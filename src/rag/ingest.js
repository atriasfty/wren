import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveTenantByGuildId, setEncryptionKey } from '../tenant/resolve.js';
import { markSourceIngested } from '../tenant/store.js';
import { loadConfig } from '../config.js';
import { embedBatch } from './embed.js';
import { ensureTenantDataDir, readVectorStore, writeVectorStore, listManualDocs, readManualDoc } from './store.js';
import { fetchWebpage } from '../integrations/search/webpage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let current = '';
  for (const s of sentences) {
    const trimmed = s.trim();
    if (current.length + trimmed.length > size && current.length > 0) {
      chunks.push(current.trim());
      const words = current.split(' ');
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      current = overlapWords.join(' ') + ' ' + trimmed;
    } else {
      current += ' ' + trimmed;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 50);
}

async function fetchChannelHistory(client, channelId, { capPerChannel = 1000 } = {}) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) return [];
  const out = [];
  let lastId = null;
  let fetched = 0;
  while (fetched < capPerChannel) {
    const opts = { limit: 100 };
    if (lastId) opts.before = lastId;
    const msgs = await channel.messages.fetch(opts);
    if (msgs.size === 0) break;
    for (const m of msgs.values()) {
      if (m.author.bot) continue;
      if (!m.content || m.content.length < 15) continue;
      if (m.content.match(/^https?:\/\//)) continue;
      if (m.content.trim().split(/\s+/).length < 3) continue;
      out.push(m.content);
      fetched++;
    }
    lastId = msgs.last()?.id;
    if (msgs.size < 100) break;
  }
  return out;
}

export async function ingestTenant(tenantCtx, client, { kinds = ['all'] } = {}) {
  await ensureTenantDataDir(tenantCtx.dataDir);
  const doAll = kinds.includes('all');
  const sources = tenantCtx.sources;
  const corpus = []; // { text, kind, ref, label }

  for (const s of sources) {
    if (!s.enabled) continue;
    if (s.kind === 'discord_channel' && (doAll || kinds.includes('channels'))) {
      try {
        const msgs = await fetchChannelHistory(client, s.ref);
        for (const content of msgs) corpus.push({ text: content, kind: s.kind, ref: s.ref, label: s.label });
      } catch (err) {
        console.warn(`[ingest] channel ${s.ref} failed: ${err.message}`);
      }
    } else if (s.kind === 'website' && (doAll || kinds.includes('websites'))) {
      const page = await fetchWebpage(s.ref, { maxChars: 50_000 });
      if (page) corpus.push({ text: page.content, kind: s.kind, ref: s.ref, label: s.label });
    } else if (s.kind === 'manual_doc' && (doAll || kinds.includes('documents'))) {
      const safe = s.ref.replace(/[^a-zA-Z0-9._-]/g, '_');
      try {
        const text = await readManualDoc(tenantCtx.dataDir, safe);
        corpus.push({ text, kind: s.kind, ref: s.ref, label: s.label });
      } catch (err) {
        console.warn(`[ingest] doc ${s.ref} failed: ${err.message}`);
      }
    }
  }

  if (!corpus.length) return { chunks: 0 };

  const chunkedCorpus = [];
  for (const c of corpus) {
    for (const chunk of chunkText(c.text)) {
      chunkedCorpus.push({ ...c, text: chunk });
    }
  }

  const store = await readVectorStore(tenantCtx.vectorStorePath);
  store.metadata = {
    createdAt: new Date().toISOString(),
    totalChunks: 0,
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  };
  store.chunks = [];

  const BATCH = 16;
  for (let i = 0; i < chunkedCorpus.length; i += BATCH) {
    const batch = chunkedCorpus.slice(i, i + BATCH);
    const vectors = await embedBatch(batch.map((b) => b.text));
    for (let j = 0; j < batch.length; j++) {
      store.chunks.push({
        id: store.chunks.length,
        text: batch[j].text,
        embedding: vectors[j],
        sourceKind: batch[j].kind,
        sourceRef: batch[j].ref,
        label: batch[j].label,
      });
    }
    console.log(`[ingest] embedded ${Math.min(i + BATCH, chunkedCorpus.length)}/${chunkedCorpus.length}`);
  }
  store.metadata.totalChunks = store.chunks.length;
  await writeVectorStore(tenantCtx.vectorStorePath, store);

  for (const s of sources) {
    if (corpus.some((c) => c.kind === s.kind && c.ref === s.ref)) {
      await markSourceIngested({ tenantId: tenantCtx.tenantId, kind: s.kind, ref: s.ref });
    }
  }
  return { chunks: store.chunks.length, sources: corpus.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
  if (!tenantArg) {
    console.error('Usage: node src/rag/ingest.js --tenant=<guildId>');
    process.exit(2);
  }
  const tenantId = tenantArg.split('=')[1];
  (async () => {
    const cfg = loadConfig();
    setEncryptionKey(cfg.tenantSecretEncKey);
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
    await client.login(cfg.discordToken);
    await clientReady(client);
    const ctx = await resolveTenantByGuildId(tenantId);
    if (!ctx) {
      console.error(`Tenant ${tenantId} not found`);
      process.exit(1);
    }
    const result = await ingestTenant(ctx, client, { kinds: ['all'] });
    console.log('✓ ingest complete', result);
    await client.destroy();
    process.exit(0);
  })().catch((err) => {
    console.error('ingest failed', err);
    process.exit(1);
  });
}

function clientReady(client) {
  if (client.isReady()) return Promise.resolve();
  return new Promise((resolve) => client.once('ready', resolve));
}
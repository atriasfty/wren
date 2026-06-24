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

export function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text) return [];
  const actualOverlap = Math.min(overlap, Math.floor(size / 2));
  // Split by standard and CJK period / question / exclamation marks, or newlines
  const sentences = text.match(/[^.!?。！？\n\r]+[.!?。！？\n\r]*/g) || [text];
  const chunks = [];
  let current = '';

  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;

    if (trimmed.length > size) {
      if (current.trim().length > 0) {
        chunks.push(current.trim());
        current = '';
      }

      const words = trimmed.split(/\s+/);
      let subChunk = '';
      for (const w of words) {
        if (subChunk.length + w.length + 1 > size && subChunk.length > 0) {
          chunks.push(subChunk.trim());
          const subWords = subChunk.trim().split(/\s+/);
          const overlapWords = subWords.slice(-Math.max(1, Math.floor(actualOverlap / 5)));
          subChunk = overlapWords.join(' ') + ' ' + w;
        } else {
          subChunk = subChunk ? subChunk + ' ' + w : w;
        }
      }

      if (subChunk.trim().length > 0) {
        if (subChunk.length > size) {
          let temp = subChunk.trim();
          while (temp.length > size) {
            chunks.push(temp.substring(0, size));
            temp = temp.substring(size - actualOverlap);
          }
          if (temp.length > 0) {
            current = temp;
          }
        } else {
          current = subChunk;
        }
      }
    } else {
      if (current.length + trimmed.length > size && current.length > 0) {
        chunks.push(current.trim());
        const words = current.split(/\s+/);
        const overlapWords = words.slice(-Math.max(1, Math.floor(actualOverlap / 5)));
        current = overlapWords.join(' ') + ' ' + trimmed;
      } else {
        current = current ? current + ' ' + trimmed : trimmed;
      }
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

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

function clientReady(client) {
  if (client.isReady()) return Promise.resolve();
  return new Promise((resolve) => client.once('ready', resolve));
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

  // Incremental: keep chunks from sources NOT being re-ingested.
  const ingestingRefs = new Set(corpus.map((c) => `${c.kind}:${c.ref}`));
  const store = await readVectorStore(tenantCtx.vectorStorePath);
  store.chunks = (store.chunks || []).filter(
    (c) => !ingestingRefs.has(`${c.sourceKind}:${c.sourceRef}`)
  );

  store.metadata = {
    createdAt: new Date().toISOString(),
    totalChunks: 0,
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  };

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
  store.chunks.forEach((c, idx) => { c.id = idx; });
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
    console.log('\u2713 ingest complete', result);
    await client.destroy();
    process.exit(0);
  })().catch((err) => {
    console.error('ingest failed', err);
    process.exit(1);
  });
}
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { embedText } from '../src/rag/embed.js';
import { ingestDiscordMessage } from '../src/rag/ingest.js';

const samples = Number(process.env.BENCH_SAMPLES ?? 40);
const chunkCount = Number(process.env.BENCH_CHUNKS ?? 3000);
const gapMs = Number(process.env.BENCH_GAP_MS ?? 0);
assert(Number.isSafeInteger(samples) && samples > 0 && Number.isSafeInteger(chunkCount) && chunkCount >= 0);
assert(Number.isFinite(gapMs) && gapMs >= 0);
const dir = await fs.mkdtemp(join(tmpdir(), 'wren-ingest-bench-'));
const vectorStorePath = join(dir, 'vector-store.json');
const ctx = {
  tenantId: 'bench-tenant', vectorStorePath,
  sources: [{ kind: 'discord_channel', ref: 'bench-channel', label: 'Announcements', enabled: true }],
};
const rename = fs.rename;
let writes = 0;
fs.rename = async (from, to) => {
  await rename(from, to);
  if (to === vectorStorePath) writes++;
};
const stop = (signal) => { process.exitCode = signal === 'SIGINT' ? 130 : 143; };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

function message(i, version) {
  return {
    id: 'bench-' + i, author: { bot: false }, channel: { id: 'bench-channel' },
    content: `Check with roleplay participants before joining any active scenes. Update ${version}, message ${i}.`,
  };
}

function latency(times) {
  times.sort((a, b) => a - b);
  const at = (p) => +times[Math.ceil(times.length * p) - 1].toFixed(2);
  return { n: times.length, p50: at(.5), p95: at(.95), p99: at(.99) };
}

try {
  const vector = await embedText(message(0, 0).content);
  let seed = 42;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const seedChunks = Array.from({ length: chunkCount }, (_, id) => ({
    id, text: ('Server rules: check with roleplay participants before joining their scene. ').repeat(6) + id,
    sourceKind: 'manual_doc', sourceRef: 'doc-' + (id % 8),
    embedding: vector.map((v) => v + (random() - .5) * .12),
  }));
  for (let i = 0; i < 4; i++) {
    const msg = message(i, 0);
    seedChunks.push({
      id: seedChunks.length, text: msg.content, messageId: msg.id, sourceKind: 'discord_channel',
      sourceRef: msg.channel.id, label: 'Announcements', embedding: vector,
    });
  }
  const fixture = JSON.stringify({ metadata: { totalChunks: seedChunks.length }, chunks: seedChunks });
  console.log({ node: process.version, samples, gapMs, chunks: seedChunks.length, bytes: Buffer.byteLength(fixture) });
  for (const lanes of [1, 4]) {
    if (process.exitCode) break;
    await fs.writeFile(vectorStorePath, fixture);
    const edits = [];
    const groups = [];
    async function group(version, record) {
      const start = performance.now();
      await Promise.all(Array.from({ length: lanes }, async (_, i) => {
        if (gapMs && i) await delay(i * gapMs);
        const arrived = gapMs && i ? performance.now() : start;
        await ingestDiscordMessage(ctx, message(i, version));
        if (record) edits.push(performance.now() - arrived);
      }));
      if (record) groups.push(performance.now() - start);
    }
    await group(0, false);
    writes = 0;
    for (let i = 1; i <= samples && !process.exitCode; i++) await group(i, true);
    if (process.exitCode) break;
    const actual = JSON.parse(await fs.readFile(vectorStorePath, 'utf8'));
    assert.equal(actual.chunks.length, seedChunks.length);
    assert(actual.chunks.every((chunk, i) => chunk.id === i));
    for (let i = 0; i < lanes; i++) {
      const expected = message(i, samples);
      assert.deepEqual(actual.chunks.filter((chunk) => chunk.messageId === expected.id).map((chunk) => chunk.text), [expected.content]);
    }
    console.log({ lanes, writes, edits: latency(edits), groups: latency(groups) });
  }
} finally {
  fs.rename = rename;
  await fs.rm(dir, { recursive: true, force: true });
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}

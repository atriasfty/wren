import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVectorStore, writeVectorStore } from '../rag/store.js';

describe('read-only vector store cache', () => {
  let directory;
  let storePath;
  const read = () => readVectorStore(storePath, { cache: true });
  const snapshot = (text) => ({ metadata: {}, chunks: [{ text }] });

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wren-vector-store-'));
    storePath = path.join(directory, 'vector-store.json');
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('shares one snapshot across overlapping and repeated reads but not with ingest', async () => {
    await writeVectorStore(storePath, snapshot('original'));
    const [first, second] = await Promise.all([read(), read()]);
    expect(second).toBe(first);
    const mutable = await readVectorStore(storePath);
    mutable.chunks[0].text = 'unsaved edit';
    expect(await read()).toBe(first);
    expect(first).toEqual(snapshot('original'));
  });

  it('sees same-length atomic replacements even if the mtime is unchanged', async () => {
    const stamp = new Date('2026-01-01T00:00:00Z');
    await writeVectorStore(storePath, snapshot('before'));
    await fs.utimes(storePath, stamp, stamp);
    expect(await read()).toEqual(snapshot('before'));

    const replacement = storePath + '.new';
    await writeVectorStore(replacement, snapshot('update'));
    await fs.utimes(replacement, stamp, stamp);
    await fs.rename(replacement, storePath);
    expect(await read()).toEqual(snapshot('update'));
    await fs.unlink(storePath);
    expect(await read()).toEqual({ metadata: {}, chunks: [] });
  });

  it('evicts the least recently used path instead of retaining every tenant', async () => {
    await writeVectorStore(storePath, snapshot('old'));
    const old = await read();
    for (let i = 0; i < 32; i++) {
      const other = path.join(directory, 'tenant-' + i + '.json');
      await writeVectorStore(other, snapshot('new'));
      expect(await readVectorStore(other, { cache: true })).toEqual(snapshot('new'));
    }
    expect(await read()).not.toBe(old);
  });

  it('leaves corrupt-file quarantine to the fresh ingest read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await fs.writeFile(storePath, 'corrupt');
    expect((await read()).chunks).toEqual([]);
    expect(await fs.readFile(storePath, 'utf8')).toBe('corrupt');
    expect((await readVectorStore(storePath)).chunks).toEqual([]);
    expect(await fs.readdir(directory)).toEqual([expect.stringMatching(/\.corrupt-/)]);
    await writeVectorStore(storePath, snapshot('rebuilt'));
    expect(await read()).toEqual(snapshot('rebuilt'));
  });
});

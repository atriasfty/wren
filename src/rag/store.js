import fs from 'fs/promises';
import path from 'path';

export async function ensureTenantDataDir(dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'manual'), { recursive: true });
}

export async function readVectorStore(vectorStorePath) {
  let raw;
  try {
    raw = await fs.readFile(vectorStorePath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return { metadata: {}, chunks: [] };
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    // A corrupt store would otherwise fail every retrieval and ingest forever.
    // Set it aside (recoverable by hand) and start empty; a re-ingest rebuilds it.
    const aside = `${vectorStorePath}.corrupt-${Date.now()}`;
    console.error(`[rag] vector store ${vectorStorePath} is corrupt (${err.message}); moved to ${aside}`);
    await fs.rename(vectorStorePath, aside).catch(() => {});
    return { metadata: {}, chunks: [] };
  }
}

export async function writeVectorStore(vectorStorePath, store) {
  // Unique temp name: the CLI ingest runs as a separate process and must not
  // share a temp file with the bot. Compact JSON — the store holds every
  // embedding, and pretty-printing roughly doubles its size.
  const tmp = `${vectorStorePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(store));
    await fs.rename(tmp, vectorStorePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

export async function appendManualDoc(dataDir, filename, content) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const full = path.join(dataDir, 'manual', safe);
  await fs.writeFile(full, content, 'utf-8');
  return safe;
}

export async function listManualDocs(dataDir) {
  try {
    const files = await fs.readdir(path.join(dataDir, 'manual'));
    return files.filter((f) => f.endsWith('.txt') || f.endsWith('.md'));
  } catch {
    return [];
  }
}

export async function readManualDoc(dataDir, filename) {
  // Defence in depth: sanitise here too, not only at the call site, so a stray
  // caller can never traverse out of the tenant's manual/ directory.
  const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return fs.readFile(path.join(dataDir, 'manual', safe), 'utf-8');
}
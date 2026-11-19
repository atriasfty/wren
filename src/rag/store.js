import fs from 'fs/promises';
import path from 'path';

const PARSED_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const PARSED_CACHE_MAX_ENTRIES = 32;
const parsedStores = new Map();
let parsedStoreBytes = 0;

function forgetParsedStore(vectorStorePath) {
  const entry = parsedStores.get(vectorStorePath);
  if (entry) {
    parsedStoreBytes -= entry.bytes;
    parsedStores.delete(vectorStorePath);
  }
}

function emptyStore() {
  return { metadata: {}, chunks: [] };
}

export async function ensureTenantDataDir(dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'manual'), { recursive: true });
}

async function loadVectorStore(vectorStorePath, file) {
  let raw;
  try {
    raw = await (file ? file.readFile('utf-8') : fs.readFile(vectorStorePath, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore();
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    if (file) {
      // A retrieval may have opened an old inode just before ingest replaced it.
      // Let ingest quarantine corruption instead of renaming the current path.
      console.error(`[rag] could not parse vector store ${vectorStorePath} (${err.message}); re-ingest to rebuild`);
      return emptyStore();
    }
    // A corrupt store would otherwise fail every retrieval and ingest forever.
    // Set it aside (recoverable by hand) and start empty; a re-ingest rebuilds it.
    const aside = `${vectorStorePath}.corrupt-${Date.now()}`;
    console.error(`[rag] vector store ${vectorStorePath} is corrupt (${err.message}); moved to ${aside}`);
    await fs.rename(vectorStorePath, aside).catch(() => {});
    return emptyStore();
  }
}

// Only read-only callers may share a parsed snapshot; ingest mutates its copy.
export async function readVectorStore(vectorStorePath, { cache = false } = {}) {
  if (!cache) return loadVectorStore(vectorStorePath);

  let file;
  try {
    file = await fs.open(vectorStorePath, 'r');
  } catch (err) {
    forgetParsedStore(vectorStorePath);
    if (err.code === 'ENOENT') return emptyStore();
    throw err;
  }

  try {
    // Stat the opened file, not its path: ingest can replace the path atomically
    // from another process, including with a new file of the same size and mtime.
    const { dev, ino, size, mtimeNs, ctimeNs } = await file.stat({ bigint: true });
    const version = `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`;
    const cached = parsedStores.get(vectorStorePath);
    if (cached?.version === version) {
      parsedStores.delete(vectorStorePath);
      parsedStores.set(vectorStorePath, cached);
      return await cached.store;
    }

    forgetParsedStore(vectorStorePath);
    const store = loadVectorStore(vectorStorePath, file);
    if (size > PARSED_CACHE_MAX_BYTES) return await store;

    // Budget by on-disk bytes as a proxy for the retained parsed heap.
    const bytes = Number(size);
    parsedStores.set(vectorStorePath, { version, store, bytes });
    parsedStoreBytes += bytes;
    while (parsedStoreBytes > PARSED_CACHE_MAX_BYTES || parsedStores.size > PARSED_CACHE_MAX_ENTRIES) {
      forgetParsedStore(parsedStores.keys().next().value);
    }
    try {
      return await store;
    } catch (err) {
      if (parsedStores.get(vectorStorePath)?.store === store) forgetParsedStore(vectorStorePath);
      throw err;
    }
  } finally {
    await file.close();
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
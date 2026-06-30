import fs from 'fs/promises';
import path from 'path';

export async function ensureTenantDataDir(dataDir) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'manual'), { recursive: true });
}

export async function readVectorStore(vectorStorePath) {
  try {
    const raw = await fs.readFile(vectorStorePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return { metadata: {}, chunks: [] };
    throw err;
  }
}

export async function writeVectorStore(vectorStorePath, store) {
  const tmp = vectorStorePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, vectorStorePath);
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
  // [SECURITY-FIX] Path traversal: sanitize filename
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return fs.readFile(path.join(dataDir, 'manual', safe), 'utf-8');
}
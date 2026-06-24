import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the memories file
const MEMORY_FILE_PATH = path.join(__dirname, '..', '..', 'data', 'memories.json');

// Memory structure cache
let memoryCache = {
  server: [], // Array of { content, addedBy, timestamp }
  users: {}   // Map userId -> Array of { content, timestamp }
};

/**
 * Initialize and load memories
 */
export async function initMemory() {
  try {
    const data = await fs.readFile(MEMORY_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(data);
    
    memoryCache.server = parsed.server || [];
    memoryCache.users = parsed.users || {};
    
    console.log(`🧠 Memory loaded: ${memoryCache.server.length} server facts, ${Object.keys(memoryCache.users).length} user contexts.`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('🧠 No memory file found, creating new one.');
      await saveMemory();
    } else {
      console.error('❌ Failed to load memories:', error);
    }
  }
}

/**
 * Save current cache to disk
 */
async function saveMemory() {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(MEMORY_FILE_PATH);
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }

    await fs.writeFile(MEMORY_FILE_PATH, JSON.stringify(memoryCache, null, 2), 'utf-8');
  } catch (error) {
    console.error('❌ Failed to save memories:', error);
  }
}

/**
 * Add a global server memory (Rule, Policy, Fact)
 * @param {string} content - The fact to remember
 * @param {string} addedBy - User ID/Name of who added it
 */
export async function addServerMemory(content, addedBy) {
  const memory = {
    content,
    addedBy,
    timestamp: Date.now()
  };
  
  memoryCache.server.push(memory);
  await saveMemory();
  return memory;
}

/**
 * Add a user-specific memory
 * @param {string} userId - Discord User ID
 * @param {string} content - The fact to remember
 */
export async function addUserMemory(userId, content) {
  if (!memoryCache.users[userId]) {
    memoryCache.users[userId] = [];
  }
  
  const memory = {
    content,
    timestamp: Date.now()
  };
  
  memoryCache.users[userId].push(memory);
  await saveMemory();
  return memory;
}

/**
 * Get all server memories formatted for the prompt
 */
export function getServerMemories() {
  return memoryCache.server.map(m => `• ${m.content}`).join('\n');
}

/**
 * Get memories for a specific user formatted for the prompt
 * @param {string} userId 
 */
export function getUserMemories(userId) {
  if (!memoryCache.users[userId] || memoryCache.users[userId].length === 0) {
    return '';
  }
  return memoryCache.users[userId].map(m => `• ${m.content}`).join('\n');
}

/**
 * Remove a server memory (by index or content match - simplified to index for now or exact content)
 * Not exposed to AI directly, mostly for maintenance if needed
 */
export async function removeServerMemory(content) {
  const initialLength = memoryCache.server.length;
  memoryCache.server = memoryCache.server.filter(m => m.content !== content);
  
  if (memoryCache.server.length !== initialLength) {
    await saveMemory();
    return true;
  }
  return false;
}

// Initialize on load
initMemory();

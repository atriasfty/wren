import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { Client, GatewayIntentBits } from 'discord.js';
import { pipeline } from '@xenova/transformers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Use local embedding model (small and fast)
let embedder = null;

async function initEmbedder() {
  console.log('🔧 Loading local embedding model (one-time download)...');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('✓ Embedding model loaded (~80MB RAM)');
}

const INPUT_FILE = './data/input.txt';
const CHAT_LOGS_DIR = './1395208327293702195';
const VECTOR_STORE_PATH = './data/vector-store.json';
const CHUNK_SIZE = 1000; // Characters per chunk (larger to reduce processing)
const CHUNK_OVERLAP = 150; // Overlap between chunks

// No more rate limiting needed - local model!
const BATCH_SIZE = 10; // Process 10 chunks at a time

const DOCUMENTATION_URLS = [
  'https://lacrp.ciankelly.xyz/',
  'https://lacrp.ciankelly.xyz/server-rules',
  'https://lacrp.ciankelly.xyz/staff-handbook',
  'https://lacrp.ciankelly.xyz/sts-guide'
];

// Discord client for progress updates
let discordClient = null;
let progressChannel = null;

/**
 * Initialize Discord client for progress updates
 */
async function initDiscord() {
  if (!process.env.DISCORD_TOKEN || !process.env.PROGRESS_CHANNEL_ID) {
    console.log('ℹ️  Discord progress updates disabled (no token/channel configured)');
    return;
  }

  try {
    discordClient = new Client({
      intents: [GatewayIntentBits.Guilds]
    });

    await discordClient.login(process.env.DISCORD_TOKEN);
    
    progressChannel = await discordClient.channels.fetch(process.env.PROGRESS_CHANNEL_ID);
    console.log('✓ Discord progress updates enabled');
    
    await sendProgress('🚀 **Starting Knowledge Base Ingestion**\nProcessing documentation, chat logs, and creating embeddings...');
  } catch (error) {
    console.log('⚠️  Discord progress updates failed:', error.message);
    discordClient = null;
    progressChannel = null;
  }
}

/**
 * Send progress update to Discord
 */
async function sendProgress(message) {
  if (progressChannel) {
    try {
      await progressChannel.send(message);
    } catch (error) {
      console.log('⚠️  Failed to send Discord update:', error.message);
    }
  }
}

/**
 * Split text into chunks with overlap (smart chunking by sentences)
 */
function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  
  // Split by sentences for better context
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  let currentChunk = '';
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    
    if (currentChunk.length + trimmedSentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      
      // Add overlap from the end of the previous chunk
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.floor(overlap / 5)); // Approximate overlap
      currentChunk = overlapWords.join(' ') + ' ' + trimmedSentence;
    } else {
      currentChunk += ' ' + trimmedSentence;
    }
  }
  
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  // Filter out very small chunks
  return chunks.filter(chunk => chunk.length > 50);
}

/**
 * Generate embedding for a given text using local model
 */
async function generateEmbedding(text) {
  try {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (error) {
    console.error('❌ Embedding error:', error.message);
    throw error;
  }
}

/**
 * Fetch and extract text from website with better parsing
 */
async function fetchWebsiteContent(url) {
  try {
    console.log(`   📥 Fetching: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LACRP-Bot/1.0)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Remove unwanted elements
    $('script, style, nav, header, footer, .navigation, .menu').remove();
    
    // Get main content (prioritize main, article, or body)
    let text = '';
    const mainContent = $('main, article, .content, #content').first();
    
    if (mainContent.length > 0) {
      text = mainContent.text();
    } else {
      text = $('body').text();
    }
    
    // Clean up text
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
    
    console.log(`   ✓ Fetched ${text.length} characters from ${url}`);
    return `\n\n=== SOURCE: ${url} ===\n${text}\n`;
  } catch (error) {
    console.error(`   ❌ Error fetching ${url}:`, error.message);
    return '';
  }
}

/**
 * Process chat logs from JSON files with better filtering
 */
async function processChatLogs() {
  console.log(`📜 Processing chat logs from ${CHAT_LOGS_DIR}...`);
  await sendProgress('📜 **Processing Chat Logs**\nReading last 30 days of messages...');
  
  try {
    const files = await fs.readdir(CHAT_LOGS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort().slice(-30); // Last 30 days
    
    console.log(`   Found ${jsonFiles.length} chat log files`);
    
    let allMessages = [];
    let processedFiles = 0;
    
    for (const file of jsonFiles) {
      const filePath = path.join(CHAT_LOGS_DIR, file);
      
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const messages = JSON.parse(content);
        
        // Filter and format messages - only meaningful content
        const formattedMessages = messages
          .filter(msg => {
            // Skip empty, very short, or bot messages
            if (!msg.content || msg.content.length < 15) return false;
            
            // Skip common noise (single words, reactions, etc.)
            const wordCount = msg.content.trim().split(/\s+/).length;
            if (wordCount < 3) return false;
            
            // Skip messages that are just links or mentions
            if (msg.content.match(/^https?:\/\//)) return false;
            
            return true;
          })
          .map(msg => {
            const date = new Date(msg.timestamp).toISOString().split('T')[0];
            const channel = msg.channel.name.replace(/[-_]/g, ' ');
            return `[${date} #${channel}] ${msg.author.displayName}: ${msg.content}`;
          });
        
        allMessages = allMessages.concat(formattedMessages);
        processedFiles++;
        
        if (processedFiles % 5 === 0) {
          console.log(`   ⏳ Processed ${processedFiles}/${jsonFiles.length} files...`);
        }
      } catch (error) {
        console.warn(`   ⚠️  Error reading ${file}:`, error.message);
      }
    }
    
    console.log(`   ✓ Processed ${allMessages.length} meaningful messages from ${processedFiles} files`);
    await sendProgress(`✓ Processed **${allMessages.length}** messages from **${processedFiles}** files`);
    
    return '\n\n=== CHAT LOGS (Last 30 Days) ===\n' + allMessages.join('\n');
    
  } catch (error) {
    console.error('   ❌ Error processing chat logs:', error.message);
    await sendProgress(`⚠️ Error processing chat logs: ${error.message}`);
    return '';
  }
}

/**
 * Main ingestion function
 */
async function ingestDocuments() {
  const startTime = Date.now();
  console.log('🚀 Starting document ingestion with LOCAL embeddings...');
  console.log('⏰ Estimated time: 5-10 minutes (no API rate limits!)\n');

  try {
    // Initialize Discord for progress updates
    await initDiscord();
    
    // Initialize local embedding model
    await initEmbedder();
    
    let allContent = '';
    let stats = {
      manualDocs: 0,
      websitePages: 0,
      chatMessages: 0
    };
    
    // 1. Read the input file (if exists and has content)
    console.log('📖 Step 1/5: Reading manual input file...');
    try {
      const manualContent = await fs.readFile(INPUT_FILE, 'utf-8');
      if (manualContent.trim().length > 100 && !manualContent.includes('[ADD ANY ADDITIONAL DOCUMENTATION HERE IF NEEDED]')) {
        allContent += '\n\n=== MANUAL DOCUMENTATION ===\n' + manualContent;
        stats.manualDocs = manualContent.length;
        console.log(`   ✓ Added ${(stats.manualDocs / 1024).toFixed(1)}KB of manual content`);
      } else {
        console.log(`   ℹ️  No manual content (using website + chat logs only)`);
      }
    } catch (error) {
      console.log(`   ℹ️  No manual input file found (optional)`);
    }
    
    // 2. Fetch documentation from website
    console.log('\n🌐 Step 2/5: Fetching documentation from website...');
    await sendProgress('🌐 **Fetching Documentation**\nDownloading content from website...');
    
    for (let i = 0; i < DOCUMENTATION_URLS.length; i++) {
      const url = DOCUMENTATION_URLS[i];
      const webContent = await fetchWebsiteContent(url);
      if (webContent.trim().length > 0) {
        allContent += webContent;
        stats.websitePages++;
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting for web scraping
    }
    console.log(`   ✓ Fetched ${stats.websitePages}/${DOCUMENTATION_URLS.length} pages`);
    await sendProgress(`✓ Fetched **${stats.websitePages}** documentation pages`);
    
    // 3. Process chat logs
    console.log('\n📜 Step 3/5: Processing chat logs...');
    const chatContent = await processChatLogs();
    allContent += chatContent;
    const chatMessageCount = (chatContent.match(/\[20\d{2}-\d{2}-\d{2}/g) || []).length;
    stats.chatMessages = chatMessageCount;

    if (!allContent.trim() || allContent.length < 500) {
      const error = '❌ No sufficient content found to process!';
      console.error(error);
      await sendProgress(error);
      process.exit(1);
    }

    // 4. Split into chunks
    console.log('\n✂️  Step 4/5: Creating text chunks...');
    await sendProgress('✂️ **Creating Chunks**\nSplitting content into searchable pieces...');
    const chunks = chunkText(allContent);
    console.log(`   ✓ Created ${chunks.length} chunks (avg ${Math.round(allContent.length / chunks.length)} chars each)`);
    console.log(`   📊 Total content: ${(allContent.length / 1024).toFixed(1)}KB`);
    await sendProgress(`✓ Created **${chunks.length}** searchable chunks`);

    // 5. Generate embeddings for each chunk
    console.log('\n🔢 Step 5/5: Generating embeddings with local model...');
    console.log(`   ⏱️  Estimated time: ~${Math.ceil(chunks.length / 50)} minutes (fast!)`);
    await sendProgress(`🔢 **Generating Embeddings**\nProcessing **${chunks.length}** chunks with local model...\n⏱️ Fast processing - no rate limits!`);
    
    // Ensure data directory exists
    await fs.mkdir('./data', { recursive: true });

    // Create metadata
    const metadata = {
      createdAt: new Date().toISOString(),
      totalChunks: chunks.length,
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
      sources: {
        manualDocs: stats.manualDocs > 0,
        websitePages: stats.websitePages,
        chatMessages: stats.chatMessages
      },
      processingTime: 0
    };

    // Write initial file structure with metadata
    await fs.writeFile(
      VECTOR_STORE_PATH,
      JSON.stringify({ metadata, chunks: [] }, null, 2)
    );

    let successfulChunks = 0;
    let lastProgressUpdate = 0;
    const progressUpdateInterval = 10;
    const processedChunks = [];
    
    // Track processing times for accurate ETA
    const processingTimes = [];
    let lastCheckpoint = Date.now();

    for (let i = 0; i < chunks.length; i++) {
      const chunkNum = i + 1;
      const progress = ((chunkNum / chunks.length) * 100).toFixed(1);
      
      // Track time for this chunk
      const chunkStartTime = Date.now();
      
      // Console progress with smart ETA
      if (chunkNum % 5 === 0 || chunkNum === chunks.length) {
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        
        // Calculate ETA based on last 10 chunks average
        let remaining = '...';
        if (processingTimes.length >= 5) {
          const recentTimes = processingTimes.slice(-10);
          const avgTime = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length;
          remaining = ((avgTime * (chunks.length - chunkNum)) / 1000 / 60).toFixed(1);
        }
        
        console.log(`   ⏳ ${progress}% (${chunkNum}/${chunks.length}) | Elapsed: ${elapsed}m | ETA: ~${remaining}m`);
      }
      
      // Discord progress update
      if (chunkNum - lastProgressUpdate >= progressUpdateInterval || chunkNum === chunks.length) {
        await sendProgress(`⏳ Progress: **${progress}%** (${chunkNum}/${chunks.length} chunks)`);
        lastProgressUpdate = chunkNum;
      }
      
      // Generate embedding with local model (no rate limiting needed!)
      try {
        const embedding = await generateEmbedding(chunks[i]);
        
        // Track processing time for this chunk
        processingTimes.push(Date.now() - chunkStartTime);
        if (processingTimes.length > 20) processingTimes.shift(); // Keep only last 20
        
        processedChunks.push({
          id: successfulChunks,
          text: chunks[i],
          embedding: embedding,
        });
        
        successfulChunks++;
        
        // Write to file every 100 chunks to free memory
        if (processedChunks.length >= 100 || chunkNum === chunks.length) {
          const existingData = JSON.parse(await fs.readFile(VECTOR_STORE_PATH, 'utf-8'));
          existingData.chunks.push(...processedChunks);
          await fs.writeFile(
            VECTOR_STORE_PATH,
            JSON.stringify(existingData, null, 2)
          );
          console.log(`   💾 Saved ${successfulChunks} chunks to disk (freed memory)`);
          processedChunks.length = 0; // Clear array
        }
        
      } catch (error) {
        console.error(`   ❌ Failed to embed chunk ${chunkNum}:`, error.message);
        await sendProgress(`⚠️ Warning: Failed to embed chunk ${chunkNum}, skipping...`);
        continue;
      }

      // No rate limiting needed for local model!
    }

    // Update final metadata
    const finalData = JSON.parse(await fs.readFile(VECTOR_STORE_PATH, 'utf-8'));
    finalData.metadata.processingTime = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    finalData.metadata.totalChunks = successfulChunks;
    await fs.writeFile(
      VECTOR_STORE_PATH,
      JSON.stringify(finalData, null, 2)
    );

    const summary = `
✅ **Ingestion Complete!**
━━━━━━━━━━━━━━━━━━━━━━━━
📊 **Statistics:**
   • Total chunks: **${successfulChunks}**
   • Website pages: **${stats.websitePages}**
   • Chat messages: **${stats.chatMessages}**
   • Processing time: **${finalData.metadata.processingTime} minutes**
   
💾 Vector store saved to: \`${VECTOR_STORE_PATH}\`

🤖 **Bot is ready!** Run \`npm start\` to launch.
`;

    console.log(summary);
    await sendProgress(summary);
    
    // Close Discord client
    if (discordClient) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      discordClient.destroy();
    }

  } catch (error) {
    console.error('\n❌ Error during ingestion:', error);
    await sendProgress(`❌ **Error during ingestion:**\n\`\`\`${error.message}\`\`\``);
    
    if (discordClient) {
      discordClient.destroy();
    }
    
    process.exit(1);
  }
}

// Run the ingestion
ingestDocuments();

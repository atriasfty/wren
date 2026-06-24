import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { pipeline } from '@xenova/transformers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Use same local embedding model
let embedder = null;

async function initEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

const VECTOR_STORE_PATH = './data/vector-store.json';

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Generate embedding for a given text using local model
 */
async function generateEmbedding(text) {
  const model = await initEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Load the vector store from disk
 */
async function loadVectorStore() {
  try {
    const data = await fs.readFile(VECTOR_STORE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No vector store found. Please run the ingest script first.');
      return { chunks: [] };
    }
    throw error;
  }
}

/**
 * Query the knowledge base with a question
 * Returns the most relevant text chunks
 */
export async function queryKnowledgeBase(question, topK = 10) {
  try {
    console.log(`🔍 Searching knowledge base for: "${question}"`);
    
    // Load vector store
    const vectorStore = await loadVectorStore();

    if (!vectorStore.chunks || vectorStore.chunks.length === 0) {
      console.log('❌ No chunks found in vector store');
      return 'No knowledge base loaded. Please run `npm run ingest` first to process your documents.';
    }

    console.log(`✓ Loaded ${vectorStore.chunks.length} chunks from knowledge base`);

    // Generate embedding for the question
    const questionEmbedding = await generateEmbedding(question);
    console.log(`✓ Generated question embedding (${questionEmbedding.length} dimensions)`);

    // Calculate similarities and rank chunks
    const rankedChunks = vectorStore.chunks
      .map((chunk) => ({
        ...chunk,
        similarity: cosineSimilarity(questionEmbedding, chunk.embedding),
      }))
      .filter(chunk => chunk.similarity > 0.05); // Very low threshold to get more results

    console.log(`✓ Found ${rankedChunks.length} chunks above similarity threshold`);

    // Sort by similarity (highest first)
    rankedChunks.sort((a, b) => b.similarity - a.similarity);

    // Log top similarities
    if (rankedChunks.length > 0) {
      console.log(`Top 5 similarities: ${rankedChunks.slice(0, 5).map(c => c.similarity.toFixed(3)).join(', ')}`);
    }

    // Get top K results (increased from 5 to 10)
    const topChunks = rankedChunks.slice(0, topK);

    if (topChunks.length === 0) {
      console.log('❌ No relevant chunks found');
      return 'No relevant information found in the knowledge base for this question. Try rephrasing or asking about something else.';
    }

    console.log(`✓ Returning ${topChunks.length} most relevant chunks`);

    // Combine the text from top chunks - MORE INFO
    const context = topChunks
      .map((chunk, i) => {
        const similarityPercent = (chunk.similarity * 100).toFixed(1);
        return `[Source ${i + 1} - Match: ${similarityPercent}%]\n${chunk.text}`;
      })
      .join('\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n');

    return context;
  } catch (error) {
    console.error('❌ Error querying knowledge base:', error);
    return 'Error accessing knowledge base. Please try again.';
  }
}

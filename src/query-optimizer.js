/**
 * Query Optimizer using Mistral API
 * Optimizes user questions into better search queries for web and Discord
 */

import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

// Simple rate limiter promise
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Optimize a user question into a better search query AND extract memories
 * @param {string} userQuestion - The original user question
 * @param {string} searchType - 'web' or 'discord'
 * @param {string} authorName - The username of the person asking (for memory attribution)
 * @returns {Promise<Object>} - { searchQuery: string, memory: { type: 'user'|'server', content: string } | null }
 */
export async function analyzeRequest(userQuestion, searchType = 'web', authorName = 'User') {
    try {
        console.log(`🧠 Analyzing request ("${userQuestion}") via Mistral...`);

        // 1. Rate Limit (1 second delay)
        await delay(1000);

        // 2. Prepare Prompt
        const systemPrompt = `You are a helper AI that analyzes user requests.
Your goal is to:
1. Generate an OPTIMIZED search query for a ${searchType} search engine.
2. Extract any NEW facts/memories the user is telling you about THEMSELVES or the SERVER.

RULES FOR OPTIMIZED QUERY:
- Remove bot names, polite phrases, and fillers.
- Focus on the core intent.

RULES FOR MEMORY EXTRACTION:
- If the user says "My name is X", "I am a cop", "I prefer red cars" -> Extract as USER memory.
- If the user says "The new server rule is X", "The speed limit is now 50" -> Extract as SERVER memory.
- IGNORE commands or questions like "Who is online?", "Ban X". Only extract FACTS stated by the user.
- If no fact is stated, return null for memory.

OUTPUT FORMAT (JSON ONLY):
{
  "searchQuery": "optimized keyword query",
  "memory": { "type": "user" | "server", "content": "The fact to remember" } OR null
}`;

        // 3. Call Mistral API
        const result = await mistral.chat.complete({
            model: 'mistral-small-2501',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `User ${authorName} says: "${userQuestion}"` }
            ],
            temperature: 0.1, // Low temp for consistent JSON
            responseFormat: { type: 'json_object' } // Force JSON
        });

        const content = result.choices[0].message.content;
        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (e) {
            console.error('Failed to parse analysis JSON:', content);
            return { searchQuery: userQuestion, memory: null };
        }

        console.log(`🧠 Analysis Result: Query="${parsed.searchQuery}", Memory=${parsed.memory ? parsed.memory.content : 'None'}`);
        return {
            searchQuery: parsed.searchQuery || userQuestion,
            memory: parsed.memory
        };

    } catch (error) {
        console.error('⚠️ Request analysis failed, using original:', error.message);
        return { searchQuery: userQuestion, memory: null };
    }
}

/**
 * Legacy support for "preload" - now just a no-op since it's an API
 */
export async function preloadOptimizer() {
    // No-op for API
    return Promise.resolve();
}

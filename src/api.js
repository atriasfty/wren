/**
 * Garmin API Server
 * Exposes Garmin's AI capabilities via HTTP REST API
 * 
 * Endpoint: POST /api/ask
 * Body: { "text": "your question", "auth_token": "your_api_key" }
 * Response: { "success": true, "response": "Garmin's answer" }
 */

import express from 'express';
import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { queryKnowledgeBase } from './rag.js';
import { webSearch } from './search.js';
import { executeFunctionCall } from './ai-tools.js';
import { getServerMemories, getUserMemories } from './services/memory-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const GARMIN_API_KEY = process.env.GARMIN_API_KEY;
const API_PORT = process.env.API_PORT || 42011;

const app = express();
app.use(express.json());

// Tools definition (same as index.js, subset for API)
const tools = [
    {
        type: 'function',
        function: {
            name: 'get_server_stats',
            description: 'Get current server statistics (player count, staff online, etc.)',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'list_online_players',
            description: 'List all players currently online in the server',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'check_if_online',
            description: 'Check if a specific player is currently online',
            parameters: {
                type: 'object',
                properties: {
                    username: { type: 'string', description: 'Player to check' }
                },
                required: ['username']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_player_info',
            description: 'Get detailed information about a player (team, permission level, callsign)',
            parameters: {
                type: 'object',
                properties: {
                    username: { type: 'string', description: 'Player to get info about' }
                },
                required: ['username']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'check_if_staff',
            description: 'Check if a player is staff (Moderator, Admin, or Owner)',
            parameters: {
                type: 'object',
                properties: {
                    username: { type: 'string', description: 'Player to check' }
                },
                required: ['username']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_command_logs',
            description: 'Search command logs for specific player actions or patterns',
            parameters: {
                type: 'object',
                properties: {
                    username: { type: 'string', description: 'Username to search for (optional)' },
                    limit: { type: 'number', description: 'Number of results to return (default 10)' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'lookup_roblox_profile',
            description: 'Get public Roblox profile information (account age, groups, etc.).',
            parameters: {
                type: 'object',
                properties: {
                    username: { type: 'string', description: 'Roblox username to lookup' }
                },
                required: ['username']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'analyze_player_activity',
            description: "Analyze a player's recent ERLC activity (joins, kills, commands) from logs.",
            parameters: {
                type: 'object',
                properties: {
                    username: { type: 'string', description: 'Roblox username to analyze' }
                },
                required: ['username']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'save_memory',
            description: 'Save a specific fact to long-term memory. Use type="server" for global rules/policies (Staff Only), or type="user" for facts about the specific user talking to you.',
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: 'The specific fact, rule, or preference to remember.' },
                    type: { type: 'string', enum: ['server', 'user'], description: 'The type of memory: "server" for global facts, "user" for personal facts.' }
                },
                required: ['content', 'type']
            }
        }
    }
];

// Core system prompt for API
const CORE_INFO = `Your name is Garmin, you're a helpful AI assistant for Los Angeles City Roleplay (LACRP/LACOMM).

KEY INFORMATION:
• Server Name: Los Angeles City Roleplay (LACRP)
• Join Code: LACOMM (both in-game and Discord invite)
• Owner: MrPxlarizedGG (also known as MrPxl)
• Roblox Group: https://www.roblox.com/communities/238079265/Los-Angeles-City-Roleplay-Whitelisted
You were made by Cisaa aka cisaakl, but your AI model was trained by Mistral AI.

MAIN RULES:
• RDM (Random Death Match) - No random shooting
• VDM (Vehicle Death Match) - No random ramming
• FRP (Fail Roleplay) - Must be realistic
• NLR (New Life Rule) - Forget previous life when you die
• Fear RP - Act realistically when threatened
• Safe Zones - No RP at spawns, PD, FD, Sheriff, DOT
• Exotics/Electrics - Booster-only vehicles

RESPONSE STYLE:
- Be direct, clear, and informative
- Keep responses focused and concise
- Use bullet points for multiple items
- Get straight to the answer

🚨 CRITICAL: NEVER HALLUCINATE INFORMATION 🚨
• If you don't know something, SAY "I don't know"
• NEVER make up player names, usernames, statistics, or events
• If a tool fails or returns no data, admit it
• Only state facts from: your tools, the knowledge base, or web search results

NOTE: This is an API request, not a Discord message. You have NO access to Discord-specific tools.
You CAN use: get_server_stats, list_online_players, check_if_online, get_player_info, check_if_staff, search_command_logs, lookup_roblox_profile, analyze_player_activity.`;

// Helper function to call Mistral
async function callMistral(messages, useTools = false) {
    const options = {
        model: 'mistral-large-2411',
        messages: messages
    };
    if (useTools) {
        options.tools = tools;
        options.toolChoice = 'auto';
    }
    return await mistral.chat.complete(options);
}

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests per minute

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitMap.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

    if (now > record.resetTime) {
        record.count = 0;
        record.resetTime = now + RATE_LIMIT_WINDOW;
    }

    record.count++;
    rateLimitMap.set(ip, record);

    return record.count <= RATE_LIMIT_MAX;
}

// Main API endpoint
app.post('/api/ask', async (req, res) => {
    const startTime = Date.now();
    const clientIP = req.ip || req.connection.remoteAddress;

    // Set long timeout for AI processing (2 minutes)
    req.setTimeout(120000);
    res.setTimeout(120000);

    // Keep connection alive during processing
    const keepAliveInterval = setInterval(() => {
        if (!res.headersSent) {
            res.write(''); // Empty write to keep connection alive
        }
    }, 30000);

    let toolCallsMade = []; // Track tool calls for response

    try {
        // Auth check
        const { text, auth_token } = req.body;

        if (!auth_token || auth_token !== GARMIN_API_KEY) {
            clearInterval(keepAliveInterval);
            console.log(`🚫 API: Unauthorized request from ${clientIP}`);
            return res.status(401).json({
                success: false,
                error: 'Unauthorized: Invalid or missing auth_token'
            });
        }

        // Rate limit check
        if (!checkRateLimit(clientIP)) {
            clearInterval(keepAliveInterval);
            console.log(`⏱️ API: Rate limit exceeded for ${clientIP}`);
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded. Max 30 requests per minute.'
            });
        }

        // Validate input
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            clearInterval(keepAliveInterval);
            return res.status(400).json({
                success: false,
                error: 'Missing or invalid "text" field'
            });
        }

        const question = text.trim();
        console.log(`🌐 API Request from ${clientIP}: "${question.substring(0, 50)}..."`);

        // Get knowledge base context
        let relevantContext = '';
        if (question.length > 5) {
            try {
                relevantContext = await queryKnowledgeBase(question);
            } catch (err) {
                console.error('KB query failed:', err);
            }
        }

        // Get web search results
        let webResults = '';
        try {
            const results = await webSearch(question, 3);
            if (results && results.length) {
                webResults = '\n\nWEB SEARCH RESULTS:\n';
                results.forEach((r, idx) => {
                    webResults += `${idx + 1}. ${r.title} - ${r.snippet}\n`;
                });
            }
        } catch (err) {
            console.error('Web search failed:', err);
        }

        // Get Memories
        const serverMemories = getServerMemories();
        const userMemories = getUserMemories(clientIP);

        // Build prompt
        const currentDateTime = new Date().toISOString();
        const prompt = `${CORE_INFO}

CURRENT DATE/TIME: ${currentDateTime}

MEMORY (Facts you know):
${serverMemories ? `SERVER FACTS (Apply to everyone):\n${serverMemories}\n` : ''}
${userMemories ? `USER FACTS (Apply to ${clientIP}):\n${userMemories}\n` : ''}

${relevantContext ? `KNOWLEDGE BASE CONTEXT:\n${relevantContext.substring(0, 5000)}\n` : ''}
${webResults}

USER'S QUESTION: ${question}

Provide a clear, factual answer:`;

        // Call Mistral with tools
        let result = await callMistral([{ role: 'user', content: prompt }], true);
        let response = result.choices[0];
        let finalResponse = '';

        // Handle tool calls
        const toolCalls = response.message.toolCalls || [];

        if (toolCalls.length > 0) {
            console.log(`🛠️ API: AI wants to call ${toolCalls.length} tools`);

            const functionResponses = [];

            for (const tc of toolCalls) {
                const args = typeof tc.function.arguments === 'string'
                    ? JSON.parse(tc.function.arguments)
                    : tc.function.arguments;

                const functionResult = await executeFunctionCall(
                    { name: tc.function.name, args },
                    null, // No guild for API
                    { playerName: clientIP } // Use clientIP as player name for memory tracking
                );

                functionResponses.push({
                    id: tc.id,
                    name: tc.function.name,
                    response: functionResult
                });

                // Track for response
                toolCallsMade.push({
                    tool: tc.function.name,
                    args: args
                });
            }

            // Get final response from AI with tool results
            const messages = [
                { role: 'user', content: prompt },
                response.message,
                ...functionResponses.map(fr => ({
                    role: 'tool',
                    toolCallId: fr.id,
                    name: fr.name,
                    content: JSON.stringify(fr.response)
                }))
            ];

            const followUp = await callMistral(messages, false);
            finalResponse = followUp.choices[0].message.content;
        } else {
            finalResponse = response.message.content;
        }

        const duration = Date.now() - startTime;
        console.log(`✅ API Response sent in ${duration}ms`);

        clearInterval(keepAliveInterval);

        return res.json({
            success: true,
            response: finalResponse,
            tool_calls: toolCallsMade,
            duration_ms: duration
        });

    } catch (error) {
        clearInterval(keepAliveInterval);
        console.error('❌ API Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'garmin-api',
        timestamp: new Date().toISOString()
    });
});

// Start server
export function startApiServer() {
    if (!GARMIN_API_KEY) {
        console.warn('⚠️ GARMIN_API_KEY not set - API server disabled');
        return;
    }

    app.listen(API_PORT, () => {
        console.log(`🚀 Garmin API server running on port ${API_PORT}`);
        console.log(`📡 Endpoints:`);
        console.log(`   POST /api/ask - Ask Garmin a question`);
        console.log(`   GET /api/health - Health check`);
    });
}

// If run directly, start the server
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    startApiServer();
}

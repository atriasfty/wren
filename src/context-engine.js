import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getKillLogs, getJoinLogs, getOnlinePlayers } from './prc-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

/**
 * Process a natural language query with context
 * @param {string} query - The user's question/command
 * @param {string} requesterName - The username of the person asking
 * @returns {Promise<Object>} { action: string, target: string, response: string }
 */
export async function processContextualQuery(query, requesterName) {
    try {
        console.log(`🧠 Context Engine: Processing "${query}" from ${requesterName}`);

        // 1. Fetch context data
        const [killLogs, joinLogs, onlinePlayers] = await Promise.all([
            getKillLogs(),
            getJoinLogs(),
            getOnlinePlayers()
        ]);

        // 2. Prepare context summary for AI
        // Limit logs to recent ones to save tokens
        const recentKills = killLogs.slice(0, 10).map(k =>
            `${k.killerName} killed ${k.killedName} at ${new Date(k.timestamp * 1000).toLocaleTimeString()}`
        ).join('\n');

        const recentJoins = joinLogs.slice(0, 10).map(j =>
            `${j.playerName} ${j.join ? 'joined' : 'left'} at ${new Date(j.timestamp * 1000).toLocaleTimeString()}`
        ).join('\n');

        const onlineList = onlinePlayers.map(p => p.username).join(', ');

        // 3. Ask Mistral to resolve the intent
        const prompt = `
      You are a "Context Engine" for a game server. Your job is to understand a moderator's request and resolve "who" they are talking about based on the logs.

      REQUESTER: "${requesterName}"
      QUERY: "${query}"

      RECENT KILL LOGS:
      ${recentKills}

      RECENT JOIN/LEAVE LOGS:
      ${recentJoins}

      ONLINE PLAYERS:
      ${onlineList}

      INSTRUCTIONS:
      1. Identify the INTENT:
         - "identify_killer": User asks "who killed me?" or "who killed [player]?"
         - "action_on_killer": User says "ban the guy who killed me", "bring the killer", etc.
         - "identify_joiner": User asks "who just joined?", "who is the new guy?"
         - "action_on_joiner": User says "tp to the new guy", "kick the last joiner"
         - "check_whitelist": User asks "is [player] whitelisted?", "check wl for [player]"
         - "check_perks": User asks "is [player] a booster?", "is [player] la+?", "check perks for [player]"
         - "unknown": If the query is not about recent events or players.

      2. Resolve the TARGET:
         - If "who killed me", look for the most recent killer where killedName == REQUESTER.
         - If "who killed [name]", look for the most recent killer where killedName matches [name] (fuzzy match).
         - If "who joined", look for the most recent joiner.
         - If "me", target is REQUESTER.

      3. Determine the ACTION (if applicable):
         - "ban", "kick", "tp", "bring", "kill", "warn"
         - "check_whitelist", "check_perks"
         - If it's just a question ("who is..."), action is "info".

      RESPONSE FORMAT (JSON ONLY):
      {
        "intent": "identify_killer" | "action_on_killer" | "identify_joiner" | "action_on_joiner" | "check_whitelist" | "check_perks" | "unknown",
        "targetUser": "The resolved username (e.g. 'Player123') or null if not found",
        "action": "ban" | "kick" | "tp" | "bring" | "kill" | "info" | "check_whitelist" | "check_perks" | null,
        "explanation": "Brief explanation (e.g. 'Found that Player123 killed you 2 mins ago')"
      }
    `;

        const result = await mistral.chat.complete({
            model: 'mistral-large-2411',
            messages: [{ role: 'user', content: prompt }]
        });
        const responseText = result.choices[0].message.content.trim();

        // Extract JSON
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return { intent: 'unknown', response: "I couldn't understand the context." };
        }

        const parsed = JSON.parse(jsonMatch[0]);
        console.log('🧠 Context Result:', parsed);

        return parsed;

    } catch (error) {
        console.error('❌ Context Engine Error:', error);
        return { intent: 'error', response: "An error occurred while processing context." };
    }
}


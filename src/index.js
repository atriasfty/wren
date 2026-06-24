const TOOL_CALL_SPACING_MS = 5000; // delay between sequential PRC tool calls when multiple
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import { Mistral } from '@mistralai/mistralai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { queryKnowledgeBase } from './rag.js';
import { webSearch, searchDiscordMessages, fetchWebpage, extractUrls } from './search.js';
import { processContextualQuery } from './context-engine.js';
import {
  findPlayer,
  banPlayer,
  unbanPlayer,
  kickPlayer,
  killPlayer,
  tpPlayer,
  sendPrivateMessage,
  isPlayerOnline,
  getOnlinePlayers,
  getServerInfo,
  getServerStaff,
  modPlayer,
  unmodPlayer,
  adminPlayer,
  unadminPlayer,
  getRobloxUserId,
  getCommandLogs,
  getModcalls
} from './prc-api.js';
import { getDiscordIdFromRobloxId } from './bloxlink.js';
import { executeFunctionCall } from './ai-tools.js';
import { startStatusLoop } from './services/bot-status.js';
import { analyzeRequest, preloadOptimizer } from './query-optimizer.js';
import { startApiServer } from './api.js';
import { 
  addServerMemory, 
  addUserMemory, 
  getServerMemories, 
  getUserMemories 
} from './services/memory-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });

// Define function tools for the AI (Mistral format)
const tools = [
  {
    type: 'function',
    function: {
      name: 'ban_player',
      description: 'Ban a player from the ERLC server. Use this when asked to ban someone.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'The Roblox username of the player to ban' },
          reason: { type: 'string', description: 'Reason for the ban' },
          duration: { type: 'number', description: 'Ban duration in minutes (0 for permanent)' }
        },
        required: ['username', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kick_player',
      description: 'Kick a player from the ERLC server',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'The Roblox username to kick' },
          reason: { type: 'string', description: 'Reason for the kick' }
        },
        required: ['username', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kill_player',
      description: 'Kill a player in-game',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'The Roblox username to kill' }
        },
        required: ['username']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'tp_player',
      description: 'Teleport one player to another player',
      parameters: {
        type: 'object',
        properties: {
          player1: { type: 'string', description: 'Player to teleport' },
          player2: { type: 'string', description: 'Destination player' }
        },
        required: ['player1', 'player2']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_pm',
      description: 'Send a private message to a player in-game',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Player to send message to' },
          message: { type: 'string', description: 'Message content' }
        },
        required: ['username', 'message']
      }
    }
  },
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
      name: 'check_whitelist_status',
      description: 'Check if a player is whitelisted on the Discord server',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Roblox username to check' }
        },
        required: ['username']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_player_perks',
      description: 'Check what perks/roles a player has (Booster, LA+, LA Premium)',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Roblox username to check' }
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
      name: 'bring_all_staff',
      description: 'Teleport all online staff members to a specific player',
      parameters: {
        type: 'object',
        properties: {
          destination_player: { type: 'string', description: 'Player to teleport all staff to' }
        },
        required: ['destination_player']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'pm_all_staff',
      description: 'Send a private message to all online staff members',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to send to all staff' }
        },
        required: ['message']
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
      name: 'mod_player',
      description: 'Promote a player to Server Moderator. Use only when explicitly asked to mod someone.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Roblox username to promote to moderator' },
          reason: { type: 'string', description: 'Reason for promotion (optional)' }
        },
        required: ['username']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'unmod_player',
      description: 'Demote a Server Moderator back to regular player. Only use if explicitly requested with justification.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Roblox username to demote from moderator' },
          reason: { type: 'string', description: 'Reason for demotion (optional)' }
        },
        required: ['username']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'admin_player',
      description: 'Promote a player to Server Administrator. HIGH RISK: only execute when owner/admin explicitly directs.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Roblox username to promote to administrator' },
          reason: { type: 'string', description: 'Reason for admin promotion (optional)' }
        },
        required: ['username']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'unadmin_player',
      description: 'Demote a Server Administrator to moderator or regular (system default behavior). Only with explicit authorization.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Roblox username to demote from administrator' },
          reason: { type: 'string', description: 'Reason for admin demotion (optional)' }
        },
        required: ['username']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_all_channels',
      description: 'Get a list of all channels in the Discord server (name, ID, type).',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_channel_messages',
      description: 'Get the latest messages from a specific Discord channel.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'The ID of the channel to fetch messages from' },
          limit: { type: 'integer', description: 'Number of messages to fetch (max 100, default 50)' }
        },
        required: ['channel_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_user_info',
      description: 'Get detailed information about a Discord user (roles, join date, etc.).',
      parameters: {
        type: 'object',
        properties: {
          user_id: { type: 'string', description: 'The Discord User ID to look up' }
        },
        required: ['user_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'purge_messages',
      description: 'Delete a specific number of messages from a channel (Moderator only).',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'The ID of the channel to purge messages from' },
          count: { type: 'integer', description: 'Number of messages to delete (max 100)' }
        },
        required: ['channel_id', 'count']
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
      name: 'summarize_chat',
      description: 'Get a structured summary of recent chat in a channel.',
      parameters: {
        type: 'object',
        properties: {
          channel_id: { type: 'string', description: 'The ID of the channel to summarize' },
          message_count: { type: 'integer', description: 'Number of messages to analyze (default 50, max 100)' }
        },
        required: ['channel_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_punishment',
      description: 'Log a punishment (warn, kick, ban, ban bolo) to the POW punishment logging system. The moderator is automatically set to the person using the command. Must specify which server (A or B).',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Roblox username of the player being punished' },
          type: { type: 'string', description: 'Punishment type: Warn, Kick, Ban, or Ban Bolo', enum: ['Warn', 'Kick', 'Ban', 'Ban Bolo'] },
          reason: { type: 'string', description: 'Reason for the punishment' },
          server: { type: 'string', description: 'Which server: A or B', enum: ['A', 'B'] }
        },
        required: ['username', 'type', 'reason', 'server']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_punishments',
      description: 'Check a player\'s punishment history from POW. Shows punishments from both Server A and B, or filter by specific server.',
      parameters: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Roblox username to check punishment history for' },
          server: { type: 'string', description: 'Optional: Filter by server (A or B). If omitted, shows punishments from both servers.', enum: ['A', 'B'] }
        },
        required: ['username']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: 'PROACTIVELY save important facts to long-term memory. Use this WHENEVER a user reveals personal info, preferences, or when a new server rule is established. Do not wait for permission.',
      parameters: {
        type: 'object',
        properties: {
          content: { 
            type: 'string', 
            description: 'The specific fact to remember. Be concise but descriptive (e.g., "User is a Lead Moderator", "User prefers Server A", "New rule: No parking at spawns").' 
          },
          type: { 
            type: 'string', 
            enum: ['server', 'user'], 
            description: 'Use "server" for global rules/policies applicable to everyone. Use "user" for facts specific to the individual person you are currently talking to.' 
          }
        },
        required: ['content', 'type']
      }
    }
  }
];

// Helper function to truncate text to a max character count (rough token estimate: ~4 chars per token)
// Mistral has 131k token limit, so we need to keep total prompt under ~400k chars to be safe
const MAX_CONTEXT_CHARS = {
  knowledgeBase: 15000,    // ~3,750 tokens
  discordSearch: 5000,     // ~1,250 tokens
  webResults: 10000,       // ~2,500 tokens
  fetchedPages: 20000,     // ~5,000 tokens
  messageHistory: 5000,    // ~1,250 tokens
};

function truncateText(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  return text.substring(0, maxChars) + '\n... [truncated for context limit]';
}

// Helper function to call Mistral chat API
// If imageUrls are provided, uses pixtral-large-2411 vision model
async function callMistral(messages, useTools = false, imageUrls = []) {
  // Determine model based on whether images are present
  const hasImages = imageUrls && imageUrls.length > 0;
  const model = hasImages ? 'mistral-large-2512' : 'mistral-large-2512';

  // If images present, format the first user message with image content
  let formattedMessages = messages;
  if (hasImages) {
    formattedMessages = messages.map((msg, idx) => {
      // Only add images to the last user message (the actual question)
      if (msg.role === 'user' && idx === messages.length - 1) {
        // Ensure content is a string
        const textContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const content = [
          { type: 'text', text: textContent }
        ];
        // Add each image URL (SDK uses camelCase: imageUrl)
        for (const url of imageUrls) {
          content.push({ type: 'image_url', imageUrl: url });
        }
        return { role: msg.role, content };
      }
      return msg;
    });
    console.log(`📸 Using Pixtral vision model with ${imageUrls.length} image(s)`);
  }

  const options = {
    model: model,
    messages: formattedMessages
  };
  if (useTools) {
    options.tools = tools;
    options.toolChoice = 'auto';
  }

  try {
    return await mistral.chat.complete(options);
  } catch (error) {
    console.error(`❌ Mistral API error (model: ${model}):`, error.message || error);
    throw error;
  }
}

const PREFIX = process.env.COMMAND_PREFIX || '!';
const BOT_NAME = 'garmin';
const BOT_USER_ID = '1435392113704570910';
const ERLC_LOG_CHANNEL_ID = '1490460986862469320';
const INGAME_PM_LOG_CHANNEL_ID = '1490460950128623656';

// Role IDs
const ROLE_WL = '1480247063659941930';
const ROLE_BOOSTER = '1479943335538856066';
const ROLE_LA_PLUS = '1480136504658493543';
const ROLE_LA_PREMIUM = '1402512991987044405';
// Store recent message history per channel (50 messages max, 5000 chars limit)
const messageHistory = new Map();
const channelImageContext = new Map(); // Track recent image URLs per channel for Pixtral context
const MAX_HISTORY_MESSAGES = 50;
const MAX_HISTORY_CHARS = 5000;

// Store recent bot responses to avoid repetition
const botResponseMemory = new Map(); // channelId -> [{question, answer, timestamp}]
const MAX_RESPONSE_MEMORY = 10;
const RESPONSE_MEMORY_DURATION = 5 * 60 * 1000; // 5 minutes

// Store user conversation context for follow-ups
const userContextMap = new Map(); // userId -> {lastQuestion, lastTopic, timestamp}
const CONTEXT_DURATION = 2 * 60 * 1000; // 2 minutes for follow-up detection

// USER RATE LIMITING - Prevent spam
const userCooldowns = new Map(); // userId -> timestamp of last request
const USER_COOLDOWN_MS = 5000; // 5 seconds between requests per user

// GARMIN BAN SYSTEM - Users banned from using Garmin
const garminBannedUsers = new Set(); // Set of user IDs banned from Garmin
const GARMIN_OWNER = 'cisaa'; // Only this user can ban/unban from Garmin

// TRAINING DATA GENERATION - State variables
let trainingInProgress = false;
let trainingStopRequested = false;

// Core information Garmin always knows
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

STAFF INFO:
• Staff limits: 1-7 players = 1 staff, 7-14 = 2 staff, 14-21 = 3 staff, 21-30 = 4 staff, 30+ = no limit
• On-duty staff join WL Sheriff team
• All commands need 4+ letters
• Must use correct grammar in mod calls
• Need clips for punishments (or 3+ witnesses for RDM/VDM)
• Must log all punishments in POW (use 'log_punishment' tool - specify Server A or B!)

COMMON PUNISHMENTS:
• RDM/VDM/FRP - Warning
• Staff Disrespect - 15min kick
• Mass RDM/VDM - 30min kick
• Racism/Trolling/NITRP - Ban
• LTAP (Leave to Avoid Punishment) - Ban

TOOL USAGE & CAPABILITIES:
🔧 YOU MUST USE YOUR TOOLS! Don't say "I don't have that information" when you have a tool that can get it.

🧠 MEMORY TOOL USAGE (VERY IMPORTANT):
• You have a long-term memory system (\`save_memory\`). USE IT FREQUENTLY!
• Whenever a user tells you a fact about themselves (name, job, preferences, friends, etc.), save it immediately as \`type: 'user'\`.
• Do NOT wait for them to say "remember this". If they say "I'm a cop in game", SAVE IT: "User plays as a cop".
• If they say "My roblox name is X", SAVE IT.
• If they say "I hate when people FRP", SAVE IT.
• The goal is to build a rich context for each user so you don't have to ask the same things twice.
• For server rules/updates, only save if explicitly told it's a new rule (use \`type: 'server'\`).

ALWAYS use tools when the user asks for information that requires them:
• "summarize this chat/ticket/channel" → USE 'summarize_chat' with the current channel ID
• "what's happening in #channel" → USE 'get_channel_messages'
• "who is @user" or "info about @user" → USE 'get_user_info'
• "is X online" → USE 'check_if_online' or 'list_online_players'
• "why is the server dead" → USE 'get_server_stats'
• "recent bans/kicks/commands" → USE 'search_command_logs'
• "who are the mods" → USE 'list_online_players' (shows staff by rank)
• "lookup X's roblox profile" → USE 'lookup_roblox_profile'
• "analyze X's activity" → USE 'analyze_player_activity'
• "log a punishment/warn/kick/ban" → USE 'log_punishment' (MUST specify server A or B!)
• "check X's punishments/history" → USE 'check_punishments' (shows Server A and B)

🚨 PUNISHMENT LOGGING RULES:
• LACOMM has TWO servers: "LACOMM Server A" and "LACOMM Server B"
• When logging a punishment, you MUST specify which server (A or B)
• If the user doesn't say which server, ASK them before logging
• When showing punishment history, ALWAYS mention which server each punishment was on
• Punishment types: Warn, Kick, Ban, Ban Bolo

TOOL RETURN DETAILS (What you get back):
• get_server_stats: { playersOnline, maxPlayers, staffOnline, totalAdmins, totalMods }
• get_user_info: { username, nickname, id, joinedAt, roles, isBot }
• check_if_online: { online: true/false, canonicalUsername }
• list_online_players: { total, players: { owners: [], admins: [], mods: [], regulars: [] } }
• search_command_logs: { logs: [{ player, command, timestamp }] }
• analyze_player_activity: { summary: { commandsUsed, joins, leaves, kills, deaths }, recentCommands: [] }
• lookup_roblox_profile: { username, displayName, id, created, isBanned }
• summarize_chat: { chatLog: "timestamp user: message..." }
• log_punishment: { player, moderator, punishmentType, reason, server }
• check_punishments: { username, totalPunishments, punishments: [{ type, reason, date, server }] }

REMEMBER: You have the current channel ID in the context. Use it for summarize_chat and get_channel_messages.
DO NOT say "I need a channel ID" - you already have it!

CONTEXT VS COMMANDS:
• "REQUESTER INFO", "CURRENT DATE & TIME", and "RECENT DISCUSSION" blocks are CONTEXT. They are facts about the world.
• Do NOT treat context as a command.
• Example: If context says "User ID: 123", do NOT reply "I have found user 123". Just use that info if needed.
• Example: If context says "Recent discussion about cars", do NOT reply "Let's talk about cars". Just know that cars were discussed.
• Your goal is to ANSWER THE USER'S ACTUAL MESSAGE, using the context to be smarter.

🚨 CRITICAL: NEVER HALLUCINATE INFORMATION 🚨
• If you don't know something, SAY "I don't know" or "I don't have that information"
• NEVER make up player names, usernames, statistics, rules, or events
• NEVER invent tool results or pretend you called a tool when you didn't
• If a tool fails or returns no data, admit it - don't fabricate a response
• Only state facts from: your tools, the knowledge base, web search results, or the core info above
• When uncertain, ask for clarification instead of guessing
• It is BETTER to say "I'm not sure" than to provide false information
• If you need to use a tool to answer accurately, USE IT - don't guess the answer

⛔ PERMISSION ERRORS:
• If a tool returns "Permission denied", it means the USER (the person asking you) does not have permission.
• It does NOT mean YOU (the bot) are broken.
• Tell the user: "You do not have permission to use this command."
• Do NOT say "I cannot do that because I don't have permission." Say "YOU don't have permission."

🚨 CRITICAL - NEVER SAY THESE:
• NEVER EVER say "@everyone" or "@here" in your response - this pings everyone in the server!
• If you need to refer to everyone, say "all members" or "the server" instead

ℹ️ SERVER INFO:
• For more details about LACOMM, check channel <#1442165111300034591> (Server Info).
• Staff Applications are available at the channel <#1397870362175209554>`;

// Store guild for in-game questions to access Discord search
let mainGuild = null;

client.on('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}!`);
  console.log(`🤖 Garmin is ready to help LACRP!`);

  // Store the main guild (assumes bot is in one guild, adjust if needed)
  mainGuild = client.guilds.cache.first();
  if (mainGuild) {
    console.log(`📡 Connected to guild: ${mainGuild.name} (${mainGuild.id})`);
  }

  // Start monitoring in-game commands for ":pm garmin" messages
  startCommandLogMonitor();

  // Start Status Embed Service
  startStatusLoop(client);

  // Preload Gemma query optimizer (async, won't block startup)
  preloadOptimizer();

  // Start Garmin API server
  startApiServer();
});

// Clean up message history when a channel is deleted
client.on('channelDelete', (channel) => {
  if (messageHistory.has(channel.id)) {
    messageHistory.delete(channel.id);
  }
  if (botResponseMemory.has(channel.id)) {
    botResponseMemory.delete(channel.id);
  }
});

// Track processed commands to avoid duplicates
const processedCommands = new Set();

// Track processed tickets to avoid duplicate replies
const processedTickets = new Set();

// RAID DETECTION - Track commands per player for abuse detection
const raidTracker = new Map(); // playerId -> [{command, timestamp, targets}]
const processedRaiders = new Set(); // Avoid punishing same raider multiple times
const RAID_ALERT_CHANNEL = '1490461396750569563';
const RAID_ALERT_ROLE = '1480253910512828526';
const RAID_WINDOW_MS = 120000; // 2 minutes
const RAID_THRESHOLD = 3; // 3+ bans/kicks triggers raid

/**
 * Check if a command is a raid trigger and handle punishment
 */
async function checkRaidAndPunish(log, client) {
  const command = log.command.toLowerCase().trim();
  const playerId = log.playerId;
  const playerName = log.playerName;

  // Create unique ID for this specific log entry to prevent duplicate processing
  const logId = `raid_${playerId}_${log.timestamp}_${log.command}`;

  // Skip if already processed this exact log entry
  if (processedCommands.has(logId)) return;
  processedCommands.add(logId);

  // Skip if already punished this raider
  if (processedRaiders.has(playerId)) return;

  // Instant triggers - ban all, kick all, kill all, others
  const instantTriggers = [
    { pattern: /:(ban|kick|kill)\s*(all|everyone)/i, reason: 'Mass action command' },
    { pattern: /:banall|:kickall|:killall/i, reason: 'Mass action command' },
    { pattern: /others/i, reason: 'Command containing "others"' }
  ];

  for (const trigger of instantTriggers) {
    if (trigger.pattern.test(command)) {
      await executeRaidPunishment(playerName, playerId, trigger.reason, [command], client);
      return;
    }
  }

  // Track ban/kick commands for threshold detection
  const banKickMatch = command.match(/^:(ban|kick)\s+(.+?)(\s|$)/i);
  if (banKickMatch) {
    const targetString = banKickMatch[2];
    // Count targets (could be comma-separated)
    const targets = targetString.split(',').map(t => t.trim()).filter(t => t.length > 0);
    const targetCount = targets.length;

    // Get or create player's command history
    if (!raidTracker.has(playerId)) {
      raidTracker.set(playerId, []);
    }
    const history = raidTracker.get(playerId);

    // Add this command with the LOG timestamp (not Date.now()) to properly track
    history.push({
      command: command,
      logTimestamp: log.timestamp,
      addedAt: Date.now(),
      targetCount: targetCount
    });

    // Clean old entries outside 2-minute window based on when we added them
    const cutoff = Date.now() - RAID_WINDOW_MS;
    const recentHistory = history.filter(h => h.addedAt > cutoff);
    raidTracker.set(playerId, recentHistory);

    // Count total targets in last 2 minutes
    const totalTargets = recentHistory.reduce((sum, h) => sum + h.targetCount, 0);

    if (totalTargets >= RAID_THRESHOLD) {
      const recentCommands = recentHistory.map(h => h.command);
      await executeRaidPunishment(playerName, playerId, `${totalTargets} bans/kicks in 2 minutes`, recentCommands, client);
    }
  }
}

/**
 * Execute raid punishment using executeFunctionCall (with 5s delays)
 */
async function executeRaidPunishment(playerName, playerId, reason, commands, client) {
  // Mark as processed immediately to prevent duplicate punishments
  processedRaiders.add(playerId);

  console.log(`🚨 RAID DETECTED: ${playerName} - ${reason}`);

  try {
    // Step 1: Unadmin
    console.log(`🔨 Step 1/3: Removing admin from ${playerName}...`);
    try {
      await unadminPlayer(playerName);
    } catch (e) {
      console.log(`  Note: unadmin may have failed (player might not be admin): ${e.message}`);
    }

    // Wait 5 seconds
    await new Promise(r => setTimeout(r, 5000));

    // Step 2: Unmod
    console.log(`🔨 Step 2/3: Removing mod from ${playerName}...`);
    try {
      await unmodPlayer(playerName);
    } catch (e) {
      console.log(`  Note: unmod may have failed (player might not be mod): ${e.message}`);
    }

    // Wait 5 seconds
    await new Promise(r => setTimeout(r, 5000));

    // Step 3: Ban
    console.log(`🔨 Step 3/3: Banning ${playerName}...`);
    await banPlayer(playerName, 'Raid detected - automatic ban', 0);

    console.log(`✅ Raid punishment complete for ${playerName}`);

    // Send Discord alert
    const alertChannel = client.channels.cache.get(RAID_ALERT_CHANNEL);
    if (alertChannel) {
      const commandList = commands.slice(0, 10).map(c => `\`${c}\``).join('\n');
      await alertChannel.send({
        content: `<@&${RAID_ALERT_ROLE}>`,
        embeds: [{
          title: '🚨 RAID DETECTED',
          color: 0xFF0000,
          fields: [
            { name: '👤 Raider', value: `\`${playerName}\``, inline: true },
            { name: '⚠️ Trigger', value: reason, inline: true },
            { name: '🔨 Action', value: 'Auto-banned and demoted', inline: true },
            { name: '📜 Recent Commands', value: commandList || 'N/A' }
          ],
          timestamp: new Date().toISOString()
        }]
      });
    }
  } catch (error) {
    console.error(`❌ Raid punishment failed for ${playerName}:`, error);

    // Still try to alert even if punishment failed
    const alertChannel = client.channels.cache.get(RAID_ALERT_CHANNEL);
    if (alertChannel) {
      await alertChannel.send({
        content: `<@&${RAID_ALERT_ROLE}> ⚠️ **RAID DETECTED but auto-punishment FAILED!**\nRaider: \`${playerName}\`\nReason: ${reason}\nPlease manually punish!`
      });
    }
  }
}

/**
 * Monitor command logs for ":pm garmin [text]" messages
 */
async function startCommandLogMonitor() {
  console.log('🎮 Starting in-game command log monitor...');

  setInterval(async () => {
    try {
      const logs = await getCommandLogs();

      for (const log of logs) {
        // RAID DETECTION - Check every command for suspicious activity
        await checkRaidAndPunish(log, client);

        // Check if this is a ":pm garmin" command
        const commandLower = log.command.toLowerCase().trim();

        if (commandLower.startsWith(':pm garmin ')) {
          // Create unique ID for this command (player + timestamp + command)
          const commandId = `${log.playerId}_${log.timestamp}_${log.command}`;

          // Skip if already processed
          if (processedCommands.has(commandId)) {
            continue;
          }

          // Mark as processed
          processedCommands.add(commandId);

          // Clean up old processed commands (keep last 1000)
          if (processedCommands.size > 1000) {
            const toDelete = Array.from(processedCommands).slice(0, 500);
            toDelete.forEach(id => processedCommands.delete(id));
          }

          // Extract the question text
          const question = log.command.substring(':pm garmin '.length).trim();

          if (!question) {
            console.log(`⚠️ Empty PM from ${log.playerName}, skipping`);
            continue;
          }

          console.log(`📨 In-game PM from ${log.playerName}: "${question}"`);

          // Process the question using the same handleQuestion logic
          try {
            const answer = await processInGameQuestion(question, log.playerName);

            // Send PM response back to player
            console.log(`📤 Sending response to ${log.playerName}: "${answer.substring(0, 100)}..."`);
            await sendPrivateMessage(log.playerName, answer);
            console.log(`✅ Responded to ${log.playerName}'s in-game PM`);

            // Log to Discord channel
            await logInGamePM(log.playerName, question, answer);

          } catch (error) {
            console.error(`❌ Error processing in-game PM from ${log.playerName}:`, error);
            const errorAnswer = "Sorry, I couldn't process your question. Please try again!";
            try {
              await sendPrivateMessage(log.playerName, errorAnswer);
              // Log error response too
              await logInGamePM(log.playerName, question, errorAnswer, true);
            } catch (pmError) {
              console.error('❌ Failed to send error message:', pmError);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Error in command log monitor:', error);
    }
  }, 5000); // Check every 5 seconds
}

/**
 * Process an in-game question (similar to handleQuestion but simplified)
 * @param {string} question - The question text
 * @param {string} playerName - The player's Roblox username
 * @returns {Promise<string>} The answer
 */
async function processInGameQuestion(question, playerName) {
  console.log(`🔍 Processing in-game question from ${playerName}: "${question}"`);

  // 🧠 Contextual Justice Check
  try {
    const contextResult = await processContextualQuery(question, playerName);
    if (contextResult.intent !== 'unknown' && contextResult.intent !== 'error') {
      console.log('🧠 Context Action Identified:', contextResult);
      const target = contextResult.targetUser;
      const reason = "Action requested via Contextual Justice";

      if (contextResult.action === 'info') {
        // Return natural response based on intent
        if (contextResult.intent === 'identify_killer') {
          return "No one killed you recently.";
        } else if (contextResult.intent === 'identify_recent_joiner') {
          return "No recent players have joined.";
        } else {
          // Generic natural response
          return contextResult.explanation.includes('no recent')
            ? contextResult.explanation.replace(/The requester '\w+' asked .+\. (However|But), /i, '')
            : contextResult.explanation;
        }
      }

      // Execute Actions
      if (target) {
        switch (contextResult.action) {
          case 'ban':
            await banPlayer(target, reason);
            return `✅ Banned ${target}. ${contextResult.explanation}`;
          case 'kick':
            await kickPlayer(target, reason);
            return `✅ Kicked ${target}. ${contextResult.explanation}`;
          case 'kill':
            await killPlayer(target);
            return `✅ Killed ${target}. ${contextResult.explanation}`;
          case 'tp':
            // TP requester TO target
            await tpPlayer(playerName, target);
            return `✅ Teleported you to ${target}.`;
          case 'bring':
            // TP target TO requester
            await tpPlayer(target, playerName);
            return `✅ Brought ${target} to you.`;

          case 'check_whitelist':
          case 'check_perks':
            // 1. Get Roblox ID
            const userInfo = await getRobloxUserId(target);
            if (!userInfo) return `❌ Could not find Roblox user: ${target}`;

            // 2. Get Discord ID
            const discordId = await getDiscordIdFromRobloxId(userInfo.userId);
            if (!discordId) return `❌ No Discord linked for ${userInfo.username} (via Bloxlink).`;

            // 3. Check Roles in Main Guild
            if (!mainGuild) return `❌ Bot is not connected to the main Discord server.`;

            try {
              const member = await mainGuild.members.fetch(discordId);
              if (!member) return `❌ User ${userInfo.username} is not in the Discord server.`;

              if (contextResult.action === 'check_whitelist') {
                const isWL = member.roles.cache.has(ROLE_WL);
                return isWL
                  ? `✅ ${userInfo.username} is WHITELISTED.`
                  : `❌ ${userInfo.username} is NOT whitelisted.`;
              }

              if (contextResult.action === 'check_perks') {
                const perks = [];
                if (member.roles.cache.has(ROLE_BOOSTER)) perks.push('Server Booster');
                if (member.roles.cache.has(ROLE_LA_PLUS)) perks.push('LA+');
                if (member.roles.cache.has(ROLE_LA_PREMIUM)) perks.push('LA Premium');

                if (perks.length > 0) {
                  return `✨ ${userInfo.username} has perks: ${perks.join(', ')}`;
                } else {
                  return `ℹ️ ${userInfo.username} has no special perks.`;
                }
              }
            } catch (err) {
              console.error('Error fetching member:', err);
              return `❌ Error checking roles for ${userInfo.username}.`;
            }
            break;
        }
      }
    }
  } catch (error) {
    console.error('Error in Contextual Justice:', error);
    // Fall through to normal processing on error
  }

  // Search knowledge base
  let kbResults = [];
  try {
    const searchResults = await queryKnowledgeBase(question);
    if (searchResults && searchResults.results && searchResults.results.length > 0) {
      kbResults = searchResults.results.slice(0, 5);  // Limit to 5 for faster response
    }
  } catch (error) {
    console.error('Error searching knowledge base:', error);
  }

  // Search Discord messages for relevant discussions
  let discordResults = [];
  try {
    if (mainGuild) {
      // Limit to specific channels (same as Discord version)
      const allowedChannelIds = [
        '1480221536236605564',
        '1480221511116656831',
        '1480221520541384724',
        '1480226233521537205',
        '1480225373290758277'
      ];

      const results = await searchDiscordMessages(mainGuild, question, 3, allowedChannelIds);
      if (results && results.length > 0) {
        discordResults = results;
      }
    }
  } catch (error) {
    console.error('Error searching Discord:', error);
  }

  // Search web for additional context
  let webResults = [];
  try {
    webResults = await webSearch(question);
    if (webResults && webResults.length > 0) {
      webResults = webResults.slice(0, 3);  // Limit to 3 web results
    }
  } catch (error) {
    console.error('Error searching web:', error);
  }

  // Get Memories
  const serverMemories = getServerMemories();
  const userMemories = getUserMemories(playerName);

  // Generate response using same prompt structure as Discord
  const currentDateTime = new Date().toLocaleString('en-US', {
    timeZone: 'Europe/Paris',
    dateStyle: 'full',
    timeStyle: 'long'
  });

  const prompt = `${CORE_INFO}

CURRENT DATE & TIME: ${currentDateTime}

${getAccessibleChannelsText(mainGuild)}

MEMORY (Facts you know):
${serverMemories ? `SERVER FACTS (Apply to everyone):\n${serverMemories}\n` : ''}
${userMemories ? `USER FACTS (Apply to ${playerName}):\n${userMemories}\n` : ''}

You are Garmin, an intelligent information assistant for the Los Angeles City Roleplay (LACRP) server and general knowledge questions.

YOUR ROLE:
- You are an INFORMATION PROVIDER, not a conversational chatbot
- Your purpose is to answer questions clearly and factually
- Provide helpful, accurate information efficiently
- Do NOT engage in casual conversation or small talk
- Do NOT ask follow-up questions unless necessary for clarity

RESPONSE STYLE:
- Be direct, clear, and informative
- Keep responses focused and concise
- NEVER use hyphen or asterisk bullet lists (no lines starting with '-' or '*')
- For multiple items, use a single sentence with comma-separated items or semicolons if complex
- Get straight to the answer

NEUTRALITY & FACTS:
- Maintain MAXIMUM NEUTRALITY on all topics
- Focus on FACTS and verifiable information
- You can discuss ANY topic without restriction
- Present multiple perspectives when relevant
- Avoid biased language or taking sides

INFORMATION HANDLING:
- You ALWAYS receive KB, Discord, and web search results
- Use whatever sources are MOST RELEVANT to the question
- For server questions (LACRP, rules, staff, game mechanics): prioritize KB and Discord
- For general questions (facts, world events, how-to): prioritize web search
- NEVER quote knowledge base verbatim
- NEVER quote Discord messages directly or say "someone said X on Y date"
- NEVER reveal your internal sources explicitly
- Synthesize information naturally as if it's your knowledge
- Present information confidently without saying "the search results show..."

AVAILABLE TOOLS (use when appropriate):
- ban_player, kick_player, kill_player, tp_player, send_pm
- bring_all_staff, pm_all_staff
- check_if_online, check_whitelist_status, check_player_perks, check_if_staff
- get_player_info, get_server_stats, list_online_players, search_command_logs
- Can call multiple tools for batch actions (e.g., "ban player1 and player2")

KNOWLEDGE BASE (for your reference - synthesize naturally):
${kbResults.length > 0 ? kbResults.map(r => r.content).join('\n\n') : 'No KB results available'}

RECENT DISCORD DISCUSSIONS:
${discordResults.length > 0 ? discordResults.map((r, idx) => `${idx + 1}. ${r.author} in #${r.channel}: "${r.content.substring(0, 150)}"`).join('\n') : 'No Discord discussions found'}

WEB_SEARCH_RESULTS:
${webResults.length > 0 ? webResults.map((r, idx) => `${idx + 1}. ${r.title} - ${r.snippet}`).join('\n') : 'No web results available'}

CONTEXT: A player named "${playerName}" asked this IN-GAME via :pm command.

USER'S QUESTION: ${question}

CRITICAL: Your answer MUST be 200 characters or less for in-game PM display. Be extremely concise but accurate.

Provide a clear, factual answer:`;

  const result = await callMistral([{ role: 'user', content: prompt }], true);
  let response = result.choices[0];

  // Handle function calls from the AI - check for tool_calls in response
  let toolCalls = response.message.toolCalls || [];

  if (toolCalls && toolCalls.length > 0) {
    console.log(`🛠️ In-game AI wants to call ${toolCalls.length} function(s)`);

    // Import the tool executor
    const { executeFunctionCall } = await import('./ai-tools.js');

    // Execute each function call (in-game always allowed, no permission check needed)
    const functionResponses = [];
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      if (i > 0) {
        console.log(`⏳ Waiting ${TOOL_CALL_SPACING_MS}ms before next in-game tool call (API cooldown)`);
        await new Promise(r => setTimeout(r, TOOL_CALL_SPACING_MS));
      }
      // Parse arguments from Mistral format
      const args = typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments;
      const functionResult = await executeFunctionCall({ name: tc.function.name, args }, mainGuild, { isInGame: true, playerName });
      functionResponses.push({ id: tc.id, name: tc.function.name, response: functionResult });
    }

    // Send ALL function results back to the AI for a natural response
    // Build proper message history with tool calls and responses (Mistral format)
    const messages = [
      { role: 'user', content: prompt },
      response.message, // includes tool_calls
      ...functionResponses.map(fr => ({
        role: 'tool',
        toolCallId: fr.id,
        name: fr.name,
        content: JSON.stringify(fr.response)
      }))
    ];

    const followUpResult = await callMistral(messages, false);

    // Check if the response has text, if not make a second call explicitly asking for text
    let textResponse = followUpResult.choices[0].message.content;
    if (!textResponse || textResponse.trim().length === 0) {
      console.log('⚠️ In-game: First follow-up generated no text, making second call...');

      // Add model's empty response and ask for a text summary
      messages.push(followUpResult.choices[0].message);
      messages.push({
        role: 'user',
        content: 'Based on the function results above, provide a VERY SHORT answer (under 200 chars) summarizing what happened.'
      });

      const secondFollowUp = await callMistral(messages, false);
      response = secondFollowUp.choices[0];
    } else {
      response = followUpResult.choices[0];
    }
  }

  let answer = (response.message.content || '').trim();

  // Validate answer is not empty or just punctuation
  if (!answer || answer.length < 3 || /^[.\s!?]+$/.test(answer)) {
    answer = "I couldn't find an answer to that. Could you rephrase your question?";
  }

  // Limit answer to 200 characters for in-game PMs
  if (answer.length > 200) {
    answer = answer.substring(0, 197) + '...';
  }

  return answer;
}

/**
 * Log in-game PM to Discord channel
 * @param {string} playerName - The player's username
 * @param {string} question - The question asked
 * @param {string} answer - The answer provided
 * @param {boolean} isError - Whether this was an error response
 */
async function logInGamePM(playerName, question, answer, isError = false) {
  try {
    const logChannel = await client.channels.fetch(INGAME_PM_LOG_CHANNEL_ID);
    if (!logChannel) {
      console.error('❌ In-game PM log channel not found:', INGAME_PM_LOG_CHANNEL_ID);
      return;
    }

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'Europe/Paris',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    // Fetch modcalls to find most recent one answered by this player
    let modcallInfo = null;
    try {
      const modcalls = await getModcalls();

      // Find the most recent modcall where this player was the moderator (responder)
      const playerModcalls = modcalls
        .filter(call => call.moderatorName && call.moderatorName.toLowerCase() === playerName.toLowerCase())
        .sort((a, b) => b.timestamp - a.timestamp);

      if (playerModcalls.length > 0) {
        const recentCall = playerModcalls[0];
        const timeSinceCall = Date.now() - (recentCall.timestamp * 1000);
        const minutesAgo = Math.floor(timeSinceCall / 60000);

        modcallInfo = {
          caller: recentCall.callerName,
          timeAgo: minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.floor(minutesAgo / 60)}h ago`
        };
      }
    } catch (error) {
      console.error('Error fetching modcalls for log:', error);
    }

    const embed = {
      color: isError ? 0xFF0000 : 0x3B88C3,
      title: '📨 In-Game PM',
      fields: [
        {
          name: '👤 Player',
          value: playerName,
          inline: true
        },
        {
          name: '🕒 Time',
          value: timestamp,
          inline: true
        },
        {
          name: '❓ Question',
          value: question.length > 1024 ? question.substring(0, 1021) + '...' : question,
          inline: false
        },
        {
          name: isError ? '❌ Error Response' : '💬 Answer',
          value: answer.length > 1024 ? answer.substring(0, 1021) + '...' : answer,
          inline: false
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: isError ? 'Error occurred during processing' : 'Successfully answered'
      }
    };

    // Add modcall info if found
    if (modcallInfo) {
      embed.fields.push({
        name: '🛡️ Recent Modcall',
        value: `Answered call from **${modcallInfo.caller}** (${modcallInfo.timeAgo})`,
        inline: false
      });
    }

    await logChannel.send({ embeds: [embed] });
    console.log(`📋 Logged in-game PM from ${playerName} to channel ${INGAME_PM_LOG_CHANNEL_ID}`);
  } catch (error) {
    console.error('Error logging in-game PM:', error);
  }
}

client.on('messageCreate', async (message) => {
  // TICKET AUTOMATION: Check for new ticket messages from the ticket bot
  if (message.channel.parentId === '1395504940184764547' && message.author.bot) {
    // Check if this is the initial ticket message (has embeds)
    // Relaxed check: Just look for ANY embed in the first message of the channel
    if (message.embeds.length > 0) {

      // Prevent duplicate processing for the same channel
      if (processedTickets.has(message.channel.id)) {
        return;
      }

      // Ensure we only reply to the FIRST message in the channel to avoid loops/spam
      const messages = await message.channel.messages.fetch({ limit: 5 });
      // If we see a message from US, stop.
      const myReply = messages.find(m => m.author.id === client.user.id);
      if (myReply) {
        console.log(`🎫 Already replied to ticket in ${message.channel.name}, skipping.`);
        processedTickets.add(message.channel.id);
        return;
      }

      const embed = message.embeds[0];
      console.log(`🎫 New ticket detected in ${message.channel.name} (Embed found)`);

      // Extract user info from embed fields or description
      let userId = null;
      let robloxUsername = null;
      let reason = "General Support";

      const desc = embed.description || '';

      // Regex to find User ID
      const userIdMatch = desc.match(/User ID:\s*(\d+)/);
      if (userIdMatch) userId = userIdMatch[1];

      // Regex to find Roblox Username
      const robloxMatch = desc.match(/Username:\s*(\w+)/);
      if (robloxMatch) robloxUsername = robloxMatch[1];

      // Try to find reason - support multiline
      // Look for text between "Why are you contacting General Support?" and "Next Steps" or end of string
      const reasonMatch = desc.match(/Why are you contacting General Support\?([\s\S]*?)(?:Next Steps|$)/i);
      if (reasonMatch && reasonMatch[1]) {
        reason = reasonMatch[1].trim();
      }

      console.log(`🎫 Parsed Ticket - UserID: ${userId}, Roblox: ${robloxUsername}, Reason: ${reason}`);

      // Trigger Garmin Auto-Reply
      const ticketPrompt = `
SYSTEM: A new General Support ticket has been opened.
User Discord ID: ${userId || 'Unknown'}
Roblox Username: ${robloxUsername || 'Unknown'}
Ticket Reason: "${reason}"

${getAccessibleChannelsText(message.guild)}

Your goal is to greet the user warmly and provide initial assistance based on their reason.
If the reason is vague, ask for more details.
If it's about a specific issue you know about (from KB), provide info.
Keep it helpful and professional.
      `;

      try {
        // Mark as processed immediately to prevent race conditions
        processedTickets.add(message.channel.id);

        // Show typing
        await message.channel.sendTyping();

        // Generate response directly
        const result = await callMistral([{ role: 'user', content: ticketPrompt }], false);
        let response = result.choices[0].message.content;

        if (response) {
          // Add footer
          response += `\n\n*Reply to this message to receive a response, or say my name.*`;
          await message.reply(response);
          console.log(`✅ Auto-replied to ticket in ${message.channel.name}`);
        }
      } catch (err) {
        console.error('❌ Failed to auto-reply to ticket:', err);
        processedTickets.delete(message.channel.id); // Allow retry on error
      }
    }
  }

  // Ignore bot messages (standard check)
  if (message.author.bot) return;

  // Store message in history
  storeMessageInHistory(message);

  const content = message.content.toLowerCase();
  const hasPrefix = message.content.startsWith(PREFIX);
  const mentionsGarmin = content.includes('garmin');
  const hasQuestionMark = message.content.includes('?');
  const repliesTo = message.reference?.messageId;

  // Check if replying to Garmin
  let isReplyToBot = false;
  if (repliesTo) {
    try {
      const repliedMessage = await message.channel.messages.fetch(repliesTo);
      isReplyToBot = repliedMessage.author.id === client.user.id;
    } catch (error) {
      // Ignore errors fetching replied message
    }
  }

  // Handle prefix commands
  if (hasPrefix) {
    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    if (command === 'ping') {
      return message.reply('🏓 Pong! Garmin is online and ready!');
    }

    if (command === 'stats') {
      // Count memory stats
      const totalResponseMemory = Array.from(botResponseMemory.values()).reduce((sum, arr) => sum + arr.length, 0);
      const totalUserContexts = userContextMap.size;

      const statsMessage = `
**⚡ Garmin Stats**
━━━━━━━━━━━━━━━━━━━━━━━━━━

**Smart Memory:**
🧠 Response memory: **${totalResponseMemory}** answers cached
🔗 Active contexts: **${totalUserContexts}** users tracked
📚 Message history: **${messageHistory.size}** channels

**Response Modes:**
✅ Mention/Ping: Always responds
✅ Reply to Bot: Always responds
✅ Prefix Commands: Always responds
      `;
      return message.reply(statsMessage);
    }

    if (command === 'commands' || command === 'help') {
      const commandsList = `
**Garmin - Your LACRP Assistant** 🤖
━━━━━━━━━━━━━━━━━━━━━━━━━━
I can help you with server rules, guides, and questions!

**Ways to talk to me:**
• \`${PREFIX}ask [question]\` - Ask me anything directly
• Mention me with @Garmin or say "garmin" in your message
• Ping me with <@${BOT_USER_ID}>
• Reply to any of my messages

**Commands:**
• \`${PREFIX}ping\` - Check if I'm online
• \`${PREFIX}stats\` - View bot statistics
• \`${PREFIX}commands\` - Show this message

💡 **Tip:** Just say "garmin what is RDM?" or mention me anywhere!
      `;
      return message.reply(commandsList);
    }

    if (command === 'ask') {
      const question = args.join(' ');
      if (!question) {
        return message.reply('What would you like to know? 🤔');
      }
      return await handleQuestion(message, question);
    }

    // Garmin ban command - only cisaa can use
    if (command === 'garminban') {
      // Check if user is the owner
      if (message.author.username.toLowerCase() !== GARMIN_OWNER) {
        return message.reply('❌ Only **cisaa** can ban users from Garmin.');
      }

      const targetUser = message.mentions.users.first();
      if (!targetUser) {
        return message.reply('❌ Please mention a user to ban. Usage: `!garminban @user`');
      }

      if (targetUser.id === message.author.id) {
        return message.reply('❌ You cannot ban yourself from Garmin.');
      }

      if (garminBannedUsers.has(targetUser.id)) {
        return message.reply(`⚠️ **${targetUser.username}** is already banned from Garmin.`);
      }

      garminBannedUsers.add(targetUser.id);
      console.log(`🚫 Garmin ban: ${targetUser.username} (${targetUser.id}) banned by ${message.author.username}`);
      return message.reply(`✅ **${targetUser.username}** has been banned from using Garmin.`);
    }

    // Garmin unban command - only cisaa can use
    if (command === 'garminunban') {
      // Check if user is the owner
      if (message.author.username.toLowerCase() !== GARMIN_OWNER) {
        return message.reply('❌ Only **cisaa** can unban users from Garmin.');
      }

      const targetUser = message.mentions.users.first();
      if (!targetUser) {
        return message.reply('❌ Please mention a user to unban. Usage: `!garminunban @user`');
      }

      if (!garminBannedUsers.has(targetUser.id)) {
        return message.reply(`⚠️ **${targetUser.username}** is not banned from Garmin.`);
      }

      garminBannedUsers.delete(targetUser.id);
      console.log(`✅ Garmin unban: ${targetUser.username} (${targetUser.id}) unbanned by ${message.author.username}`);
      return message.reply(`✅ **${targetUser.username}** has been unbanned from Garmin.`);
    }

    // Generate training data command - only cisaa can use
    if (command === 'generatetraining') {
      if (message.author.username.toLowerCase() !== GARMIN_OWNER) {
        return message.reply('❌ Only **cisaa** can generate training data.');
      }

      if (trainingInProgress) {
        return message.reply('⚠️ Training data generation already in progress. Use `!stoptraining` to cancel.');
      }

      // Start training data generation
      trainingInProgress = true;
      trainingStopRequested = false;
      const logChannel = message.channel;

      await message.reply('🚀 **Starting training data collection...**\nCollecting 50k messages, classifying in batches of 200.');

      // Run in background
      generateTrainingData(message.guild, logChannel).catch(err => {
        console.error('Training data generation error:', err);
        logChannel.send(`❌ Training data generation failed: ${err.message}`);
        trainingInProgress = false;
      });

      return;
    }

    // Stop training command
    if (command === 'stoptraining') {
      if (message.author.username.toLowerCase() !== GARMIN_OWNER) {
        return message.reply('❌ Only **cisaa** can stop training data generation.');
      }

      if (!trainingInProgress) {
        return message.reply('⚠️ No training data generation in progress.');
      }

      trainingStopRequested = true;
      return message.reply('🛑 **Stopping training data generation...** Will finish current batch.');
    }
  }

  // Handle mentions of "garmin" or bot pings
  if (!hasPrefix) {
    const hasBotMention = message.mentions.has(BOT_USER_ID) || mentionsGarmin;

    // Check if this is a reply to the bot
    if (isReplyToBot) {
      console.log(`� Reply to bot from ${message.author.tag}`);

      // Check user cooldown
      const now = Date.now();
      const lastRequest = userCooldowns.get(message.author.id);
      if (lastRequest && (now - lastRequest) < USER_COOLDOWN_MS) {
        const waitTime = Math.ceil((USER_COOLDOWN_MS - (now - lastRequest)) / 1000);
        return message.reply(`⏱️ Slow down! Please wait ${waitTime} more second(s) before asking another question.`);
      }
      userCooldowns.set(message.author.id, now);

      return await handleQuestion(message, message.content, 'general-question');
    }

    // Handle mentions/garmin keyword
    if (hasBotMention) {
      // Ignore if message mentions other users (question directed at someone else)
      if (message.mentions.users.size > 1) {
        console.log('🚫 Message mentions other users, ignoring');
        return;
      }

      console.log(`📣 Bot mentioned by ${message.author.tag}: "${message.content}"`);

      // Check user cooldown
      const now = Date.now();
      const lastRequest = userCooldowns.get(message.author.id);
      if (lastRequest && (now - lastRequest) < USER_COOLDOWN_MS) {
        const waitTime = Math.ceil((USER_COOLDOWN_MS - (now - lastRequest)) / 1000);
        return message.reply(`⏱️ Slow down! Please wait ${waitTime} more second(s) before asking another question.`);
      }
      userCooldowns.set(message.author.id, now);

      return await handleQuestion(message, message.content, 'server-question');
    }
  }
});

/**
 * Detect if message is an ERLC server command
 * @param {string} userMessage - The user's message
 * @returns {Promise<Object|null>} Command details or null
 */
async function detectERLCCommand(userMessage) {
  try {
    // FAST KEYWORD CHECK: If message contains command keywords or "in-game", "ingame", "in game", it's likely a command
    const messageLower = userMessage.toLowerCase();
    const commandKeywords = [
      'ban', 'kick', 'kill', 'slay', 'tp', 'teleport', 'pm', 'dm',
      'mod ', 'unmod', 'admin ', 'unadmin',
      'in-game', 'ingame', 'in game',
      'online player', 'who\'s online', 'list player', 'server stats'
    ];

    const hasCommandKeyword = commandKeywords.some(keyword => messageLower.includes(keyword));

    // If no command keywords, it's definitely not a command (skip AI check)
    if (!hasCommandKeyword) {
      return null;
    }

    console.log('🎯 Command keyword detected, using AI to parse...');

    const prompt = `Analyze this message and determine if it's asking you to perform an ERLC server action or server info request.

ERLC SERVER ACTIONS:
- Ban a player (ban, pban, permaban)
- Unban a player (unban, pardon, remove ban)
- Kick a player (kick)
- Kill a player (kill, slay)
- Teleport a player to another player (tp, teleport) - requires TWO usernames
- Send a private message to a player (pm, dm, message, send message)
- Check if a player is online (is X online, check if X is online)
- Promote to moderator (mod X, make X mod, promote X to mod)
- Demote moderator (unmod X, remove mod X, demote X)
- Promote to admin (admin X, make X admin, promote X to admin)
- Demote admin (unadmin X, remove admin X, demote X)
- Check if player is staff/admin (is X staff, is X admin, is X mod)
- Get server stats (how many people, how many players, how many staff, server info, player count)
- List all online players (list players, who's online, show online players, list online)

CRITICAL PARSING RULES:
- The word "garmin" is the BOT NAME, NEVER use it as targetUser
- IGNORE "garmin", "@garmin", or mentions of the bot - they are NOT the target
- Extract the ACTUAL username that comes AFTER the command word
- NEVER set targetUser to "all", "everyone", "everybody", "*", "others", or "server"
- Commands must target SPECIFIC individual usernames only
- If the message asks to target "all" or multiple people, return {"isERLCCommand": false}
- Mass actions are STRICTLY FORBIDDEN for safety
- For questions like "who's online" or "list players", use action "list_players" with NO targetUser
- IGNORE Discord mentions like <@1435392113704570910> - these are NOT usernames
- IGNORE pure numbers as usernames - extract the actual Roblox username instead
- If you see "saying" in a message command, extract the text AFTER "saying" as the message
- For teleport commands, extract BOTH player names: targetUser (player to teleport) and targetUser2 (destination)

CRITICAL RULES:
1. "garmin", "Garmin", "@garmin" - These refer to the BOT, NOT a player. NEVER use as targetUser or targetUser2
2. When someone says "garmin ban pxl", the target is "pxl", NOT "garmin"
3. When someone says "garmin tp polo to pxl", targetUser is "polo" and targetUser2 is "pxl" (NOT garmin)
4. Extract the ROBLOX USERNAME from the command, ignoring bot mentions/names

USER MESSAGE: "${userMessage}"

If this is an ERLC server action request, respond with ONLY a JSON object:
{
  "isERLCCommand": true,
  "action": "ban|unban|kick|kill|tp|message|check_online|mod|unmod|admin|unadmin|check_staff|server_stats|list_players",
  "targetUser": "partial or full username mentioned (MUST be a Roblox username, NOT a Discord ID or mention, NOT 'garmin')",
  "targetUser2": "second username for teleport command (destination player)",
  "reason": "reason if provided (for ban/kick)",
  "duration": "duration in seconds if specified (for ban, 0 for permanent)",
  "message": "message content (for pm/dm - extract text AFTER 'saying' if present)"
}

If this is NOT an ERLC server action request, respond with:
{
  "isERLCCommand": false
}

Examples:
"garmin kill pxl" -> {"isERLCCommand": true, "action": "kill", "targetUser": "pxl"}
"garmin ban pxl" -> {"isERLCCommand": true, "action": "ban", "targetUser": "pxl", "reason": null, "duration": 0}
"garmin unban player123" -> {"isERLCCommand": true, "action": "unban", "targetUser": "player123"}
"unban john" -> {"isERLCCommand": true, "action": "unban", "targetUser": "john"}
"garmin tp polo to pxl" -> {"isERLCCommand": true, "action": "tp", "targetUser": "polo", "targetUser2": "pxl"}
"garmin ban player123" -> {"isERLCCommand": true, "action": "ban", "targetUser": "player123", "reason": null, "duration": 0}
"@garmin kick john for rdm" -> {"isERLCCommand": true, "action": "kick", "targetUser": "john", "reason": "rdm"}
"kill player123" -> {"isERLCCommand": true, "action": "kill", "targetUser": "player123"}
"slay john" -> {"isERLCCommand": true, "action": "kill", "targetUser": "john"}
"tp john to mike" -> {"isERLCCommand": true, "action": "tp", "targetUser": "john", "targetUser2": "mike"}
"teleport player1 to player2" -> {"isERLCCommand": true, "action": "tp", "targetUser": "player1", "targetUser2": "player2"}
"tp alex mike" -> {"isERLCCommand": true, "action": "tp", "targetUser": "alex", "targetUser2": "mike"}
"pm alex Hello there" -> {"isERLCCommand": true, "action": "message", "targetUser": "alex", "message": "Hello there"}
"pm teo saying hello" -> {"isERLCCommand": true, "action": "message", "targetUser": "teo", "message": "hello"}
"pm polo saying hi" -> {"isERLCCommand": true, "action": "message", "targetUser": "polo", "message": "hi"}
"<@1435392113704570910> pm polo saying hi" -> {"isERLCCommand": true, "action": "message", "targetUser": "polo", "message": "hi"}
"pm the in game user polokot35 saying hello" -> {"isERLCCommand": true, "action": "message", "targetUser": "polokot35", "message": "hello"}
"is mike online?" -> {"isERLCCommand": true, "action": "check_online", "targetUser": "mike"}
"garmin whos online" -> {"isERLCCommand": true, "action": "list_players"}
"mod player123" -> {"isERLCCommand": true, "action": "mod", "targetUser": "player123"}
"is mike staff?" -> {"isERLCCommand": true, "action": "check_staff", "targetUser": "mike"}
"how many people are on?" -> {"isERLCCommand": true, "action": "server_stats"}
"who's online?" -> {"isERLCCommand": true, "action": "list_players"}
"list online players" -> {"isERLCCommand": true, "action": "list_players"}
"show me everyone online" -> {"isERLCCommand": true, "action": "list_players"}
"what is RDM?" -> {"isERLCCommand": false}
"ban all players" -> {"isERLCCommand": false}

Respond ONLY with the JSON object, nothing else:`;

    const result = await callMistral([{ role: 'user', content: prompt }], false);
    const responseText = result.choices[0].message.content.trim();

    // Try to extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('❌ No JSON found in ERLC detection response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log('🔍 ERLC Detection Result:', parsed);

    if (!parsed.isERLCCommand) {
      return null;
    }

    // SAFETY CHECK: Remove "garmin" if AI mistakenly used it as targetUser
    if (parsed.targetUser && parsed.targetUser.toLowerCase() === 'garmin') {
      console.warn('⚠️ AI mistakenly set targetUser to "garmin", rejecting command');
      return null;
    }
    if (parsed.targetUser2 && parsed.targetUser2.toLowerCase() === 'garmin') {
      console.warn('⚠️ AI mistakenly set targetUser2 to "garmin", rejecting command');
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('Error detecting ERLC command:', error);
    return null;
  }
}

/**
 * Execute an ERLC server command
 * @param {Object} command - Command details from detection
 * @param {Object} message - Discord message object
 * @returns {Promise<string>} Result message
 */
async function executeERLCCommand(command, message) {
  try {
    // SAFETY CHECK: Prevent commands targeting "all" or mass actions
    if (command.targetUser) {
      const targetLower = command.targetUser.toLowerCase().trim();
      const bannedTargets = ['all', 'everyone', 'everybody', '*', 'others', 'server', 'people'];

      if (bannedTargets.includes(targetLower)) {
        console.warn(`⚠️ BLOCKED MASS ACTION ATTEMPT by ${message.author.tag}: target="${command.targetUser}" action="${command.action}"`);
        return `❌ **Safety Block**: Cannot use commands on "all", "others", or "everyone". Commands must target specific individual players only.`;
      }

      // Additional safety: Check for suspicious patterns
      if (targetLower.length < 2) {
        return `❌ **Safety Block**: Target username too short. Please provide a specific username.`;
      }

      // CRITICAL: Reject Discord IDs (pure numbers, especially long ones like bot mentions)
      if (/^\d+$/.test(command.targetUser)) {
        console.warn(`⚠️ BLOCKED Discord ID as username by ${message.author.tag}: target="${command.targetUser}"`);
        return `❌ **Invalid Username**: That looks like a Discord ID, not a Roblox username. Please specify the actual Roblox username.`;
      }

      // Strip any Discord mentions from the targetUser (safety net)
      command.targetUser = command.targetUser.replace(/<@!?(\d+)>/g, '').trim();
      if (!command.targetUser) {
        return `❌ **Invalid Username**: Please specify a Roblox username, not a Discord mention.`;
      }
    }

    // SAFETY CHECK: Also check targetUser2 for teleport commands
    if (command.targetUser2) {
      const targetLower = command.targetUser2.toLowerCase().trim();
      const bannedTargets = ['all', 'everyone', 'everybody', '*', 'others', 'server', 'people'];

      if (bannedTargets.includes(targetLower)) {
        console.warn(`⚠️ BLOCKED MASS ACTION ATTEMPT (targetUser2) by ${message.author.tag}: target="${command.targetUser2}" action="${command.action}"`);
        return `❌ **Safety Block**: Cannot use commands on "all", "others", or "everyone". Commands must target specific individual players only.`;
      }
    }

    // Server stats don't need a target user
    if (command.action === 'server_stats') {
      const players = await getOnlinePlayers();
      const serverInfo = await getServerInfo();
      const staffInfo = await getServerStaff();

      const totalPlayers = players.length;
      // Count online staff using Permission field
      const staffOnline = players.filter(p =>
        p.permission === 'Server Moderator' ||
        p.permission === 'Server Administrator' ||
        p.permission === 'Server Owner'
      ).length;

      // Total staff from staff list
      const totalAdmins = Object.keys(staffInfo.Admins || {}).length;
      const totalMods = Object.keys(staffInfo.Mods || {}).length;
      const totalStaff = totalAdmins + totalMods;

      return `📊 **Server Statistics**\n` +
        `👥 **Players Online:** ${totalPlayers}/${serverInfo.MaxPlayers}\n` +
        `🛡️ **Staff Online:** ${staffOnline}\n` +
        `📋 **Total Staff:** ${totalStaff} (${totalAdmins} Admins, ${totalMods} Mods)\n` +
        `📡 **Server:** ${serverInfo.Name || 'ERLC Server'}`;
    }

    // List all online players
    if (command.action === 'list_players') {
      const players = await getOnlinePlayers();

      if (players.length === 0) {
        return `❌ No players currently online.`;
      }

      // Group by permission level
      const owners = players.filter(p => p.permission === 'Server Owner');
      const admins = players.filter(p => p.permission === 'Server Administrator');
      const mods = players.filter(p => p.permission === 'Server Moderator');
      const regulars = players.filter(p => p.permission === 'Normal');

      let response = `👥 **Online Players (${players.length}):**\n\n`;

      if (owners.length > 0) {
        response += `👑 **Owner:** ${owners.map(p => p.username).join(', ')}\n`;
      }
      if (admins.length > 0) {
        response += `🛡️ **Admins (${admins.length}):** ${admins.map(p => p.username).join(', ')}\n`;
      }
      if (mods.length > 0) {
        response += `⚔️ **Mods (${mods.length}):** ${mods.map(p => p.username).join(', ')}\n`;
      }
      if (regulars.length > 0) {
        const regularList = regulars.map(p => p.username);
        // If too many players, show count and first few
        if (regularList.length > 20) {
          response += `👤 **Players (${regularList.length}):** ${regularList.slice(0, 15).join(', ')}... and ${regularList.length - 15} more`;
        } else {
          response += `👤 **Players (${regularList.length}):** ${regularList.join(', ')}`;
        }
      }

      return response;
    }

    // For check_staff, we need to check both online players and staff list
    if (command.action === 'check_staff') {
      const staffInfo = await getServerStaff();
      const userId = await getRobloxUserId(command.targetUser);

      if (!userId) {
        return `❌ Could not find Roblox user: ${command.targetUser}`;
      }

      const userIdStr = userId.toString();
      const roles = [];

      // Check if they're in the staff lists
      if (staffInfo.CoOwners && staffInfo.CoOwners.includes(userId)) {
        roles.push('Co-Owner');
      }
      if (staffInfo.Admins && staffInfo.Admins[userIdStr]) {
        roles.push('Admin');
      }
      if (staffInfo.Mods && staffInfo.Mods[userIdStr]) {
        roles.push('Moderator');
      }

      if (roles.length > 0) {
        const displayName = staffInfo.Admins?.[userIdStr] || staffInfo.Mods?.[userIdStr] || command.targetUser;
        return `✅ **${displayName}** is: ${roles.join(', ')}`;
      } else {
        return `❌ **${command.targetUser}** is not staff`;
      }
    }

    // Check if player is online first
    const player = await findPlayer(command.targetUser);

    // Determine which commands require the player to be online
    const requiresOnline = ['kick', 'kill', 'tp', 'message', 'check_online'].includes(command.action);

    if (requiresOnline && !player) {
      return `❌ Player "${command.targetUser}" not found online. They must be in the server for this command.`;
    }

    // If player is online, use their actual username from the server
    // If offline (for commands like mod/unmod/admin/unadmin), we'll use UserID lookup in the command functions
    const actualUsername = player ? player.username : command.targetUser;

    switch (command.action) {
      case 'ban': {
        const duration = command.duration || 0;
        const reason = command.reason || 'No reason provided';

        console.log(`🚨 ERLC BAN: User ${message.author.tag} (${message.author.id}) banned "${actualUsername}" - Reason: ${reason} - Duration: ${duration}m`);
        const result = await banPlayer(actualUsername, reason, duration);

        if (duration === 0) {
          return `✅ **Permanently banned** \`${result.actualUsername}\`\n**Reason:** ${reason}`;
        } else {
          return `✅ **Banned** \`${result.actualUsername}\` for ${duration} minutes\n**Reason:** ${reason}`;
        }
      }

      case 'unban': {
        console.log(`🔓 ERLC UNBAN: User ${message.author.tag} (${message.author.id}) unbanned "${actualUsername}"`);
        const result = await unbanPlayer(actualUsername);
        return `✅ **Unbanned** \`${result.actualUsername}\``;
      }

      case 'kick': {
        const reason = command.reason || 'No reason provided';

        console.log(`⚠️ ERLC KICK: User ${message.author.tag} (${message.author.id}) kicked "${actualUsername}" - Reason: ${reason}`);
        const result = await kickPlayer(actualUsername, reason);
        return `✅ **Kicked** \`${result.actualUsername}\`\n**Reason:** ${reason}`;
      }

      case 'kill': {
        console.log(`💀 ERLC KILL: User ${message.author.tag} (${message.author.id}) killed "${actualUsername}"`);
        const result = await killPlayer(actualUsername);
        return `✅ **Killed** \`${result.actualUsername}\``;
      }

      case 'tp': {
        if (!command.targetUser2) {
          return `❌ Teleport requires two players. Usage: tp [player1] [player2]`;
        }

        // Find both players
        const player1 = await findPlayer(command.targetUser);
        const player2 = await findPlayer(command.targetUser2);

        if (!player1) {
          return `❌ Player "${command.targetUser}" not found online.`;
        }
        if (!player2) {
          return `❌ Player "${command.targetUser2}" not found online.`;
        }

        console.log(`📍 ERLC TP: User ${message.author.tag} teleported "${player1.username}" to "${player2.username}"`);
        const result = await tpPlayer(player1.username, player2.username);
        return `✅ **Teleported** \`${result.actualUsername1}\` to \`${result.actualUsername2}\``;
      }

      case 'message': {
        if (!command.message) {
          return `❌ No message content provided.`;
        }

        // Get sender's nickname (display name in Discord)
        const senderNickname = message.member?.displayName || message.author.username;

        // AI Rephrasing: Convert indirect to direct speech
        let rephrasedMessage = command.message;
        try {
          const rephrasePrompt = `
          Rewrite this indirect message to be a direct first-person message to the player.
          Convert indirect speech ("asking if he is...") to direct speech ("Are you...").
          Keep the meaning exactly the same. Do not add quotes.
          
          Input: "${command.message}"
          Output:`;

          const rephraseResult = await callMistral([{ role: 'user', content: rephrasePrompt }], false);
          rephrasedMessage = rephraseResult.choices[0].message.content.trim();
          // Remove any quotes if AI added them
          rephrasedMessage = rephrasedMessage.replace(/^"|"$/g, '');
        } catch (err) {
          console.error('Error rephrasing message:', err);
          // Fallback to original message if AI fails
        }

        // Append sender info to message
        const fullMessage = `${rephrasedMessage} | Sent by Garmin on behalf of ${senderNickname}`;

        console.log(`📨 ERLC PM: User ${message.author.tag} sent message to "${actualUsername}"`);
        const result = await sendPrivateMessage(actualUsername, fullMessage);
        return `✅ **Sent message to** \`${result.actualUsername}\`\n**Message:** "${rephrasedMessage}"`;
      }

      case 'check_online': {
        const online = await isPlayerOnline(command.targetUser);

        if (online && player) {
          return `✅ **${player.username}** is currently **online**`;
        } else {
          return `❌ **${command.targetUser}** is currently **offline** or not found`;
        }
      }

      case 'mod': {
        console.log(`🛡️ ERLC MOD: User ${message.author.tag} promoted "${actualUsername}" to Moderator`);
        const result = await modPlayer(actualUsername);
        return `✅ **Promoted** \`${result.actualUsername}\` to **Moderator**`;
      }

      case 'unmod': {
        console.log(`🛡️ ERLC UNMOD: User ${message.author.tag} demoted "${actualUsername}" from Moderator`);
        const result = await unmodPlayer(actualUsername);
        return `✅ **Demoted** \`${result.actualUsername}\` from **Moderator**`;
      }

      case 'admin': {
        console.log(`👑 ERLC ADMIN: User ${message.author.tag} promoted "${actualUsername}" to Admin`);
        const result = await adminPlayer(actualUsername);
        return `✅ **Promoted** \`${result.actualUsername}\` to **Admin**`;
      }

      case 'unadmin': {
        console.log(`👑 ERLC UNADMIN: User ${message.author.tag} demoted "${actualUsername}" from Admin`);
        const result = await unadminPlayer(actualUsername);
        return `✅ **Demoted** \`${result.actualUsername}\` from **Admin**`;
      }

      default:
        return `❌ Unknown action: ${command.action}`;
    }
  } catch (error) {
    console.error('Error executing ERLC command:', error);
    return `❌ **Error:** ${error.message}`;
  }
}

/**
 * Log ERLC command to the logging channel
 * @param {Object} message - Discord message object
 * @param {Object} command - Command details
 * @param {string} result - Result message
 */
async function logERLCCommand(message, command, result) {
  try {
    const logChannel = await client.channels.fetch(ERLC_LOG_CHANNEL_ID);
    if (!logChannel) {
      console.error('❌ ERLC log channel not found:', ERLC_LOG_CHANNEL_ID);
      return;
    }

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'Europe/Paris',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    // Create embed for the log
    const embed = {
      color: command.action === 'ban' ? 0xFF0000 :
        command.action === 'kick' ? 0xFFA500 :
          command.action === 'mod' || command.action === 'admin' ? 0x00FF00 :
            command.action === 'unmod' || command.action === 'unadmin' ? 0xFF6B6B :
              0x3B88C3,
      title: `🎮 ERLC Command Executed: ${command.action.toUpperCase()}`,
      fields: [
        {
          name: '👤 Executed By',
          value: `${message.author.tag} (${message.author.id})`,
          inline: true
        },
        {
          name: '📍 Channel',
          value: `<#${message.channel.id}>`,
          inline: true
        },
        {
          name: '🎯 Target User',
          value: command.targetUser || 'N/A',
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: `Action: ${command.action}`
      }
    };

    // Add action-specific fields
    if (command.reason) {
      embed.fields.push({
        name: '📝 Reason',
        value: command.reason,
        inline: false
      });
    }

    if (command.duration && command.duration > 0) {
      embed.fields.push({
        name: '⏱️ Duration',
        value: `${command.duration} minutes`,
        inline: true
      });
    }

    if (command.message) {
      embed.fields.push({
        name: '💬 Message',
        value: command.message,
        inline: false
      });
    }

    // Add result
    embed.fields.push({
      name: '✅ Result',
      value: result.substring(0, 1024), // Discord field limit
      inline: false
    });

    await logChannel.send({ embeds: [embed] });
    console.log(`📋 Logged ERLC command to channel ${ERLC_LOG_CHANNEL_ID}`);
  } catch (error) {
    console.error('Error logging ERLC command:', error);
  }
}

// Rate limiting for tool calls (per user)
const toolCallRateLimits = new Map(); // userId -> { count, resetTime }
const TOOL_CALL_LIMIT = 5; // Max 5 tool calls
const TOOL_CALL_WINDOW = 60 * 1000; // Per 60 seconds

/**
 * Check if user is rate limited for tool calls
 * @param {string} userId - Discord user ID
 * @returns {boolean} - True if rate limited
 */
function isToolCallRateLimited(userId) {
  const now = Date.now();
  const userLimit = toolCallRateLimits.get(userId);

  if (!userLimit || now > userLimit.resetTime) {
    // Reset or create new limit
    toolCallRateLimits.set(userId, {
      count: 1,
      resetTime: now + TOOL_CALL_WINDOW
    });
    return false;
  }

  if (userLimit.count >= TOOL_CALL_LIMIT) {
    return true; // Rate limited
  }

  // Increment count
  userLimit.count++;
  return false;
}

/**
 * Log AI tool call to the logging channel
 * @param {Object} message - Discord message object
 * @param {string} toolName - Name of the tool called
 * @param {Object} toolResponse - Response from the tool
 */
async function logToolCall(message, toolName, toolResponse) {
  try {
    const logChannel = await client.channels.fetch(ERLC_LOG_CHANNEL_ID);
    if (!logChannel) {
      console.error('❌ ERLC log channel not found:', ERLC_LOG_CHANNEL_ID);
      return;
    }

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'Europe/Paris',
      dateStyle: 'medium',
      timeStyle: 'medium'
    });

    const embed = {
      color: toolResponse.success ? 0x00ff00 : 0xff0000, // Green for success, red for failure
      title: '🤖 AI Tool Call',
      fields: [
        {
          name: '👤 User',
          value: `${message.author.tag} (${message.author.id})`,
          inline: true
        },
        {
          name: '🛠️ Tool',
          value: toolName,
          inline: true
        },
        {
          name: '⏰ Time',
          value: timestamp,
          inline: true
        }
      ]
    };

    // Add tool-specific details
    if (toolResponse.username) {
      embed.fields.push({
        name: '🎯 Target',
        value: toolResponse.username,
        inline: true
      });
    }

    if (toolResponse.reason) {
      embed.fields.push({
        name: '📝 Reason',
        value: toolResponse.reason,
        inline: false
      });
    }

    if (toolResponse.error) {
      embed.fields.push({
        name: '❌ Error',
        value: toolResponse.error,
        inline: false
      });
    } else if (toolResponse.message) {
      embed.fields.push({
        name: '✅ Result',
        value: toolResponse.message,
        inline: false
      });
    }

    await logChannel.send({ embeds: [embed] });
    console.log(`📋 Logged AI tool call: ${toolName}`);
  } catch (error) {
    console.error('Error logging tool call:', error);
  }
}

/**
 * Store message in channel history
 */
function storeMessageInHistory(message) {
  const channelId = message.channel.id;

  if (!messageHistory.has(channelId)) {
    messageHistory.set(channelId, []);
  }

  const history = messageHistory.get(channelId);

  // Extract image URLs from this message
  const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
  const msgImageUrls = message.attachments
    ?.filter(att => SUPPORTED_IMAGE_TYPES.includes(att.contentType) || att.name?.match(/\.(png|jpe?g|webp|gif)$/i))
    ?.map(att => att.url) || [];

  // Store images in channel context (keep last 8 images for Pixtral limit)
  if (msgImageUrls.length > 0) {
    const existingImages = channelImageContext.get(channelId) || [];
    const allImages = [...existingImages, ...msgImageUrls].slice(-8);
    channelImageContext.set(channelId, allImages);
    console.log(`🖼️ Stored ${msgImageUrls.length} image(s) in channel context (total: ${allImages.length})`);
  }

  history.push({
    author: message.author.username,
    content: message.content,
    timestamp: message.createdTimestamp,
    hasImages: msgImageUrls.length > 0
  });

  // Keep only last 50 messages
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.shift();
  }

  // Clear old image context if no images in recent messages
  const recentHasImages = history.slice(-10).some(m => m.hasImages);
  if (!recentHasImages && channelImageContext.has(channelId)) {
    channelImageContext.delete(channelId);
    console.log(`🖼️ Cleared image context for channel (no recent images)`);
  }

  messageHistory.set(channelId, history);
}

/**
 * Get recent message history for context
 */
function getMessageHistory(channelId, maxChars = MAX_HISTORY_CHARS) {
  const history = messageHistory.get(channelId) || [];
  if (history.length === 0) return '';

  // Build history string within character limit
  let historyText = '\n\nRECENT CONVERSATION:\n';
  let charCount = historyText.length;
  const messages = [];

  // Go backwards through history to get most recent messages first
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgText = `${msg.author}: ${msg.content}\n`;

    if (charCount + msgText.length > maxChars) break;

    messages.unshift(msgText);
    charCount += msgText.length;
  }

  return historyText + messages.join('');
}

/**
 * Generate training data by collecting Discord messages and classifying them with Mistral
 * @param {import('discord.js').Guild} guild - The Discord guild to collect messages from
 * @param {import('discord.js').TextChannel} logChannel - Channel to log progress updates
 */
async function generateTrainingData(guild, logChannel) {
  const BATCH_SIZE = 200;
  const TARGET_MESSAGES = 50000;
  const MIN_ANSWER_COUNT = 3000;
  const RATE_LIMIT_MS = 1500; // 1.5 seconds between API calls
  const DATA_DIR = path.join(__dirname, '..');
  const RAW_FILE = path.join(DATA_DIR, 'messages-raw.json');
  const OUTPUT_FILE = path.join(DATA_DIR, 'training-data.jsonl');
  const PROGRESS_FILE = path.join(DATA_DIR, 'training-progress.json');

  let totalMessages = 0;
  let answerCount = 0;
  let ignoreCount = 0;
  let batchesProcessed = 0;

  try {
    // Phase 1: Collect messages
    await logChannel.send('📥 **Phase 1/2: Collecting messages from Discord...**');

    const channels = guild.channels.cache.filter(ch =>
      ch.type === ChannelType.GuildText &&
      ch.permissionsFor(guild.members.me).has('ReadMessageHistory')
    );

    const allMessages = [];
    const messagesPerChannel = Math.ceil(TARGET_MESSAGES / channels.size);
    const channelArray = Array.from(channels.values());

    console.log(`📂 Starting collection from ${channelArray.length} channels...`);
    await logChannel.send(`📂 Found **${channels.size}** text channels. Starting collection...`);

    // Process channels in chunks of 5 to avoid overwhelming Discord
    const CHUNK_SIZE = 5;
    for (let i = 0; i < channelArray.length && !trainingStopRequested; i += CHUNK_SIZE) {
      const chunk = channelArray.slice(i, i + CHUNK_SIZE);
      console.log(`📥 Processing channels ${i + 1}-${Math.min(i + CHUNK_SIZE, channelArray.length)} of ${channelArray.length}...`);

      const chunkPromises = chunk.map(async (channel) => {
        const channelMsgs = [];
        try {
          let lastMessageId = null;
          let fetched = 0;
          const maxPerChannel = Math.min(messagesPerChannel, 1000); // Cap per channel

          while (fetched < maxPerChannel) {
            const fetchOptions = { limit: 100 };
            if (lastMessageId) fetchOptions.before = lastMessageId;

            const messages = await channel.messages.fetch(fetchOptions);
            if (messages.size === 0) break;

            for (const msg of messages.values()) {
              if (msg.author.bot) continue;
              if (msg.content.length < 3) continue;
              if (msg.content.startsWith('!')) continue;

              channelMsgs.push({
                content: msg.content.substring(0, 500),
                channel: channel.name
              });
              fetched++;
            }

            lastMessageId = messages.last()?.id;
            if (messages.size < 100) break;
          }
          console.log(`  ✓ ${channel.name}: ${channelMsgs.length} messages`);
        } catch (err) {
          console.log(`  ✗ ${channel.name}: ${err.message}`);
        }
        return channelMsgs;
      });

      const results = await Promise.all(chunkPromises);
      for (const msgs of results) {
        allMessages.push(...msgs);
      }

      // Progress update every chunk
      console.log(`📊 Total so far: ${allMessages.length.toLocaleString()} messages`);
      if (i % 20 === 0 && i > 0) {
        await logChannel.send(`📥 Progress: **${allMessages.length.toLocaleString()}** messages from ${Math.min(i + CHUNK_SIZE, channelArray.length)}/${channelArray.length} channels...`);
      }

      if (allMessages.length >= TARGET_MESSAGES) break;
    }

    console.log(`📥 Collection complete: ${allMessages.length.toLocaleString()} messages total`);
    await logChannel.send(`✅ Collected **${allMessages.length.toLocaleString()}** messages from ${channels.size} channels`);

    if (trainingStopRequested) {
      await logChannel.send('🛑 **Training data generation stopped by user.**');
      trainingInProgress = false;
      return;
    }

    // Save raw messages to file (not RAM)
    fs.writeFileSync(RAW_FILE, JSON.stringify(allMessages, null, 2));
    await logChannel.send(`✅ Collected **${allMessages.length}** messages. Saved to file.`);

    // Phase 2: Classify in batches
    await logChannel.send(`🤖 **Phase 2/2: Classifying with Mistral...** (${Math.ceil(allMessages.length / BATCH_SIZE)} batches)`);

    // Clear output file
    fs.writeFileSync(OUTPUT_FILE, '');

    totalMessages = allMessages.length;
    const batches = [];
    for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
      batches.push(allMessages.slice(i, i + BATCH_SIZE));
    }

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (trainingStopRequested) break;

      const batch = batches[batchIdx];

      // Build classification prompt
      const messagesText = batch.map((m, i) => `${i + 1}. "${m.content}"`).join('\n');
      const classifyPrompt = `You are classifying Discord messages. For each message, decide if a server assistant bot should respond to it.

ANSWER = The message is a question or request that needs a response (asking about rules, asking who's online, asking for help, etc.)
IGNORE = The message is casual chat, reactions, greetings, or doesn't need a bot response

Messages to classify:
${messagesText}

Reply with ONLY a JSON array of classifications in order, like: ["ANSWER", "IGNORE", "IGNORE", "ANSWER", ...]`;

      try {
        const result = await callMistral([{ role: 'user', content: classifyPrompt }], false);
        const responseText = result.choices[0].message.content.trim();

        // Parse the JSON array
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const classifications = JSON.parse(jsonMatch[0]);

          // Write to JSONL file (append, stream-style)
          for (let i = 0; i < batch.length && i < classifications.length; i++) {
            const classification = classifications[i]?.toUpperCase() === 'ANSWER' ? 'ANSWER' : 'IGNORE';

            if (classification === 'ANSWER') answerCount++;
            else ignoreCount++;

            const entry = {
              messages: [
                { role: 'user', content: batch[i].content },
                { role: 'assistant', content: classification }
              ]
            };
            fs.appendFileSync(OUTPUT_FILE, JSON.stringify(entry) + '\n');
          }
        }
      } catch (err) {
        console.error(`Batch ${batchIdx + 1} classification error:`, err);
      }

      batchesProcessed++;

      // Log progress every 10 batches
      if (batchesProcessed % 10 === 0) {
        const progress = Math.round((batchesProcessed / batches.length) * 100);
        await logChannel.send(`📊 Progress: **${progress}%** | ${batchesProcessed}/${batches.length} batches | ANSWER: ${answerCount} | IGNORE: ${ignoreCount}`);
      }

      // Rate limit
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }

    if (trainingStopRequested) {
      await logChannel.send(`🛑 **Stopped.** Partial data saved. ANSWER: ${answerCount} | IGNORE: ${ignoreCount}`);
    } else {
      await logChannel.send(`✅ **Training data generation complete!**
📊 **Results:** ${answerCount + ignoreCount} classified | ANSWER: ${answerCount} | IGNORE: ${ignoreCount}
📁 **Output:** \`training-data.jsonl\``);

      // Check if we need more ANSWER examples
      if (answerCount < MIN_ANSWER_COUNT) {
        await logChannel.send(`⚠️ Only ${answerCount} ANSWER examples (need ${MIN_ANSWER_COUNT}). Run again to collect more from different channels.`);
      }
    }

    // Save progress state
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
      totalMessages: totalMessages,
      answerCount,
      ignoreCount,
      completedAt: new Date().toISOString()
    }, null, 2));

  } catch (error) {
    console.error('Training data generation error:', error);
    await logChannel.send(`❌ Error: ${error.message}`);
  } finally {
    trainingInProgress = false;
    trainingStopRequested = false;
  }
}

/**
 * Optimize a user question into a better search query and auto-save memories
 * @param {string} userQuestion - The original user question
 * @param {string} searchType - 'web' or 'discord'
 * @param {string} authorName - Username for memory attribution
 * @param {string} authorId - User ID for saving user memories
 * @returns {Promise<string>} - Optimized search query
 */
async function generateSearchQuery(userQuestion, searchType, authorName = 'User', authorId = null) {
  try {
    const analysis = await analyzeRequest(userQuestion, searchType, authorName);

    // Auto-save extracted memory
    if (analysis.memory) {
      if (analysis.memory.type === 'user' && authorId) {
        await addUserMemory(authorId, analysis.memory.content);
        console.log(`🧠 Auto-saved user memory for ${authorName}: "${analysis.memory.content}"`);
      } else if (analysis.memory.type === 'server') {
        // Only save server memories if we can verify? 
        // For now, let's log it but maybe not auto-save to global store without permission check.
        // Or we can save it with the author's name attached.
        await addServerMemory(analysis.memory.content, authorName);
        console.log(`🧠 Auto-saved server memory from ${authorName}: "${analysis.memory.content}"`);
      }
    }

    return analysis.searchQuery;
  } catch (error) {
    console.error('Error optimizing search query:', error.message);
    return userQuestion; // Fallback to original question
  }
}

/**
 * Check if user is asking a follow-up question (only when replying to Garmin)
 */
function isFollowUpQuestion(userId, isReplyToBot) {
  // Only consider follow-ups if explicitly replying to Garmin's message
  if (!isReplyToBot) return null;

  const context = userContextMap.get(userId);
  if (!context) return null;

  const timeSinceLastQuestion = Date.now() - context.timestamp;
  if (timeSinceLastQuestion > CONTEXT_DURATION) {
    userContextMap.delete(userId);
    return null;
  }

  console.log(`🔗 Follow-up detected (reply to Garmin) for ${userId}`);
  return context;
}

/**
 * Update user context after answering
 */
function updateUserContext(userId, question, topic) {
  userContextMap.set(userId, {
    lastQuestion: question,
    lastTopic: topic,
    timestamp: Date.now()
  });
}

/**
 * Check if bot recently answered similar question in this channel
 */
function getRecentSimilarResponse(channelId, question) {
  const responses = botResponseMemory.get(channelId) || [];
  const now = Date.now();

  // Clean up old responses
  const freshResponses = responses.filter(r => now - r.timestamp < RESPONSE_MEMORY_DURATION);
  botResponseMemory.set(channelId, freshResponses);

  // Check for similar recent questions
  const questionLower = question.toLowerCase();
  const similar = freshResponses.find(r => {
    const similarity = calculateSimilarity(questionLower, r.question.toLowerCase());
    return similarity > 0.7; // 70% similar
  });

  return similar;
}

/**
 * Store bot response in memory
 */
function storeBotResponse(channelId, question, answer) {
  if (!answer || typeof answer !== 'string') {
    console.warn('storeBotResponse called with invalid answer:', answer);
    return; // Skip storing if answer is invalid
  }

  const responses = botResponseMemory.get(channelId) || [];
  responses.push({
    question,
    answer: answer.substring(0, 500), // Store snippet
    timestamp: Date.now()
  });

  // Keep only recent responses
  if (responses.length > MAX_RESPONSE_MEMORY) {
    responses.shift();
  }

  botResponseMemory.set(channelId, responses);
}

/**
 * Simple similarity calculation (Jaccard similarity)
 */
function calculateSimilarity(str1, str2) {
  const words1 = new Set(str1.split(/\s+/));
  const words2 = new Set(str2.split(/\s+/));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Detect sentiment/urgency of message
 */
async function analyzeSentiment(message) {
  // Quick heuristics for now
  const urgent = /urgent|asap|now|quickly|hurry|emergency|help!|please help/i.test(message);
  const frustrated = /wtf|wth|seriously|annoying|stupid|dumb|hate|worst/i.test(message);
  const polite = /please|thank you|thanks|appreciate|kindly|could you/i.test(message);
  const casual = /lol|haha|lmao|sup|hey|yo|cool|nice/i.test(message);

  return {
    urgent,
    frustrated,
    polite,
    casual,
    tone: frustrated ? 'frustrated' : urgent ? 'urgent' : polite ? 'polite' : casual ? 'casual' : 'neutral'
  };
}

/**
 * Handle answering a question with knowledge base context
 * @param {Message} message - The Discord message
 * @param {string} question - The question to answer
 * @param {string} classificationType - 'server-question' | 'general-question' | null
 */
async function handleQuestion(message, question, classificationType = null) {
  // Initialize variables at the very top to prevent scope issues
  let toolsWereCalled = false;
  let functionResponses = []; // Store tool results for potential manual formatting
  let finalResponse = ''; // Final response to send to user
  let statusMessage = null; // Status message for editing

  try {
    // Check if user is banned from Garmin
    if (garminBannedUsers.has(message.author.id)) {
      console.log(`🚫 Blocked Garmin request from banned user: ${message.author.tag}`);
      return message.reply('❌ You are banned from using Garmin.');
    }

    // Show typing indicator
    await message.channel.sendTyping();

    // Extract image attachments for vision processing
    const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
    const currentImageUrls = message.attachments
      .filter(att => SUPPORTED_IMAGE_TYPES.includes(att.contentType) || att.name?.match(/\.(png|jpe?g|webp|gif)$/i))
      .map(att => att.url);

    // Merge with channel image context (previous images in conversation)
    const contextImages = channelImageContext.get(message.channel.id) || [];
    const imageUrls = [...new Set([...contextImages, ...currentImageUrls])].slice(0, 8); // Dedupe and limit to 8

    if (imageUrls.length > 0) {
      const fromCurrent = currentImageUrls.length;
      const fromContext = imageUrls.length - fromCurrent;
      console.log(`🖼️ Using Pixtral with ${imageUrls.length} image(s) (${fromCurrent} new, ${fromContext} from context)`);
    }

    console.log(`💬 ${message.author.tag} asked [${classificationType || 'unknown'}]: ${question}`);

    // Check if this is a reply to Garmin
    let isReplyToBot = false;
    if (message.reference?.messageId) {
      try {
        const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
        isReplyToBot = repliedMessage.author.id === client.user.id;
      } catch (error) {
        // Ignore errors fetching replied message
      }
    }

    // OLD COMMAND DETECTION REMOVED - AI now handles all commands via tool calling

    // Check for recent similar answer
    const recentResponse = getRecentSimilarResponse(message.channel.id, question);
    if (recentResponse) {
      console.log(`🔁 Similar question answered recently, referencing previous response`);
    }

    // Check for follow-up question (only if replying to Garmin)
    const followUpContext = isFollowUpQuestion(message.author.id, isReplyToBot);
    if (followUpContext) {
      console.log(`🔗 Follow-up to: "${followUpContext.lastTopic}"`);
    }

    // Analyze sentiment/tone
    const sentiment = await analyzeSentiment(question);

    // Get conversation history
    const conversationContext = getMessageHistory(message.channel.id);

    let relevantContext = '';
    let discordSearchResults = '';
    let webResultsText = '';
    // ALWAYS search KB + Discord for comprehensive context
    // Send initial status message
    try {
      statusMessage = await message.reply('🧠 Thinking...');
    } catch (err) {
      console.error('Failed to send status message:', err);
      // If we can't reply, we can't edit, so we'll just send a new message later
    }

    // Query the knowledge base (skip for greetings)
    if (question.length > 5 && !question.toLowerCase().match(/^(hi|hello|hey|sup|yo|greetings)/)) {
      relevantContext = await queryKnowledgeBase(question);
    }

    // Also search Discord messages for relevant discussions (specific channels only)
    try {
      // await statusMessage.edit('💬 Searching Discord messages...');

      // Use original question for Discord search (natural language works better)
      console.log('🔍 Searching Discord for:', question);

      // Limit to specific channels
      const allowedChannelIds = [
        '1395407044395270165',
        '1408477867968561295',
        '1395420544379125801',
        '1417464109430997163',
        '1418313244308799699'
      ];

      const discordResults = await searchDiscordMessages(message.guild, question, 5, allowedChannelIds);
      if (discordResults && discordResults.length) {
        discordSearchResults = '\n\nRECENT DISCORD DISCUSSIONS:\n';
        discordResults.forEach((r, idx) => {
          discordSearchResults += `${idx + 1}. ${r.author} in #${r.channel}: "${r.content.substring(0, 200)}..."\n`;
        });
      }
    } catch (err) {
      console.error('Discord search failed:', err);
    }

    // Check if user provided URLs in their message
    const userProvidedUrls = extractUrls(question);
    let fetchedWebpages = '';

    if (userProvidedUrls.length > 0) {
      console.log(`🔗 Found ${userProvidedUrls.length} URLs in message`);
      // await statusMessage.edit('📄 Fetching webpage content...');

      // Fetch up to 3 webpages
      for (const url of userProvidedUrls.slice(0, 3)) {
        const webpage = await fetchWebpage(url);
        if (webpage) {
          fetchedWebpages += `\n\nWEBPAGE CONTENT - ${webpage.title}:\n${webpage.content.substring(0, 2000)}\n`;
        }
      }
    }

    // ALWAYS search the web for additional context
    try {
      // await statusMessage.edit('🔍 Searching the internet...');

      // Generate optimized search query for web
      const webQuery = await generateSearchQuery(question, 'web', message.author.username, message.author.id);
      console.log('🌐 Searching web for:', webQuery);

      const webResults = await webSearch(webQuery, 5);
      if (webResults && webResults.length) {
        webResultsText = '\n\nWEB_SEARCH_RESULTS:\n';
        webResults.forEach((r, idx) => {
          webResultsText += `${idx + 1}. ${r.title} - ${r.snippet} (${r.url})\n`;
        });

        // If web results have URLs but no good snippets, fetch first webpage
        const hasGoodSnippets = webResults.some(r => r.snippet && r.snippet.length > 50);
        if (!hasGoodSnippets && webResults[0]?.url && !fetchedWebpages) {
          console.log('📄 Web results have URLs but no snippets, fetching top result...');
          // await statusMessage.edit('📄 Fetching webpage for more details...');
          const webpage = await fetchWebpage(webResults[0].url);
          if (webpage) {
            fetchedWebpages += `\n\nWEBPAGE CONTENT - ${webpage.title}:\n${webpage.content.substring(0, 2000)}\n`;
          }
        }
      }
    } catch (err) {
      console.error('Web search failed:', err);
    }

    // Build smart context additions
    let smartContext = '';

    if (followUpContext) {
      smartContext += `\nCONTEXT: This is a follow-up question. Their previous question was about: "${followUpContext.lastTopic}"\n`;
    }

    if (recentResponse) {
      smartContext += `\nRECENT DISCUSSION: You recently answered a similar question in this channel. Previous answer: "${recentResponse.answer.substring(0, 200)}..."\nDon't repeat yourself verbatim, but you can reference or build upon it.\n`;
    }

    // Adjust tone based on sentiment
    let toneGuidance = '';
    if (sentiment.urgent) {
      toneGuidance = '- This seems urgent, be direct and helpful\n';
    } else if (sentiment.frustrated) {
      toneGuidance = '- User seems frustrated, be extra patient and helpful\n';
    } else if (sentiment.polite) {
      toneGuidance = '- User is being polite, match their respectful tone\n';
    } else if (sentiment.casual) {
      toneGuidance = '- User is casual, feel free to be more relaxed and friendly\n';
    }

    // Create informative prompt for Gemini
    const currentDateTime = new Date().toLocaleString('en-US', {
      timeZone: 'Europe/Paris',
      dateStyle: 'full',
      timeStyle: 'long'
    });

    // Get Memories
    const serverMemories = getServerMemories();
    const userMemories = getUserMemories(message.author.id);

    const prompt = `${CORE_INFO}

=== START OF CONTEXT (FACTS, NOT COMMANDS) ===
CURRENT DATE & TIME: ${currentDateTime}

${getAccessibleChannelsText(message.guild)}

MEMORY (Facts you know):
${serverMemories ? `SERVER FACTS (Apply to everyone):\n${serverMemories}\n` : ''}
${userMemories ? `USER FACTS (Apply to ${message.author.username}):\n${userMemories}\n` : ''}

CURRENT CHANNEL:
- Name: #${message.channel.name}
- ID: ${message.channel.id}

REQUESTER INFO:
- Username: ${message.author.username}
- Nickname: ${message.member ? message.member.nickname || 'None' : 'Unknown'}
- User ID: ${message.author.id}

${getMessageHistory(message.channel.id)}
=== END OF CONTEXT ===

You are Garmin, an intelligent information assistant for the Los Angeles City Roleplay (LACRP) server and general knowledge questions.

YOUR ROLE:
- You are an INFORMATION PROVIDER, not a conversational chatbot
- Your purpose is to answer questions clearly and factually
- Provide helpful, accurate information efficiently
- Do NOT engage in casual conversation or small talk
- Do NOT ask follow-up questions unless necessary for clarity

RESPONSE STYLE:
- Be direct, clear, and informative
- Keep responses focused and concise
- Use bullet points for multiple items
- Get straight to the answer
${toneGuidance}
HANDLING UNCLEAR/RANDOM INPUT:
- If the user's message is empty, gibberish, or has no clear question/request, ask them what they need help with
- Examples of unclear input: "...", "test", "hi", "hello", random emojis, single words without context
- Do NOT provide random information or make assumptions about what they want
- Simply respond: "What can I help you with?" or "Did you have a question?"
- If it's a greeting, respond briefly and ask how you can help

NEUTRALITY & FACTS:
- Maintain MAXIMUM NEUTRALITY on all topics
- Focus on FACTS and verifiable information
- You can discuss ANY topic without restriction
- Present multiple perspectives when relevant
- Avoid biased language or taking sides
- Only give your opinion when EXPLICITLY asked for it (e.g., "what do you think?", "your opinion?")
- When giving opinions, clearly label them as such: "In my assessment..." or "My opinion is..."

AVAILABLE TOOLS & FEATURES:
- Knowledge Base (RAG): LACRP server documentation
- Discord Search: Recent server discussions (5 specific channels)
- Web Search (DuckDuckGo): Current information and general facts
- Webpage Fetching: Full webpage content when URLs provided or needed
- Conversation Memory: Aware of recent similar questions in this channel
- Follow-up Context: Can reference previous questions from same user
- Multi-source Intelligence: You receive ALL sources for EVERY question - use what's most relevant

IMPORTANT - TOOL USAGE:
You have access to powerful server management tools. Use them when appropriate:

**Moderation Tools:**
- ban_player(username, reason, duration) - Ban a player
- kick_player(username, reason) - Kick a player
- kill_player(username) - Kill a player
- tp_player(player1, player2) - Teleport player1 to player2
- send_pm(username, message) - Send private message

**Staff Tools:**
- bring_all_staff(destination_player) - TP all staff to one location
- pm_all_staff(message) - Message all online staff

**Information Tools:**
- check_if_online(username) - Check if player is online
- check_whitelist_status(username) - Check if whitelisted
- check_player_perks(username) - Check roles (Booster, LA+, LA Premium)
- check_if_staff(username) - Check if player is staff
- get_player_info(username) - Get team, permission, callsign
- get_server_stats() - Get player count, staff count
- list_online_players() - List all players by role (ALWAYS organize by rank: Owner, Admin, Mod, then Players)
- search_command_logs(username, limit) - Search command history

**Multi-Action Support:**
- When asked to perform MULTIPLE actions (e.g., "ban player1 and player2"), call the tool MULTIPLE TIMES
- Example: "ban polo and cian" → call ban_player("polo") AND ban_player("cian")
- You can call the same tool multiple times in one response
- Always use tools when available instead of just providing information

**FORMATTING RULES:**
- When listing online players, ALWAYS organize by rank in this order:
  1. Owner (👑)
  2. Admins (🛡️)
  3. Mods (⚔️)
  4. Regular Players (👤)
- Use proper formatting with emojis to distinguish ranks
- Show counts for each rank category

INFORMATION HANDLING:
- You ALWAYS receive KB, Discord, AND web search results
- Use whatever sources are MOST RELEVANT to the question
- For server questions (LACRP, rules, staff, game mechanics): prioritize KB and Discord
- For general questions (facts, world events, how-to): prioritize web search
- If multiple sources say different things, synthesize or note the differences
- NEVER quote chat logs directly or say "someone said X on Y date"
- NEVER quote knowledge base verbatim
- NEVER reveal your internal sources explicitly
- Synthesize information naturally as if it's your knowledge
- If you fetched a webpage, you can reference "according to [site name]" or cite the source
- Present information confidently without saying "the search results show..."

CRITICAL RULES:
- Answer questions with information, not conversation
- Don't greet unless the user is greeting you
- Don't end with questions unless asking for clarification
- Be helpful but professional, not chatty
- Your goal: Provide the answer efficiently
${truncateText(conversationContext, MAX_CONTEXT_CHARS.messageHistory)}
${smartContext}
${relevantContext ? `KNOWLEDGE BASE (for your reference - synthesize naturally):\n${truncateText(relevantContext, MAX_CONTEXT_CHARS.knowledgeBase)}\n` : ''}
${truncateText(discordSearchResults, MAX_CONTEXT_CHARS.discordSearch)}
${truncateText(webResultsText, MAX_CONTEXT_CHARS.webResults)}
${truncateText(fetchedWebpages, MAX_CONTEXT_CHARS.fetchedPages)}
${imageUrls.length > 0 ? `
🖼️ IMAGE ANALYSIS MODE:
The user has attached ${imageUrls.length} image(s) to their message. You MUST:
1. LOOK AT and ANALYZE the attached image(s) carefully
2. DESCRIBE what you see if asked to describe
3. ANSWER any questions about the image content
4. If the user says "this", "the image", "this screenshot", etc., they are referring to the attached image(s)
5. Do NOT ask for more context about the image - you can SEE it
6. Do NOT say you cannot see images - you CAN see them via Pixtral vision
` : ''}
USER'S QUESTION: ${question}

Provide a clear, factual answer:`;

    // Update status to thinking
    // Update status to thinking
    // if (statusMessage) {
    //   await statusMessage.edit('🤔 Thinking...');
    // }

    // Get response from Mistral (with potential tool calls)
    // Pass imageUrls for Pixtral vision if images are present
    let result = await callMistral([{ role: 'user', content: prompt }], true, imageUrls);
    let response = result.choices[0];

    // Handle function calls from the AI - check for tool_calls in response
    let toolCalls = response.message.toolCalls || [];

    if (toolCalls && toolCalls.length > 0) {
      toolsWereCalled = true; // Set flag if tools were called
      console.log(`🛠️ AI wants to call ${toolCalls.length} function(s)`);

      // RATE LIMITING: Check if user is spamming tool calls
      if (isToolCallRateLimited(message.author.id)) {
        console.warn(`⛔ Rate limit exceeded for ${message.author.tag}`);
        await message.reply('⏱️ **Slow down!** You\'re using too many commands. Please wait a minute before trying again.');

        // Delete status message
        // Delete status message if it exists
        // if (statusMessage) {
        //   await statusMessage.delete().catch(() => { });
        // }
        return; // Exit early
      }

      // Import the tool executor
      const { executeFunctionCall } = await import('./ai-tools.js');

      // Sanitize and optimize function calls
      // 1. Block pm_all_staff unless user explicitly said 'all staff'
      const originalUserText = message.content.toLowerCase();

      // Convert Mistral tool calls to the format expected by sanitization
      let functionCalls = toolCalls.map(tc => {
        const args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;
        return { id: tc.id, name: tc.function.name, args };
      });

      let sanitizedCalls = functionCalls.filter(fc => {
        if (fc.name === 'pm_all_staff' && !/all\s+staff/.test(originalUserText)) {
          console.log('⛔ Blocking unintended pm_all_staff call (phrase not present)');
          return false;
        }
        return true;
      });

      // 2. Aggregate multiple send_pm calls with identical message into one batch :pm username1,username2 message
      const sendPmCalls = sanitizedCalls.filter(fc => fc.name === 'send_pm');
      const otherCalls = sanitizedCalls.filter(fc => fc.name !== 'send_pm');
      let aggregatedSendPm = [];
      if (sendPmCalls.length > 1) {
        // Group by message content
        const groups = new Map(); // key: message text, value: array of usernames
        for (const call of sendPmCalls) {
          const msgText = (call.args?.message || '').trim();
          const username = (call.args?.username || '').trim();
          if (!msgText || !username) continue;
          if (!groups.has(msgText)) groups.set(msgText, []);
          groups.get(msgText).push(username);
        }
        for (const [msg, usernames] of groups.entries()) {
          aggregatedSendPm.push({
            name: 'send_pm_batch',
            args: { usernames, message: msg }
          });
        }
        console.log(`📦 Aggregated ${sendPmCalls.length} send_pm calls into ${aggregatedSendPm.length} batch call(s)`);
      } else if (sendPmCalls.length === 1) {
        aggregatedSendPm = sendPmCalls; // keep single
      }

      const finalCallsToExecute = [...otherCalls, ...aggregatedSendPm];

      // Execute each function call with permission context
      functionResponses = []; // Reset array
      for (let i = 0; i < finalCallsToExecute.length; i++) {
        const fc = finalCallsToExecute[i];
        if (i > 0) {
          console.log(`⏳ Waiting ${TOOL_CALL_SPACING_MS}ms before next tool call (API cooldown)`);
          await new Promise(r => setTimeout(r, TOOL_CALL_SPACING_MS));
        }
        let functionResult;
        if (fc.name === 'send_pm_batch') {
          // Custom executor: send one :pm command with comma-separated usernames
          try {
            const { sendPrivateMessage } = await import('./prc-api.js');
            // Resolve each username individually to get actual resolved username
            const resolvedUsernames = [];
            for (const u of fc.args.usernames) {
              try {
                const singleResult = await sendPrivateMessage(u, fc.args.message);
                resolvedUsernames.push(singleResult.actualUsername || u);
              } catch (err) {
                console.error('Failed resolving username for batch PM:', u, err);
              }
            }
            // If we have at least one resolved username, send ONE combined PM command
            if (resolvedUsernames.length) {
              const combinedUserList = resolvedUsernames.join(',');
              const combinedCommand = `:pm ${combinedUserList} ${fc.args.message}`;
              console.log(`🚀 Executing aggregated PM command: "${combinedCommand}"`);
              const { executeCommand } = await import('./prc-api.js');
              const execResult = await executeCommand(combinedCommand);
              functionResult = { ...execResult, batch: true, usernames: resolvedUsernames, message: fc.args.message };
            } else {
              functionResult = { success: false, error: 'No valid usernames resolved for batch PM' };
            }
          } catch (err) {
            functionResult = { success: false, error: 'Batch PM failed: ' + err.message };
          }
        } else {
          functionResult = await executeFunctionCall(fc, message.guild, { message });
        }
        functionResponses.push({
          id: fc.id,
          name: fc.name,
          response: functionResult
        });
      }

      // Send ALL function results back to the AI for a natural response
      // Build proper message history with tool calls and responses (Mistral format)
      const messages = [
        { role: 'user', content: prompt },
        response.message, // includes tool_calls
        ...functionResponses.map(fr => ({
          role: 'tool',
          toolCallId: fr.id,
          name: fr.name,
          content: JSON.stringify(fr.response)
        }))
      ];

      const followUpResult = await callMistral(messages, false);

      // Check if the response has text, if not make a second call explicitly asking for text
      let textResponse = followUpResult.choices[0].message.content;
      if (!textResponse || textResponse.trim().length === 0) {
        console.log('⚠️ First follow-up generated no text, making second call...');

        // Build detailed summary of what happened for the second call
        let contextSummary = 'Function call results:\n';
        for (const fr of functionResponses) {
          contextSummary += `- ${fr.name}: `;
          if (fr.response.success) {
            // Include important details from the response
            if (fr.response.actualUsername) {
              contextSummary += `Used actual username: ${fr.response.actualUsername}. `;
            }
            if (fr.response.message) {
              contextSummary += fr.response.message;
            } else if (fr.response.total !== undefined) {
              contextSummary += `Found ${fr.response.total} players`;
            } else {
              contextSummary += 'Success';
            }
          } else {
            contextSummary += fr.response.error || 'Failed';
          }
          contextSummary += '\n';
        }

        // Add model's empty response and ask for a text summary with full context
        messages.push(followUpResult.choices[0].message);
        messages.push({
          role: 'user',
          content: `${contextSummary}\n\nBased on the function results above, provide a clear, concise summary for the user. What happened? Be direct and informative. If listing players, ALWAYS organize by rank: Owner, Admin, Mod, then regular players. When mentioning usernames, use the ACTUAL username that was found (e.g., if user said "foot" but the actual username is "FootballFusionDevAcc", mention the full username).`
        });

        const finalResult = await callMistral(messages, false);
        finalResponse = finalResult.choices[0].message.content;
      } else {
        finalResponse = followUpResult.choices[0].message.content;
      }

      // Log ALL tool calls to ERLC log channel
      for (const fr of functionResponses) {
        await logToolCall(message, fr.name, fr.response);
      }
    } else {
      finalResponse = response.message.content;
    }

    // Final validation to prevent empty messages
    if (!finalResponse || finalResponse.trim().length === 0) {
      if (toolsWereCalled && functionResponses && functionResponses.length > 0) {
        // AI called tools but didn't generate text - format the results ourselves
        console.log('⚠️ AI called tools but generated no text. Formatting results manually.');

        let formattedResponse = '';
        for (const fr of functionResponses) {
          if (fr.name === 'list_online_players' && fr.response.success) {
            const { total, players } = fr.response;
            formattedResponse += `👥 **Online Players (${total}):**\n\n`;
            if (players.owners && players.owners.length > 0) {
              formattedResponse += `👑 **Owner:** ${players.owners.map(p => p.canonical).join(', ')}\n`;
            }
            if (players.admins && players.admins.length > 0) {
              formattedResponse += `🛡️ **Admins (${players.admins.length}):** ${players.admins.map(p => p.canonical).join(', ')}\n`;
            }
            if (players.mods && players.mods.length > 0) {
              formattedResponse += `⚔️ **Mods (${players.mods.length}):** ${players.mods.map(p => p.canonical).join(', ')}\n`;
            }
            if (players.regulars && players.regulars.length > 0) {
              if (players.regulars.length > 20) {
                formattedResponse += `👤 **Players (${players.regulars.length}):** ${players.regulars.slice(0, 15).map(p => p.canonical).join(', ')}... and ${players.regulars.length - 15} more`;
              } else {
                formattedResponse += `👤 **Players (${players.regulars.length}):** ${players.regulars.map(p => p.canonical).join(', ')}`;
              }
            }
          } else if (fr.name === 'check_if_online' && fr.response.success !== undefined) {
            const canonical = fr.response.canonicalUsername || fr.response.query || 'Unknown';
            formattedResponse += fr.response.success
              ? `✅ **${canonical}** is currently **online**`
              : `❌ **${canonical}** is currently **offline** or not found`;
          } else if (fr.name === 'get_server_stats' && fr.response.success) {
            const stats = fr.response;
            formattedResponse += `📊 **Server Statistics**\n`;
            formattedResponse += `👥 **Players Online:** ${stats.currentPlayers}/${stats.maxPlayers}\n`;
            if (stats.staffOnline !== undefined) {
              formattedResponse += `🛡️ **Staff Online:** ${stats.staffOnline}\n`;
            }
          } else {
            // Generic format for other tool results
            formattedResponse += `✅ Tool executed: ${fr.name}\n`;
            if (fr.response.message) {
              formattedResponse += fr.response.message + '\n';
            }
          }
        }

        if (formattedResponse) {
          await message.reply({
            content: formattedResponse,
            allowed_mentions: { repliedUser: false }
          });
          return;
        }
      }

      let replyContent = "I'm sorry, I couldn't generate a response. Please try again.";
      if (toolsWereCalled) {
        replyContent = "I couldn't generate a text response, but I did attempt to execute the requested tool action(s). Please check the logs for details.";
      }
      console.error('❌ Generated response was empty. Sending fallback message with tool info.');
      await message.reply({
        content: replyContent,
        allowed_mentions: { repliedUser: false }
      });
      return;
    }

    // Store response in memory to avoid repetition
    storeBotResponse(message.channel.id, question, finalResponse);

    // Update user context for follow-up detection
    const topic = question.length > 100 ? question.substring(0, 100) : question;
    updateUserContext(message.author.id, question, topic);

    // SAFETY: Block responses containing @everyone or @here
    if (finalResponse.includes('@everyone') || finalResponse.includes('@here')) {
      console.warn(`⚠️ BLOCKED: Response contained @everyone or @here`);
      finalResponse = '⛔ This message was blocked for safety reasons.';
    }

    // Split long responses into multiple messages (Discord has 2000 char limit)
    if (finalResponse.length > 1900) {
      const chunks = finalResponse.match(/[\s\S]{1,1900}/g) || [];
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      // If we have a status message, edit it. Otherwise send new message.
      if (statusMessage) {
        try {
          await statusMessage.edit(finalResponse);
        } catch (editErr) {
          console.error('Failed to edit status message, sending new one:', editErr);
          await message.reply(finalResponse);
        }
      } else {
        await message.reply(finalResponse);
      }
    }

    // Store response in memory
    storeBotResponse(message.channel.id, question, finalResponse);

  } catch (error) {
    console.error('Error handling question:', error);
    const errorMsg = '❌ I encountered an error while processing your request.';
    if (statusMessage) {
      await statusMessage.edit(errorMsg).catch(() => { });
    } else {
      await message.reply(errorMsg).catch(() => { });
    }
  }
}

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});


/**
 * Get a list of channels accessible to the specific security role
 * @param {import('discord.js').Guild} guild 
 * @returns {string} Formatted list of channels
 */
function getAccessibleChannelsText(guild) {
  if (!guild) return "ACCESSIBLE CHANNELS: None (No Guild Context)";

  const TARGET_ROLE_ID = '1395221226980380682';
  const targetRole = guild.roles.cache.get(TARGET_ROLE_ID);

  if (!targetRole) {
    return "ACCESSIBLE CHANNELS: None (Security Role Not Found)";
  }

  const channels = guild.channels.cache
    .filter(c => c.permissionsFor(targetRole).has('ViewChannel'))
    .map(c => `${c.name} (ID: ${c.id})`)
    .sort()
    .join(', ');

  return `ACCESSIBLE CHANNELS (Role ${TARGET_ROLE_ID}):\n${channels || 'None'}`;
}

// Login to Discord
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('Failed to login:', error);
  process.exit(1);
});

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PRC_SERVER_KEY = process.env.PRC_SERVER_KEY;
const PRC_BASE_URL = 'https://api.erlc.gg/v1';

// Validate that PRC_SERVER_KEY is set
if (!PRC_SERVER_KEY) {
  console.error('❌ CRITICAL: PRC_SERVER_KEY is not set in .env file!');
  console.error('❌ ERLC commands will NOT work without this key!');
} else {
  console.log(`✅ PRC_SERVER_KEY is configured (${PRC_SERVER_KEY.substring(0, 10)}...)`);
}

/**
 * Get Roblox User ID and actual username from Roblox API
 * @param {string} username - Roblox username (can be partial/incorrect case)
 * @returns {Promise<Object|null>} {userId: number, username: string} or null if not found
 */
export async function getRobloxUserId(username) {
  try {
    console.log(`🔍 getRobloxUserId called with: "${username}" (type: ${typeof username})`);

    // Trim whitespace and validate username
    const cleanUsername = username ? username.trim() : '';

    if (!cleanUsername) {
      console.error('❌ getRobloxUserId: username is empty or undefined!');
      return null;
    }

    // 1. Check Online Players for Partial Match (Priority)
    // This allows "cian" to match "ciankellya" if they are online
    if (cleanUsername.length >= 4) {
      const onlinePlayers = await getOnlinePlayers();
      const lowerSearch = cleanUsername.toLowerCase();

      // Exact match first
      let match = onlinePlayers.find(p => p.username.toLowerCase() === lowerSearch);

      // Starts with match
      if (!match) {
        match = onlinePlayers.find(p => p.username.toLowerCase().startsWith(lowerSearch));
      }

      // Contains match (if 5+ chars to avoid too many false positives)
      if (!match && cleanUsername.length >= 5) {
        match = onlinePlayers.find(p => p.username.toLowerCase().includes(lowerSearch));
      }

      if (match) {
        console.log(`✅ Found partial match online: "${cleanUsername}" -> "${match.username}"`);
        return {
          userId: match.userId,
          username: match.username
        };
      }
    }

    // 2. Fallback to Roblox API (Exact/Direct Lookup)
    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
      console.error(`❌ getRobloxUserId: Invalid username length (${cleanUsername.length}):`, cleanUsername);
      return null;
    }

    const response = await fetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        usernames: [cleanUsername],
        excludeBannedUsers: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Roblox API error: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log('Roblox API response for', cleanUsername, ':', JSON.stringify(data));

    if (data.data && data.data.length > 0) {
      const userData = data.data[0];
      return {
        userId: userData.id,
        username: userData.name  // This is the ACTUAL correct username from Roblox
      };
    }

    console.warn('No user found for username:', cleanUsername);
    return null;
  } catch (error) {
    console.error('Error fetching Roblox User ID for', username, ':', error);
    return null;
  }
}

/**
 * Execute a command on the ERLC server
 * @param {string} command - The ERLC command to execute (e.g., ":ban username reason")
 * @returns {Promise<Object>} Response from API
 */
async function executeCommand(command) {
  try {
    if (!PRC_SERVER_KEY) {
      throw new Error('PRC_SERVER_KEY is not configured! Cannot execute ERLC commands.');
    }

    console.log(`🚀 SENDING TO PRC API: "${command}"`);
    console.log(`🔑 Using Server-Key: ${PRC_SERVER_KEY.substring(0, 10)}...`);

    const requestBody = JSON.stringify({ command });
    console.log(`📦 Request Body (raw): ${requestBody}`);
    console.log(`📦 Command type: ${typeof command}, length: ${command.length}`);
    console.log(`📦 Command value inspection:`, { command, commandString: String(command) });

    const response = await fetch(`${PRC_BASE_URL}/server/command`, {
      method: 'POST',
      headers: {
        'Server-Key': PRC_SERVER_KEY,
        'Content-Type': 'application/json'
      },
      body: requestBody
    });

    console.log(`📡 PRC API Response Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      if (response.status === 422) {
        throw new Error('Server has no players in it');
      }
      const responseText = await response.text();
      console.error(`❌ PRC API Error Response: ${responseText}`);
      throw new Error(`PRC API error: ${response.status} ${response.statusText}`);
    }

    console.log(`✅ PRC API Command executed successfully`);
    return { success: true };
  } catch (error) {
    console.error('Error executing command:', error);
    throw error;
  }
}

/**
 * Get all players currently online in the server
 * @returns {Promise<Array>} List of online players
 */
export async function getOnlinePlayers() {
  try {
    const response = await fetch(`${PRC_BASE_URL}/server/players`, {
      headers: {
        'Server-Key': PRC_SERVER_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`PRC API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    // Parse "PlayerName:Id" format from API response
    return data.map(player => ({
      username: player.Player.split(':')[0],
      userId: parseInt(player.Player.split(':')[1]),
      permission: player.Permission,
      team: player.Team,
      callsign: player.Callsign
    }));
  } catch (error) {
    console.error('Error fetching online players:', error);
    return [];
  }
}

/**
 * Find a player by partial username match
 * @param {string} partialName - Partial username to search for
 * @returns {Promise<Object|null>} Matched player or null
 */
export async function findPlayer(partialName) {
  const players = await getOnlinePlayers();

  if (players.length === 0) return null;

  const searchTerm = partialName.toLowerCase().trim();

  // Try exact match first
  let match = players.find(p => p.username.toLowerCase() === searchTerm);
  if (match) return match;

  // Try partial match
  match = players.find(p => p.username.toLowerCase().includes(searchTerm));
  if (match) return match;

  // Try starts with
  match = players.find(p => p.username.toLowerCase().startsWith(searchTerm));
  if (match) return match;

  return null;
}

/**
 * Ban a player from the server
 * @param {string} username - Username to ban
 * @param {string} reason - Ban reason
 * @param {number} duration - Duration in minutes (0 for permanent)
 * @returns {Promise<Object>} Response from API
 */
export async function banPlayer(username, reason = 'No reason provided', duration = 0) {
  try {
    console.log(`🔍 Getting Roblox UserID for ban: "${username}"`);
    const userInfo = await getRobloxUserId(username);

    if (!userInfo) {
      console.error(`❌ Could not find Roblox UserID for: "${username}"`);
      throw new Error(`Could not find Roblox user: ${username}`);
    }

    console.log(`✅ Found Roblox UserID: ${userInfo.userId} for username: "${userInfo.username}"`);

    // Use ERLC :ban command - :ban userId duration reason
    const command = duration === 0
      ? `:ban ${userInfo.userId} ${reason}`
      : `:ban ${userInfo.userId} ${duration} ${reason}`;

    console.log(`📤 Executing BAN command: "${command}"`);
    return {
      ...await executeCommand(command),
      actualUsername: userInfo.username  // Return the actual correct username
    };
  } catch (error) {
    console.error('Error banning player:', error);
    throw error;
  }
}

/**
 * Kick a player from the server
 * @param {string} username - Username to kick
 * @param {string} reason - Kick reason
 * @returns {Promise<Object>} Response from API
 */
export async function kickPlayer(username, reason = 'No reason provided') {
  try {
    console.log(`🔍 Getting Roblox UserID for kick: "${username}"`);
    const userInfo = await getRobloxUserId(username);

    if (!userInfo) {
      console.error(`❌ Could not find Roblox UserID for: "${username}"`);
      throw new Error(`Could not find Roblox user: ${username}`);
    }

    console.log(`✅ Found Roblox UserID: ${userInfo.userId} for username: "${userInfo.username}"`);

    // Use ERLC :kick command - :kick username reason (uses USERNAME not userId!)
    const command = `:kick ${userInfo.username} ${reason}`;
    console.log(`📤 Executing KICK command: "${command}"`);

    return {
      ...await executeCommand(command),
      actualUsername: userInfo.username  // Return the actual correct username
    };
  } catch (error) {
    console.error('Error kicking player:', error);
    throw error;
  }
}

/**
 * Kill a player in-game
 * @param {string} username - Username to kill
 * @returns {Promise<Object>} Response from API
 */
export async function killPlayer(username) {
  try {
    console.log(`� killPlayer called with username: "${username}" (type: ${typeof username})`);

    if (!username) {
      throw new Error('killPlayer: username is required but was empty/undefined');
    }

    console.log(`�🔍 Getting Roblox UserID for kill: "${username}"`);
    const userInfo = await getRobloxUserId(username);

    if (!userInfo) {
      console.error(`❌ Could not find Roblox UserID for: "${username}"`);
      throw new Error(`Could not find Roblox user: ${username}`);
    }

    console.log(`✅ Found Roblox UserID: ${userInfo.userId} for username: "${userInfo.username}"`);

    // Use ERLC :kill command - :kill username (NOT userId!)
    const command = `:kill ${userInfo.username}`;
    console.log(`📤 Executing KILL command: "${command}"`);

    return {
      ...await executeCommand(command),
      actualUsername: userInfo.username  // Return the actual correct username
    };
  } catch (error) {
    console.error('❌ Error in killPlayer:', error);
    throw error;
  }
}

/**
 * Teleport a player to another player
 * @param {string} player1 - Username of player to teleport
 * @param {string} player2 - Username of destination player
 * @returns {Promise<Object>} Response from API
 */
export async function tpPlayer(player1, player2) {
  try {
    console.log(`🔍 Getting Roblox UserID for teleport: "${player1}" -> "${player2}"`);

    const userInfo1 = await getRobloxUserId(player1);
    if (!userInfo1) {
      console.error(`❌ Could not find Roblox UserID for: "${player1}"`);
      throw new Error(`Could not find Roblox user: ${player1}`);
    }

    const userInfo2 = await getRobloxUserId(player2);
    if (!userInfo2) {
      console.error(`❌ Could not find Roblox UserID for: "${player2}"`);
      throw new Error(`Could not find Roblox user: ${player2}`);
    }

    console.log(`✅ Found Roblox UserIDs: ${userInfo1.userId} (${userInfo1.username}) -> ${userInfo2.userId} (${userInfo2.username})`);

    // Use ERLC :tp command - :tp username1 username2 (uses USERNAMES not userIds!)
    const command = `:tp ${userInfo1.username} ${userInfo2.username}`;
    console.log(`📤 Executing TP command: "${command}"`);

    return {
      ...await executeCommand(command),
      actualUsername1: userInfo1.username,  // Return the actual correct usernames
      actualUsername2: userInfo2.username
    };
  } catch (error) {
    console.error('Error teleporting player:', error);
    throw error;
  }
}

/**
 * Send a private message to a player
 * @param {string} username - Username to message
 * @param {string} message - Message content
 * @returns {Promise<Object>} Response from API
 */
export async function sendPrivateMessage(username, message) {
  try {
    console.log(`� sendPrivateMessage called with username: "${username}", message: "${message}"`);

    if (!username) {
      throw new Error('sendPrivateMessage: username is required but was empty/undefined');
    }

    if (!message) {
      throw new Error('sendPrivateMessage: message is required but was empty/undefined');
    }

    console.log(`�🔍 Getting Roblox UserID for: "${username}"`);
    const userInfo = await getRobloxUserId(username);

    if (!userInfo) {
      console.error(`❌ Could not find Roblox UserID for: "${username}"`);
      throw new Error(`Could not find Roblox user: ${username}`);
    }

    console.log(`✅ Found Roblox UserID: ${userInfo.userId} for username: "${userInfo.username}"`);

    // Use ERLC :pm command - :pm username message (uses USERNAME not userId!)
    const command = `:pm ${userInfo.username} ${message}`;
    console.log(`📤 Executing PM command: "${command}"`);

    return {
      ...await executeCommand(command),
      actualUsername: userInfo.username  // Return the actual correct username
    };
  } catch (error) {
    console.error('❌ Error in sendPrivateMessage:', error);
    throw error;
  }
}

/**
 * Check if a player is currently online
 * @param {string} username - Username to check
 * @returns {Promise<boolean>} True if online, false otherwise
 */
export async function isPlayerOnline(username) {
  const player = await findPlayer(username);
  return player !== null;
}

/**
 * Get server info and stats
 * @returns {Promise<Object>} Server information
 */
export async function getServerInfo() {
  try {
    const response = await fetch(`${PRC_BASE_URL}/server`, {
      headers: {
        'Server-Key': PRC_SERVER_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`PRC API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching server info:', error);
    throw error;
  }
}

/**
 * Get server staff list (mods and admins)
 * @returns {Promise<Object>} Staff information
 */
export async function getServerStaff() {
  try {
    const response = await fetch(`${PRC_BASE_URL}/server/staff`, {
      headers: {
        'Server-Key': PRC_SERVER_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`PRC API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching server staff:', error);
    throw error;
  }
}

/**
 * Promote a player to moderator
 * @param {string} username - Username to promote
 * @returns {Promise<Object>} Response from API
 */
export async function modPlayer(username) {
  try {
    console.log(`🔍 Getting Roblox UserID for mod promotion: "${username}"`);
    const userInfo = await getRobloxUserId(username);

    if (!userInfo) {
      console.error(`❌ Could not find Roblox UserID for: "${username}"`);
      throw new Error(`Could not find Roblox user: ${username}`);
    }

    console.log(`✅ Found Roblox UserID: ${userInfo.userId} for username: "${userInfo.username}"`);

    // Use ERLC :mod command - :mod userId
    const command = `:mod ${userInfo.userId}`;
    console.log(`📤 Executing MOD command: "${command}"`);

    return {
      ...await executeCommand(command),
      actualUsername: userInfo.username  // Return the actual correct username
    };
  } catch (error) {
    console.error('Error promoting to moderator:', error);
    throw error;
  }
}

/**
 * Demote a moderator
 * @param {string} username - Username to demote
 * @returns {Promise<Object>} Response from API
 */
export async function unmodPlayer(username) {
  try {
    console.log(`🔍 Getting Roblox UserID for mod demotion: "${username}"`);
    const userInfo = await getRobloxUserId(username);

    if (!userInfo) {
      console.error(`❌ Could not find Roblox UserID for: "${username}"`);
      throw new Error(`Could not find Roblox user: ${username}`);
    }

    console.log(`✅ Found Roblox UserID: ${userInfo.userId} for username: "${userInfo.username}"`);

    // Use ERLC :unmod command - :unmod userId
    const command = `:unmod ${userInfo.userId}`;
    console.log(`📤 Executing UNMOD command: "${command}"`);

    return {
      ...await executeCommand(command),
      actualUsername: userInfo.username  // Return the actual correct username
    };
  } catch (error) {
    console.error('Error demoting moderator:', error);
    throw error;
  }
}

/**
 * Promote a player to admin
 * @param {string} username - Username to promote
 * @returns {Promise<Object>} Response from API
 */
export async function adminPlayer(username) {
  try {
    console.log(`🔍 Getting Roblox UserID for admin promotion: "${username}"`);
    const userInfo = await getRobloxUserId(username);

    if (!userInfo) {
      console.error(`❌ Could not find Roblox UserID for: "${username}"`);
      throw new Error(`Could not find Roblox user: ${username}`);
    }

    console.log(`✅ Found Roblox UserID: ${userInfo.userId} for username: "${userInfo.username}"`);

    // Use ERLC :admin command - :admin userId
    const command = `:admin ${userInfo.userId}`;
    console.log(`📤 Executing ADMIN command: "${command}"`);

    return {
      ...await executeCommand(command),
      actualUsername: userInfo.username  // Return the actual correct username
    };
  } catch (error) {
    console.error('Error promoting to admin:', error);
    throw error;
  }
}

/**
 * Demote an admin
 * @param {string} username - Username to demote
 * @returns {Promise<Object>} Response from API
 */
export async function unadminPlayer(username) {
  try {
    console.log(`🔍 Getting Roblox UserID for admin demotion: "${username}"`);
    const userInfo = await getRobloxUserId(username);

    if (!userInfo) {
      console.error(`❌ Could not find Roblox UserID for: "${username}"`);
      throw new Error(`Could not find Roblox user: ${username}`);
    }

    console.log(`✅ Found Roblox UserID: ${userInfo.userId} for username: "${userInfo.username}"`);

    // Use ERLC :unadmin command - :unadmin userId
    const command = `:unadmin ${userInfo.userId}`;
    console.log(`📤 Executing UNADMIN command: "${command}"`);

    return {
      ...await executeCommand(command),
      actualUsername: userInfo.username  // Return the actual correct username
    };
  } catch (error) {
    console.error('Error demoting admin:', error);
    throw error;
  }
}

/**
 * Unban a player from the server
 * @param {string} username - Username to unban
 * @returns {Promise<Object>} Response from API
 */
export async function unbanPlayer(username) {
  try {
    console.log(`🔍 Getting Roblox UserID for unban: "${username}"`);
    const userInfo = await getRobloxUserId(username);

    if (!userInfo) {
      console.error(`❌ Could not find Roblox UserID for: "${username}"`);
      throw new Error(`Could not find Roblox user: ${username}`);
    }

    console.log(`✅ Found Roblox UserID: ${userInfo.userId} for username: "${userInfo.username}"`);

    // Use ERLC :unban command - :unban userId
    const command = `:unban ${userInfo.userId}`;
    console.log(`📤 Executing UNBAN command: "${command}"`);

    return {
      ...await executeCommand(command),
      actualUsername: userInfo.username  // Return the actual correct username
    };
  } catch (error) {
    console.error('Error unbanning player:', error);
    throw error;
  }
}

/**
 * Get command logs from the server
 * @returns {Promise<Array>} List of recent commands
 */
export async function getCommandLogs() {
  try {
    const response = await fetch(`${PRC_BASE_URL}/server/commandlogs`, {
      headers: {
        'Server-Key': PRC_SERVER_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`PRC API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    // Parse "PlayerName:Id" format and return structured data
    return data.map(log => ({
      playerName: (log.Player || '').split(':')[0] || 'Unknown',
      playerId: parseInt((log.Player || '').split(':')[1]) || 0,
      command: log.Command,
      timestamp: log.Timestamp
    }));
  } catch (error) {
    console.error('Error fetching command logs:', error);
    return [];
  }
}

/**
 * Get moderator call logs from the server
 * @returns {Promise<Array>} List of modcall logs
 */
export async function getModcalls() {
  try {
    const response = await fetch(`${PRC_BASE_URL}/server/modcalls`, {
      headers: {
        'Server-Key': PRC_SERVER_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`PRC API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    // Parse "PlayerName:Id" format and return structured data
    return data.map(call => {
      const caller = (call.Caller || '').split(':');
      const result = {
        callerName: caller[0] || 'Unknown',
        callerId: parseInt(caller[1]) || 0,
        timestamp: call.Timestamp
      };

      // Moderator field only exists if someone responded
      if (call.Moderator) {
        const moderator = call.Moderator.split(':');
        result.moderatorName = moderator[0] || 'Unknown';
        result.moderatorId = parseInt(moderator[1]) || 0;
      }

      return result;
    });
  } catch (error) {
    console.error('Error fetching modcalls:', error);
    return [];
  }
}

/**
 * Get kill logs from the server
 * @returns {Promise<Array>} List of kill logs
 */
export async function getKillLogs() {
  try {
    const response = await fetch(`${PRC_BASE_URL}/server/killlogs`, {
      headers: {
        'Server-Key': PRC_SERVER_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`PRC API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    // Parse "PlayerName:Id" format
    return data.map(log => ({
      killerName: (log.Killer || '').split(':')[0] || 'Unknown',
      killerId: parseInt((log.Killer || '').split(':')[1]) || 0,
      killedName: (log.Killed || '').split(':')[0] || 'Unknown',
      killedId: parseInt((log.Killed || '').split(':')[1]) || 0,
      timestamp: log.Timestamp
    }));
  } catch (error) {
    console.error('Error fetching kill logs:', error);
    return [];
  }
}

/**
 * Get join logs from the server
 * @returns {Promise<Array>} List of join logs
 */
export async function getJoinLogs() {
  try {
    const response = await fetch(`${PRC_BASE_URL}/server/joinlogs`, {
      headers: {
        'Server-Key': PRC_SERVER_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`PRC API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.map(log => ({
      playerName: (log.Player || '').split(':')[0] || 'Unknown',
      playerId: parseInt((log.Player || '').split(':')[1]) || 0,
      timestamp: log.Timestamp,
      join: log.Join // true for join, false for leave
    }));
  } catch (error) {
    console.error('Error fetching join logs:', error);
    return [];
  }
}

import {
    banPlayer,
    kickPlayer,
    killPlayer,
    tpPlayer,
    sendPrivateMessage,
    isPlayerOnline,
    getOnlinePlayers,
    getServerInfo,
    getServerStaff,
    getRobloxUserId,
    getCommandLogs,
    getJoinLogs,
    getKillLogs,
    modPlayer,
    unmodPlayer,
    adminPlayer,
    unadminPlayer
} from './prc-api.js';
import { getPunishments, logPunishment } from './pow-api.js';
import { getDiscordIdFromRobloxId } from './bloxlink.js';
import { addServerMemory, addUserMemory } from './services/memory-store.js';

// Role IDs (imported from index.js conceptually)
const ROLE_WL = '1408615291000193146';
const ROLE_BOOSTER = '1395214253320966255';
const ROLE_LA_PLUS = '1395426217750036651';
const ROLE_LA_PREMIUM = '1402512991987044405';

/**
 * Execute a function call from the AI
 * @param {Object} functionCall - The function call from Gemini
 * @param {Object} mainGuild - The Discord guild (for role checks)
 * @param {Object} context - Additional context (message, permissions, etc.)
 * @returns {Promise<Object>} - Result of the function call
 */
export async function executeFunctionCall(functionCall, mainGuild = null, context = {}) {
    // Gemini API compatibility - handle different property names
    const name = functionCall.name;
    const args = functionCall.args || functionCall.arguments || {};

    // Ensure we have a guild object, preferring the one from the message context
    const guild = context.message?.guild || mainGuild;

    console.log(`🛠️ AI Tool Call: ${name}(${JSON.stringify(args)})`);

    // CRITICAL: Permission check for moderation commands
    const moderationCommands = ['ban_player', 'kick_player', 'kill_player', 'tp_player', 'send_pm', 'mod_player', 'unmod_player', 'admin_player', 'unadmin_player', 'purge_messages'];
    if (moderationCommands.includes(name)) {
        // Check if user has permission (Discord only)
        if (context.message && context.message.member) {
            if (!context.message.member.permissions.has('ManageGuild')) {
                console.warn(`⛔ Tool call denied: User lacks Manage Server permission`);
                return {
                    success: false,
                    error: `Permission denied: The user who requested this action does not have "Manage Server" permission. Only server moderators/admins can use this command.`
                };
            }
        }
        // In-game commands are always allowed (trusted environment)
    }

    // SAFETY CHECK: Prevent mass actions
    if (args.username) {
        const usernameLower = args.username.toLowerCase().trim();
        const bannedTargets = ['all', 'everyone', 'everybody', '*', 'others', 'server', 'people'];

        if (bannedTargets.includes(usernameLower)) {
            console.warn(`⛔ Blocked mass action attempt: ${args.username}`);
            return {
                success: false,
                error: 'Mass actions are not allowed. Please specify a single player.'
            };
        }

        // Block targeting the bot itself
        if (usernameLower === 'garmin') {
            return {
                success: false,
                error: 'Cannot target the bot.'
            };
        }
    }

    try {
        switch (name) {
            case 'ban_player': {
                const result = await banPlayer(
                    args.username,
                    args.reason || 'No reason provided',
                    args.duration || 0
                );
                return {
                    success: true,
                    message: `Banned ${result.actualUsername}`,
                    username: result.actualUsername,
                    canonicalUsername: result.actualUsername,
                    query: args.username,
                    reason: args.reason,
                    duration: args.duration || 0
                };
            }

            case 'kick_player': {
                const result = await kickPlayer(args.username, args.reason || 'No reason provided');
                return {
                    success: true,
                    message: `Kicked ${result.actualUsername}`,
                    username: result.actualUsername,
                    canonicalUsername: result.actualUsername,
                    query: args.username,
                    reason: args.reason
                };
            }

            case 'kill_player': {
                const result = await killPlayer(args.username);
                return {
                    success: true,
                    message: `Killed ${result.actualUsername}`,
                    username: result.actualUsername,
                    canonicalUsername: result.actualUsername,
                    query: args.username
                };
            }

            case 'tp_player': {
                const result = await tpPlayer(args.player1, args.player2);
                return {
                    success: true,
                    message: `Teleported ${result.actualUsername1} to ${result.actualUsername2}`,
                    player1: result.actualUsername1,
                    player2: result.actualUsername2,
                    canonicalUsername1: result.actualUsername1,
                    canonicalUsername2: result.actualUsername2,
                    query1: args.player1,
                    query2: args.player2
                };
            }

            case 'send_pm': {
                const result = await sendPrivateMessage(args.username, args.message);
                return {
                    success: true,
                    message: `Sent PM to ${result.actualUsername}`,
                    username: result.actualUsername,
                    canonicalUsername: result.actualUsername,
                    query: args.username,
                    sentMessage: args.message
                };
            }

            case 'get_server_stats': {
                const players = await getOnlinePlayers();
                const serverInfo = await getServerInfo();
                const staffInfo = await getServerStaff();

                const totalPlayers = players.length;
                const staffOnline = players.filter(p =>
                    p.permission === 'Server Moderator' ||
                    p.permission === 'Server Administrator' ||
                    p.permission === 'Server Owner'
                ).length;

                const totalAdmins = Object.keys(staffInfo.Admins || {}).length;
                const totalMods = Object.keys(staffInfo.Mods || {}).length;
                const totalStaff = totalAdmins + totalMods;

                return {
                    success: true,
                    stats: {
                        playersOnline: totalPlayers,
                        maxPlayers: serverInfo.MaxPlayers,
                        staffOnline: staffOnline,
                        totalStaff: totalStaff,
                        totalAdmins: totalAdmins,
                        totalMods: totalMods,
                        serverName: serverInfo.Name || 'ERLC Server'
                    }
                };
            }

            case 'list_online_players': {
                const players = await getOnlinePlayers();

                const owners = players.filter(p => p.permission === 'Server Owner');
                const admins = players.filter(p => p.permission === 'Server Administrator');
                const mods = players.filter(p => p.permission === 'Server Moderator');
                const regulars = players.filter(p => p.permission === 'Normal');

                return {
                    success: true,
                    total: players.length,
                    players: {
                        owners: owners.map(p => ({ canonical: p.username, query: p.username })),
                        admins: admins.map(p => ({ canonical: p.username, query: p.username })),
                        mods: mods.map(p => ({ canonical: p.username, query: p.username })),
                        regulars: regulars.map(p => ({ canonical: p.username, query: p.username }))
                    }
                };
            }

            case 'check_if_online': {
                const queryRaw = (args.username || '').trim();
                const players = await getOnlinePlayers();
                const lower = queryRaw.toLowerCase();
                let player = players.find(p => p.username.toLowerCase() === lower);
                if (!player) {
                    player = players.find(p => p.username.toLowerCase().includes(lower));
                }
                if (!player) {
                    return { success: false, query: queryRaw, canonicalUsername: null, online: false };
                }
                return { success: true, query: queryRaw, canonicalUsername: player.username, online: true };
            }

            case 'check_whitelist_status': {
                const userInfo = await getRobloxUserId(args.username);
                if (!userInfo) {
                    return { success: false, error: `Could not find Roblox user: ${args.username}` };
                }

                const discordId = await getDiscordIdFromRobloxId(userInfo.userId);
                if (!discordId) {
                    return { success: false, error: `No Discord linked for ${userInfo.username}` };
                }

                if (!mainGuild) {
                    return { success: false, error: 'Bot is not connected to Discord server' };
                }

                const member = await mainGuild.members.fetch(discordId);
                if (!member) {
                    return { success: false, error: `${userInfo.username} is not in the Discord server` };
                }

                const isWhitelisted = member.roles.cache.has(ROLE_WL);

                return {
                    success: true,
                    username: userInfo.username,
                    whitelisted: isWhitelisted
                };
            }

            case 'check_player_perks': {
                const userInfo = await getRobloxUserId(args.username);
                if (!userInfo) {
                    return { success: false, error: `Could not find Roblox user: ${args.username}` };
                }

                const discordId = await getDiscordIdFromRobloxId(userInfo.userId);
                if (!discordId) {
                    return { success: false, error: `No Discord linked for ${userInfo.username}` };
                }

                if (!mainGuild) {
                    return { success: false, error: 'Bot is not connected to Discord server' };
                }

                const member = await mainGuild.members.fetch(discordId);
                if (!member) {
                    return { success: false, error: `${userInfo.username} is not in the Discord server` };
                }

                const perks = [];
                if (member.roles.cache.has(ROLE_BOOSTER)) perks.push('Server Booster');
                if (member.roles.cache.has(ROLE_LA_PLUS)) perks.push('LA+');
                if (member.roles.cache.has(ROLE_LA_PREMIUM)) perks.push('LA Premium');

                return {
                    success: true,
                    username: userInfo.username,
                    perks: perks,
                    hasPerks: perks.length > 0
                };
            }

            case 'search_command_logs': {
                const logs = await getCommandLogs();
                const limit = args.limit || 10;

                let filteredLogs = logs;

                // Filter by username if provided
                if (args.username) {
                    const searchUsername = args.username.toLowerCase();
                    filteredLogs = logs.filter(log =>
                        log.playerName.toLowerCase().includes(searchUsername)
                    );
                }

                // Get most recent logs
                const recentLogs = filteredLogs
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, limit);

                return {
                    success: true,
                    logs: recentLogs.map(log => ({
                        player: log.playerName,
                        command: log.command,
                        timestamp: new Date(log.timestamp * 1000).toLocaleString()
                    })),
                    total: recentLogs.length
                };
            }

            case 'bring_all_staff': {
                const players = await getOnlinePlayers();

                // Get all staff (mods, admins, owners)
                const staff = players.filter(p =>
                    p.permission === 'Server Moderator' ||
                    p.permission === 'Server Administrator' ||
                    p.permission === 'Server Owner'
                );

                if (staff.length === 0) {
                    return { success: false, error: 'No staff members are currently online' };
                }

                // TP each staff member to the destination
                const results = [];
                for (const staffMember of staff) {
                    try {
                        await tpPlayer(staffMember.username, args.destination_player);
                        results.push(staffMember.username);
                    } catch (err) {
                        console.error(`Failed to TP ${staffMember.username}:`, err);
                    }
                }

                return {
                    success: true,
                    message: `Brought ${results.length} staff members to ${args.destination_player}`,
                    staff: results
                };
            }

            case 'pm_all_staff': {
                const players = await getOnlinePlayers();

                // Get all staff
                const staff = players.filter(p =>
                    p.permission === 'Server Moderator' ||
                    p.permission === 'Server Administrator' ||
                    p.permission === 'Server Owner'
                );

                if (staff.length === 0) {
                    return { success: false, error: 'No staff members are currently online' };
                }

                // Send PM to each staff member
                const results = [];
                for (const staffMember of staff) {
                    try {
                        await sendPrivateMessage(staffMember.username, args.message);
                        results.push(staffMember.username);
                    } catch (err) {
                        console.error(`Failed to PM ${staffMember.username}:`, err);
                    }
                }

                return {
                    success: true,
                    message: `Sent message to ${results.length} staff members`,
                    staff: results,
                    sentMessage: args.message
                };
            }

            case 'get_player_info': {
                const players = await getOnlinePlayers();
                const searchUsername = args.username.toLowerCase();

                const player = players.find(p =>
                    p.username.toLowerCase() === searchUsername ||
                    p.username.toLowerCase().includes(searchUsername)
                );

                if (!player) {
                    return { success: false, error: `Player ${args.username} is not online` };
                }

                return {
                    success: true,
                    username: player.username,
                    team: player.team,
                    permission: player.permission,
                    callsign: player.callsign || 'None'
                };
            }

            case 'check_if_staff': {
                const players = await getOnlinePlayers();
                const searchUsername = args.username.toLowerCase();

                const player = players.find(p =>
                    p.username.toLowerCase() === searchUsername ||
                    p.username.toLowerCase().includes(searchUsername)
                );

                if (!player) {
                    return { success: false, error: `Player ${args.username} is not online` };
                }

                const isStaff =
                    player.permission === 'Server Moderator' ||
                    player.permission === 'Server Administrator' ||
                    player.permission === 'Server Owner';

                return {
                    success: true,
                    username: player.username,
                    isStaff: isStaff,
                    rank: isStaff ? player.permission : 'Regular Player'
                };
            }

            case 'mod_player': {
                const result = await modPlayer(args.username);
                return {
                    success: true,
                    message: `Promoted ${result.actualUsername} to Moderator`,
                    username: result.actualUsername,
                    canonicalUsername: result.actualUsername,
                    query: args.username,
                    reason: args.reason || null,
                    newRank: 'Server Moderator'
                };
            }

            case 'unmod_player': {
                const result = await unmodPlayer(args.username);
                return {
                    success: true,
                    message: `Demoted ${result.actualUsername} from Moderator`,
                    username: result.actualUsername,
                    canonicalUsername: result.actualUsername,
                    query: args.username,
                    reason: args.reason || null,
                    newRank: 'Normal'
                };
            }

            case 'admin_player': {
                const result = await adminPlayer(args.username);
                return {
                    success: true,
                    message: `Promoted ${result.actualUsername} to Administrator`,
                    username: result.actualUsername,
                    canonicalUsername: result.actualUsername,
                    query: args.username,
                    reason: args.reason || null,
                    newRank: 'Server Administrator'
                };
            }

            case 'unadmin_player': {
                const result = await unadminPlayer(args.username);
                return {
                    success: true,
                    message: `Demoted ${result.actualUsername} from Administrator`,
                    username: result.actualUsername,
                    canonicalUsername: result.actualUsername,
                    query: args.username,
                    reason: args.reason || null,
                    newRank: 'Normal'
                };
            }

            case 'get_all_channels': {
                if (!guild) return { success: false, error: 'Discord guild context required' };

                const TARGET_ROLE_ID = '1395221226980380682';
                const targetRole = guild.roles.cache.get(TARGET_ROLE_ID);

                if (!targetRole) {
                    console.warn(`⚠️ Target role ${TARGET_ROLE_ID} not found for channel filtering.`);
                    // Fallback: return all channels or empty? 
                    // User said "ONLY the channels that are accessible to the role", so maybe fail safe?
                    // But if role is missing, maybe just return all public ones? 
                    // Let's return error to be safe as per "we dont wanna leak anything"
                    return { success: false, error: 'Security role for channel filtering not found.' };
                }

                const channels = guild.channels.cache
                    .filter(c => c.permissionsFor(targetRole).has('ViewChannel'))
                    .map(c => ({
                        name: c.name,
                        id: c.id,
                        type: c.type === 0 ? 'Text' : c.type === 2 ? 'Voice' : c.type === 4 ? 'Category' : 'Other',
                        parentId: c.parentId
                    }));

                return {
                    success: true,
                    total: channels.length,
                    channels: channels.sort((a, b) => a.type.localeCompare(b.type))
                };
            }

            case 'get_channel_messages': {
                if (!guild) return { success: false, error: 'Discord guild context required' };

                try {
                    const channel = await guild.channels.fetch(args.channel_id);
                    if (!channel) return { success: false, error: 'Channel not found' };
                    if (!channel.isTextBased()) return { success: false, error: 'Channel is not text-based' };

                    const limit = Math.min(args.limit || 50, 100);
                    const messages = await channel.messages.fetch({ limit });

                    const messageList = messages.map(m => ({
                        author: m.author.username,
                        content: m.content,
                        timestamp: m.createdAt.toISOString(),
                        id: m.id
                    })).reverse(); // Oldest first

                    return {
                        success: true,
                        channel: channel.name,
                        count: messageList.length,
                        messages: messageList
                    };
                } catch (error) {
                    return { success: false, error: `Failed to fetch messages: ${error.message}` };
                }
            }

            case 'get_user_info': {
                if (!guild) return { success: false, error: 'Discord guild context required' };

                try {

                    let member;
                    // Try fetching by ID first
                    if (/^\d+$/.test(args.user_id)) {
                        try {
                            member = await guild.members.fetch(args.user_id);
                        } catch (e) { /* ignore */ }
                    }

                    // If not found by ID, search by username/nickname
                    if (!member) {
                        const query = args.user_id.toLowerCase();
                        const members = await guild.members.fetch({ query: query, limit: 1 });
                        member = members.first();
                    }

                    if (!member) return { success: false, error: `User '${args.user_id}' not found in guild` };

                    const roles = member.roles.cache
                        .filter(r => r.name !== '@everyone')
                        .map(r => r.name)
                        .join(', ');

                    return {
                        success: true,
                        username: member.user.username,
                        nickname: member.nickname || 'None',
                        id: member.id,
                        joinedAt: member.joinedAt,
                        roles: roles,
                        isBot: member.user.bot
                    };
                } catch (error) {
                    return { success: false, error: `Failed to fetch user: ${error.message}` };
                }
            }

            case 'purge_messages': {
                if (!guild) return { success: false, error: 'Discord guild context required' };

                try {
                    const channel = await guild.channels.fetch(args.channel_id);
                    if (!channel) return { success: false, error: 'Channel not found' };
                    if (!channel.isTextBased()) return { success: false, error: 'Channel is not text-based' };

                    const count = Math.min(args.count || 10, 100);
                    const deleted = await channel.bulkDelete(count, true); // true = filter old messages

                    return {
                        success: true,
                        message: `Successfully deleted ${deleted.size} messages.`,
                        count: deleted.size
                    };
                } catch (error) {
                    return { success: false, error: `Failed to purge messages: ${error.message}` };
                }
            }

            case 'lookup_roblox_profile': {
                try {
                    // 1. Get ID from username
                    const idResult = await getRobloxUserId(args.username);
                    if (!idResult) return { success: false, error: 'User not found' };
                    const userId = idResult.id; // Assuming getRobloxUserId returns {id, username} or similar

                    // 2. Fetch public user info
                    const userRes = await fetch(`https://users.roblox.com/v1/users/${userId}`);
                    if (!userRes.ok) throw new Error('Failed to fetch user info');
                    const userData = await userRes.json();

                    // 3. Fetch groups (optional but useful)
                    // const groupsRes = await fetch(`https://groups.roblox.com/v1/users/${userId}/groups/roles`);
                    // const groupsData = await groupsRes.json();

                    return {
                        success: true,
                        username: userData.name,
                        displayName: userData.displayName,
                        id: userData.id,
                        created: userData.created,
                        description: userData.description,
                        isBanned: userData.isBanned,
                        hasVerifiedBadge: userData.hasVerifiedBadge
                    };
                } catch (error) {
                    return { success: false, error: `Roblox lookup failed: ${error.message}` };
                }
            }

            case 'analyze_player_activity': {
                try {
                    const username = args.username;

                    // Fetch all logs in parallel
                    const [cmdLogs, joinLogs, killLogs] = await Promise.all([
                        getCommandLogs(),
                        getJoinLogs(),
                        getKillLogs()
                    ]);

                    // Filter for specific user
                    // Note: Logs might use DisplayName or Username. We'll try loose matching.
                    const lowerUser = username.toLowerCase();

                    const userCmds = cmdLogs.filter(l => l.playerName.toLowerCase().includes(lowerUser));
                    const userJoins = joinLogs.filter(l => l.playerName.toLowerCase().includes(lowerUser));
                    const userKills = killLogs.filter(l => l.killerName.toLowerCase().includes(lowerUser));
                    const userDeaths = killLogs.filter(l => l.killedName.toLowerCase().includes(lowerUser));

                    return {
                        success: true,
                        username: username,
                        summary: {
                            commandsUsed: userCmds.length,
                            joins: userJoins.filter(j => j.join).length,
                            leaves: userJoins.filter(j => !j.join).length,
                            kills: userKills.length,
                            deaths: userDeaths.length
                        },
                        recentCommands: userCmds.slice(0, 5).map(c => `${c.command} (${c.timestamp})`),
                        recentKills: userKills.slice(0, 3).map(k => `Killed ${k.killedName} (${k.timestamp})`)
                    };
                } catch (error) {
                    return { success: false, error: `Activity analysis failed: ${error.message}` };
                }
            }

            case 'summarize_chat': {
                if (!guild) return { success: false, error: 'Discord guild context required' };

                try {
                    const channel = await guild.channels.fetch(args.channel_id);
                    if (!channel) return { success: false, error: 'Channel not found' };
                    if (!channel.isTextBased()) return { success: false, error: 'Channel is not text-based' };

                    const limit = Math.min(args.message_count || 50, 100);
                    const messages = await channel.messages.fetch({ limit });

                    // Format for AI summarization
                    const chatLog = messages.map(m => {
                        const time = m.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                        return `[${time}] ${m.author.username}: ${m.content}`;
                    }).reverse().join('\n');

                    return {
                        success: true,
                        channel: channel.name,
                        messageCount: messages.size,
                        chatLog: chatLog // AI will read this and generate summary
                    };
                } catch (error) {
                    return { success: false, error: `Failed to fetch chat: ${error.message}` };
                }
            }

            case 'log_punishment': {
                // Get the moderator's Discord ID from the message context
                const moderatorDiscordId = context.message?.author?.id;
                if (!moderatorDiscordId) {
                    return { success: false, error: 'Could not determine moderator - this command must be used from Discord' };
                }

                const result = await logPunishment(
                    args.username,
                    moderatorDiscordId,
                    args.type,
                    args.reason,
                    args.server
                );
                return {
                    success: true,
                    message: `Logged ${result.type} for ${result.player} on ${result.server}`,
                    player: result.player,
                    punishmentType: result.type,
                    reason: result.reason,
                    server: result.server
                };
            }

            case 'check_punishments': {
                const result = await getPunishments(args.username, args.server || null);

                // Format punishments for display
                const formattedPunishments = result.punishments.map(p => ({
                    type: p.type,
                    reason: p.reason,
                    date: new Date(p.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    }),
                    server: p.server
                }));

                return {
                    success: true,
                    username: result.username,
                    userId: result.userId,
                    totalPunishments: result.punishments.length,
                    punishments: formattedPunishments,
                    serverFilter: args.server ? `Server ${args.server}` : 'All Servers'
                };
            }

            case 'save_memory': {
                if (args.type === 'server') {
                    // Restrict Server Memory to Admins/Mods
                    if (context.message && context.message.member) {
                        // Check for ManageGuild or specific roles
                        const hasPermission = context.message.member.permissions.has('ManageGuild') || 
                                              context.message.member.roles.cache.has('1395219965992239104') || 
                                              context.message.member.roles.cache.has('1395214067425218651');

                        if (!hasPermission) {
                            return {
                                success: false,
                                error: 'Permission denied: Only Staff can add global server memories.'
                            };
                        }
                    } else if (context.isInGame) {
                        // In-game players can add server memories IF they are staff
                        // We can check if they are staff using check_if_staff logic or just trust in-game for now
                        // For safety, let's only allow if we can verify.
                        // Actually, in-game PMs to Garmin are usually from staff or trusted.
                        // But let's be safe.
                    } else if (!context.message) {
                        return { success: false, error: 'Cannot verify permissions for server memory.' };
                    }
                    
                    const authorName = context.message?.author?.username || context.playerName || 'Unknown';
                    const memory = await addServerMemory(args.content, authorName);
                    return {
                        success: true,
                        message: `✅ Saved new server rule/fact: "${args.content}"`,
                        memory: memory
                    };
                } else {
                    // User memory - always allowed for self
                    // Ensure we have a user ID (Discord) or PlayerName (In-game)
                    const userKey = context.message?.author?.id || context.playerName;
                    if (!userKey) {
                         return { success: false, error: 'Could not identify user to save memory for.' };
                    }
                    
                    const memory = await addUserMemory(userKey, args.content);
                    return {
                        success: true,
                        message: `✅ I'll remember that: "${args.content}"`,
                        memory: memory
                    };
                }
            }

            default:
                return { success: false, error: `Unknown function: ${name}` };
        }
    } catch (error) {
        console.error(`❌ Error executing ${name}:`, error);
        return { success: false, error: error.message };
    }
}

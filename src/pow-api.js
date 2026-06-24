import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getRobloxUserId } from './prc-api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const POW_API_TOKEN = 'pow_z61poufprwi2z77if87ysy';
const POW_BASE_URL = 'https://pow.ciankelly.xyz';

// Server identifiers for LACOMM A and B
const SERVERS = {
    A: 'LACOMM Server A',
    B: 'LACOMM Server B'
};

// Log POW API config
console.log(`✅ POW API configured (${POW_BASE_URL})`);

/**
 * Get punishment history for a player
 * @param {string} username - Roblox username to look up
 * @param {string} server - Server identifier ('A' or 'B', or null for both)
 * @returns {Promise<Object>} Punishment history
 */
export async function getPunishments(username, server = null) {
    try {
        if (!POW_API_TOKEN) {
            throw new Error('POW_API_TOKEN is not configured! Cannot fetch punishments.');
        }

        // Get Roblox User ID
        const userInfo = await getRobloxUserId(username);
        if (!userInfo) {
            throw new Error(`Could not find Roblox user: ${username}`);
        }

        console.log(`📋 Fetching punishments for ${userInfo.username} (${userInfo.userId})`);

        const results = {
            username: userInfo.username,
            userId: userInfo.userId,
            punishments: []
        };

        // Determine which servers to query
        const serversToQuery = server
            ? [{ key: server.toUpperCase(), id: SERVERS[server.toUpperCase()] }]
            : [{ key: 'A', id: SERVERS.A }, { key: 'B', id: SERVERS.B }];

        for (const srv of serversToQuery) {
            if (!srv.id) {
                console.warn(`⚠️ Unknown server: ${server}`);
                continue;
            }

            try {
                const response = await fetch(
                    `${POW_BASE_URL}/api/public/v1/punishments?server=${srv.id}&userId=${userInfo.userId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${POW_API_TOKEN}`,
                            'Accept': 'application/json'
                        }
                    }
                );

                if (!response.ok) {
                    console.error(`❌ POW API error for server ${srv.key}: ${response.status}`);
                    continue;
                }

                const data = await response.json();

                // Add server identifier to each punishment
                const punishmentsWithServer = (data || []).map(p => ({
                    ...p,
                    server: `Server ${srv.key}`
                }));

                results.punishments.push(...punishmentsWithServer);
            } catch (err) {
                console.error(`❌ Error fetching from server ${srv.key}:`, err.message);
            }
        }

        // Sort by date, newest first
        results.punishments.sort((a, b) =>
            new Date(b.createdAt) - new Date(a.createdAt)
        );

        return results;
    } catch (error) {
        console.error('Error fetching punishments:', error);
        throw error;
    }
}

/**
 * Log a punishment to POW
 * @param {string} username - Roblox username of the punished player
 * @param {string} moderatorDiscordId - Discord ID of the moderator issuing the punishment
 * @param {string} type - Punishment type: 'Warn', 'Kick', 'Ban', or 'Ban Bolo'
 * @param {string} reason - Reason for the punishment
 * @param {string} server - Server identifier ('A' or 'B')
 * @returns {Promise<Object>} Response from API
 */
export async function logPunishment(username, moderatorDiscordId, type, reason, server) {
    try {
        if (!POW_API_TOKEN) {
            throw new Error('POW_API_TOKEN is not configured! Cannot log punishment.');
        }

        // Validate punishment type
        const validTypes = ['Warn', 'Kick', 'Ban', 'Ban Bolo'];
        if (!validTypes.includes(type)) {
            throw new Error(`Invalid punishment type: ${type}. Valid types: ${validTypes.join(', ')}`);
        }

        // Validate server
        const serverKey = server?.toUpperCase();
        const serverId = SERVERS[serverKey];
        if (!serverId) {
            throw new Error(`Invalid server: ${server}. Use 'A' or 'B'.`);
        }

        // Get Roblox User ID for the punished player
        const userInfo = await getRobloxUserId(username);
        if (!userInfo) {
            throw new Error(`Could not find Roblox user: ${username}`);
        }

        console.log(`📝 Logging ${type} for ${userInfo.username} (${userInfo.userId}) by Discord user ${moderatorDiscordId} on Server ${serverKey}`);

        const response = await fetch(
            `${POW_BASE_URL}/api/public/v1/punishments?server=${serverId}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${POW_API_TOKEN}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    userId: String(userInfo.userId),
                    moderatorId: String(moderatorDiscordId),
                    type: type,
                    reason: reason || 'No reason provided'
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ POW API error: ${response.status} - ${errorText}`);
            throw new Error(`Failed to log punishment: ${response.status}`);
        }

        console.log(`✅ Punishment logged successfully`);

        return {
            success: true,
            player: userInfo.username,
            moderatorDiscordId: moderatorDiscordId,
            type: type,
            reason: reason,
            server: `Server ${serverKey}`
        };
    } catch (error) {
        console.error('Error logging punishment:', error);
        throw error;
    }
}

export { SERVERS };

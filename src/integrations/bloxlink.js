import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const BLOXLINK_API_KEY = process.env.BLOXLINK_API_KEY;
const BLOXLINK_BASE_OVERRIDE = process.env.BLOXLINK_BASE_URL; // optional override

// Known base domains (new first, legacy second, with optional override priority)
const BASES = [
    ...(BLOXLINK_BASE_OVERRIDE ? [BLOXLINK_BASE_OVERRIDE] : []),
    'https://api.blox.link',          // new documented domain
    'https://api.bloxlink.org'        // legacy (often failing DNS)
];

const MAX_RETRIES_PER_BASE = 2;
const TOTAL_TIMEOUT_MS = 4000; // per attempt timeout

async function fetchWithTimeout(url, options = {}, timeoutMs = TOTAL_TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

/**
 * Resolve Discord ID from a Roblox ID via Bloxlink with multi-base fallback and retries
 * @param {string|number} robloxId
 * @returns {Promise<string|null>}
 */
export async function getDiscordIdFromRobloxId(robloxId) {
    if (!BLOXLINK_API_KEY) {
        console.warn('⚠️ BLOXLINK_API_KEY not set; skipping Bloxlink lookup');
        return null;
    }

    const idStr = String(robloxId).trim();
    if (!idStr || !/^[0-9]+$/.test(idStr)) {
        console.warn(`⚠️ Invalid Roblox ID provided to Bloxlink: ${robloxId}`);
        return null;
    }

    console.log(`🔍 Bloxlink lookup for Roblox ID ${idStr}`);

    for (const base of BASES) {
        for (let attempt = 1; attempt <= MAX_RETRIES_PER_BASE; attempt++) {
            const url = `${base}/v1/user/${idStr}?provider=roblox`;
            try {
                console.log(`🌐 Attempt ${attempt} @ ${base}`);
                const response = await fetchWithTimeout(url, {
                    headers: { 'Authorization': BLOXLINK_API_KEY }
                });

                if (!response.ok) {
                    if (response.status === 404) {
                        console.log(`ℹ️ No Discord link for Roblox ID ${idStr} (404)`);
                        return null; // no need to continue
                    }
                    console.warn(`⚠️ Bloxlink ${base} attempt ${attempt} failed: ${response.status} ${response.statusText}`);
                    continue; // retry / next base
                }

                const data = await response.json();
                const discordId = data.discordId || (data.user && data.user.discordId) || data.id || null;
                if (discordId) {
                    console.log(`✅ Bloxlink resolved Roblox ${idStr} -> Discord ${discordId}`);
                    return discordId;
                }
                console.warn('⚠️ Bloxlink response missing discordId field');
                return null;
            } catch (err) {
                const isAbort = err.name === 'AbortError';
                console.warn(`⚠️ Bloxlink error on ${base} attempt ${attempt}: ${isAbort ? 'Timeout' : err.message}`);
                // continue to next attempt/base
            }
        }
        console.log(`➡️ Moving to next Bloxlink base after failures: ${base}`);
    }

    console.error(`❌ All Bloxlink attempts failed for Roblox ID ${idStr}`);
    return null;
}

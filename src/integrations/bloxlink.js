const TOTAL_TIMEOUT_MS = 4000;

// Bloxlink's public Server API (blox.link/dashboard/developer) is guild-scoped:
// the bot must be in the given Discord server, and lookups only resolve accounts
// linked within that server. https://api.bloxlink.org is not a valid alternate
// base for this API — only api.blox.link is documented.
function apiBase() {
  return process.env.BLOXLINK_BASE_URL || 'https://api.blox.link';
}

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

function isSnowflake(id) {
  return typeof id === 'string' ? /^[0-9]+$/.test(id) : /^[0-9]+$/.test(String(id ?? ''));
}

/**
 * Resolve the Discord ID(s) linked to a Roblox account within a given Discord server via Bloxlink.
 * @param {string|number} robloxId
 * @param {string} guildId Discord server ID the bot must share with the user.
 * @returns {Promise<string|null>} The first linked Discord ID, or null.
 */
export async function getDiscordIdFromRobloxId(robloxId, guildId) {
  const apiKey = process.env.BLOXLINK_API_KEY;
  if (!apiKey) {
    console.warn('[bloxlink] BLOXLINK_API_KEY not set; skipping lookup');
    return null;
  }

  const idStr = String(robloxId).trim();
  const guildStr = String(guildId ?? '').trim();
  if (!isSnowflake(idStr)) {
    console.warn(`[bloxlink] invalid Roblox ID: ${robloxId}`);
    return null;
  }
  if (!isSnowflake(guildStr)) {
    console.warn(`[bloxlink] invalid guild ID: ${guildId}`);
    return null;
  }

  const url = `${apiBase()}/v4/public/guilds/${guildStr}/roblox-to-discord/${idStr}`;
  try {
    const response = await fetchWithTimeout(url, { headers: { 'Authorization': apiKey } });
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[bloxlink] no Discord link for Roblox ID ${idStr} in guild ${guildStr} (404)`);
        return null;
      }
      console.warn(`[bloxlink] lookup failed: ${response.status} ${response.statusText}`);
      return null;
    }
    const data = await response.json();
    const discordId = Array.isArray(data.discordIDs) ? data.discordIDs[0] : null;
    if (discordId) {
      console.log(`[bloxlink] resolved Roblox ${idStr} -> Discord ${discordId}`);
      return String(discordId);
    }
    console.warn('[bloxlink] response missing discordIDs field');
    return null;
  } catch (err) {
    const isAbort = err.name === 'AbortError';
    console.warn(`[bloxlink] error resolving Roblox ${idStr}: ${isAbort ? 'timeout' : err.message}`);
    return null;
  }
}

/**
 * Resolve the Roblox ID linked to a Discord user within a given Discord server via Bloxlink.
 * @param {string|number} discordId
 * @param {string} guildId Discord server ID the bot must share with the user.
 * @returns {Promise<string|null>}
 */
export async function getRobloxIdFromDiscordId(discordId, guildId) {
  const apiKey = process.env.BLOXLINK_API_KEY;
  if (!apiKey) {
    console.warn('[bloxlink] BLOXLINK_API_KEY not set; skipping lookup');
    return null;
  }

  const idStr = String(discordId).trim();
  const guildStr = String(guildId ?? '').trim();
  if (!isSnowflake(idStr)) {
    console.warn(`[bloxlink] invalid Discord ID: ${discordId}`);
    return null;
  }
  if (!isSnowflake(guildStr)) {
    console.warn(`[bloxlink] invalid guild ID: ${guildId}`);
    return null;
  }

  const url = `${apiBase()}/v4/public/guilds/${guildStr}/discord-to-roblox/${idStr}`;
  try {
    const response = await fetchWithTimeout(url, { headers: { 'Authorization': apiKey } });
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[bloxlink] no Roblox link for Discord ID ${idStr} in guild ${guildStr} (404)`);
        return null;
      }
      console.warn(`[bloxlink] lookup failed: ${response.status} ${response.statusText}`);
      return null;
    }
    const data = await response.json();
    const robloxId = data.robloxID || null;
    if (robloxId) {
      console.log(`[bloxlink] resolved Discord ${idStr} -> Roblox ${robloxId}`);
      return String(robloxId);
    }
    console.warn('[bloxlink] response missing robloxID field');
    return null;
  } catch (err) {
    const isAbort = err.name === 'AbortError';
    console.warn(`[bloxlink] error resolving Discord ${idStr}: ${isAbort ? 'timeout' : err.message}`);
    return null;
  }
}

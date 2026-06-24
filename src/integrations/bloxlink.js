const MAX_RETRIES_PER_BASE = 2;
const TOTAL_TIMEOUT_MS = 4000;

// Known base domains (new first, legacy second, with optional override priority)
function getBases() {
  const override = process.env.BLOXLINK_BASE_URL;
  return [
    ...(override ? [override] : []),
    'https://api.blox.link',
    'https://api.bloxlink.org',
  ];
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

/**
 * Resolve Discord ID from a Roblox ID via Bloxlink with multi-base fallback and retries.
 * @param {string|number} robloxId
 * @returns {Promise<string|null>}
 */
export async function getDiscordIdFromRobloxId(robloxId) {
  const apiKey = process.env.BLOXLINK_API_KEY;
  if (!apiKey) {
    console.warn('[bloxlink] BLOXLINK_API_KEY not set; skipping lookup');
    return null;
  }

  const idStr = String(robloxId).trim();
  if (!idStr || !/^[0-9]+$/.test(idStr)) {
    console.warn(`[bloxlink] invalid Roblox ID: ${robloxId}`);
    return null;
  }

  console.log(`[bloxlink] lookup Roblox ID ${idStr}`);

  for (const base of getBases()) {
    for (let attempt = 1; attempt <= MAX_RETRIES_PER_BASE; attempt++) {
      const url = `${base}/v1/user/${idStr}?provider=roblox`;
      try {
        console.log(`[bloxlink] attempt ${attempt} @ ${base}`);
        const response = await fetchWithTimeout(url, {
          headers: { 'Authorization': apiKey },
        });

        if (!response.ok) {
          if (response.status === 404) {
            console.log(`[bloxlink] no Discord link for Roblox ID ${idStr} (404)`);
            return null;
          }
          console.warn(`[bloxlink] ${base} attempt ${attempt} failed: ${response.status} ${response.statusText}`);
          continue;
        }

        const data = await response.json();
        const discordId = data.discordId || (data.user && data.user.discordId) || data.id || null;
        if (discordId) {
          console.log(`[bloxlink] resolved Roblox ${idStr} -> Discord ${discordId}`);
          return discordId;
        }
        console.warn('[bloxlink] response missing discordId field');
        return null;
      } catch (err) {
        const isAbort = err.name === 'AbortError';
        console.warn(`[bloxlink] error on ${base} attempt ${attempt}: ${isAbort ? 'timeout' : err.message}`);
      }
    }
    console.log(`[bloxlink] moving to next base after failures: ${base}`);
  }

  console.error(`[bloxlink] all attempts failed for Roblox ID ${idStr}`);
  return null;
}

// Blocks outbound fetches to domains on the oisd NSFW blocklist
// (https://nsfw.oisd.nl/), an Adblock Plus-format list of ~450k domains.
// The list is parsed into a Set once and refreshed on an interval, so the
// per-request cost is a single hash lookup per domain label — not a scan of
// 450k entries.
const LIST_URL = 'https://nsfw.oisd.nl/';
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — list itself expires hourly, but domain churn doesn't need minute-level freshness

let blockedDomains = new Set();
let refreshTimer = null;

// Adblock Plus lines look like `||example.com^`. Comments start with "!" and
// the header is a bracketed tag ("[Adblock Plus]") — everything else is
// ignored rather than erroring, since oisd may add rule types we don't need.
function parseAdblockList(text) {
  const domains = new Set();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[')) continue;
    const match = /^\|\|([a-z0-9.-]+)\^$/i.exec(trimmed);
    if (match) domains.add(match[1].toLowerCase());
  }
  return domains;
}

export async function refreshNsfwList() {
  try {
    const res = await fetch(LIST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = parseAdblockList(text);
    // A near-empty parse almost certainly means oisd changed format or served
    // an error page — keep the last good list rather than silently unblocking
    // everything.
    if (parsed.size < 1000) throw new Error(`suspiciously small parse (${parsed.size} domains)`);
    blockedDomains = parsed;
    console.log(`[nsfwFilter] loaded ${blockedDomains.size} domains`);
  } catch (err) {
    console.error('[nsfwFilter] refresh failed, keeping previous list:', err.message);
  }
}

export function startNsfwFilterRefresh() {
  refreshNsfwList();
  refreshTimer = setInterval(refreshNsfwList, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
}

// Checks the hostname and every parent domain (so a rule for "example.com"
// also blocks "sub.example.com") against the set. O(labels) hash lookups —
// negligible next to the network fetch this guards.
export function isNsfwHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (blockedDomains.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}

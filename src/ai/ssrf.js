import dns from 'dns';
import net from 'net';

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reserved
  return false;
}

// Expands any valid textual IPv6 address — with or without "::" elision, and
// with or without a trailing embedded IPv4 dotted-quad — into exactly 8
// 16-bit integers. Returns null if the address isn't well-formed enough to
// expand with confidence; callers must treat null as unsafe.
//
// This exists specifically so the IPv4-mapped check below works on the
// decoded NUMBER, not on a specific textual notation: WHATWG URL parsing
// always canonicalises "::ffff:10.0.0.1" to the hex-group form "::ffff:a00:1"
// before this code ever sees it, so a regex tied to the dotted-decimal form
// (the previous implementation) never matches a real URL's hostname and the
// mapped-address check was silently dead — e.g. http://[::ffff:a9fe:a9fe]/,
// the hex form of the 169.254.169.254 cloud-metadata address, sailed through
// as "not private".
function expandIPv6ToWords(ip) {
  const clean = ip.split('%')[0]; // strip a zone/scope id, e.g. fe80::1%eth0
  const halves = clean.split('::');
  if (halves.length > 2) return null; // more than one "::" is invalid

  function splitSide(side) {
    if (side === '') return [];
    const tokens = side.split(':');
    const last = tokens[tokens.length - 1];
    if (last.includes('.')) {
      // An embedded IPv4 dotted-quad occupies the last TWO 16-bit words.
      const octets = last.split('.');
      if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)) return null;
      const hexTokens = tokens.slice(0, -1);
      if (!hexTokens.every((t) => /^[0-9a-f]{1,4}$/i.test(t))) return null;
      const hi = (Number(octets[0]) << 8) | Number(octets[1]);
      const lo = (Number(octets[2]) << 8) | Number(octets[3]);
      return [...hexTokens.map((t) => parseInt(t, 16)), hi, lo];
    }
    if (!tokens.every((t) => /^[0-9a-f]{1,4}$/i.test(t))) return null;
    return tokens.map((t) => parseInt(t, 16));
  }

  const head = splitSide(halves[0] ?? '');
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;

  const tail = splitSide(halves[1] ?? '');
  if (tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  return [...head, ...Array(missing).fill(0), ...tail];
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local

  const words = expandIPv6ToWords(lower);
  if (!words) return true; // couldn't confidently parse — treat as unsafe

  // IPv4-mapped (::ffff:a.b.c.d): first 5 words zero, 6th is 0xffff, last two
  // words hold the embedded IPv4 address — checked numerically so it can't be
  // dodged by whichever textual form the address is written or normalised in.
  if (words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0 && words[5] === 0xffff) {
    const a = (words[6] >> 8) & 0xff, b = words[6] & 0xff;
    const c = (words[7] >> 8) & 0xff, d = words[7] & 0xff;
    return isPrivateIPv4(`${a}.${b}.${c}.${d}`);
  }
  return false;
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not a valid literal IP — treat as unsafe
}

// WHATWG URL.hostname keeps the brackets on an IPv6 literal (e.g. "[::1]"),
// but net.isIP / our private-range checks expect the bare address. Without
// stripping them, net.isIP("[::1]") returns 0 and every IPv6-literal URL
// silently falls through to the DNS-lookup branch below instead of the
// intended IP-literal fast path — it still ends up blocked today because
// dns.lookup() can't resolve a bracket-containing string, but that's an
// accident of DNS syntax rules, not the guard actually recognising the
// address, and it incorrectly blocks legitimate public IPv6 hosts too.
function stripIPv6Brackets(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Resolves and validates a URL before it is fetched server-side, blocking
 * requests to loopback/link-local/private/cloud-metadata addresses to
 * prevent SSRF via user-supplied URLs (e.g. the read_webpage tool).
 * Throws if the URL is unsafe; otherwise returns the parsed URL.
 */
export async function assertPublicHttpUrl(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http/https URLs are allowed');
  }
  const rawHostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(rawHostname)) {
    throw new Error('URL host is not allowed');
  }
  const hostname = stripIPv6Brackets(rawHostname);
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('URL resolves to a private/internal address');
    return url;
  }
  const addrs = await dns.promises.lookup(hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('Could not resolve host');
  for (const { address } of addrs) {
    if (isPrivateIp(address)) throw new Error('URL resolves to a private/internal address');
  }
  return url;
}

// Host-level cache for repeated validations of the same base URL. Tenant
// integration base URLs (PRC/POW) are hit on a tight polling loop, so we don't
// want a DNS lookup on every request — but we still re-check each host once a
// minute in case DNS records change.
const hostCheckCache = new Map();
const HOST_CACHE_TTL_MS = 60_000;

/**
 * Same guarantees as assertPublicHttpUrl, but memoises the result per host for
 * a minute. Use for URLs that are validated over and over (integration base
 * URLs), not for one-shot user-supplied URLs.
 */
export async function assertPublicHttpUrlCached(urlStr) {
  let url;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error('Invalid URL');
  }
  const key = url.hostname.toLowerCase();
  const cached = hostCheckCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.ok) throw new Error('URL resolves to a private/internal address');
    return url;
  }
  try {
    const validated = await assertPublicHttpUrl(urlStr);
    hostCheckCache.set(key, { ok: true, expiresAt: Date.now() + HOST_CACHE_TTL_MS });
    return validated;
  } catch (err) {
    hostCheckCache.set(key, { ok: false, expiresAt: Date.now() + HOST_CACHE_TTL_MS });
    throw err;
  }
}

/**
 * Fetches a URL while re-validating every redirect hop against
 * assertPublicHttpUrl, so an attacker can't bypass the SSRF guard by
 * pointing a public URL at a redirect to an internal address.
 */
export async function safeFetch(urlStr, { maxRedirects = 3, ...fetchOpts } = {}) {
  let current = urlStr;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicHttpUrl(current);
    const resp = await fetch(url, { ...fetchOpts, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get('location');
      if (!location) return resp;
      current = new URL(location, url).toString();
      continue;
    }
    return resp;
  }
  throw new Error('Too many redirects');
}

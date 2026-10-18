import dns from 'dns';
import net from 'net';
import { Agent } from 'undici';
import { isNsfwHostname } from './nsfwFilter.js';

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
  if (a === 192 && b === 0 && parts[2] === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && parts[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
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

function wordsToIPv4(hi, lo) {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

function isPrivateIPv6(ip) {
  const words = expandIPv6ToWords(ip.toLowerCase());
  if (!words) return true; // couldn't confidently parse — treat as unsafe

  // All prefix checks are numeric so they can't be dodged by whichever
  // textual form the address is written or normalised in.
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words;
  const firstSixZero = w0 === 0 && w1 === 0 && w2 === 0 && w3 === 0 && w4 === 0;
  if (firstSixZero && w5 === 0 && w6 === 0 && (w7 === 0 || w7 === 1)) return true; // :: and ::1
  if ((w0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((w0 & 0xffc0) === 0xfec0) return true; // deprecated site-local fec0::/10
  if ((w0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((w0 & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (w0 === 0x2001 && w1 === 0x0db8) return true; // documentation
  if (w0 === 0x0100 && w1 === 0 && w2 === 0 && w3 === 0) return true; // discard-only 100::/64
  // Teredo (2001::/32) tunnels to an arbitrary IPv4 endpoint — no safe reading.
  if (w0 === 0x2001 && w1 === 0) return true;

  // Forms that embed an IPv4 address: judge them by that address.
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (firstSixZero && (w5 === 0xffff || w5 === 0)) return isPrivateIPv4(wordsToIPv4(w6, w7));
  // NAT64 well-known prefix 64:ff9b::/96 and local-use 64:ff9b:1::/48
  if (w0 === 0x0064 && w1 === 0xff9b) {
    if (w2 === 0x0001) return true;
    return isPrivateIPv4(wordsToIPv4(w6, w7));
  }
  // 6to4 2002:AABB:CCDD::/48
  if (w0 === 0x2002) return isPrivateIPv4(wordsToIPv4(w1, w2));
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

// A trailing DNS root-zone dot ("localhost.") is semantically identical to
// the same name without it — the resolver treats them the same — but a naive
// string comparison against BLOCKED_HOSTNAMES doesn't, so "localhost." would
// skip the fast-path denylist. Stripped once here so every hostname-based
// check (denylist, cache key) sees the normalized form.
function normalizeHostname(hostname) {
  return hostname.replace(/\.+$/, '');
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
  const rawHostname = normalizeHostname(url.hostname.toLowerCase());
  if (BLOCKED_HOSTNAMES.has(rawHostname)) {
    throw new Error('URL host is not allowed');
  }
  if (isNsfwHostname(rawHostname)) {
    throw new Error('URL is blocked by content policy');
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
  const key = normalizeHostname(url.hostname.toLowerCase());
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
    // Cache policy rejections, but not a transient resolver failure — one DNS
    // blip shouldn't take a tenant's integration down for a full minute.
    if (err.message !== 'Could not resolve host') {
      hostCheckCache.set(key, { ok: false, expiresAt: Date.now() + HOST_CACHE_TTL_MS });
    }
    throw err;
  }
}

// DNS-rebinding defence. assertPublicHttpUrl resolves + validates a hostname,
// but a plain fetch() then does its OWN, second DNS resolution to open the
// socket — an attacker-controlled resolver can answer public on the first
// lookup and 169.254.169.254 (or any internal IP) on the second (a TOCTOU
// rebind). This lookup runs at connect time and re-validates every address the
// resolver actually returns, so the IP the socket connects to is the same one
// that passed validation. IP-literal hosts never reach here (net.isIP short-
// circuits in assertPublicHttpUrl and undici skips lookup for literals).
function validatingLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    for (const a of list) {
      if (isPrivateIp(a.address)) {
        return callback(new Error('URL resolves to a private/internal address'));
      }
    }
    if (options && options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

// Shared dispatcher that pins outbound SSRF-guarded fetches to the
// connect-time-validated address. Exported so integration fetches (PRC/POW)
// can opt into the same protection.
export const ssrfAgent = new Agent({ connect: { lookup: validatingLookup } });

/**
 * Fetches a URL while re-validating every redirect hop against
 * assertPublicHttpUrl, so an attacker can't bypass the SSRF guard by
 * pointing a public URL at a redirect to an internal address.
 */
const CROSS_ORIGIN_SAFE_HEADERS = new Set(['user-agent', 'accept', 'accept-language']);

function stripToSafeHeaders(headers) {
  if (!headers) return headers;
  const entries = headers instanceof globalThis.Headers ? [...headers.entries()] : Object.entries(headers);
  return Object.fromEntries(entries.filter(([k]) => CROSS_ORIGIN_SAFE_HEADERS.has(k.toLowerCase())));
}

export async function safeFetch(urlStr, { maxRedirects = 3, timeoutMs = 15_000, ...fetchOpts } = {}) {
  const signal = fetchOpts.signal
    ? AbortSignal.any([fetchOpts.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
  let current = urlStr;
  let headers = fetchOpts.headers;
  let origin = null;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicHttpUrl(current);
    // Caller-supplied headers (auth, cookies, API keys) are meant for the
    // original origin only — drop them once a redirect leaves it.
    if (origin && url.origin !== origin) headers = stripToSafeHeaders(headers);
    origin ??= url.origin;
    const resp = await fetch(url, { ...fetchOpts, headers, signal, dispatcher: ssrfAgent, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const location = resp.headers.get('location');
      if (!location) return resp;
      await resp.body?.cancel().catch(() => {});
      current = new URL(location, url).toString();
      continue;
    }
    return resp;
  }
  throw new Error('Too many redirects');
}

/**
 * Reads a response body as text, refusing to buffer more than maxBytes —
 * resp.text() on an attacker-chosen URL can otherwise exhaust memory.
 * Returns the (possibly truncated) text.
 */
export async function readTextCapped(resp, maxBytes = 2 * 1024 * 1024) {
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    // No stream to read incrementally (non-standard Response) — best effort.
    const text = typeof resp.text === 'function' ? await resp.text() : '';
    return text.slice(0, maxBytes);
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
}

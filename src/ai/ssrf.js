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

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);
  return false;
}

function isPrivateIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // not a valid literal IP — treat as unsafe
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
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('URL host is not allowed');
  }
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

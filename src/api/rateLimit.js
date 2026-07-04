// Simple in-memory rate limiter: N requests per key per window. Shared across
// every authenticated surface (REST /v1/chat, MCP tool calls) so a single
// token can't bypass the limit by switching transport.
const rateLimitMap = new Map();

function pruneExpiredRateLimits(now = Date.now()) {
  for (const [key, entry] of rateLimitMap.entries()) {
    if (!entry || now > entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}

export function checkRateLimit(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  pruneExpiredRateLimits(now);
  let entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  if (entry.count >= limit) {
    rateLimitMap.set(key, entry);
    return false;
  }
  entry.count++;
  rateLimitMap.set(key, entry);
  return true;
}

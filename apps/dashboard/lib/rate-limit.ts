/**
 * In-process rate limiter using a sliding window.
 * 100 requests per minute per IP by default.
 * No external dependencies needed.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 100;

function cleanupOldEntries(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS * 2) {
      store.delete(key);
    }
  }
}

let cleanupCounter = 0;
function maybeCleanup(): void {
  if (++cleanupCounter % 100 === 0) {
    cleanupOldEntries();
  }
}

export function checkRateLimit(ip: string, limit = MAX_REQUESTS): { allowed: boolean; remaining: number; resetAt: number } {
  maybeCleanup();
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1, resetAt: now + WINDOW_MS };
  }

  entry.count++;
  const remaining = Math.max(0, limit - entry.count);
  const allowed = entry.count <= limit;
  return { allowed, remaining, resetAt: entry.windowStart + WINDOW_MS };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") || "unknown";
}

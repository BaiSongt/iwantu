/**
 * In-Memory Rate Limiter
 *
 * Tracks requests by identifier (IP address or userId) within a sliding
 * time window. Designed for single-server deployments; for multi-instance
 * production, replace with Redis-backed rate limiting.
 *
 * Usage:
 *   const { allowed, remaining } = await rateLimit(ip, { limit: 100, windowMs: 60_000 });
 *   if (!allowed) return Response.json({ error: 'Too many requests' }, { status: 429 });
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RateLimitOptions {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
}

interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining requests in the current window */
  remaining: number;
  /** Seconds until the window resets (useful for Retry-After header) */
  retryAfter: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** Map of identifier -> Bucket */
const store = new Map<string, Bucket>();

/** Periodic cleanup interval (every 5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

// ---------------------------------------------------------------------------
// Pre-configured limit presets
// ---------------------------------------------------------------------------

/** General API: 100 requests per minute */
export const GENERAL_LIMIT: RateLimitOptions = {
  limit: 100,
  windowMs: 60_000,
};

/** Auth endpoints: 10 requests per minute */
export const AUTH_LIMIT: RateLimitOptions = {
  limit: 10,
  windowMs: 60_000,
};

/** Upload endpoints: 20 requests per minute */
export const UPLOAD_LIMIT: RateLimitOptions = {
  limit: 20,
  windowMs: 60_000,
};

/** MCP API: 60 requests per minute */
export const MCP_LIMIT: RateLimitOptions = {
  limit: 60,
  windowMs: 60_000,
};

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Check whether a request from the given identifier is allowed.
 *
 * Uses a fixed-window algorithm: all requests within `windowMs` share a
 * single counter. When the window expires, the counter resets.
 *
 * @param identifier - IP address, userId, or other unique key
 * @param options - Limit and window configuration
 * @returns Whether the request is allowed, remaining count, and retry-after
 */
export function rateLimit(
  identifier: string,
  options: RateLimitOptions = GENERAL_LIMIT,
): RateLimitResult {
  const now = Date.now();

  // Periodic cleanup to prevent memory leaks
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    cleanup(now);
    lastCleanup = now;
  }

  const key = `${identifier}:${options.limit}:${options.windowMs}`;
  let bucket = store.get(key);

  // Create or reset expired bucket
  if (!bucket || now >= bucket.resetAt) {
    bucket = {
      count: 1,
      resetAt: now + options.windowMs,
    };
    store.set(key, bucket);
    return {
      allowed: true,
      remaining: options.limit - 1,
      retryAfter: 0,
    };
  }

  // Increment existing bucket
  bucket.count += 1;

  const remaining = Math.max(0, options.limit - bucket.count);
  const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);

  if (bucket.count > options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter,
    };
  }

  return {
    allowed: true,
    remaining,
    retryAfter: 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a client identifier from a Request object.
 * Falls back to 'unknown' if no IP can be determined.
 */
export function getClientIdentifier(request: Request): string {
  // Try common proxy headers first
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for may contain multiple IPs; use the first one
    return forwarded.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  return 'unknown';
}

/**
 * Remove expired entries from the store to prevent unbounded memory growth.
 */
function cleanup(now: number): void {
  for (const [key, bucket] of store) {
    if (now >= bucket.resetAt) {
      store.delete(key);
    }
  }
}

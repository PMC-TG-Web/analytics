type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  limited: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
};

declare global {
  var __apiRateLimitBuckets__: Map<string, RateLimitBucket> | undefined;
}

const rateLimitBuckets = globalThis.__apiRateLimitBuckets__ ?? new Map<string, RateLimitBucket>();
globalThis.__apiRateLimitBuckets__ = rateLimitBuckets;

export function getClientIdentifier(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const cloudflareIp = headers.get('cf-connecting-ip')?.trim();
  if (cloudflareIp) return cloudflareIp;

  return 'unknown-client';
}

export function checkRateLimit(options: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const { key, limit, windowMs, now = Date.now() } = options;

  for (const [bucketKey, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(bucketKey);
    }
  }

  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt,
    });

    return {
      limited: false,
      limit,
      remaining: Math.max(0, limit - 1),
      resetAt,
      retryAfter: Math.ceil(windowMs / 1000),
    };
  }

  existing.count += 1;
  rateLimitBuckets.set(key, existing);

  const remaining = Math.max(0, limit - existing.count);
  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  return {
    limited: existing.count > limit,
    limit,
    remaining,
    resetAt: existing.resetAt,
    retryAfter,
  };
}

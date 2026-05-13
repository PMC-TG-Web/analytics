import { readJsonResponse } from "@/utils/readJsonResponse";

type FetchJsonWithRetryOptions<T> = {
  fallback: T;
  init?: RequestInit;
  retries?: number;
  retryDelayMs?: number;
  label?: string;
  cacheKey?: string;
  ttlMs?: number;
  forceRefresh?: boolean;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const responseCache = new Map<string, CacheEntry<unknown>>();
const inFlightRequests = new Map<string, Promise<unknown>>();

export function clearFetchJsonCache(cacheKey?: string) {
  if (!cacheKey) {
    responseCache.clear();
    inFlightRequests.clear();
    return;
  }

  responseCache.delete(cacheKey);
  inFlightRequests.delete(cacheKey);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJsonWithRetry<T>(
  url: string,
  options: FetchJsonWithRetryOptions<T>
): Promise<T> {
  const {
    fallback,
    init,
    retries = 1,
    retryDelayMs = 300,
    label,
    cacheKey,
    ttlMs = 0,
    forceRefresh = false,
  } = options;

  const shouldUseCache = typeof window !== 'undefined' && ttlMs > 0;
  const effectiveCacheKey = shouldUseCache ? (cacheKey || url) : '';
  const now = Date.now();

  if (shouldUseCache && !forceRefresh) {
    const cached = responseCache.get(effectiveCacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const pending = inFlightRequests.get(effectiveCacheKey);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  const requestPromise = (async () => {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          ...init,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const value = await readJsonResponse<T>(response, { label: label || url });
        if (shouldUseCache) {
          responseCache.set(effectiveCacheKey, {
            expiresAt: Date.now() + ttlMs,
            value,
          });
        }

        return value;
      } catch (error) {
        const name = label || url;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[fetchJsonWithRetry] ${name} failed on attempt ${attempt + 1}: ${message}`);

        if (attempt < retries) {
          await delay(retryDelayMs);
          continue;
        }
      }
    }

    return fallback;
  })();

  if (shouldUseCache) {
    inFlightRequests.set(effectiveCacheKey, requestPromise);
    requestPromise.finally(() => {
      inFlightRequests.delete(effectiveCacheKey);
    });
  }

  return requestPromise;
}

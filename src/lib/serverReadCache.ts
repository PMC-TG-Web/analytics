type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const GLOBAL_CACHE_KEY = '__analytics_server_read_cache__';

type CacheStore = Map<string, CacheEntry<unknown>>;

function getStore(): CacheStore {
  const globalAny = globalThis as typeof globalThis & {
    [GLOBAL_CACHE_KEY]?: CacheStore;
  };

  if (!globalAny[GLOBAL_CACHE_KEY]) {
    globalAny[GLOBAL_CACHE_KEY] = new Map<string, CacheEntry<unknown>>();
  }

  return globalAny[GLOBAL_CACHE_KEY]!;
}

function pruneExpiredEntries(store: CacheStore) {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

export function getCachedValue<T>(key: string): T | undefined {
  const store = getStore();
  const entry = store.get(key);
  if (!entry) return undefined;

  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }

  return entry.value as T;
}

export function setCachedValue<T>(key: string, value: T, ttlMs: number): void {
  const store = getStore();

  if (store.size > 1000) {
    pruneExpiredEntries(store);
  }

  store.set(key, {
    value,
    expiresAt: Date.now() + Math.max(0, ttlMs),
  });
}

export function buildSearchParamsCacheKey(
  prefix: string,
  searchParams: URLSearchParams,
  excludedParams: string[] = []
): string {
  const excluded = new Set(excludedParams.map((param) => param.toLowerCase()));

  const normalizedEntries = Array.from(searchParams.entries())
    .filter(([key]) => !excluded.has(key.toLowerCase()))
    .sort(([aKey, aValue], [bKey, bValue]) => {
      if (aKey === bKey) return aValue.localeCompare(bValue);
      return aKey.localeCompare(bKey);
    });

  const serialized = new URLSearchParams(normalizedEntries).toString();
  return `${prefix}?${serialized}`;
}

  /**
   * Deletes all cache entries whose key starts with the given prefix.
   * Use this after a mutation to bust related cached reads.
   */
  export function invalidateCacheByPrefix(prefix: string): void {
    const store = getStore();
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) {
        store.delete(key);
      }
    }
  }

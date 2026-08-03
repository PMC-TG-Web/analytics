"use client";
import { useEffect, useState } from "react";
import { hasPageAccess } from "@/lib/permissions";

interface User {
  email: string;
  name?: string | null;
}

type CachedAuthState = {
  user: User | null;
  cachedAt: number;
};

const AUTH_CACHE_KEY = 'analytics-auth-user';
const AUTH_CACHE_TTL_MS = 60 * 60 * 1000;

let inMemoryAuthState: CachedAuthState | null = null;
let inFlightAuthRequest: Promise<User | null> | null = null;

function isCacheFresh(cachedAt: number): boolean {
  return Date.now() - cachedAt < AUTH_CACHE_TTL_MS;
}

function getSelectedDevLoginEmail(): string | null {
  if (typeof document === 'undefined' || process.env.NODE_ENV === 'production') return null;

  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('dev_user_email='));
  if (!cookie) return null;

  try {
    return decodeURIComponent(cookie.slice('dev_user_email='.length)).trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

function cacheMatchesSelectedDevUser(state: CachedAuthState): boolean {
  const selectedDevEmail = getSelectedDevLoginEmail();
  if (!selectedDevEmail) return true;
  return state.user?.email.trim().toLowerCase() === selectedDevEmail;
}

function readSessionAuthCache(): CachedAuthState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: unknown; cachedAt?: unknown };
    if (typeof parsed.cachedAt !== 'number') return null;
    if (!isCacheFresh(parsed.cachedAt)) return null;

    const candidate = parsed.user;
    if (candidate === null) {
      const state = { user: null, cachedAt: parsed.cachedAt };
      return cacheMatchesSelectedDevUser(state) ? state : null;
    }

    if (!candidate || typeof candidate !== 'object') return null;
    const userObj = candidate as { email?: unknown; name?: unknown };
    if (typeof userObj.email !== 'string' || !userObj.email.trim()) return null;

    const state = {
      user: {
        email: userObj.email,
        name: typeof userObj.name === 'string' ? userObj.name : null,
      },
      cachedAt: parsed.cachedAt,
    };
    return cacheMatchesSelectedDevUser(state) ? state : null;
  } catch {
    return null;
  }
}

function writeSessionAuthCache(state: CachedAuthState): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

function setAuthCache(user: User | null): void {
  const nextState: CachedAuthState = { user, cachedAt: Date.now() };
  inMemoryAuthState = nextState;
  writeSessionAuthCache(nextState);
}

async function fetchAuthUser(): Promise<User | null> {
  console.log('Checking auth status...');
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    console.log('User is not authenticated (401)');
    return null;
  }

  const userData = await response.json();
  console.log('User is authenticated:', userData.email);
  const user: User = {
    email: String(userData.email || '').trim(),
    name: typeof userData.name === 'string' ? userData.name : null,
  };
  return user.email ? user : null;
}

async function getAuthUserDeduped(): Promise<User | null> {
  if (inFlightAuthRequest) return inFlightAuthRequest;

  inFlightAuthRequest = fetchAuthUser()
    .then((user) => {
      setAuthCache(user);
      return user;
    })
    .finally(() => {
      inFlightAuthRequest = null;
    });

  return inFlightAuthRequest;
}

export function useAuth() {
  // Keep initial render deterministic across server/client to avoid hydration mismatch.
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const cached = inMemoryAuthState;
    if (cached && isCacheFresh(cached.cachedAt) && cacheMatchesSelectedDevUser(cached)) {
      setUser(cached.user);
      setError(cached.user ? null : 'Not authenticated');
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const sessionCached = readSessionAuthCache();
    if (sessionCached && isCacheFresh(sessionCached.cachedAt)) {
      inMemoryAuthState = sessionCached;
      setUser(sessionCached.user);
      setError(sessionCached.user ? null : 'Not authenticated');
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    async function hydrateAuth() {
      try {
        const nextUser = await getAuthUserDeduped();
        if (cancelled) return;

        setUser(nextUser);
        setError(nextUser ? null : 'Not authenticated');
      } catch (err) {
        if (cancelled) return;
        console.error('Auth check fetch error:', err);
        setError('Failed to check auth');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void hydrateAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  const checkAccess = (page: string) => {
    return hasPageAccess(user?.email || null, page);
  };

  return { user, loading, error, checkAccess };
}

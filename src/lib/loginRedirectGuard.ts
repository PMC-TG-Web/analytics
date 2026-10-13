export const LOGIN_REDIRECT_GUARD_KEY = 'analytics-login-auto-redirect';
export const LOGIN_REDIRECT_GUARD_WINDOW_MS = 20_000;

type GuardStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type GuardRecord = { returnTo: string; at: number };

function readRecord(storage: GuardStorage): GuardRecord | null {
  try {
    const raw = storage.getItem(LOGIN_REDIRECT_GUARD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuardRecord>;
    if (typeof parsed.returnTo !== 'string' || typeof parsed.at !== 'number') return null;
    return { returnTo: parsed.returnTo, at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * Decides whether /login may automatically send an already-authenticated
 * browser back to `returnTo`.
 *
 * `/api/auth/me` can report a user (for example from the dev-login cookie)
 * while the middleware rejects the request because no server session exists.
 * Without this guard the browser bounces between the page and /login forever.
 * A second auto-redirect to the same destination inside the window is refused
 * and the record is cleared so a later, genuine login proceeds normally.
 */
export function shouldAutoRedirectFromLogin(
  storage: GuardStorage | null | undefined,
  returnTo: string,
  now = Date.now(),
): boolean {
  if (!storage) return true;

  const previous = readRecord(storage);
  const bouncedBack = previous !== null
    && previous.returnTo === returnTo
    && now - previous.at >= 0
    && now - previous.at < LOGIN_REDIRECT_GUARD_WINDOW_MS;

  try {
    if (bouncedBack) {
      storage.removeItem(LOGIN_REDIRECT_GUARD_KEY);
      return false;
    }
    storage.setItem(LOGIN_REDIRECT_GUARD_KEY, JSON.stringify({ returnTo, at: now } satisfies GuardRecord));
  } catch {
    // Storage failures must never block login.
  }
  return true;
}

export function clearLoginRedirectGuard(storage: GuardStorage | null | undefined) {
  try {
    storage?.removeItem(LOGIN_REDIRECT_GUARD_KEY);
  } catch {
    // Ignore storage failures.
  }
}

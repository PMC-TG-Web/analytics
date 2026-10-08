// Server-only rollout switch. Preparation does not enable this in any environment.
export function procoreSignInEnabled() {
  return process.env.PROCORE_SIGN_IN_ENABLED === 'true';
}

export function emailSignInEnabled() {
  return !procoreSignInEnabled() || process.env.AUTH0_EMAIL_LOGIN_ENABLED !== 'false';
}

export const APP_SESSION_COOKIE = 'analytics_app_session';
export const APP_SESSION_IDLE_SECONDS = 3 * 24 * 60 * 60;
export const APP_SESSION_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;

export function safeAppReturnTo(value: unknown, fallback = '/') {
  const candidate = typeof value === 'string' ? value : '';
  if (!candidate.startsWith('/') || candidate.startsWith('//') || /[\\\u0000-\u0020]/.test(candidate)) return fallback;
  try {
    const url = new URL(candidate, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid') return fallback;
    if (/^\/(?:login|dev-login|api\/auth|auth\/start|auth\/logout-complete)(?:[/?]|$)/.test(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return fallback; }
}

export function appSessionCookieOptions(absoluteExpiresAt: Date, secure: boolean) {
  return { httpOnly: true, secure, sameSite: secure ? 'none' as const : 'lax' as const,
    path: '/', expires: absoluteExpiresAt };
}

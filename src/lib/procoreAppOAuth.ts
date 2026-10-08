import { randomBytes, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appSessions } from '@/lib/appSession';
import { APP_SESSION_COOKIE, appSessionCookieOptions, safeAppReturnTo } from '@/lib/appSignInPolicy';
import { getAuthorizationUrl, getProcoreRedirectUri, getProcoreSignInIdentity, getProcoreSignInToken } from '@/lib/procore';
import { localLogoutCookies } from '@/lib/localLogoutCookies';

const STATE_COOKIE = 'analytics_procore_oauth';
type OAuthState = { state: string; returnTo: string; redirectUri: string; expiresAt: number };

export function startProcoreAppLogin(request: NextRequest) {
  if (Buffer.byteLength(process.env.PROCORE_APP_SESSION_SECRET || '') < 32
    || !process.env.PROCORE_CLIENT_ID || !process.env.PROCORE_CLIENT_SECRET || !process.env.PROCORE_COMPANY_ID) {
    return NextResponse.json({ error: 'Procore sign-in is not configured.' }, { status: 503 });
  }
  const redirectUri = getProcoreRedirectUri(request.nextUrl.origin);
  if (new URL(redirectUri).origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Procore callback must use this app environment. Check the callback configuration.' }, { status: 503 });
  }
  const state = randomBytes(32).toString('base64url');
  const transaction: OAuthState = { state, returnTo: safeAppReturnTo(request.nextUrl.searchParams.get('returnTo')),
    redirectUri, expiresAt: Date.now() + 10 * 60_000 };
  const response = NextResponse.redirect(getAuthorizationUrl(state, redirectUri));
  response.cookies.set(STATE_COOKIE, JSON.stringify(transaction), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production' || request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 600,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function finishProcoreAppLogin(request: NextRequest) {
  let transaction: OAuthState | null = null;
  try {
    const parsed = JSON.parse(request.cookies.get(STATE_COOKIE)?.value || 'null');
    if (parsed && typeof parsed.state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(parsed.state)
      && typeof parsed.returnTo === 'string' && typeof parsed.redirectUri === 'string'
      && typeof parsed.expiresAt === 'number' && Number.isFinite(parsed.expiresAt)) transaction = parsed;
  } catch { /* Invalid state fails closed. */ }
  const state = request.nextUrl.searchParams.get('state') || '';
  const expected = transaction?.state || '';
  const fail = (message: string) => {
    const url = new URL('/login', request.url);
    url.searchParams.set('error', message);
    url.searchParams.set('returnTo', safeAppReturnTo(transaction?.returnTo));
    const response = NextResponse.redirect(url);
    response.cookies.delete(STATE_COOKIE);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
  if (!transaction || !/^[A-Za-z0-9_-]{43}$/.test(state) || state.length !== expected.length
    || !timingSafeEqual(Buffer.from(state), Buffer.from(expected)) || transaction.expiresAt <= Date.now()
    || transaction.redirectUri !== getProcoreRedirectUri(request.nextUrl.origin)
    || new URL(transaction.redirectUri).origin !== request.nextUrl.origin) return fail('Sign-in expired. Please try again.');
  const code = request.nextUrl.searchParams.get('code');
  if (!code || request.nextUrl.searchParams.has('error')) return fail('Procore sign-in was not completed. Please try again.');
  try {
    const tokens = await getProcoreSignInToken(code, transaction.redirectUri);
    const identity = await getProcoreSignInIdentity(tokens.access_token);
    const { token, session } = await appSessions.create(identity, tokens);
    await appSessions.revoke(request.cookies.get(APP_SESSION_COOKIE)?.value);
    const response = NextResponse.redirect(new URL(safeAppReturnTo(transaction.returnTo), request.url));
    const secure = process.env.NODE_ENV === 'production' || request.nextUrl.protocol === 'https:';
    // Switching identities invalidates permission and old provider cookies as well as the old app session.
    for (const cookie of localLogoutCookies(request.cookies.getAll().map((cookie) => cookie.name), secure)) response.cookies.set(cookie);
    response.cookies.set(APP_SESSION_COOKIE, token, appSessionCookieOptions(session.absoluteExpiresAt, secure));
    response.cookies.set('procore_access_token', tokens.access_token, appSessionCookieOptions(session.accessExpiresAt, secure));
    response.cookies.set('procore_company_id', session.companyId, appSessionCookieOptions(session.accessExpiresAt, secure));
    if (tokens.scope) response.cookies.set('procore_scope', tokens.scope, appSessionCookieOptions(session.accessExpiresAt, secure));
    response.cookies.delete(STATE_COOKIE);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    return fail(error instanceof Error && error.message === 'PROCORE_APP_ACCESS_DENIED'
      ? 'Your Procore account does not have access to this app. Contact your administrator.'
      : 'Unable to complete Procore sign-in. Please try again.');
  }
}

import { Auth0Client } from '@auth0/nextjs-auth0/server';
import { NextResponse } from 'next/server';
import { resolveAuth0SessionCookieOptions } from './auth0SessionCookie';

function resolveAppBaseUrl(explicitBaseUrl?: string) {
  return (
    explicitBaseUrl ||
    process.env.APP_BASE_URL
  );
}

function getErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) {
    return undefined;
  }

  return typeof value.code === 'string' ? value.code : undefined;
}

export function createAuth0Client(appBaseUrl?: string) {
  const developmentCallback =
    process.env.NODE_ENV !== 'production'
      ? (error: Error & { code?: string; cause?: unknown }, ctx: { appBaseUrl?: string; returnTo?: string }) => {
          if (error) {
            const cause = error.cause;
            const causeName =
              typeof cause === 'object' && cause !== null && 'name' in cause && typeof cause.name === 'string'
                ? cause.name
                : undefined;
            const causeCode = getErrorCode(cause);
            const causeMessage =
              cause instanceof Error ? cause.message.replace(/[\r\n]/g, ' ').slice(0, 240) : undefined;
            console.error('Auth0 callback failed', {
              code: error.code,
              name: error.name,
              causeCode,
              causeName,
              causeMessage,
            });

            const diagnostic = [causeCode, causeMessage].filter(Boolean).join(': ');
            return Promise.resolve(
              new NextResponse(`${error.message}${diagnostic ? ` (${diagnostic})` : ''}`, { status: 500 }),
            );
          }

          if (!ctx.appBaseUrl) {
            throw new Error('appBaseUrl could not be resolved for the Auth0 callback redirect.');
          }

          return Promise.resolve(
            NextResponse.redirect(new URL(ctx.returnTo || '/', ctx.appBaseUrl)),
          );
        }
      : undefined;

  return new Auth0Client({
    appBaseUrl: resolveAppBaseUrl(appBaseUrl),
    // Auth0 v4 uses environment variables for most settings.
    // We explicitly configure the session cookie for Iframe compatibility (Procore).
    logoutStrategy: 'v2',
    routes: {
      login: '/api/auth/login',
      callback: '/api/auth/callback',
      logout: '/api/auth/logout',
    },
    session: {
      // Match Auth0 tenant session settings:
      // Idle: 3 days (4320 min), Absolute: 30 days (43200 min)
      rolling: true,
      inactivityDuration: 60 * 60 * 24 * 3,   // 3 days
      absoluteDuration: 60 * 60 * 24 * 30,    // 30 days
      cookie: resolveAuth0SessionCookieOptions(appBaseUrl),
    },
    ...(developmentCallback ? { onCallback: developmentCallback } : {}),
  });
}

export const auth0 = createAuth0Client();

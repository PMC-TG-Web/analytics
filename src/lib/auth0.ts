import { Auth0Client } from '@auth0/nextjs-auth0/server';

function resolveAppBaseUrl(explicitBaseUrl?: string) {
  return (
    explicitBaseUrl ||
    process.env.APP_BASE_URL ||
    process.env.AUTH0_BASE_URL
  );
}

export function createAuth0Client(appBaseUrl?: string) {
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
      cookie: {
        sameSite: 'none',
        secure: true,
      },
    },
  });
}

export const auth0 = createAuth0Client();

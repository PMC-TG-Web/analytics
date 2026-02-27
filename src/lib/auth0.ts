import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client({
  appBaseUrl:
    process.env.APP_BASE_URL ||
    process.env.AUTH0_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined),
  // Auth0 v4 uses environment variables for most settings.
  // We explicitly configure the session cookie for Iframe compatibility (Procore).
  routes: {
    login: '/api/auth/login',
    callback: '/api/auth/callback',
    logout: '/api/auth/logout',
  },
  session: {
    cookie: {
      sameSite: 'none',
      secure: true,
    },
  },
});

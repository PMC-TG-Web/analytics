import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client({
  // Auth0 v4 uses environment variables for most settings.
  // We explicitly configure the session cookie for Iframe compatibility (Procore).
  session: {
    cookie: {
      sameSite: 'none',
      secure: true,
    },
  },
});

import { Auth0Client } from '@auth0/nextjs-auth0/server';

export const auth0 = new Auth0Client({
  // Auth0 v4 uses environment variables by default
  // Add other options here if needed, but 'profile' is not a valid route key in v4
});

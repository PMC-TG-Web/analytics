import { handleAuth } from '@auth0/nextjs-auth0/edge';

/**
 * API route for Auth0 authentication handlers.
 * Handles /api/auth/login, /api/auth/logout, /api/auth/callback automatically.
 * The [auth0] dynamic segment catches all auth0 routes.
 */
export const GET = handleAuth();
export const POST = handleAuth();

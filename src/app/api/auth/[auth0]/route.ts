import { withApiAuthRequired } from '@auth0/nextjs-auth0';

// The @auth0/nextjs-auth0 SDK handles /api/auth/* routes automatically
// This file is just a placeholder for type safety
export const GET = withApiAuthRequired(async () => {
  return new Response('Auth route', { status: 200 });
});

export const POST = withApiAuthRequired(async () => {
  return new Response('Auth route', { status: 200 });
});

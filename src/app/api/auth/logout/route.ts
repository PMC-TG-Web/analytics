import { NextRequest } from 'next/server';
import { createAuth0Client } from '@/lib/auth0';

function buildSanitizedLogoutRequest(request: NextRequest) {
  const url = new URL(request.url);
  url.search = '';
  url.searchParams.set('returnTo', `${request.nextUrl.origin}/auth/logout-complete`);
  return new NextRequest(url, request);
}

export async function GET(request: NextRequest) {
  const auth0 = createAuth0Client(request.nextUrl.origin);
  return auth0.middleware(buildSanitizedLogoutRequest(request));
}

export async function POST(request: NextRequest) {
  const auth0 = createAuth0Client(request.nextUrl.origin);
  return auth0.middleware(buildSanitizedLogoutRequest(request));
}

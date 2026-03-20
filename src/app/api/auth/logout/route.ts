import { NextRequest } from 'next/server';
import { createAuth0Client } from '@/lib/auth0';

function resolveCanonicalBaseUrl(request: NextRequest) {
  const explicit = (process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || '').trim();
  const fallback = request.nextUrl.origin;
  const base = explicit || fallback;
  return base.replace(/\/$/, '');
}

function buildSanitizedLogoutRequest(request: NextRequest) {
  const baseUrl = resolveCanonicalBaseUrl(request);
  const url = new URL(request.url);
  url.search = '';
  url.searchParams.set('returnTo', `${baseUrl}/auth/logout-complete`);
  return new NextRequest(url, request);
}

export async function GET(request: NextRequest) {
  const auth0 = createAuth0Client(resolveCanonicalBaseUrl(request));
  return auth0.middleware(buildSanitizedLogoutRequest(request));
}

export async function POST(request: NextRequest) {
  const auth0 = createAuth0Client(resolveCanonicalBaseUrl(request));
  return auth0.middleware(buildSanitizedLogoutRequest(request));
}

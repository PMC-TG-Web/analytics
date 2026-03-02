import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production';
  const auth0Domain = (process.env.AUTH0_DOMAIN || '').trim().toLowerCase();
  const auth0ClientId = (process.env.AUTH0_CLIENT_ID || '').trim();
  const auth0Secret = (process.env.AUTH0_SECRET || '').trim();
  const auth0Misconfigured =
    !auth0Domain ||
    auth0Domain.includes('your-auth0-domain') ||
    !auth0ClientId ||
    !auth0Secret;

  const { pathname } = request.nextUrl;

  // Skip auth for API routes (except auth routes themselves)
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // In dev mode without Auth0 config, bypass all middleware
  if (isDev && auth0Misconfigured) {
    return NextResponse.next();
  }

  // In production or if Auth0 is configured, enforce auth
  // Allow auth routes
  if (pathname.startsWith('/api/auth/')) {
    const response = await auth0.middleware(request);
    return response;
  }

  const session = await auth0.getSession(request);
  if (!session) {
    const loginUrl = new URL('/api/auth/login', request.url);
    loginUrl.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

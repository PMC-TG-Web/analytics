import { NextRequest, NextResponse } from 'next/server';

/**
 * Auth0 routes are handled automatically by @auth0/nextjs-auth0 SDK
 * This file ensures Next.js recognizes the /api/auth/* routes
 */
export async function GET(request: NextRequest) {
  // Redirect to login page if accessing auth routes directly
  const pathname = request.nextUrl.pathname;
  if (pathname === '/api/auth/login') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function POST(request: NextRequest) {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}

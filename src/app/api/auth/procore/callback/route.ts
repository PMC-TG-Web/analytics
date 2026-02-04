// app/api/auth/procore/callback/route.ts - Procore OAuth callback handler
import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/procore';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/procore?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/procore?error=missing_code', request.url)
    );
  }

  try {
    const tokenResponse = await getAccessToken(code);
    
    // Store token in secure httpOnly cookie
    const response = NextResponse.redirect(
      new URL('/procore?status=authenticated', request.url)
    );
    response.cookies.set('procore_access_token', tokenResponse.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: tokenResponse.expires_in,
      path: '/',
    });

    if (tokenResponse.refresh_token) {
      response.cookies.set('procore_refresh_token', tokenResponse.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60, // 30 days
        path: '/',
      });
    }

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(
      new URL(`/procore?error=${encodeURIComponent(errorMessage)}`, request.url)
    );
  }
}

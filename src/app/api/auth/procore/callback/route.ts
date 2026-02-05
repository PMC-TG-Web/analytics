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
    
     // Fetch user info from Procore
     const userInfoResponse = await fetch('https://api.procore.com/rest/v1.0/me', {
       headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` }
     });
   
     if (!userInfoResponse.ok) {
       throw new Error('Failed to fetch user info from Procore');
     }
   
     const procoreUser = await userInfoResponse.json();
   
    // Store token in secure httpOnly cookie
    const response = NextResponse.redirect(
       new URL(state || '/dashboard', request.url)
    );
   
     // Store user session (similar to Auth0 session)
     response.cookies.set('auth_session', JSON.stringify({
       email: procoreUser.login,
       name: procoreUser.name,
       picture: procoreUser.avatar,
       sub: `procore|${procoreUser.id}`,
     }), {
      httpOnly: true,
       secure: true,
       sameSite: 'none',
       maxAge: 60 * 60 * 24 * 180, // 180 days
      path: '/',
    });

     // Also store Procore access token for API calls
     response.cookies.set('procore_token', tokenResponse.access_token, {
       httpOnly: true,
       secure: true,
       sameSite: 'none',
       maxAge: tokenResponse.expires_in || 3600,
       path: '/',
     });

    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(
      new URL(`/procore?error=${encodeURIComponent(errorMessage)}`, request.url)
    );
  }
}

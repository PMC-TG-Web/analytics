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
    console.log('Procore Callback received with code:', code?.substring(0, 5) + '...');
    const tokenResponse = await getAccessToken(code);
    console.log('Procore Access Token received');
    
     // Fetch user info from Procore using the configured API URL
     const apiUrl = process.env.PROCORE_API_URL || 'https://api.procore.com';
     console.log('Fetching user info from:', `${apiUrl}/rest/v1.0/me`);

     const userInfoResponse = await fetch(`${apiUrl}/rest/v1.0/me`, {
       headers: { 'Authorization': `Bearer ${tokenResponse.access_token}` }
     });
   
     if (!userInfoResponse.ok) {
       const errorText = await userInfoResponse.text();
       console.error('Failed to fetch user info:', errorText);
       throw new Error(`Failed to fetch user info from Procore: ${userInfoResponse.status}`);
     }
   
     const procoreUser = await userInfoResponse.json();
     console.log('Success! Procore User:', procoreUser.login);
    console.log('Procore User received:', procoreUser.login);
   
    // Store token in secure httpOnly cookie
    // Append status=authenticated if we're going back to the procore page
    const isSafeRedirect = (value: string | null) => {
      if (!value) return false;
      if (!value.startsWith('/')) return false;
      if (value.startsWith('//')) return false;
      if (value.includes('://')) return false;
      return true;
    };

    let redirectPath = isSafeRedirect(state) ? state! : '/dashboard';
    if (redirectPath.includes('/procore')) {
      const url = new URL(redirectPath, request.url);
      url.searchParams.set('status', 'authenticated');
      redirectPath = url.pathname + url.search;
    }

    console.log('Redirecting to:', redirectPath);

    const response = NextResponse.redirect(
       new URL(redirectPath, request.url)
    );
   
    // Store user session
    const isProduction = process.env.NODE_ENV === 'production';
    const isHttps = request.url.startsWith('https://');
    const cookieOptions = {
      httpOnly: true,
      secure: isHttps || isProduction,
      path: '/',
      sameSite: (isHttps || isProduction) ? 'none' as const : 'lax' as const,
      maxAge: 60 * 60 * 24 * 180,
    };

    console.log('Setting cookies with options:', { ...cookieOptions, secure: isProduction });

     response.cookies.set('auth_session', JSON.stringify({
       email: procoreUser.login,
       name: procoreUser.name,
       picture: procoreUser.avatar,
       sub: `procore|${procoreUser.id}`,
     }), cookieOptions);

     // Also store procore_session as backup
     response.cookies.set('procore_session', JSON.stringify({
       email: procoreUser.login,
       name: procoreUser.name,
       picture: procoreUser.avatar,
       sub: `procore|${procoreUser.id}`,
     }), cookieOptions);

     // Also store Procore access token for API calls
     response.cookies.set('procore_access_token', tokenResponse.access_token, {
       ...cookieOptions,
       maxAge: tokenResponse.expires_in || 3600,
     });

     // Store refresh token if available (for token refresh flow)
     if (tokenResponse.refresh_token) {
       response.cookies.set('procore_refresh_token', tokenResponse.refresh_token, {
         ...cookieOptions,
         maxAge: 60 * 60 * 24 * 180, // longer expiry for refresh token
       });
       console.log('✓ Refresh token stored');
     } else {
       console.warn('⚠️ No refresh token in response from Procore');
     }

    console.log('Cookies set, sending redirect...');
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.redirect(
      new URL(`/procore?error=${encodeURIComponent(errorMessage)}`, request.url)
    );
  }
}

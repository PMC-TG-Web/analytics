// Endpoint to refresh Procore access token
import { NextRequest, NextResponse } from 'next/server';
import { refreshAccessToken } from '@/lib/procore';

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get('procore_refresh_token')?.value;

    if (!refreshToken) {
      return NextResponse.json({ error: 'No refresh token available' }, { status: 401 });
    }

    const newTokenData = await refreshAccessToken(refreshToken);
    
    // Create response with new access token in cookie
    const response = NextResponse.json({ 
      success: true,
      accessToken: newTokenData.access_token 
    });
    
    // Set the new access token in cookies
    response.cookies.set('procore_access_token', newTokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: newTokenData.expires_in || 3600,
    });

    return response;
  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Token refresh failed' 
    }, { status: 401 });
  }
}

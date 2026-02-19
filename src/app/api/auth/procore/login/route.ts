import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizationUrl } from '@/lib/procore';

/**
 * Procore OAuth Login Endpoint
 * Clears expired tokens and redirects user to Procore OAuth authorization page
 */
export async function GET(request: NextRequest) {
  try {
    const returnTo = request.nextUrl.searchParams.get('returnTo') || '/dashboard';
    
    // Get Procore OAuth URL with state parameter for return path
    const authUrl = getAuthorizationUrl(returnTo);
    
    // Validate that we have a valid URL before redirecting to avoid 500
    if (!authUrl || authUrl.startsWith('undefined') || !authUrl.includes('://')) {
      console.error('CRITICAL: Malformed Procore Auth URL generated:', authUrl);
      return NextResponse.json(
        { error: 'Procore configuration is incomplete (missing Auth URL)' },
        { status: 500 }
      );
    }

    console.log('Clearing expired Procore tokens and redirecting to login...');
    const response = NextResponse.redirect(authUrl);
    
    // Clear old expired tokens - set maxAge to 0 to delete them
    response.cookies.delete('procore_access_token');
    response.cookies.delete('procore_refresh_token');
    response.cookies.delete('procore_session');
    
    console.log('Redirecting to Procore Login:', authUrl);
    return response;
  } catch (error) {
    console.error('Auth Login Route Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown authentication error' },
      { status: 500 }
    );
  }
}

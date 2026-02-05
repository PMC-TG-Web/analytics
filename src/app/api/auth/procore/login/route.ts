import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizationUrl } from '@/lib/procore';

/**
 * Procore OAuth Login Endpoint
 * Redirects user to Procore OAuth authorization page
 */
export async function GET(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/dashboard';
  
  // Get Procore OAuth URL with state parameter for return path
  const authUrl = getAuthorizationUrl(returnTo);
  
  return NextResponse.redirect(authUrl);
}

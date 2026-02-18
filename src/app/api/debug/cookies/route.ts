import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const cookies: Record<string, string> = {};
  
  // Get all cookies
  request.cookies.getAll().forEach(cookie => {
    cookies[cookie.name] = cookie.value;
  });

  console.log('[Debug Cookies] Available cookies:', Object.keys(cookies).join(', '));

  return NextResponse.json({
    cookies,
    cookieNames: Object.keys(cookies),
    hasAuthSession: !!cookies['auth_session'],
    hasProcoreToken: !!cookies['procore_access_token'],
  });
}

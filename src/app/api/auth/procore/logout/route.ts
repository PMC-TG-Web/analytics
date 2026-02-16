// app/api/auth/procore/logout/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/procore', request.url));
  
  // Clear all Procore-related cookies
  response.cookies.delete('procore_access_token');
  response.cookies.delete('procore_session');
  
  return response;
}

import { NextRequest, NextResponse } from 'next/server';
import { localLogoutCookies } from '@/lib/localLogoutCookies';
import { getDeveloperEmail } from '@/lib/developerIdentity';

function buildLogoutCookieResponse(request: NextRequest) {
  const response = NextResponse.json({ success: true, developerSession: Boolean(getDeveloperEmail(request)) });
  const secure = process.env.NODE_ENV === 'production' || request.nextUrl.protocol === 'https:';
  for (const cookie of localLogoutCookies(request.cookies.getAll().map(cookie => cookie.name), secure)) {
    response.cookies.set(cookie);
  }
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(request: NextRequest) {
  return buildLogoutCookieResponse(request);
}

export async function GET(request: NextRequest) {
  return buildLogoutCookieResponse(request);
}

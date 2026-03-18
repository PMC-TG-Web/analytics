import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production';

  if (!isDev) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') || '').trim().toLowerCase();
  const returnTo = (searchParams.get('returnTo') || '/').trim();

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
  }

  const safeReturnTo = returnTo.startsWith('/') ? returnTo : '/';
  const redirectUrl = new URL(safeReturnTo, request.url);
  const response = NextResponse.redirect(redirectUrl);

  response.cookies.set('dev_user_email', email, {
    httpOnly: false,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 60 * 60 * 12,
  });

  return response;
}

import { NextRequest, NextResponse } from 'next/server';
import { hasPageAccess } from '@/lib/permissions';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    // Check if user has any access to any page
    const hasAccess = 
      hasPageAccess(email, 'dashboard') ||
      hasPageAccess(email, 'kpi') ||
      hasPageAccess(email, 'scheduling') ||
      hasPageAccess(email, 'wip') ||
      hasPageAccess(email, 'long-term-schedule') ||
      hasPageAccess(email, 'kpi-cards-management') ||
      hasPageAccess(email, 'procore');

    if (!hasAccess) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Store email in httpOnly cookie
    const response = NextResponse.json({ success: true });
    response.cookies.set('user_email', email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: 'Login failed' }, { status: 500 });
  }
}

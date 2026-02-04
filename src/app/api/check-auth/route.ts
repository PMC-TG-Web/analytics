import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const email = request.cookies.get('user_email')?.value;

    if (!email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({ email });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to check auth' }, { status: 500 });
  }
}

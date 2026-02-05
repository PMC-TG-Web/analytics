import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Deprecated. Use Auth0 /api/auth/login.' },
    { status: 410 }
  );
}

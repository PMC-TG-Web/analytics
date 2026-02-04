import { NextResponse } from 'next/server';
import { getAuthorizationUrl } from '@/lib/procore';

export async function GET() {
  try {
    const authUrl = getAuthorizationUrl();
    return NextResponse.json({ authUrl });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

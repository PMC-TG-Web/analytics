import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const signoff = await prisma.handbookSignoff.findUnique({
      where: { email: email.toLowerCase() }
    });

    return NextResponse.json({ exists: !!signoff, signoff });
  } catch (error) {
    console.error('Error checking handbook signoff:', error);
    return NextResponse.json(
      { error: 'Failed to check handbook signoff' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, displayName } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const signoff = await prisma.handbookSignoff.upsert({
      where: { email: email.toLowerCase() },
      update: { updatedAt: new Date() },
      create: {
        email: email.toLowerCase(),
        displayName: displayName || 'Unknown',
        userAgent: request.headers.get('user-agent') || '',
        signedAt: new Date()
      }
    });

    return NextResponse.json(signoff);
  } catch (error) {
    console.error('Error saving handbook signoff:', error);
    return NextResponse.json(
      { error: 'Failed to save handbook signoff' },
      { status: 500 }
    );
  }
}

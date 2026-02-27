import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const email = searchParams.get('email');

    const submissions = await prisma.onboardingSubmission.findMany({
      where: email ? { email } : undefined,
      orderBy: { submittedAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      data: submissions,
    });
  } catch (error) {
    console.error('Failed to fetch onboarding submissions:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch onboarding submissions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, displayName, submittedAt, hasBooklet, hasHandbook } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'email is required' },
        { status: 400 }
      );
    }

    const submission = await prisma.onboardingSubmission.create({
      data: {
        email,
        displayName: displayName || null,
        submittedAt: submittedAt ? new Date(submittedAt) : new Date(),
        hasBooklet: hasBooklet || null,
        hasHandbook: hasHandbook || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: submission,
    });
  } catch (error) {
    console.error('Failed to create onboarding submission:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create onboarding submission' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    await prisma.onboardingSubmission.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete onboarding submission:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete onboarding submission' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const requests = await prisma.timeOffRequest.findMany({
      orderBy: { createdAt: 'desc' }
    });
    
    return NextResponse.json(requests);
  } catch (error) {
    console.error('Error fetching time off requests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch time off requests' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const timeOffRequest = await prisma.timeOffRequest.create({
      data: body
    });
    
    return NextResponse.json(timeOffRequest);
  } catch (error) {
    console.error('Error creating time off request:', error);
    return NextResponse.json(
      { error: 'Failed to create time off request' },
      { status: 500 }
    );
  }
}

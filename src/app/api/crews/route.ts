import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const crews = await prisma.crewTemplate.findMany({
      orderBy: { name: 'asc' }
    });
    
    return NextResponse.json(crews);
  } catch (error) {
    console.error('Error fetching crew templates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch crew templates' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const crew = await prisma.crewTemplate.create({
      data: body
    });
    
    return NextResponse.json(crew);
  } catch (error) {
    console.error('Error creating crew template:', error);
    return NextResponse.json(
      { error: 'Failed to create crew template' },
      { status: 500 }
    );
  }
}

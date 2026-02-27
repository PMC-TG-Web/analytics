import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobKey = searchParams.get('jobKey');

    if (!jobKey) {
      return NextResponse.json({ error: 'jobKey is required' }, { status: 400 });
    }

    const schedule = await prisma.schedule.findUnique({
      where: { jobKey }
    });

    if (!schedule) {
      return NextResponse.json(null);
    }

    // Return the shortTermData for this jobKey
    return NextResponse.json(schedule.shortTermData);
  } catch (error) {
    console.error('Error fetching short-term schedule:', error);
    return NextResponse.json(
      { error: 'Failed to fetch short-term schedule' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobKey, docId, scheduleData } = body;

    if (!jobKey || !docId) {
      return NextResponse.json({ error: 'jobKey and docId are required' }, { status: 400 });
    }

    // Find or create the schedule
    let schedule = await prisma.schedule.findUnique({
      where: { jobKey }
    });

    // Get existing shortTermData or initialize
    const existingShortTerm = (schedule?.shortTermData as any) || {};
    
    // Merge the new data  with existing
    const updatedShortTerm = {
      ...existingShortTerm,
      [docId]: scheduleData
    };

    if (schedule) {
      // Update existing schedule
      schedule = await prisma.schedule.update({
        where: { jobKey },
        data: {
          shortTermData: updatedShortTerm,
          updatedAt: new Date()
        }
      });
    } else {
      // Create new schedule
      schedule = await prisma.schedule.create({
        data: {
          jobKey,
          customer: scheduleData.customer,
          projectNumber: scheduleData.projectNumber,
          projectName: scheduleData.projectName,
          shortTermData: updatedShortTerm
        }
      });
    }

    return NextResponse.json({ success: true, schedule });
  } catch (error) {
    console.error('Error saving short-term schedule:', error);
    return NextResponse.json(
      { error: 'Failed to save short-term schedule' },
      { status: 500 }
    );
  }
}

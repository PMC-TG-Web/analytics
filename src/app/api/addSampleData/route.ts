import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    await prisma.project.create({
      data: {
        projectNumber: "P-001",
        projectName: "Example Project",
        customer: "Acme Corp", 
        status: "Pending",
        hours: 8,
        projectManager: "John Doe",
        estimator: "John Doe",
        sales: 1500,
        cost: 500,
        dateCreated: new Date(),
      },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}

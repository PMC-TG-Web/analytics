import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100;
    const pageSize = Math.min(500, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;
    const mode = (searchParams.get('mode') || '').trim().toLowerCase();
    const customer = (searchParams.get('customer') || '').trim();
    const projectNumber = (searchParams.get('projectNumber') || '').trim();
    const projectName = (searchParams.get('projectName') || '').trim();
    const statusesParam = (searchParams.get('statuses') || '').trim();

    const statusList = statusesParam
      ? statusesParam.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
      : [];

    const where: any = {};

    if (mode !== 'dashboard' && statusList.length === 0) {
      where.status = {
        notIn: ['Bid Submitted', 'Lost'],
      };
    }

    if (statusList.length > 0) {
      where.status = {
        in: statusList,
      };
    }

    if (customer) {
      where.customer = customer;
    }

    if (projectNumber) {
      where.projectNumber = projectNumber;
    }

    if (projectName) {
      where.projectName = projectName;
    }

    // Get all projects with status not in ["Bid Submitted", "Lost"]
    const [total, projects] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where,
        skip,
        take: pageSize,
      }),
    ]);

    const projectsWithPMC = projects.map((project) => {
      const customFields =
        project.customFields && typeof project.customFields === 'object' && !Array.isArray(project.customFields)
          ? (project.customFields as Record<string, any>)
          : {};

      return {
        ...project,
        pmcGroup: customFields.pmcGroup ?? null,
        pmcBreakdown: customFields.pmcBreakdown ?? null,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      count: projectsWithPMC.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      data: projectsWithPMC,
    });
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { status, customer, projectNumber } = body;

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Status is required' },
        { status: 400 }
      );
    }

    // Update project status
    const updated = await prisma.project.updateMany({
      where: {
        customer: customer,
        projectNumber: projectNumber,
      },
      data: {
        status,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Updated ${updated.count} project(s)`,
      data: { count: updated.count },
    });
  } catch (error) {
    console.error('Failed to update project status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update status' },
      { status: 500 }
    );
  }
}


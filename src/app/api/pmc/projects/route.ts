import { NextRequest, NextResponse } from 'next/server';
import {
  getPmcBidBoardProjectRows,
  getPmcCombinedProjectRows,
  getPmcProjectIdentityRows,
  PMC_COMPANY_ID,
} from '@/lib/pmcProjects';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestedCompanyId = String(request.nextUrl.searchParams.get('companyId') || PMC_COMPANY_ID).trim();
  const requestedType = String(request.nextUrl.searchParams.get('type') || 'combined').trim().toLowerCase();

  if (requestedCompanyId !== PMC_COMPANY_ID) {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden company context for this deployment.',
      },
      { status: 403 },
    );
  }

  try {
    if (requestedType === 'projects' || requestedType === 'procore') {
      const projects = await getPmcProjectIdentityRows(requestedCompanyId);

      return NextResponse.json({
        success: true,
        companyId: requestedCompanyId,
        type: 'projects',
        count: projects.length,
        data: projects.map((project) => ({
          id: project.procoreProjectId,
          sourceType: 'project',
          companyId: project.companyId,
          projectId: project.procoreProjectId,
          procoreProjectId: project.procoreProjectId,
          bidBoardId: project.bidBoardId,
          projectNumber: project.projectNumber,
          projectName: project.projectName,
          customer: project.customer,
          projectStatus: project.status,
          bidBoardStatus: null,
          status: project.status,
          hasProcoreProject: true,
          hasBidBoardProject: Boolean(project.bidBoardId),
        })),
      });
    }

    if (requestedType === 'bid-board' || requestedType === 'bidboard') {
      const bidBoardProjects = await getPmcBidBoardProjectRows(requestedCompanyId);

      return NextResponse.json({
        success: true,
        companyId: requestedCompanyId,
        type: 'bid-board',
        count: bidBoardProjects.length,
        data: bidBoardProjects.map((project) => ({
          id: project.bidBoardId,
          sourceType: 'bid_board',
          companyId: project.companyId,
          projectId: project.procoreProjectId,
          procoreProjectId: project.procoreProjectId,
          bidBoardId: project.bidBoardId,
          customerCompanyId: project.customerCompanyId,
          projectNumber: project.projectNumber,
          projectName: project.projectName,
          customer: project.customer,
          projectStatus: null,
          bidBoardStatus: project.status,
          status: project.status,
          statusRaw: project.statusRaw,
          hasProcoreProject: Boolean(project.procoreProjectId),
          hasBidBoardProject: true,
        })),
      });
    }

    const rows = await getPmcCombinedProjectRows(requestedCompanyId);

    return NextResponse.json({
      success: true,
      companyId: requestedCompanyId,
      type: 'combined',
      count: rows.length,
      counts: {
        linked: rows.filter((row) => row.sourceType === 'linked').length,
        bidBoardOnly: rows.filter((row) => row.sourceType === 'bid_board').length,
        projectOnly: rows.filter((row) => row.sourceType === 'project').length,
        withProcoreProjectId: rows.filter((row) => row.procoreProjectId).length,
        withoutProcoreProjectId: rows.filter((row) => !row.procoreProjectId).length,
      },
      data: rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to fetch PMC projects:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch PMC projects',
        details: message,
      },
      { status: 500 },
    );
  }
}

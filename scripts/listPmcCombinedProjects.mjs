import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const COMPANY_ID = '598134325805519';

async function main() {
  const [projects, bidBoardProjects] = await Promise.all([
    prisma.pmcProject.findMany({
      where: { companyId: COMPANY_ID },
      select: {
        companyId: true,
        procoreProjectId: true,
        bidBoardId: true,
        projectNumber: true,
        projectName: true,
        customer: true,
        status: true,
        bidBoardStatus: true,
      },
    }),
    prisma.pmcBidBoardProject.findMany({
      where: { companyId: COMPANY_ID },
      orderBy: [{ projectNumber: 'asc' }, { projectName: 'asc' }],
      select: {
        companyId: true,
        bidBoardId: true,
        procoreProjectId: true,
        projectNumber: true,
        projectName: true,
        customer: true,
        customerCompanyId: true,
        status: true,
      },
    }),
  ]);

  const projectsById = new Map(projects.map((project) => [project.procoreProjectId, project]));
  const rows = bidBoardProjects.map((bidBoardProject) => {
    const project = bidBoardProject.procoreProjectId
      ? projectsById.get(bidBoardProject.procoreProjectId)
      : undefined;

    return {
      sourceType: project ? 'linked' : 'bid_board',
      projectId: project?.procoreProjectId ?? bidBoardProject.procoreProjectId,
      bidBoardId: bidBoardProject.bidBoardId,
      customerCompanyId: bidBoardProject.customerCompanyId,
      projectNumber: project?.projectNumber ?? bidBoardProject.projectNumber,
      projectName: project?.projectName ?? bidBoardProject.projectName,
      customer: project?.customer ?? bidBoardProject.customer,
      projectStatus: project?.status ?? null,
      bidBoardStatus: bidBoardProject.status,
    };
  });

  console.log(JSON.stringify({
    companyId: COMPANY_ID,
    count: rows.length,
    counts: {
      linked: rows.filter((row) => row.sourceType === 'linked').length,
      bidBoardOnly: rows.filter((row) => row.sourceType === 'bid_board').length,
      withProjectId: rows.filter((row) => row.projectId).length,
      withoutProjectId: rows.filter((row) => !row.projectId).length,
    },
    data: rows,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

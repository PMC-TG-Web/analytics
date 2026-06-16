import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const COMPANY_ID = '598134325805519';

async function main() {
  const rows = await prisma.pmcBidBoardProject.findMany({
    where: { companyId: COMPANY_ID },
    orderBy: [{ projectName: 'asc' }],
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
  });

  console.log(JSON.stringify({ companyId: COMPANY_ID, count: rows.length, data: rows }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

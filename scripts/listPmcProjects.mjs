import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const COMPANY_ID = '598134325805519';
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.pmcProject.findMany({
    where: { companyId: COMPANY_ID },
    orderBy: [{ projectNumber: 'asc' }, { projectName: 'asc' }],
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

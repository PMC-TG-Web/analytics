import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

try {
  // Check what commitment contract tables exist and their columns
  const tables = await prisma.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name ILIKE '%commit%'
    ORDER BY table_name
  `);
  process.stdout.write('Commitment tables: ' + JSON.stringify(tables) + '\n\n');

  // Check commitment contracts for Memory Care project (procoreProjectId)
  const contracts = await prisma.$queryRawUnsafe(`
    SELECT id, "procoreProjectId", "procoreId", title, number, status, "vendorName", value, "originalValue"
    FROM "CommitmentContract"
    WHERE "procoreProjectId" = $1
    LIMIT 20
  `, '598134326371113');
  process.stdout.write('Commitment contracts count: ' + contracts.length + '\n');
  if (contracts.length > 0) {
    process.stdout.write(JSON.stringify(contracts, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
  }

  // Also try by jobKey - first find the job key for this project
  const projectInfo = await prisma.$queryRawUnsafe(`
    SELECT id, "jobKey", name FROM "Project"
    WHERE name ILIKE '%Memory Care Meditation%'
    LIMIT 5
  `);
  process.stdout.write('Project: ' + JSON.stringify(projectInfo) + '\n');

  if (projectInfo.length > 0) {
    const projectId = projectInfo[0].id;
    const byProjectId = await prisma.$queryRawUnsafe(`
      SELECT id, "projectId", "procoreId", title, number, status, "vendorName", value, "originalValue"
      FROM "CommitmentContract"
      WHERE "projectId" = $1
      LIMIT 20
    `, projectId);
    process.stdout.write('Contracts by projectId: ' + byProjectId.length + '\n');
    process.stdout.write(JSON.stringify(byProjectId.slice(0,3), (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n');
  }
} catch(e) {
  process.stdout.write('ERROR: ' + e.message + '\n');
}
await prisma.$disconnect();

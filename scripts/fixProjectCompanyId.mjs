/**
 * Fix procore_project_staging rows that have the wrong company_id.
 * Updates 598134325658789 → 598134325805519 across both the staging table and gantt_v2_projects.
 *
 * Run: node scripts/fixProjectCompanyId.mjs
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const OLD_COMPANY_ID = '598134325658789';
const NEW_COMPANY_ID = '598134325805519';

try {
  // Preview staging
  const stagingAffected = await prisma.procoreProjectStaging.findMany({
    where: { companyId: OLD_COMPANY_ID },
    select: { externalId: true, name: true, companyId: true },
  });
  console.log(`Staging rows to fix (${stagingAffected.length}):`);
  stagingAffected.forEach(r => console.log(`  - ${r.name} (${r.externalId})`));

  // Fix staging table
  const stagingResult = await prisma.procoreProjectStaging.updateMany({
    where: { companyId: OLD_COMPANY_ID },
    data: { companyId: NEW_COMPANY_ID },
  });
  console.log(`\nUpdated ${stagingResult.count} staging rows.`);

  // Fix gantt_v2_projects table
  const ganttResult = await prisma.$executeRawUnsafe(
    `UPDATE gantt_v2_projects SET source_company_id = $1 WHERE source_company_id = $2`,
    NEW_COMPANY_ID, OLD_COMPANY_ID
  );
  console.log(`Updated ${ganttResult} gantt_v2_projects rows.`);

  // Verify
  const remainingStaging = await prisma.procoreProjectStaging.count({ where: { companyId: OLD_COMPANY_ID } });
  const remainingGantt = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM gantt_v2_projects WHERE source_company_id = $1`, OLD_COMPANY_ID
  );
  console.log(`\nRemaining with old ID — staging: ${remainingStaging}, gantt: ${remainingGantt[0].count}`);

  const correctGantt = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM gantt_v2_projects WHERE source_company_id = $1`, NEW_COMPANY_ID
  );
  console.log(`Gantt projects with correct company ID: ${correctGantt[0].count}`);

} finally {
  await prisma.$disconnect();
}

/**
 * Fix gantt_v2_projects rows that have the wrong source_company_id.
 * Updates 598134325658789 → 598134325805519 (the active Procore company).
 *
 * Run: node scripts/fixGanttCompanyId.mjs
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const OLD_COMPANY_ID = '598134325658789';
const NEW_COMPANY_ID = '598134325805519';

try {
  // Preview
  const affected = await prisma.$queryRawUnsafe(
    `SELECT id, project_name, source_company_id FROM gantt_v2_projects WHERE source_company_id = $1`,
    OLD_COMPANY_ID
  );
  console.log(`Projects to update (${affected.length}):`);
  affected.forEach(r => console.log(`  - ${r.project_name}`));

  // Update
  const result = await prisma.$executeRawUnsafe(
    `UPDATE gantt_v2_projects SET source_company_id = $1 WHERE source_company_id = $2`,
    NEW_COMPANY_ID, OLD_COMPANY_ID
  );
  console.log(`\nUpdated ${result} rows.`);

  // Verify
  const remaining = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM gantt_v2_projects WHERE source_company_id = $1`,
    OLD_COMPANY_ID
  );
  console.log(`Remaining rows with old company ID: ${remaining[0].count}`);

  const total = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM gantt_v2_projects WHERE source_company_id = $1`,
    NEW_COMPANY_ID
  );
  console.log(`Rows with correct company ID: ${total[0].count}`);

} finally {
  await prisma.$disconnect();
}

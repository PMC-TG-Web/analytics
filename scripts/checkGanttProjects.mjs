import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, job_key, project_name, customer, project_number, status, source, source_company_id
     FROM gantt_v2_projects ORDER BY project_name ASC`
  );
  console.log(`gantt_v2_projects total: ${rows.length}\n`);
  rows.forEach((r, i) => {
    console.log(`  ${i+1}. ${r.project_name} | ${r.customer} | ${r.project_number} | ${r.status} | source=${r.source} | company=${r.source_company_id}`);
  });

  // Show what gets filtered (template/sandbox)
  const filtered = rows.filter(r =>
    r.source === 'procore' &&
    (r.project_name?.toLowerCase().includes('template') || r.project_name?.toLowerCase().includes('sandbox'))
  );
  console.log(`\nFiltered out (template/sandbox): ${filtered.length}`);
  filtered.forEach(r => console.log(`  - ${r.project_name}`));

  // Show those with wrong company ID
  const COMPANY_ID = '598134325805519';
  const wrongCompany = rows.filter(r => r.source === 'procore' && r.source_company_id && r.source_company_id !== COMPANY_ID);
  console.log(`\nWrong company ID: ${wrongCompany.length}`);
  wrongCompany.forEach(r => console.log(`  - ${r.project_name} | company=${r.source_company_id}`));

} finally {
  await prisma.$disconnect();
}

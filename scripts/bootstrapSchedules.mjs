/**
 * Bootstrap script: create a Schedule row for every Project that doesn't already have one.
 * Run: node scripts/bootstrapSchedules.mjs
 *
 * jobKey format: customer~projectNumber~projectName
 * This is the canonical system-wide format used across all schedule, gantt, scope,
 * concrete-order, and equipment-assignment tables. Do NOT use project_id or bidboard_id
 * as the jobKey — all SQL queries, split_part() calls, and UI parsers depend on this format.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const projects = await prisma.project.findMany({
    where: { projectArchived: { not: true } },
    select: {
      id: true,
      projectNumber: true,
      projectName: true,
      customer: true,
      status: true,
      hours: true,
    },
  });

  console.log(`Found ${projects.length} active projects.`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const project of projects) {
    const customer = (project.customer || '').trim();
    const projectNumber = (project.projectNumber || '').trim();
    const projectName = (project.projectName || '').trim();

    if (!projectNumber || !projectName) {
      console.warn(`  SKIP: Project ${project.id} missing number or name.`);
      skipped++;
      continue;
    }

    const jobKey = `${customer}~${projectNumber}~${projectName}`;

    try {
      await prisma.schedule.upsert({
        where: { jobKey },
        update: {
          customer,
          projectNumber,
          projectName,
          status: project.status || 'active',
          totalHours: project.hours || 0,
          projectId: project.id,
        },
        create: {
          jobKey,
          customer,
          projectNumber,
          projectName,
          status: project.status || 'active',
          totalHours: project.hours || 0,
          projectId: project.id,
        },
      });
      console.log(`  OK: ${jobKey}`);
      created++;
    } catch (err) {
      console.error(`  ERROR: ${jobKey} — ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone. Created/updated: ${created}, Skipped: ${skipped}, Errors: ${errors}`);

  // Verify
  const scheduleCount = await prisma.schedule.count();
  console.log(`Schedule table now has ${scheduleCount} rows.`);

} finally {
  await prisma.$disconnect();
}

/**
 * deleteProjectsByName.cjs
 * Hard-deletes projects (and their related records) by projectName.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PROJECT_NAMES_TO_DELETE = [
  'John Stoltzfus',
  'LStoltzfus',
  'New Project',
  'Paradise Masonry Time Tracking',
  'PMC Operations',
  'PMC Test Project',
  'PMC_Shop_Time',
  'Raymond King',
  'Sandbox Test Project',
  'Shop_Equipment_Test',
  "Stevens Feed Mill (Jr's. Demo Project)",
  'Template of Copy of TCC East Cocalico Warehouse',
  'Test project 2',
];

async function main() {
  // Find matching projects (case-insensitive)
  const allProjects = await prisma.project.findMany({
    select: { id: true, projectName: true, customer: true, status: true },
  });

  const toDelete = allProjects.filter((p) => {
    const name = (p.projectName || '').trim();
    return PROJECT_NAMES_TO_DELETE.some(
      (target) => name.toLowerCase() === target.toLowerCase()
    );
  });

  if (toDelete.length === 0) {
    console.log('No matching projects found.');
    return;
  }

  console.log(`\nFound ${toDelete.length} project(s) to delete:`);
  toDelete.forEach((p) =>
    console.log(`  [${p.id}] "${p.projectName}" | customer: ${p.customer} | status: ${p.status}`)
  );

  const ids = toDelete.map((p) => p.id);

  // Hard delete with manual cascade for models that use onDelete:SetNull
  await prisma.$transaction(async (tx) => {
    // Models with onDelete: SetNull on projectId — null them out / delete as appropriate
    await tx.productivityLog.deleteMany({ where: { projectId: { in: ids } } });
    await tx.productivitySummary.deleteMany({ where: { projectId: { in: ids } } });

    // Delete the projects themselves (Prisma cascade handles related models with onDelete:Cascade)
    await tx.project.deleteMany({ where: { id: { in: ids } } });
  });

  console.log(`\n✅ Deleted ${ids.length} project(s).`);

  // Verify
  const remaining = await prisma.project.findMany({
    where: {
      projectName: {
        in: PROJECT_NAMES_TO_DELETE,
        mode: 'insensitive',
      },
    },
    select: { projectName: true },
  });

  if (remaining.length === 0) {
    console.log('✅ Verification: 0 matching projects remain in DB.');
  } else {
    console.log(`⚠️  ${remaining.length} project(s) still remain:`);
    remaining.forEach((p) => console.log('  -', p.projectName));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

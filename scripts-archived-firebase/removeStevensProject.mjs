import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function removeProject() {
  const projectName = 'Stevens Feed Mill Schoeneck';
  const customer = 'Hoover Building Specialists, Inc.';

  console.log(`Removing project: ${customer} ~ ${projectName}\n`);

  // 1. Find the project
  const project = await prisma.project.findFirst({
    where: {
      customer: customer,
      projectName: projectName
    }
  });

  if (!project) {
    console.log('❌ Project not found');
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`Found project: ${project.id}`);

  // 2. Find and delete associated schedules
  const schedules = await prisma.schedule.findMany({
    where: {
      projectId: project.id
    }
  });

  console.log(`Found ${schedules.length} schedule(s)`);

  for (const schedule of schedules) {
    // Delete allocations first
    const allocCount = await prisma.scheduleAllocation.deleteMany({
      where: { scheduleId: schedule.id }
    });
    console.log(`  Deleted ${allocCount.count} allocations for schedule ${schedule.id}`);

    // Delete schedule
    await prisma.schedule.delete({
      where: { id: schedule.id }
    });
    console.log(`  Deleted schedule ${schedule.id}`);
  }

  // 3. Find and delete scopes
  const scopes = await prisma.projectScope.findMany({
    where: {
      projectId: project.id
    }
  });

  console.log(`Found ${scopes.length} scope(s)`);
  for (const scope of scopes) {
    await prisma.projectScope.delete({
      where: { id: scope.id }
    });
    console.log(`  Deleted scope ${scope.id}`);
  }

  // 4. Delete the project
  await prisma.project.delete({
    where: { id: project.id }
  });

  console.log(`\n✓ Project deleted: ${customer} ~ ${projectName}`);

  await prisma.$disconnect();
  process.exit(0);
}

removeProject().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

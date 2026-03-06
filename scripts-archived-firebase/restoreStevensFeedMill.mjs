import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function restoreStevensFeedMill() {
  console.log('Restoring Stevens Feed Mill Schoeneck project...\n');

  // Project data from backup
  const projectData = {
    projectNumber: '2509 - SFMS',
    projectName: 'Stevens Feed Mill Schoeneck',
    customer: 'Hoover Building Specialists, Inc.',
    status: 'In Progress',
    sales: 588622.3,
    cost: 446215.28,
    hours: 4111.5,
    laborSales: 210431.32,
    laborCost: 158219,
    estimator: 'Steffy Rick',
    dateCreated: new Date('2025-09-29T04:00:00.000Z'),
    projectArchived: false
  };

  // Create the project
  const project = await prisma.project.create({
    data: projectData
  });

  console.log(`✓ Created project: ${project.projectName} (id: ${project.id})`);
  console.log(`  Hours: ${project.hours}`);
  console.log(`  Status: ${project.status}`);

  // Create jobKey
  const jobKey = `${project.customer}~${project.projectNumber}~${project.projectName}`;

  // Create schedule
  const schedule = await prisma.schedule.create({
    data: {
      jobKey,
      projectId: project.id,
      customer: project.customer,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      status: project.status,
      totalHours: project.hours
    }
  });

  console.log(`\n✓ Created schedule (id: ${schedule.id})`);

  // Allocations from WIP3.csv
  const allocations = [
    { period: '2026-04', percent: 10 },
    { period: '2026-05', percent: 5 },
    { period: '2026-06', percent: 15 },
    { period: '2026-07', percent: 20 },
    { period: '2026-08', percent: 25 },
    { period: '2026-09', percent: 25 }
  ];

  console.log(`\n✓ Creating ${allocations.length} allocations...`);

  for (const alloc of allocations) {
    const hours = (project.hours || 0) * (alloc.percent / 100);
    await prisma.scheduleAllocation.create({
      data: {
        scheduleId: schedule.id,
        period: alloc.period,
        percent: alloc.percent,
        hours
      }
    });
    console.log(`  ${alloc.period}: ${alloc.percent}% (${hours.toFixed(1)} hours)`);
  }

  console.log(`\n✓ Stevens Feed Mill Schoeneck fully restored!`);
  console.log(`  Total allocated: ${allocations.reduce((sum, a) => sum + a.percent, 0)}%`);

  // Final database counts
  const projectCount = await prisma.project.count();
  const scheduleCount = await prisma.schedule.count();
  const allocCount = await prisma.scheduleAllocation.count();

  console.log(`\nDatabase totals:`);
  console.log(`  Projects: ${projectCount}`);
  console.log(`  Schedules: ${scheduleCount}`);
  console.log(`  Allocations: ${allocCount}`);

  await prisma.$disconnect();
  process.exit(0);
}

restoreStevensFeedMill().catch(err => {
  console.error('Restore failed:', err);
  process.exit(1);
});

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Check for duplicate jobKeys
  const jobKeyDuplicates = await prisma.$queryRaw`
    SELECT 
      "jobKey",
      COUNT(*) as count,
      SUM("totalHours") as total_hours
    FROM "Schedule"
    GROUP BY "jobKey"
    HAVING COUNT(*) > 1
  `;
  
  console.log(`Schedule records with duplicate jobKeys:\n`);
  if (jobKeyDuplicates.length === 0) {
    console.log('  None found - database constraint is working correctly\n');
  } else {
    console.log(`  Found ${jobKeyDuplicates.length} duplicate keys:\n`);
    jobKeyDuplicates.forEach(row => {
      console.log(`  ${row.jobKey}:`);
      console.log(`    ${row.count} schedules, ${row.total_hours} total hours combined`);
    });
  }
  
  // Specifically check Giant #6582
  const giantSchedules = await prisma.schedule.findMany({
    where: {
      jobKey: 'Ames Construction, Inc.~2508 - GI~Giant #6582'
    }
  });
  
  console.log(`\n\nGiant #6582 schedules found: ${giantSchedules.length}`);
  giantSchedules.forEach(s => {
    console.log(`  ID: ${s.id}`);
    console.log(`  Total Hours: ${s.totalHours}`);
    console.log(`  Status: ${s.status}`);
  });
  
  // Check if unique constraint is in place
  console.log(`\n\nChecking database schema...`);
  const constraints = await prisma.$queryRaw`
    SELECT constraint_type, constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'Schedule' AND constraint_type = 'UNIQUE'
  `;
  
  console.log('Unique constraints on Schedule table:');
  if (constraints && constraints.length > 0) {
    constraints.forEach(c => {
      console.log(`  ${c.constraint_name} (${c.constraint_type})`);
    });
  } else {
    console.log('  None found');
  }
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});

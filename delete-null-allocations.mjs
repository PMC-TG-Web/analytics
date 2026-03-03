import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Removing NULL percent allocations...\n');
  
  const result = await prisma.scheduleAllocation.deleteMany({
    where: {
      AND: [
        { period: { startsWith: '2026' } },
        { percent: null }
      ]
    }
  });
  
  console.log(`✅ Deleted ${result.count} NULL percent allocations for 2026`);
  console.log(`\nRemoving ALL NULL percent allocations (across all years):  `);
  
  const resultAll = await prisma.scheduleAllocation.deleteMany({
    where: {
      percent: null
    }
  });
  
  console.log(`✅ Deleted ${resultAll.count} total NULL percent allocations`);
  
  // Verify
  const nullCount = await prisma.scheduleAllocation.count({
    where: { percent: null }
  });
  
  console.log(`✅ Verification: ${nullCount} NULL allocations remaining`);
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

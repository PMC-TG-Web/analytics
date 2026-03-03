import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const entries = await prisma.kPIEntry.findMany({
    where: { year: '2026' },
    select: { month: true, scheduledSales: true },
    orderBy: { month: 'asc' }
  });
  
  console.log('Current 2026 KPI Entries (Scheduled Sales):');
  let total = 0;
  entries.forEach(e => {
    const sales = e.scheduledSales ?? 0;
    total += sales;
    console.log(`  Month ${e.month}: $${sales.toLocaleString()}`);
  });
  console.log(`Total: $${total.toLocaleString()}`);
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

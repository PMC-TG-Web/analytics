import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const cardRows = await prisma.estimatingConstant.findMany({
    where: {
      category: 'KPI_CARDS',
    }
  });
  
  console.log('KPI Cards in Database:');
  cardRows.forEach(row => {
    console.log(`\n${row.name}:`);
    try {
      const parsed = JSON.parse(row.value || '{}');
      console.log(`  Card Name: ${parsed.cardName}`);
      if (parsed.rows && Array.isArray(parsed.rows)) {
        parsed.rows.forEach((r, i) => {
          const values = r.values || [];
          console.log(`    Row ${i + 1}: ${r.kpi}`);
          if (values.length > 0) {
            console.log(`      Values (first 3): ${values.slice(0, 3).join(', ')}`);
          }
        });
      }
    } catch (e) {
      console.log(`  [Parse error: ${e.message}]`);
    }
  });
  
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

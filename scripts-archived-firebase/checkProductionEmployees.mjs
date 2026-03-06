import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkProductionEmployees() {
  try {
    console.log('Checking production Employee table...\n');

    const count = await prisma.employee.count();
    console.log(`Total employees: ${count}\n`);

    if (count > 0) {
      const all = await prisma.employee.findMany({
        orderBy: { lastName: 'asc' },
      });

      console.log('All employees in production:');
      console.log('='.repeat(80));
      all.forEach((emp, idx) => {
        const email = emp.email || '(no email)';
        console.log(`${idx + 1}. ${emp.firstName} ${emp.lastName} - ${emp.jobTitle || 'No title'} - ${email}`);
      });
      console.log('='.repeat(80));
      
      // Check for duplicate emails
      const emails = all.map(e => e.email).filter(Boolean);
      const duplicates = emails.filter((e, i) => emails.indexOf(e) !== i);
      if (duplicates.length > 0) {
        console.log('\n⚠️  Duplicate emails found:', [...new Set(duplicates)]);
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

checkProductionEmployees();

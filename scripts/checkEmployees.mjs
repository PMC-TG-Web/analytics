import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkEmployees() {
  try {
    console.log('Checking Employee table in PostgreSQL...\n');

    const count = await prisma.employee.count();
    console.log(`Total employees in database: ${count}\n`);

    if (count > 0) {
      const employees = await prisma.employee.findMany({
        take: 10,
        orderBy: { lastName: 'asc' },
      });

      console.log('Sample employees:');
      console.log('='.repeat(80));
      employees.forEach(emp => {
        console.log(`${emp.firstName} ${emp.lastName} - ${emp.jobTitle || 'No title'} ${emp.isActive ? '✅' : '❌'}`);
      });
      console.log('='.repeat(80));
    } else {
      console.log('⚠️  No employees found in database.');
      console.log('\nOptions to load employee data:');
      console.log('1. Import from CSV file');
      console.log('2. Import from JSON export');
      console.log('3. Manually add employees via the UI');
    }

  } catch (error) {
    console.error('Error checking employees:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

checkEmployees();

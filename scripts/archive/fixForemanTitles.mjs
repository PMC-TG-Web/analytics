import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.join(__dirname, '..', '.env.local') });

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.PRISMA_DATABASE_URL ||
    '';
}

const prisma = new PrismaClient();

async function fixForemanTitles() {
  try {
    console.log('Fixing foreman job titles...\n');
    
    // Fix Jason Stoltzfus - change "Forman" to "Foreman"
    const jason = await prisma.employee.findFirst({
      where: {
        firstName: 'Jason',
        lastName: 'Stoltzfus'
      }
    });
    
    if (jason) {
      await prisma.employee.update({
        where: { id: jason.id },
        data: { jobTitle: 'Foreman' }
      });
      console.log('✅ Updated Jason Stoltzfus: "Forman" → "Foreman"');
    }
    
    // Fix Alvin Huyard - change "Lead Foreman / Project Manager" to "Lead Foreman"
    const alvin = await prisma.employee.findFirst({
      where: {
        firstName: 'Alvin',
        lastName: 'Huyard'
      }
    });
    
    if (alvin) {
      await prisma.employee.update({
        where: { id: alvin.id },
        data: { jobTitle: 'Lead Foreman' }
      });
      console.log('✅ Updated Alvin Huyard: "Lead Foreman / Project Manager" → "Lead Foreman"');
    }
    
    console.log('\n=== Foreman Summary ===');
    
    // Get all foremen
    const foremen = await prisma.employee.findMany({
      where: {
        OR: [
          { jobTitle: 'Foreman' },
          { jobTitle: 'Lead Foreman' }
        ],
        isActive: true
      },
      select: {
        firstName: true,
        lastName: true,
        jobTitle: true
      },
      orderBy: [
        { jobTitle: 'asc' },
        { firstName: 'asc' }
      ]
    });
    
    console.log(`\nTotal Foremen: ${foremen.length}\n`);
    
    foremen.forEach(f => {
      console.log(`  ${f.firstName} ${f.lastName} - ${f.jobTitle}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixForemanTitles();

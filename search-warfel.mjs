import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env.local') });

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.PRISMA_DATABASE_URL ||
    '';
}

const prisma = new PrismaClient();

async function searchForWarfel() {
  try {
    // Search for projects with similar names
    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { projectName: { contains: 'ACTS', mode: 'insensitive' } },
          { projectName: { contains: 'Oakbridge', mode: 'insensitive' } },
          { customer: { contains: 'Warfel', mode: 'insensitive' } }
        ]
      }
    });

    console.log(`=== Projects matching "ACTS", "Oakbridge", or "Warfel" ===\n`);
    console.log(`Found ${projects.length} projects\n`);

    projects.forEach(proj => {
      console.log(`Project Name: ${proj.projectName}`);
      console.log(`  Customer: ${proj.customer}`);
      console.log(`  Status: ${proj.status}`);
      console.log(`  Hours: ${proj.hours}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

searchForWarfel();

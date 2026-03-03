import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function check() {
  // Find Mechanicsburg project
  const projects = await prisma.project.findMany({
    where: {
      projectName: {
        contains: 'Mechanicsburg',
      },
    },
    select: {
      id: true,
      projectName: true,
      customer: true,
      projectNumber: true,
      hours: true,
      status: true,
    },
  });
  
  console.log('Mechanicsburg projects in database:\n');
  projects.forEach(p => {
    console.log(`Project: ${p.projectName}`);
    console.log(`Customer: ${p.customer || '(none)'}`);
    console.log(`Number: ${p.projectNumber || '(none)'}`);
    console.log(`Hours: ${p.hours || 0}`);
    console.log(`Status: ${p.status}\n`);
  });
  
  // Check Schedule
  const schedules = await prisma.schedule.findMany({
    where: {
      projectName: {
        contains: 'Mechanicsburg',
      },
    },
    select: {
      projectName: true,
      customer: true,
      allocations: true,
    },
  });
  
  console.log('Mechanicsburg schedules:\n');
  schedules.forEach(s => {
    console.log(`Schedule: ${s.projectName}`);
    console.log(`Customer: ${s.customer || '(none)'}`);
    const allocs = s.allocations || {};
    console.log('Allocations:', Object.keys(allocs).length > 0 ? '' : '(none)');
    Object.entries(allocs).forEach(([month, pct]) => {
      console.log(`  ${month}: ${pct}%`);
    });
    console.log('');
  });
  
  await prisma.$disconnect();
}

check();

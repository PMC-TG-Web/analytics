// Clean up duplicate Alexander Drive Addition projects

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

console.log('\n========================================');
console.log('CLEANING UP DUPLICATE PROJECTS');
console.log('========================================\n');

// Find all Alexander Drive Addition projects
const alexProjects = await prisma.project.findMany({
  where: {
    projectName: {
      contains: 'Alexander Drive Addition'
    }
  },
  select: {
    id: true,
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
    hours: true,
  }
});

console.log(`Found ${alexProjects.length} Alexander Drive Addition projects:\n`);

alexProjects.forEach((p, i) => {
  console.log(`${i + 1}. Customer: ${p.customer || '(blank)'}`);
  console.log(`   Project #: ${p.projectNumber || '(blank)'}`);
  console.log(`   Project Name: ${p.projectName}`);
  console.log(`   Status: ${p.status}`);
  console.log(`   Hours: ${p.hours}`);
  console.log(`   ID: ${p.id}\n`);
});

// Delete the one with blank customer and projectNumber = "Alexander Drive Addition"
// This is the duplicate that's causing issues
const toDelete = alexProjects.filter(p => 
  !p.customer && p.projectNumber === 'Alexander Drive Addition'
);

if (toDelete.length > 0) {
  console.log(`🗑️  Deleting ${toDelete.length} duplicate project(s):\n`);
  
  for (const proj of toDelete) {
    console.log(`   ${proj.projectName} (ID: ${proj.id})`);
    
    try {
      await prisma.project.delete({
        where: { id: proj.id }
      });
      console.log(`   ✅ Deleted successfully\n`);
    } catch (error) {
      console.error(`   ❌ Failed to delete:`, error.message, '\n');
    }
  }
} else {
  console.log('No duplicates to delete.');
}

// Show remaining projects
const remaining = await prisma.project.findMany({
  where: {
    projectName: {
      contains: 'Alexander Drive Addition'
    }
  },
  select: {
    customer: true,
    projectNumber: true,
    projectName: true,
    status: true,
  }
});

console.log('========================================');
console.log(`REMAINING: ${remaining.length} project(s)`);
console.log('========================================\n');

remaining.forEach((p, i) => {
  console.log(`${i + 1}. ${p.customer || '(blank)'} - ${p.projectNumber} - ${p.projectName} (${p.status})`);
});

await prisma.$disconnect();

console.log('\n========================================');
console.log('DONE');
console.log('========================================\n');

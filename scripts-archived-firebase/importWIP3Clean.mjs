import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();

async function importWIP3Allocations() {
  console.log('Starting clean WIP3 import...\n');

  // Read CSV file
  const csvContent = readFileSync('scripts/WIP3.csv', 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  
  console.log(`CSV Headers: ${headers.join(', ')}`);
  console.log(`Total lines (including header): ${lines.length}\n`);

  // Parse CSV data
  const allocations = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Handle quoted values
    const values = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g)?.map(v => v.replace(/^"(.*)"$/, '$1').trim());
    
    if (!values || values.length < 4) continue;

    const customer = values[0];
    const projectName = values[1];
    const wipMonth = values[2];
    const percentStr = values[3];

    // Parse percentage
    const percent = parseFloat(percentStr.replace('%', ''));
    if (isNaN(percent)) {
      console.warn(`  Skipping invalid percentage: ${percentStr}`);
      continue;
    }

    // Convert date to YYYY-MM format
    const date = new Date(wipMonth);
    if (isNaN(date.getTime())) {
      console.warn(`  Skipping invalid date: ${wipMonth}`);
      continue;
    }
    
    const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    allocations.push({
      customer,
      projectName,
      period,
      percent
    });
  }

  console.log(`Parsed ${allocations.length} allocation records\n`);

  // Group by customer + projectName
  const byProject = {};
  allocations.forEach(alloc => {
    const key = `${alloc.customer}~${alloc.projectName}`;
    if (!byProject[key]) {
      byProject[key] = {
        customer: alloc.customer,
        projectName: alloc.projectName,
        allocations: []
      };
    }
    byProject[key].allocations.push({
      period: alloc.period,
      percent: alloc.percent
    });
  });

  console.log(`Found ${Object.keys(byProject).length} unique projects\n`);

  // Match to database projects and create schedules
  let matched = 0;
  let notMatched = 0;

  for (const [key, data] of Object.entries(byProject)) {
    // Find matching project
    const project = await prisma.project.findFirst({
      where: {
        customer: data.customer,
        projectName: data.projectName
      }
    });

    if (!project) {
      console.log(`❌ No match: ${data.customer} ~ ${data.projectName}`);
      notMatched++;
      continue;
    }

    // Create jobKey
    const jobKey = `${project.customer}~${project.projectNumber || ''}~${project.projectName}`;

    // Create Schedule
    const schedule = await prisma.schedule.upsert({
      where: { jobKey },
      create: {
        jobKey,
        projectId: project.id,
        customer: project.customer || '',
        projectNumber: project.projectNumber || '',
        projectName: project.projectName || '',
        status: project.status || 'In Progress',
        totalHours: project.hours || 0
      },
      update: {
        status: project.status || 'In Progress',
        totalHours: project.hours || 0
      }
    });

    // Create allocations
    for (const alloc of data.allocations) {
      await prisma.scheduleAllocation.upsert({
        where: {
          scheduleId_period: {
            scheduleId: schedule.id,
            period: alloc.period
          }
        },
        create: {
          scheduleId: schedule.id,
          period: alloc.period,
          percent: alloc.percent,
          hours: (project.hours || 0) * (alloc.percent / 100)
        },
        update: {
          percent: alloc.percent,
          hours: (project.hours || 0) * (alloc.percent / 100)
        }
      });
    }

    console.log(`✓ ${data.customer} ~ ${data.projectName} (${data.allocations.length} allocations)`);
    matched++;
  }

  console.log(`\n=== IMPORT SUMMARY ===`);
  console.log(`Matched and imported: ${matched}`);
  console.log(`Not matched: ${notMatched}`);

  // Final counts
  const scheduleCount = await prisma.schedule.count();
  const allocCount = await prisma.scheduleAllocation.count();

  console.log(`\nDatabase totals:`);
  console.log(`  Schedules: ${scheduleCount}`);
  console.log(`  Allocations: ${allocCount}`);

  await prisma.$disconnect();
  process.exit(0);
}

importWIP3Allocations().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});

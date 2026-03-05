import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  if (current) {
    result.push(current.trim());
  }

  return result;
}

function convertDateToMonth(dateStr) {
  // Parse dates like "8/1/2025" to "2025-08"
  const [month, , year] = dateStr.split('/');
  return `${year}-${month.padStart(2, '0')}`;
}

async function seedWIP3() {
  try {
    // Read CSV file
    const csvPath = path.join(__dirname, 'WIP3.csv');
    const csvContent = readFileSync(csvPath, 'utf8');
    const lines = csvContent.split('\n').filter(line => line.trim());

    console.log(`\n📊 Loading WIP3.csv allocations (percentages)...\n`);

    // Skip header and parse data
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVLine(lines[i]);
      if (fields.length < 4) continue;

      const customer = fields[0];
      const projectName = fields[1];
      const wipMonth = fields[2];
      const percentStr = fields[3];

      // Parse percentage (remove % sign)
      const percent = parseFloat(percentStr.replace('%', ''));
      if (isNaN(percent)) continue;

      // Convert date to YYYY-MM format
      const monthKey = convertDateToMonth(wipMonth);

      records.push({
        customer,
        projectName,
        monthKey,
        percent,
      });
    }

    console.log(`Parsed ${records.length} allocation records from CSV\n`);

    // Get all projects for matching
    const allProjects = await prisma.project.findMany({
      select: {
        id: true,
        customer: true,
        projectName: true,
        hours: true,
      },
    });

    console.log(`Database has ${allProjects.length} projects\n`);

    let matched = 0;
    let created = 0;
    let updated = 0;
    let notFound = 0;
    const notFoundProjects = new Set();

    for (const record of records) {
      // Find project by customer + projectName
      const project = allProjects.find(
        (p) =>
          p.customer?.toLowerCase().trim() === record.customer.toLowerCase().trim() &&
          p.projectName?.toLowerCase().trim() === record.projectName.toLowerCase().trim()
      );

      if (!project) {
        notFound++;
        notFoundProjects.add(`${record.customer} / ${record.projectName}`);
        continue;
      }

      matched++;

      // Find or create Schedule by customer + projectName
      let schedule = await prisma.schedule.findFirst({
        where: {
          customer: record.customer,
          projectName: record.projectName,
        },
      });

      if (!schedule) {
        // Create Schedule if it doesn't exist with proper jobKey format
        const jobKey = `${record.customer}~${project.id}~${record.projectName}`;
        try {
          schedule = await prisma.schedule.create({
            data: {
              jobKey,
              projectId: project.id,
              customer: record.customer,
              projectNumber: project.id,
              projectName: record.projectName,
              status: 'In Progress',
              totalHours: project.hours || 2000,
            },
          });
          created++;
          console.log(`🆕 Created schedule: ${record.customer} / ${record.projectName}`);
        } catch (createErr) {
          // If jobKey already exists, try to find by customer + projectName again
          if (createErr.code === 'P2002') {
            schedule = await prisma.schedule.findFirst({
              where: {
                customer: record.customer,
                projectName: record.projectName,
              },
            });
            if (!schedule) throw createErr;
            console.log(`⚠️  Schedule already exists for ${record.customer} / ${record.projectName}`);
          } else {
            throw createErr;
          }
        }
      }

      // Create or update ScheduleAllocation with percentage
      const allocation = await prisma.scheduleAllocation.upsert({
        where: {
          scheduleId_period: {
            scheduleId: schedule.id,
            period: record.monthKey,
          },
        },
        create: {
          scheduleId: schedule.id,
          period: record.monthKey,
          periodType: 'month',
          percent: record.percent,
          hours: (schedule.totalHours || 0) * (record.percent / 100),
        },
        update: {
          percent: record.percent,
          hours: (schedule.totalHours || 0) * (record.percent / 100),
        },
      });

      updated++;
      console.log(`✅ ${record.customer} / ${record.projectName} - ${record.monthKey}: ${record.percent}%`);
    }

    // Final stats
    const totalSchedules = await prisma.schedule.count();
    const totalAllocations = await prisma.scheduleAllocation.count();

    console.log(`\n📈 Results:`);
    console.log(`   Matched: ${matched} records`);
    console.log(`   Created Schedules: ${created}`);
    console.log(`   Updated Allocations: ${updated}`);
    console.log(`   Not Found: ${notFound} projects`);

    if (notFoundProjects.size > 0) {
      console.log(`\n⚠️  Projects not found in database:`);
      Array.from(notFoundProjects)
        .sort()
        .slice(0, 10)
        .forEach((proj) => console.log(`   - ${proj}`));
      if (notFoundProjects.size > 10) {
        console.log(`   ... and ${notFoundProjects.size - 10} more`);
      }
    }

    console.log(`\n📊 Database State:`);
    console.log(`   Total Schedules: ${totalSchedules}`);
    console.log(`   Total Allocations: ${totalAllocations}`);

    process.exit(0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

seedWIP3();

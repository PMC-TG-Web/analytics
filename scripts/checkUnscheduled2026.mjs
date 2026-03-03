import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function checkUnscheduled() {
  try {
    // Get all In Progress projects
    const projects = await prisma.project.findMany({
      where: {
        status: 'In Progress'
      }
    });

    // Get all schedules
    const schedules = await prisma.schedule.findMany();

    const scheduleMap = new Map();
    schedules.forEach(s => {
      scheduleMap.set(s.jobKey, s);
    });

    // Group projects by jobKey
    const jobMap = new Map();
    projects.forEach(p => {
      const key = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
      if (!jobMap.has(key)) {
        jobMap.set(key, {
          customer: p.customer,
          projectName: p.projectName,
          totalHours: 0,
          allocations: {}
        });
      }
      jobMap.get(key).totalHours += p.hours || 0;
    });

    console.log('\n📊 Projects with hours not fully allocated to 2026:\n');
    
    let totalUnscheduled = 0;
    const issues = [];

    jobMap.forEach((job, jobKey) => {
      const schedule = scheduleMap.get(jobKey);
      
      if (!schedule) {
        // No schedule at all
        if (job.totalHours > 0) {
          issues.push({
            customer: job.customer,
            project: job.projectName,
            totalHours: job.totalHours,
            allocated2026: 0,
            unscheduled: job.totalHours,
            reason: 'No allocations'
          });
          totalUnscheduled += job.totalHours;
        }
        return;
      }

      // Calculate hours allocated to 2026
      let allocated2026Hours = 0;
      let allocatedOtherYears = 0;
      
      Object.entries(schedule.allocations || {}).forEach(([month, percent]) => {
        const hourValue = (schedule.totalHours || 0) * (percent / 100);
        if (month.startsWith('2026')) {
          allocated2026Hours += hourValue;
        } else {
          allocatedOtherYears += hourValue;
        }
      });

      // Budget available for 2026 = Total - Other Years
      const available2026 = job.totalHours - allocatedOtherYears;
      const unscheduled = available2026 - allocated2026Hours;

      if (unscheduled > 0.5) { // More than 0.5 hours unscheduled
        issues.push({
          customer: job.customer,
          project: job.projectName,
          totalHours: job.totalHours,
          allocatedOther: allocatedOtherYears,
          available2026: available2026,
          allocated2026: allocated2026Hours,
          unscheduled: unscheduled,
          reason: allocatedOtherYears > 0 ? 'Partially in other years' : 'Under-allocated'
        });
        totalUnscheduled += unscheduled;
      }
    });

    // Sort by unscheduled hours desc
    issues.sort((a, b) => b.unscheduled - a.unscheduled);

    issues.forEach((issue, idx) => {
      console.log(`${idx + 1}. ${issue.customer} - ${issue.project}`);
      console.log(`   Total Hours: ${Math.round(issue.totalHours)}`);
      if (issue.allocatedOther) {
        console.log(`   Allocated to other years: ${Math.round(issue.allocatedOther)}`);
        console.log(`   Available for 2026: ${Math.round(issue.available2026)}`);
      }
      console.log(`   Allocated to 2026: ${Math.round(issue.allocated2026)}`);
      console.log(`   ⚠️  Unscheduled 2026: ${Math.round(issue.unscheduled)} hours`);
      console.log(`   Reason: ${issue.reason}\n`);
    });

    console.log(`\n📈 Total Unscheduled 2026 Hours: ${Math.round(totalUnscheduled)}\n`);

  } finally {
    await prisma.$disconnect();
  }
}

checkUnscheduled();

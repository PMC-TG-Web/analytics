import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debug() {
  try {
    console.log('=== DEBUGGING SYNC ISSUES ===\n');

    // 1. Find Westminster Presbyterian Addition
    const project = await prisma.project.findFirst({
      where: {
        projectName: { contains: 'Westminster' }
      },
      include: {
        schedules: true,
        activeSchedules: true
      }
    });

    if (!project) {
      console.log('❌ Westminster Presbyterian Addition project not found');
      return;
    }

    console.log(`✅ Found project: ${project.projectName} (ID: ${project.id})`);
    console.log(`   Project Number: ${project.projectNumber}`);
    console.log(`   Status: ${project.status}\n`);

    // 2. Check Schedule records
    console.log('📋 SCHEDULE RECORDS:');
    const schedules = await prisma.schedule.findMany({
      where: {
        projectNumber: project.projectNumber || undefined
      },
      include: {
        allocationsList: true
      }
    });

    console.log(`   Found ${schedules.length} schedule(s)`);
    if (schedules.length > 0) {
      schedules.forEach(s => {
        console.log(`   - Job Key: ${s.jobKey}`);
        console.log(`     Customer: ${s.customer}`);
        console.log(`     Total Hours: ${s.totalHours}`);
        console.log(`     Allocations: ${s.allocationsList.length}`);
        s.allocationsList.forEach(alloc => {
          console.log(`       • ${alloc.period}: ${alloc.hours} hrs`);
        });
      });
    }
    console.log();

    // 3. Check ActiveSchedule records
    console.log('📅 ACTIVE SCHEDULE RECORDS:');
    const activeSchedules = await prisma.activeSchedule.findMany({
      where: {
        projectId: project.id
      }
    });

    console.log(`   Found ${activeSchedules.length} active schedule entries`);
    if (activeSchedules.length > 0) {
      // Group by jobKey
      const byJobKey = new Map();
      activeSchedules.forEach(as => {
        if (!byJobKey.has(as.jobKey)) byJobKey.set(as.jobKey, []);
        byJobKey.get(as.jobKey).push(as);
      });

      byJobKey.forEach((entries, jobKey) => {
        const totalHours = entries.reduce((sum, e) => sum + (e.hours || 0), 0);
        const firstEntry = entries[0];
        const lastEntry = entries[entries.length - 1];
        console.log(`   - Job Key: ${jobKey}`);
        console.log(`     Scope: ${firstEntry ? firstEntry.scopeOfWork : 'N/A'}`);
        console.log(`     Total Hours: ${totalHours}`);
        console.log(`     Entries: ${entries.length} days`);
        console.log(`     Date Range: ${firstEntry ? firstEntry.date : 'N/A'} to ${lastEntry ? lastEntry.date : 'N/A'}`);
      });
    }
    console.log();

    // 4. Check Gantt V2 Scopes
    console.log('🎯 GANTT V2 SCOPES:');
    const ganttScopes = await prisma.$queryRawUnsafe(`
      SELECT id, title, start_date, end_date, total_hours
      FROM gantt_v2_scopes
      WHERE project_id = (
        SELECT id FROM gantt_v2_projects WHERE project_name LIKE '%Westminster%'
      )
    `);

    console.log(`   Found ${ganttScopes.length} scopes`);
    if (ganttScopes.length > 0) {
      ganttScopes.forEach(s => {
        console.log(`   - ${s.title}: ${s.total_hours} total hours`);
        console.log(`     Dates: ${s.start_date} to ${s.end_date}`);
      });
    }
    console.log();

    // 5. Check gantt_v2_schedule_entries
    console.log('📊 GANTT V2 SCHEDULE ENTRIES:');
    const ganttEntries = await prisma.$queryRawUnsafe(`
      SELECT e.id, e.scope_id, e.work_date, e.scheduled_hours, s.title
      FROM gantt_v2_schedule_entries e
      JOIN gantt_v2_scopes s ON s.id = e.scope_id
      WHERE s.project_id = (
        SELECT id FROM gantt_v2_projects WHERE project_name LIKE '%Westminster%'
      )
      LIMIT 20
    `);

    console.log(`   Found ${ganttEntries.length} schedule entries`);
    if (ganttEntries.length > 0) {
      ganttEntries.forEach(e => {
        console.log(`   - ${e.title}: ${e.scheduled_hours} hrs on ${e.work_date}`);
      });
    }

    console.log('\n=== DIAGNOSIS ===');
    if (schedules.length === 0 && activeSchedules.length > 0) {
      console.log('⚠️  ISSUE: ActiveSchedule has entries but NO Schedule records found');
      console.log('   Solution: Need to match by jobKey directly, not projectNumber');
    } else if (activeSchedules.length === 0) {
      console.log('⚠️  ISSUE: No activeSchedule entries found');
      console.log('   Check: Did you save allocations on the scheduling page?');
    } else if (ganttEntries.length === 0) {
      console.log('⚠️  ISSUE: gantt_v2_schedule_entries are empty');
      console.log('   The sync may not have run, or activeSchedule data is not matching');
    } else {
      console.log('✅ All data looks good!');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

debug();

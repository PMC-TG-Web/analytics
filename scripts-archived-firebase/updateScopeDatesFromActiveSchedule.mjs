import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateScopeDatesFromActiveSchedule() {
  try {
    console.log('Updating ProjectScope dates from ActiveSchedule...\n');
    
    // Get all active schedules
    const activeSchedules = await prisma.activeSchedule.findMany({
      orderBy: { date: 'asc' }
    });
    
    console.log(`Found ${activeSchedules.length} active schedule records`);
    
    // Group by jobKey to find date ranges
    const projectDateRanges = new Map();
    
    for (const record of activeSchedules) {
      if (!projectDateRanges.has(record.jobKey)) {
        projectDateRanges.set(record.jobKey, {
          startDate: record.date,
          endDate: record.date
        });
      }
      
      const range = projectDateRanges.get(record.jobKey);
      if (record.date < range.startDate) range.startDate = record.date;
      if (record.date > range.endDate) range.endDate = record.date;
    }
    
    console.log(`Found date ranges for ${projectDateRanges.size} projects\n`);
    
    let updatedCount = 0;
    let noDateCount = 0;
    
    // Update all ProjectScope records that match these jobKeys
    for (const [jobKey, dates] of projectDateRanges.entries()) {
      try {
        const result = await prisma.projectScope.updateMany({
          where: {
            jobKey: jobKey,
            OR: [
              { startDate: null },
              { endDate: null }
            ]
          },
          data: {
            startDate: dates.startDate,
            endDate: dates.endDate
          }
        });
        
        if (result.count > 0) {
          updatedCount += result.count;
        }
      } catch (error) {
        console.error(`Error updating scopes for ${jobKey}:`, error.message);
      }
    }
    
    // Count scopes still without dates
    const scopesWithoutDates = await prisma.projectScope.count({
      where: {
        OR: [
          { startDate: null },
          { endDate: null }
        ]
      }
    });
    
    noDateCount = scopesWithoutDates;
    
    console.log(`✅ Updated ${updatedCount} ProjectScope records with dates`);
    console.log(`   ${noDateCount} scopes still need scheduling (no ActiveSchedule data)\n`);
    
    // Show sample updated scopes
    const samples = await prisma.projectScope.findMany({
      where: {
        startDate: { not: null }
      },
      take: 5,
      orderBy: { startDate: 'asc' }
    });
    
    console.log('Sample updated scopes:');
    samples.forEach(s => {
      console.log(`  - ${s.title.substring(0, 50)}`);
      console.log(`    ${s.startDate} → ${s.endDate}`);
    });
    
  } catch (error) {
    console.error('Error updating scope dates:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateScopeDatesFromActiveSchedule()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

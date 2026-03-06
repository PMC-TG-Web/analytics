import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function populateProjectScopes() {
  try {
    console.log('Starting ProjectScope population from ActiveSchedule...');
    
    // Get all active schedule records
    const activeSchedules = await prisma.activeSchedule.findMany({
      orderBy: { date: 'asc' }
    });
    
    console.log(`Found ${activeSchedules.length} active schedule records`);
    
    // Group by jobKey + scopeOfWork (composite key)
    const scopeMap = new Map();
    
    for (const record of activeSchedules) {
      const scopeKey = `${record.jobKey}|||${record.scopeOfWork || 'General Work'}`;
      
      if (!scopeMap.has(scopeKey)) {
        scopeMap.set(scopeKey, {
          jobKey: record.jobKey,
          projectId: record.projectId,
          scopeOfWork: record.scopeOfWork || 'General Work',
          startDate: record.date,
          endDate: record.date,
          totalHours: 0,
          dates: []
        });
      }
      
      const scope = scopeMap.get(scopeKey);
      
      // Track earliest and latest dates
      if (record.date < scope.startDate) {
        scope.startDate = record.date;
      }
      if (record.date > scope.endDate) {
        scope.endDate = record.date;
      }
      
      // Sum hours
      scope.totalHours += record.hours;
      
      // Track all unique dates
      if (!scope.dates.includes(record.date)) {
        scope.dates.push(record.date);
      }
    }
    
    console.log(`Found ${scopeMap.size} unique scopes across projects`);
    
    // Clear existing ProjectScope records
    const deletedCount = await prisma.projectScope.deleteMany({});
    console.log(`Deleted ${deletedCount.count} existing ProjectScope records`);
    
    // Create ProjectScope records
    let createdCount = 0;
    
    for (const [scopeKey, data] of scopeMap.entries()) {
      // Extract project name from jobKey (format: "customer~projectNumber~projectName")
      const parts = data.jobKey.split('~');
      const projectName = parts.length >= 3 ? parts[2] : parts[parts.length - 1];
      
      try {
        await prisma.projectScope.create({
          data: {
            jobKey: data.jobKey,
            projectId: data.projectId,
            title: data.scopeOfWork,
            startDate: data.startDate,
            endDate: data.endDate,
            hours: data.totalHours,
            description: `${data.dates.length} scheduled work days from ${data.startDate} to ${data.endDate}`
          }
        });
        createdCount++;
      } catch (error) {
        console.error(`Error creating scope for ${data.jobKey} - ${data.scopeOfWork}:`, error.message);
      }
    }
    
    console.log(`\n✅ Created ${createdCount} ProjectScope records`);
    
    // Verify results
    const totalScopes = await prisma.projectScope.count();
    console.log(`Total ProjectScope records: ${totalScopes}`);
    
    // Show sample records
    const samples = await prisma.projectScope.findMany({
      take: 5,
      orderBy: { startDate: 'asc' }
    });
    
    console.log('\nSample ProjectScope records:');
    samples.forEach(s => {
      console.log(`  - ${s.title}`);
      console.log(`    ${s.startDate} → ${s.endDate} (${s.hours} hours)`);
    });
    
  } catch (error) {
    console.error('Error populating ProjectScopes:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

populateProjectScopes()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

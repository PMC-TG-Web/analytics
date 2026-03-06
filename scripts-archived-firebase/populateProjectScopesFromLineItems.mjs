import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function populateProjectScopesFromLineItems() {
  try {
    console.log('Creating ProjectScope records from Project lineItems...\n');
    
    // Get all projects with customFields
    const projects = await prisma.project.findMany({
      where: {
        customFields: { not: null },
        status: { notIn: ['Invitations', 'Lost'] }
      },
      select: {
        id: true,
        customer: true,
        projectNumber: true,
        projectName: true,
        customFields: true,
      }
    });
    
    console.log(`Found ${projects.length} projects with custom fields`);
    
    // Clear existing ProjectScope records
    const deletedCount = await prisma.projectScope.deleteMany({});
    console.log(`Deleted ${deletedCount.count} existing ProjectScope records\n`);
    
    let createdCount = 0;
    let skippedCount = 0;
    
    for (const project of projects) {
      const jobKey = `${project.customer || ''}~${project.projectNumber || ''}~${project.projectName || ''}`;
      const customFields = project.customFields;
      
      if (!customFields || !Array.isArray(customFields.lineItems)) {
        skippedCount++;
        continue;
      }
      
      // Group line items by scopeOfWork
      const scopeMap = new Map();
      
      for (const item of customFields.lineItems) {
        if (!item.scopeOfWork || typeof item.scopeOfWork !== 'string') continue;
        
        const scopeName = item.scopeOfWork.trim();
        if (!scopeName || scopeName === '') continue;
        
        if (!scopeMap.has(scopeName)) {
          scopeMap.set(scopeName, {
            title: scopeName,
            hours: 0,
            sales: 0,
            cost: 0,
          });
        }
        
        const scope = scopeMap.get(scopeName);
        
        // Sum labor hours (exclude management)
        if (item.hours && item.costType !== 'Part' && item.costType !== 'Subcontractor') {
          const costTypeLower = (item.costType || '').toLowerCase();
          if (!costTypeLower.includes('management')) {
            scope.hours += item.hours || 0;
          }
        }
        
        scope.sales += item.sales || 0;
        scope.cost += item.cost || 0;
      }
      
      // Create ProjectScope for each unique scope
      for (const [scopeName, scopeData] of scopeMap.entries()) {
        try {
          await prisma.projectScope.create({
            data: {
              jobKey,
              projectId: project.id,
              title: scopeData.title,
              hours: scopeData.hours > 0 ? scopeData.hours : null,
              description: `Sales: $${scopeData.sales.toFixed(2)}, Cost: $${scopeData.cost.toFixed(2)}`,
              // Dates will be populated when scope is scheduled
              startDate: null,
              endDate: null,
            }
          });
          createdCount++;
        } catch (error) {
          console.error(`Error creating scope "${scopeName}" for ${jobKey}:`, error.message);
        }
      }
    }
    
    console.log(`\n✅ Created ${createdCount} ProjectScope records`);
    console.log(`   Skipped ${skippedCount} projects without lineItems`);
    
    // Verify and show samples
    const totalScopes = await prisma.projectScope.count();
    console.log(`\nTotal ProjectScope records: ${totalScopes}`);
    
    const samples = await prisma.projectScope.findMany({
      take: 10,
      orderBy: { hours: 'desc' }
    });
    
    console.log('\nTop 10 scopes by hours:');
    samples.forEach(s => {
      const hours = s.hours ? `${s.hours} hrs` : 'no hours';
      console.log(`  - ${s.title.substring(0, 60)}`);
      console.log(`    ${s.jobKey.split('~')[2] || s.jobKey} (${hours})`);
    });
    
  } catch (error) {
    console.error('Error populating ProjectScopes:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

populateProjectScopesFromLineItems()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  // Check if Giant #6582 has any ProjectScopes
  const scopes = await prisma.projectScope.findMany({
    where: {
      jobKey: { contains: 'Giant' }
    },
    select: {
      id: true,
      jobKey: true,
      title: true,
      hours: true,
      startDate: true,
      endDate: true,
    },
    orderBy: { jobKey: 'asc' }
  });
  
  console.log(`Found ${scopes.length} ProjectScopes with "Giant" in jobKey\n`);
  
  if (scopes.length === 0) {
    console.log('No scopes found');
  } else {
    scopes.forEach((s) => {
      console.log(`${s.jobKey}`);
      console.log(`  Title: ${s.title}`);
      console.log(`  Hours: ${s.hours}`);
      console.log(`  Start: ${s.startDate}`);
      console.log(`  End: ${s.endDate}`);
      console.log('');
    });
    
    // Check if this could cause the 19x multiplier
    const totalGiantHours = scopes.reduce((sum, s) => sum + (s.hours || 0), 0);
    console.log(`\nTotal hours from scopes: ${totalGiantHours}`);
    console.log(`If scopes hours are being used instead of allocations...`);
    if (totalGiantHours > 3756) {
      console.log(`And there are ${scopes.length} scopes...`);
      console.log(`Total scopes hours / project hours = ${totalGiantHours} / 3756 = ${(totalGiantHours / 3756).toFixed(2)}x`);
    }
  }
  
  await prisma.$disconnect();
}

check().catch(e => {
  console.error(e);
  process.exit(1);
});

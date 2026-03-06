import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkProjectHours() {
  const projects = await prisma.project.findMany({
    where: {
      status: 'In Progress'
    },
    select: {
      id: true,
      customer: true,
      projectName: true,
      status: true,
      hours: true,
    }
  });

  console.log('In Progress Projects and Hours:\n');
  
  let total = 0;
  projects.forEach(p => {
    const hrs = p.hours || 0;
    total += hrs;
    console.log(`${p.customer} ~ ${p.projectName}`);
    console.log(`  Hours: ${hrs}`);
  });

  console.log(`\nTotal: ${total}`);
  console.log(`\nThese 43,621 hours are coming from the Project.hours field in the database.`);

  await prisma.$disconnect();
  process.exit(0);
}

checkProjectHours().catch(err => {
  console.error(err);
  process.exit(1);
});

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const missingProjects = [
  {
    customer: "Hoover Building Specialists, Inc.",
    projectName: "AB Martin 34 Denver Road",
    projectNumber: "2508-AB",
    hours: 497
  },
  {
    customer: "Heck Construction",
    projectName: "Gish Furniture Site Work",
    projectNumber: "HEC-GFS",
    hours: 2000
  },
  {
    customer: "Hoover Building Specialists, Inc.",
    projectName: "Paneling Sales Pine Building",
    projectNumber: "2511-PSPB",
    hours: 2000
  },
  {
    customer: "Jonas King",
    projectName: "Jonas King Sidewalk",
    projectNumber: "JK-Sidewalk",
    hours: 2000
  }
];

(async () => {
  console.log('Creating missing projects...\n');
  
  for (const proj of missingProjects) {
    const existing = await prisma.project.findFirst({
      where: {
        customer: proj.customer,
        projectName: proj.projectName
      }
    });

    if (existing) {
      console.log(`✅ Already exists: ${proj.customer} / ${proj.projectName}`);
      continue;
    }

    const created = await prisma.project.create({
      data: {
        customer: proj.customer,
        projectName: proj.projectName,
        projectNumber: proj.projectNumber,
        hours: proj.hours,
        status: "In Progress"
      }
    });

    console.log(`🆕 Created: ${proj.customer} / ${proj.projectName} (${proj.hours} hours)`);
  }

  console.log('\n✅ Done creating missing projects');
  process.exit(0);
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

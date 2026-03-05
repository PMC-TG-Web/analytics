import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const generateId = () => randomBytes(12).toString('hex');

async function migrateScopesFromLineItems() {
  console.log('Starting scope migration from lineItems...\n');

  try {
    // Get all "In Progress" projects with customFields
    const projects = await prisma.project.findMany({
      where: {
        status: 'In Progress',
      },
      select: {
        id: true,
        projectName: true,
        customer: true,
        projectNumber: true,
        customFields: true,
      },
      orderBy: { projectName: 'asc' },
    });

    console.log(`Found ${projects.length} "In Progress" projects\n`);

    let scopesCreated = 0;
    let projectsWithScopes = 0;

    for (const project of projects) {
      if (!project.customFields || typeof project.customFields !== 'object') {
        continue;
      }

      const customFields = project.customFields;
      if (!customFields.lineItems || !Array.isArray(customFields.lineItems)) {
        continue;
      }

      // Find the matching gantt_v2_project
      const v2Project = await prisma.$queryRaw`
        SELECT id FROM gantt_v2_projects 
        WHERE project_name = ${project.projectName}
        LIMIT 1
      `;

      if (!v2Project || v2Project.length === 0) {
        console.log(`⊘ Skipping "${project.projectName}" - not found in Gantt V2`);
        continue;
      }

      const v2ProjectId = v2Project[0].id;

      // Aggregate labor hours by scopeOfWork
      const scopeMap = new Map();

      customFields.lineItems.forEach((item) => {
        // Only process Labor items (ignore materials, equipment, subcontractors)
        if (item.costType === 'Labor' && item.scopeOfWork && item.hours > 0) {
          const scope = item.scopeOfWork.trim();
          scopeMap.set(scope, (scopeMap.get(scope) || 0) + item.hours);
        }
      });

      if (scopeMap.size === 0) {
        continue;
      }

      projectsWithScopes++;
      console.log(`✓ Project: "${project.projectName}" (${project.customer})`);

      // Create scopes in gantt_v2_scopes
      for (const [scopeTitle, totalHours] of scopeMap) {
        const scopeId = generateId();
        await prisma.$executeRaw`
          INSERT INTO gantt_v2_scopes (id, project_id, title, total_hours)
          VALUES (${scopeId}, ${v2ProjectId}, ${scopeTitle}, ${totalHours})
          ON CONFLICT DO NOTHING
        `;
        scopesCreated++;
        console.log(`  └─ Scope: "${scopeTitle}" (${totalHours.toFixed(1)} hours)`);
      }

      console.log();
    }

    console.log('\n========== MIGRATION SUMMARY ==========');
    console.log(`Projects with labor items:  ${projectsWithScopes}`);
    console.log(`Scopes created:             ${scopesCreated}`);
    console.log('\nMigration complete! Visit /project-schedule to view your scopes.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrateScopesFromLineItems();

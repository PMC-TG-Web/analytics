import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const generateId = () => randomBytes(12).toString('hex');

async function migrateToGanttV2() {
  console.log('Starting Gantt V2 migration...\n');

  try {
    // Ensure V2 schema exists
    await ensureGanttV2Schema(prisma);
    console.log('✓ Gantt V2 schema verified\n');

    // Get all projects
    const projects = await prisma.project.findMany({
      include: {
        scopes: true,
      },
      orderBy: { projectName: 'asc' },
    });

    console.log(`Found ${projects.length} projects to migrate\n`);

    let projectsCreated = 0;
    let scopesCreated = 0;
    let skipped = 0;

    // Process each project
    for (const project of projects) {
      if (!project.projectName) {
        console.log(`⊘ Skipping project with no name`);
        skipped++;
        continue;
      }

      // Check if project already exists in V2
      const existing = await prisma.$queryRaw`
        SELECT id FROM gantt_v2_projects 
        WHERE project_name = ${project.projectName}
      `;

      let v2ProjectId;

      if (existing && existing.length > 0) {
        v2ProjectId = existing[0].id;
        console.log(`→ Project "${project.projectName}" already exists in V2`);
      } else {
        // Create V2 project
        v2ProjectId = generateId();
        await prisma.$executeRaw`
          INSERT INTO gantt_v2_projects (id, project_name, customer, project_number, status)
          VALUES (${v2ProjectId}, ${project.projectName}, ${project.customer || null}, ${project.projectNumber || null}, ${project.status || null})
        `;
        projectsCreated++;
        console.log(`✓ Created V2 project: "${project.projectName}"`);
      }

      // Migrate scopes for this project
      if (project.scopes && project.scopes.length > 0) {
        console.log(`  └─ Migrating ${project.scopes.length} scope(s)...`);

        for (const scope of project.scopes) {
          if (!scope.title) {
            console.log(`    ⊘ Skipping scope with no title`);
            continue;
          }

          // Check if scope already exists in V2
          const existingScope = await prisma.$queryRaw`
            SELECT id FROM gantt_v2_scopes 
            WHERE project_id = ${v2ProjectId} 
            AND title = ${scope.title}
          `;

          if (existingScope && existingScope.length > 0) {
            console.log(`    → Scope "${scope.title}" already exists`);
            continue;
          }

          // Create V2 scope with hours from ProjectScope.hours
          const scopeId = generateId();
          const totalHours = scope.hours || 0;
          const startDate = scope.startDate ? new Date(scope.startDate).toISOString().split('T')[0] : null;
          const endDate = scope.endDate ? new Date(scope.endDate).toISOString().split('T')[0] : null;

          await prisma.$executeRaw`
            INSERT INTO gantt_v2_scopes (id, project_id, title, start_date, end_date, total_hours, notes)
            VALUES (${scopeId}, ${v2ProjectId}, ${scope.title}, ${startDate}, ${endDate}, ${totalHours}, ${scope.description || null})
          `;

          scopesCreated++;
          console.log(`    ✓ Created scope: "${scope.title}" (${totalHours} hours)`);
        }
      } else {
        console.log(`  (no scopes to migrate)`);
      }

      console.log();
    }

    console.log('\n========== MIGRATION SUMMARY ==========');
    console.log(`Projects created:  ${projectsCreated}`);
    console.log(`Scopes created:    ${scopesCreated}`);
    console.log(`Skipped:           ${skipped}`);
    console.log(`Total processed:   ${projects.length}`);
    console.log('\nMigration complete! Visit /project-schedule to view your Gantt V2 data.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureGanttV2Schema(prisma) {
  // Create projects table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gantt_v2_projects (
      id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      customer TEXT,
      project_number TEXT,
      status TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Create scopes table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS gantt_v2_scopes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      start_date DATE,
      end_date DATE,
      total_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
      crew_size DOUBLE PRECISION,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT fk_gantt_v2_project
        FOREIGN KEY(project_id)
          REFERENCES gantt_v2_projects(id)
          ON DELETE CASCADE
    );
  `);

  // Create indices
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_gantt_v2_scopes_project_id ON gantt_v2_scopes(project_id);
  `);
}

migrateToGanttV2();

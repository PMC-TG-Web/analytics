import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

console.log('=== Gantt V2 Data Diagnostic ===\n');

// Count all projects
const totalProjects = await prisma.$queryRaw`
  SELECT COUNT(*) as count FROM gantt_v2_projects
`;
console.log(`Total projects in gantt_v2_projects: ${totalProjects[0].count}`);

// Count In Progress projects
const inProgressProjects = await prisma.$queryRaw`
  SELECT COUNT(*) as count FROM gantt_v2_projects WHERE status = 'In Progress'
`;
console.log(`Projects with status 'In Progress': ${inProgressProjects[0].count}`);

// Count all scopes
const totalScopes = await prisma.$queryRaw`
  SELECT COUNT(*) as count FROM gantt_v2_scopes
`;
console.log(`Total scopes in gantt_v2_scopes: ${totalScopes[0].count}`);

// Sample projects
console.log('\nSample projects (first 5):');
const sampleProjects = await prisma.$queryRaw`
  SELECT id, project_name, status FROM gantt_v2_projects LIMIT 5
`;
sampleProjects.forEach((p) => {
  console.log(`  - "${p.project_name}" (status: ${p.status})`);
});

// Check what statuses exist
console.log('\nDistinct statuses in gantt_v2_projects:');
const statuses = await prisma.$queryRaw`
  SELECT DISTINCT status, COUNT(*) as count FROM gantt_v2_projects GROUP BY status ORDER BY count DESC
`;
statuses.forEach((s) => {
  console.log(`  - "${s.status}": ${s.count} projects`);
});

await prisma.$disconnect();

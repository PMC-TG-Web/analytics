import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const prisma = new PrismaClient();

async function run() {
  try {
    const project = await prisma.project.findFirst({
      where: { projectName: { contains: 'Westminster Presbyterian Addition' } },
      select: {
        id: true,
        customer: true,
        projectNumber: true,
        projectName: true,
        status: true,
        hours: true,
      },
    });

    console.log('PROJECT');
    console.log(JSON.stringify(project, null, 2));

    if (!project) return;

    const schedule = await prisma.schedule.findFirst({
      where: { projectId: project.id },
      select: {
        id: true,
        jobKey: true,
        totalHours: true,
        status: true,
        allocationsList: {
          select: { period: true, percent: true, hours: true },
          orderBy: { period: 'asc' },
        },
      },
    });

    console.log('\nSCHEDULE');
    console.log(JSON.stringify(schedule, null, 2));

    const active = await prisma.activeSchedule.findMany({
      where: {
        OR: [
          { jobKey: { contains: project.projectNumber || '' } },
          { jobKey: { contains: '2505-WP' } },
        ],
      },
      select: {
        source: true,
        hours: true,
        date: true,
        scopeOfWork: true,
        foreman: true,
        jobKey: true,
      },
      orderBy: [{ source: 'asc' }, { date: 'asc' }],
    });

    const bySource = active.reduce((map, row) => {
      const key = row.source || 'null';
      map[key] = (map[key] || 0) + Number(row.hours || 0);
      return map;
    }, {});

    console.log('\nACTIVE_COUNT', active.length);
    console.log('ACTIVE_HOURS_BY_SOURCE', bySource);
    console.log('ACTIVE_ROWS');
    console.log(JSON.stringify(active, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

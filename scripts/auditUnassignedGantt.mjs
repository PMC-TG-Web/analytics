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
    const rows = await prisma.activeSchedule.findMany({
      where: {
        source: 'gantt',
        OR: [{ foreman: null }, { foreman: '' }],
      },
      select: {
        jobKey: true,
        scopeOfWork: true,
        date: true,
        hours: true,
      },
      orderBy: [{ jobKey: 'asc' }, { scopeOfWork: 'asc' }, { date: 'asc' }],
    });

    const groups = new Map();
    for (const row of rows) {
      const scope = row.scopeOfWork || 'Unscoped';
      const key = `${row.jobKey}|||${scope}`;
      if (!groups.has(key)) {
        groups.set(key, {
          jobKey: row.jobKey,
          scopeOfWork: scope,
          rows: 0,
          totalHours: 0,
          startDate: row.date,
          endDate: row.date,
        });
      }
      const group = groups.get(key);
      group.rows += 1;
      group.totalHours += Number(row.hours || 0);
      if (row.date < group.startDate) group.startDate = row.date;
      if (row.date > group.endDate) group.endDate = row.date;
    }

    const sorted = Array.from(groups.values()).sort((a, b) => b.totalHours - a.totalHours);

    console.log('UNASSIGNED_GANTT_GROUPS', sorted.length);
    console.log('UNASSIGNED_GANTT_ROWS', rows.length);
    console.log('TOP_100');
    sorted.slice(0, 100).forEach((group, index) => {
      console.log(
        `${index + 1}. ${group.jobKey} || ${group.scopeOfWork} || rows=${group.rows} || hours=${group.totalHours.toFixed(1)} || ${group.startDate}..${group.endDate}`
      );
    });
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

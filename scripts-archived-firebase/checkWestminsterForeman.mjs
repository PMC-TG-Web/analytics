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
      where: { jobKey: { contains: '2505-WP' } },
      select: {
        jobKey: true,
        scopeOfWork: true,
        date: true,
        hours: true,
        foreman: true,
        source: true,
        lastModified: true,
      },
      orderBy: { lastModified: 'desc' },
    });

    console.log(JSON.stringify(rows, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

run();

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type ConcreteOrderRow = {
  id: string;
  job_key: string;
  project_name: string;
  concrete_company: string;
  date: string;
  time: string;
  total_yards: number;
  created_at: Date;
};

async function ensureConcreteOrdersTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS concrete_orders (
      id TEXT PRIMARY KEY,
      job_key TEXT NOT NULL,
      project_name TEXT NOT NULL,
      concrete_company TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      total_yards DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function toResponseShape(row: ConcreteOrderRow) {
  return {
    id: row.id,
    jobKey: row.job_key,
    projectName: row.project_name,
    concreteCompany: row.concrete_company,
    date: row.date,
    time: row.time,
    totalYards: Number(row.total_yards || 0),
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    await ensureConcreteOrdersTable();

    const startDate = request.nextUrl.searchParams.get('startDate') || '';
    const endDate = request.nextUrl.searchParams.get('endDate') || '';
    const beforeTime = request.nextUrl.searchParams.get('beforeTime') || '';

    const rows = await prisma.$queryRaw<ConcreteOrderRow[]>`
      SELECT id, job_key, project_name, concrete_company, date, time, total_yards, created_at
      FROM concrete_orders
      ORDER BY date ASC, time ASC, created_at ASC
    `;

    const filtered = rows.filter((row) => {
      if (startDate && row.date < startDate) return false;
      if (endDate && row.date > endDate) return false;
      if (beforeTime && row.time >= beforeTime) return false;
      return true;
    });

    return NextResponse.json({
      success: true,
      data: filtered.map(toResponseShape),
    });
  } catch (error) {
    console.error('Failed to fetch concrete orders:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch concrete orders' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureConcreteOrdersTable();

    const body = await request.json();
    const jobKey = (body?.jobKey || '').trim();
    const projectName = (body?.projectName || '').trim();
    const concreteCompany = (body?.concreteCompany || '').trim();
    const date = (body?.date || '').trim();
    const time = (body?.time || '').trim();
    const totalYards = Number(body?.totalYards || 0);

    if (!jobKey || !projectName || !concreteCompany || !date || !time || !Number.isFinite(totalYards) || totalYards <= 0) {
      return NextResponse.json(
        { success: false, error: 'jobKey, projectName, concreteCompany, date, time, and totalYards are required' },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();

    await prisma.$executeRaw`
      INSERT INTO concrete_orders (id, job_key, project_name, concrete_company, date, time, total_yards)
      VALUES (${id}, ${jobKey}, ${projectName}, ${concreteCompany}, ${date}, ${time}, ${totalYards})
    `;

    return NextResponse.json({
      success: true,
      data: {
        id,
        jobKey,
        projectName,
        concreteCompany,
        date,
        time,
        totalYards,
      },
    });
  } catch (error) {
    console.error('Failed to save concrete order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save concrete order' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await ensureConcreteOrdersTable();

    const body = await request.json();
    const id = (body?.id || '').trim();

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    await prisma.$executeRaw`
      DELETE FROM concrete_orders
      WHERE id = ${id}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete concrete order:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete concrete order' },
      { status: 500 }
    );
  }
}

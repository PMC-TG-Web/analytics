import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export type KPIEntry = {
  id: string;
  entryKey: string;
  year: string;
  month: number;
  monthName: string;
  estimates?: number | null;
  scheduledSales?: number | null;
  bidSubmittedSales?: number | null;
  subs?: number | null;
  scheduledHours?: number | null;
  bidSubmittedHours?: number | null;
  grossProfit?: number | null;
  cost?: number | null;
  leadtimes?: number | null;
  createdAt: Date;
  updatedAt: Date;
  createdByEmail?: string | null;
  updatedByEmail?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    console.log('[KPI POST] Received request');
    const body = await request.json();
    console.log('[KPI POST] Body parsed:', { year: body.year, month: body.month, fields: Object.keys(body) });
    
    const { 
      year, 
      month, 
      monthName, 
      estimates, 
      scheduledSales, 
      bidSubmittedSales, 
      subs, 
      scheduledHours, 
      bidSubmittedHours, 
      grossProfit, 
      cost, 
      leadtimes,
      createdByEmail,
      updatedByEmail 
    } = body;

    if (!year || !month) {
      console.log('[KPI POST] Missing required fields: year or month');
      return NextResponse.json({ error: 'year and month are required' }, { status: 400 });
    }

    const entryKey = `${year}-${String(month).padStart(2, '0')}`;
    console.log('[KPI POST] Creating entry with key:', entryKey);
    
    const kpiEntry = await prisma.kPIEntry.upsert({
      where: { entryKey },
      update: {
        monthName: monthName || '',
        estimates: estimates !== undefined && estimates !== null ? Number(estimates) : undefined,
        scheduledSales: scheduledSales !== undefined && scheduledSales !== null ? Number(scheduledSales) : undefined,
        bidSubmittedSales: bidSubmittedSales !== undefined && bidSubmittedSales !== null ? Number(bidSubmittedSales) : undefined,
        subs: subs !== undefined && subs !== null ? Number(subs) : undefined,
        scheduledHours: scheduledHours !== undefined && scheduledHours !== null ? Number(scheduledHours) : undefined,
        bidSubmittedHours: bidSubmittedHours !== undefined && bidSubmittedHours !== null ? Number(bidSubmittedHours) : undefined,
        grossProfit: grossProfit !== undefined && grossProfit !== null ? Number(grossProfit) : undefined,
        cost: cost !== undefined && cost !== null ? Number(cost) : undefined,
        leadtimes: leadtimes !== undefined && leadtimes !== null ? Number(leadtimes) : undefined,
        updatedAt: new Date(),
        updatedByEmail: updatedByEmail || undefined,
      },
      create: {
        entryKey,
        year,
        month: Number(month),
        monthName: monthName || '',
        estimates: estimates !== undefined && estimates !== null ? Number(estimates) : null,
        scheduledSales: scheduledSales !== undefined && scheduledSales !== null ? Number(scheduledSales) : null,
        bidSubmittedSales: bidSubmittedSales !== undefined && bidSubmittedSales !== null ? Number(bidSubmittedSales) : null,
        subs: subs !== undefined && subs !== null ? Number(subs) : null,
        scheduledHours: scheduledHours !== undefined && scheduledHours !== null ? Number(scheduledHours) : null,
        bidSubmittedHours: bidSubmittedHours !== undefined && bidSubmittedHours !== null ? Number(bidSubmittedHours) : null,
        grossProfit: grossProfit !== undefined && grossProfit !== null ? Number(grossProfit) : null,
        cost: cost !== undefined && cost !== null ? Number(cost) : null,
        leadtimes: leadtimes !== undefined && leadtimes !== null ? Number(leadtimes) : null,
        createdByEmail: createdByEmail || null,
        updatedByEmail: updatedByEmail || null,
      },
    });

    console.log('[KPI POST] ✓ Saved to Vercel Postgres:', entryKey);

    // Log the change to AuditLog
    try {
      await prisma.auditLog.create({
        data: {
          action: 'UPDATE',
          entity: 'KPIEntry',
          entityId: kpiEntry.id,
          userEmail: updatedByEmail || 'system',
          changes: {
            updated: { year, month, ...body },
          },
        },
      });
    } catch (auditError) {
      console.log('[KPI POST] Warning: Could not create audit log:', auditError);
    }

    return NextResponse.json({ success: true, id: kpiEntry.id, entryKey });
  } catch (error) {
    console.error('[KPI POST] Error:', error);
    return NextResponse.json({ error: 'Failed to save KPI: ' + (error as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');

    console.log('[KPI GET] Retrieving KPI data', year ? `for year ${year}` : '');

    const kpis = await prisma.kPIEntry.findMany({
      where: year ? { year } : {},
      orderBy: [{ year: 'asc' }, { month: 'asc' }],
    });

    console.log('[KPI GET] ✓ Retrieved', kpis.length, 'entries');
    return NextResponse.json({ data: kpis });
  } catch (error) {
    console.error('[KPI GET] Error:', error);
    return NextResponse.json({ data: [] }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, entryKey } = body;

    if (!id && !entryKey) {
      return NextResponse.json({ error: 'id or entryKey is required' }, { status: 400 });
    }

    const where = id ? { id } : { entryKey };

    const deleted = await prisma.kPIEntry.delete({ where });

    console.log('[KPI DELETE] ✓ Deleted:', deleted.entryKey);

    // Log the deletion
    try {
      await prisma.auditLog.create({
        data: {
          action: 'DELETE',
          entity: 'KPIEntry',
          entityId: deleted.id,
          userEmail: 'system',
          changes: { deleted },
        },
      });
    } catch (auditError) {
      console.log('[KPI DELETE] Warning: Could not create audit log:', auditError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[KPI DELETE] Error:', error);
    return NextResponse.json({ error: 'Failed to delete KPI' }, { status: 500 });
  }
}


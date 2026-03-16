import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type StoredTimeOffPayload = {
  startDate?: string;
  endDate?: string;
  type?: string;
  hours?: number;
  dates?: string[];
};

const DEFAULT_TYPE = 'Vacation';
const DEFAULT_HOURS = 10;

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function expandDateRange(startDate: string, endDate: string): string[] {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(toDateKey(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function normalizeStoredTimeOff(row: {
  id: string;
  employeeId: string;
  employeeName: string | null;
  dates: unknown;
  reason: string | null;
  status: string;
}) {
  const payload = (row.dates && typeof row.dates === 'object' && !Array.isArray(row.dates)
    ? (row.dates as StoredTimeOffPayload)
    : null);

  const explicitDates = Array.isArray(payload?.dates)
    ? payload?.dates.filter((d): d is string => typeof d === 'string' && d.length > 0)
    : Array.isArray(row.dates)
      ? (row.dates as unknown[]).filter((d): d is string => typeof d === 'string' && d.length > 0)
      : [];

  const startDate =
    (typeof payload?.startDate === 'string' && payload.startDate) ||
    explicitDates[0] ||
    '';
  const endDate =
    (typeof payload?.endDate === 'string' && payload.endDate) ||
    explicitDates[explicitDates.length - 1] ||
    startDate;

  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    startDate,
    endDate,
    type: (payload?.type || DEFAULT_TYPE) as
      | 'Vacation'
      | 'Sick'
      | 'Personal'
      | 'Other'
      | 'Company timeoff',
    hours: Number(payload?.hours) > 0 ? Number(payload?.hours) : DEFAULT_HOURS,
    dates: explicitDates.length > 0 ? explicitDates : (startDate && endDate ? expandDateRange(startDate, endDate) : []),
    reason: row.reason || '',
    status: row.status || 'approved',
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employeeId');

    const records = await prisma.timeOffRequest.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
      },
      select: {
        id: true,
        employeeId: true,
        employeeName: true,
        dates: true,
        reason: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      data: records.map(normalizeStoredTimeOff),
    });
  } catch (error) {
    console.error('Failed to fetch time off requests:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch time off requests' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const employeeId = String(body?.employeeId || '').trim();
    const startDate = String(body?.startDate || '').trim();
    const endDate = String(body?.endDate || '').trim();
    const type = String(body?.type || DEFAULT_TYPE).trim() || DEFAULT_TYPE;
    const reason = String(body?.reason || '').trim() || null;
    const hours = Number(body?.hours);
    const normalizedHours = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_HOURS;

    if (!employeeId || !startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'employeeId, startDate, and endDate are required' },
        { status: 400 }
      );
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { firstName: true, lastName: true },
    });

    const employeeName = employee
      ? `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || null
      : null;

    const expandedDates = expandDateRange(startDate, endDate);
    if (expandedDates.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid startDate/endDate range' },
        { status: 400 }
      );
    }

    const record = await prisma.timeOffRequest.create({
      data: {
        employeeId,
        employeeName,
        dates: {
          startDate,
          endDate,
          type,
          hours: normalizedHours,
          dates: expandedDates,
        },
        reason,
        status: 'approved',
      },
      select: {
        id: true,
        employeeId: true,
        employeeName: true,
        dates: true,
        reason: true,
        status: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: normalizeStoredTimeOff(record),
    });
  } catch (error) {
    console.error('Failed to create time off request:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create time off request' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    await prisma.timeOffRequest.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete time off request:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete time off request' },
      { status: 500 }
    );
  }
}

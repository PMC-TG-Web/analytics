import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type HomeSnapshotPayload = {
  announcements: Array<Record<string, unknown>>;
  employees: Array<Record<string, unknown>>;
  activeSchedules: Array<Record<string, unknown>>;
  timeOff: Array<Record<string, unknown>>;
  concreteOrders: Array<Record<string, unknown>>;
  pmAssignments: Array<Record<string, unknown>>;
  crewTemplates: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  scopes: Array<Record<string, unknown>>;
};

function emptyPayload(): HomeSnapshotPayload {
  return {
    announcements: [],
    employees: [],
    activeSchedules: [],
    timeOff: [],
    concreteOrders: [],
    pmAssignments: [],
    crewTemplates: [],
    projects: [],
    scopes: [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const startDate = String(request.nextUrl.searchParams.get('startDate') || '').trim();
    const endDate = String(request.nextUrl.searchParams.get('endDate') || '').trim();
    const canReadEmployees =
      String(request.nextUrl.searchParams.get('canReadEmployees') || '').trim().toLowerCase() === 'true';

    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    const cookie = request.headers.get('cookie') || '';
    const forwardedHeaders = cookie ? { Cookie: cookie } : undefined;

    const fetchArray = async (path: string): Promise<Array<Record<string, unknown>>> => {
      try {
        const response = await fetch(new URL(path, request.url), {
          method: 'GET',
          cache: 'no-store',
          headers: forwardedHeaders,
        });

        const payload = await response.json().catch(() => ({}));
        return Array.isArray((payload as { data?: unknown[] })?.data)
          ? ((payload as { data?: unknown[] }).data as Array<Record<string, unknown>>)
          : [];
      } catch {
        return [];
      }
    };

    const [employees, activeSchedules, timeOff, concreteOrders, pmAssignments, crewTemplates, projects, scopes] =
      await Promise.all([
        canReadEmployees
          ? fetchArray('/api/employees?isActive=true&page=1&pageSize=500')
          : Promise.resolve([]),
        fetchArray(`/api/short-term-schedule?action=active-schedule&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
        fetchArray('/api/time-off'),
        fetchArray(`/api/concrete-orders?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
        fetchArray('/api/long-term-schedule/pm-assignments'),
        fetchArray('/api/crew-templates'),
        fetchArray('/api/projects?page=1&pageSize=500&summary=true'),
        fetchArray('/api/project-scopes'),
      ]);

    return NextResponse.json(
      {
        success: true,
        data: {
          ...emptyPayload(),
          employees,
          activeSchedules,
          timeOff,
          concreteOrders,
          pmAssignments,
          crewTemplates,
          projects,
          scopes,
        },
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  } catch (error) {
    console.error('Failed to fetch home snapshot:', error);
    return NextResponse.json({ success: true, data: emptyPayload() });
  }
}

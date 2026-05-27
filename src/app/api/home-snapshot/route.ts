import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type ViewerProfile = {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
};

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
  viewerEmployee: ViewerProfile | null;
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
    viewerEmployee: null,
  };
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function parseNameParts(name: string) {
  const normalized = String(name || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const parts = normalized.split(' ');
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

export async function GET(request: NextRequest) {
  try {
    const startDate = String(request.nextUrl.searchParams.get('startDate') || '').trim();
    const endDate = String(request.nextUrl.searchParams.get('endDate') || '').trim();

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
        fetchArray('/api/employees?isActive=true&page=1&pageSize=500'),
        fetchArray(`/api/short-term-schedule?action=active-schedule&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
        fetchArray('/api/time-off'),
        fetchArray(`/api/concrete-orders?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`),
        fetchArray('/api/long-term-schedule/pm-assignments'),
        fetchArray('/api/crew-templates'),
        fetchArray('/api/projects?page=1&pageSize=500&summary=true'),
        fetchArray('/api/project-scopes'),
      ]);

    let viewerEmployee: ViewerProfile | null = null;
    try {
      const authResponse = await fetch(new URL('/api/auth/me', request.url), {
        method: 'GET',
        cache: 'no-store',
        headers: forwardedHeaders,
      });

      if (authResponse.ok) {
        const authPayload = (await authResponse.json().catch(() => ({}))) as {
          email?: string;
          name?: string;
        };
        const userEmail = normalizeEmail(authPayload.email);

        if (userEmail) {
          const listMatch = employees.find((row) => normalizeEmail((row as { email?: unknown }).email) === userEmail);
          if (listMatch) {
            const row = listMatch as {
              id?: unknown;
              firstName?: unknown;
              lastName?: unknown;
              jobTitle?: unknown;
              email?: unknown;
            };
            viewerEmployee = {
              id: String(row.id || ''),
              firstName: String(row.firstName || ''),
              lastName: String(row.lastName || ''),
              jobTitle: row.jobTitle ? String(row.jobTitle) : null,
              email: row.email ? String(row.email) : userEmail,
            };
          } else {
            const dbMatch = await prisma.employee.findFirst({
              where: { email: userEmail },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                jobTitle: true,
                email: true,
              },
            });

            if (dbMatch) {
              viewerEmployee = {
                id: dbMatch.id,
                firstName: dbMatch.firstName,
                lastName: dbMatch.lastName,
                jobTitle: dbMatch.jobTitle || null,
                email: dbMatch.email || userEmail,
              };
            } else {
              const parts = parseNameParts(String(authPayload.name || ''));
              viewerEmployee = {
                id: '',
                firstName: parts.firstName,
                lastName: parts.lastName,
                jobTitle: null,
                email: userEmail,
              };
            }
          }
        }
      }
    } catch {
      viewerEmployee = null;
    }

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
          viewerEmployee,
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

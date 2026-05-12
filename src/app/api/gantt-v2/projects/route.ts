import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import {
  consolidateDuplicateGanttV2Projects,
  consolidateDuplicateGanttV2Scopes,
  ensureGanttV2Schema,
  getGanttV2ProjectsWithScopes,
  syncGanttV2ProjectsFromCanonicalProjects,
} from '@/lib/ganttV2Db';
import { getErrorMessage, shouldFallbackToEmptyRead, withDatabaseRetry } from '@/lib/dbResilience';
import { getCachedValue, setCachedValue, invalidateCacheByPrefix } from '@/lib/serverReadCache';

export const dynamic = 'force-dynamic';

const GANTT_PROJECTS_CACHE_KEY = 'gantt-v2:projects';
const GANTT_PROJECTS_TTL_MS = 60_000; // 60 seconds
const GANTT_PROJECTS_MAINTENANCE_TTL_MS = 60_000;
let lastGanttProjectsMaintenanceAt = 0;
let ganttProjectsMaintenancePromise: Promise<void> | null = null;

const maybeRunGanttProjectsMaintenanceInBackground = () => {
  const now = Date.now();
  if (now - lastGanttProjectsMaintenanceAt <= GANTT_PROJECTS_MAINTENANCE_TTL_MS) return;
  if (ganttProjectsMaintenancePromise) return;

  lastGanttProjectsMaintenanceAt = now;
  ganttProjectsMaintenancePromise = (async () => {
    try {
      await withDatabaseRetry(async () => {
        await syncGanttV2ProjectsFromCanonicalProjects();
        await consolidateDuplicateGanttV2Projects();
        await consolidateDuplicateGanttV2Scopes();
      });
    } catch (error) {
      console.warn('[gantt-v2/projects] Background maintenance failed:', getErrorMessage(error));
      lastGanttProjectsMaintenanceAt = 0;
    } finally {
      ganttProjectsMaintenancePromise = null;
    }
  })();
};

export async function GET() {
  try {
    const cookieStore = await cookies();
    const procoreAccessToken = String(cookieStore.get('procore_access_token')?.value || '').trim() || null;
    const procoreCompanyId = String(cookieStore.get('procore_company_id')?.value || '').trim() || null;

    maybeRunGanttProjectsMaintenanceInBackground();

    const cached = getCachedValue<unknown[]>(GANTT_PROJECTS_CACHE_KEY);
    if (cached) {
      return NextResponse.json({ success: true, data: cached, cached: true });
    }

    const projects = await withDatabaseRetry(() =>
      getGanttV2ProjectsWithScopes({ procoreAccessToken, procoreCompanyId, includeEstimateHours: false })
    );
    setCachedValue(GANTT_PROJECTS_CACHE_KEY, projects, GANTT_PROJECTS_TTL_MS);
    return NextResponse.json({ success: true, data: projects, cached: false });
  } catch (error) {
    if (shouldFallbackToEmptyRead(error)) {
      return NextResponse.json({ success: true, data: [] });
    }
    return NextResponse.json(
      { success: false, error: `Failed to load Gantt V2 projects: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await withDatabaseRetry(() => ensureGanttV2Schema());
    const body = await request.json();

    const projectName = (body?.projectName || '').toString().trim();
    const customer = (body?.customer || '').toString().trim() || null;
    const projectNumber = (body?.projectNumber || '').toString().trim() || null;
    const status = (body?.status || '').toString().trim() || null;
    const jobKey = `${customer || ''}~${projectNumber || ''}~${projectName}`;

    if (!projectName) {
      return NextResponse.json({ success: false, error: 'projectName is required' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO gantt_v2_projects (id, job_key, project_name, customer, project_number, status, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7);`,
      id, jobKey, projectName, customer, projectNumber, status, 'app'
    );

    invalidateCacheByPrefix('gantt-v2:');
    return NextResponse.json({ success: true, data: { id, jobKey, projectName, customer, projectNumber, status, source: 'app' } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to create Gantt V2 project: ${String(error)}` },
      { status: 500 }
    );
  }
}

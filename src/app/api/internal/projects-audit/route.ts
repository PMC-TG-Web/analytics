import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type ProjectRow = {
  id: string;
  job_key: string | null;
  customer: string | null;
  project_number: string | null;
  project_name: string;
  scope_count: number;
};

function normalize(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await prisma.$queryRaw<ProjectRow[]>`
      SELECT
        p.id,
        p.job_key,
        p.customer,
        p.project_number,
        p.project_name,
        CAST((SELECT COUNT(*) FROM gantt_v2_scopes WHERE project_id = p.id) AS integer) AS scope_count
      FROM gantt_v2_projects p
      ORDER BY p.customer NULLS LAST, p.project_name NULLS LAST, p.project_number NULLS LAST, p.created_at DESC
    `;

    const grouped = new Map<string, ProjectRow[]>();
    for (const row of rows) {
      const key = `${normalize(row.customer)}||${normalize(row.project_name)}`;
      const bucket = grouped.get(key) || [];
      bucket.push(row);
      grouped.set(key, bucket);
    }

    const duplicates = Array.from(grouped.entries())
      .filter(([, entries]) => entries.length > 1)
      .map(([key, entries]) => {
        const [customerKey, projectNameKey] = key.split('||');
        return {
          customer: entries[0]?.customer || null,
          projectName: entries[0]?.project_name || null,
          normalizedCustomer: customerKey,
          normalizedProjectName: projectNameKey,
          projectCount: entries.length,
          totalScopes: entries.reduce((sum, entry) => sum + Number(entry.scope_count || 0), 0),
          projects: entries.map((entry) => ({
            id: entry.id,
            jobKey: entry.job_key,
            projectNumber: entry.project_number,
            scopeCount: Number(entry.scope_count || 0),
          })),
        };
      })
      .sort((a, b) => b.projectCount - a.projectCount || b.totalScopes - a.totalScopes);

    return NextResponse.json({
      ok: true,
      totalProjects: rows.length,
      duplicateGroups: duplicates.length,
      duplicates,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Projects audit failed:', error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
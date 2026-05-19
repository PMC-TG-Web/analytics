import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Diagnostic endpoint — returns ProjectScope data quality stats.
// Protected by CRON_SECRET header.
// Call: GET /api/internal/scope-diagnostics
//   -H "Authorization: Bearer $CRON_SECRET"

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [total, linked, unlinked, unlinkedWithTasks, dupes, orphanedSamples] = await Promise.all([
      prisma.$queryRaw<{ cnt: bigint }[]>`SELECT COUNT(*) as cnt FROM "ProjectScope"`,
      prisma.$queryRaw<{ cnt: bigint }[]>`SELECT COUNT(*) as cnt FROM "ProjectScope" WHERE "ganttV2ScopeId" IS NOT NULL`,
      prisma.$queryRaw<{ cnt: bigint }[]>`SELECT COUNT(*) as cnt FROM "ProjectScope" WHERE "ganttV2ScopeId" IS NULL`,
      prisma.$queryRaw<{ cnt: bigint }[]>`
        SELECT COUNT(*) as cnt FROM "ProjectScope"
        WHERE "ganttV2ScopeId" IS NULL
          AND tasks IS NOT NULL
          AND tasks::text != 'null'
          AND jsonb_typeof(tasks) = 'array'
          AND jsonb_array_length(tasks) > 0
      `,
      prisma.$queryRaw<{ jobKey: string; title: string; cnt: bigint }[]>`
        SELECT "jobKey", title, COUNT(*) as cnt
        FROM "ProjectScope"
        GROUP BY "jobKey", title
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 30
      `,
      prisma.$queryRaw<{ id: string; jobKey: string; title: string; task_count: bigint }[]>`
        SELECT id, "jobKey", title,
               COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(tasks) = 'array' THEN tasks ELSE '[]'::jsonb END), 0) as task_count
        FROM "ProjectScope"
        WHERE "ganttV2ScopeId" IS NULL
          AND tasks IS NOT NULL
          AND tasks::text != 'null'
          AND jsonb_typeof(tasks) = 'array'
          AND jsonb_array_length(tasks) > 0
        ORDER BY "jobKey", title
        LIMIT 50
      `,
    ]);

    return NextResponse.json({
      ok: true,
      totalRows: Number(total[0].cnt),
      linkedRows: Number(linked[0].cnt),
      unlinkedRows: Number(unlinked[0].cnt),
      unlinkedWithTasks: Number(unlinkedWithTasks[0].cnt),
      duplicateTitleGroups: dupes.length,
      duplicates: dupes.map((d) => ({
        jobKey: d.jobKey,
        title: d.title,
        count: Number(d.cnt),
      })),
      unlinkedSamplesWithTasks: orphanedSamples.map((s) => ({
        id: s.id,
        jobKey: s.jobKey,
        title: s.title,
        taskCount: Number(s.task_count),
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Scope diagnostics failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

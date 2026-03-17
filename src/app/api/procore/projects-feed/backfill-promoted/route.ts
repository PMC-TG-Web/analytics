import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureProcoreProjectFeedTable } from '@/lib/procoreProjectFeed';

export const dynamic = 'force-dynamic';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = readString(value);
    if (str && str.trim()) return str;
  }
  return null;
}

function readText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
}

function normalizeTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeRowId(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

export async function POST(request: Request) {
  try {
    await ensureProcoreProjectFeedTable();

    const body = await request.json().catch(() => ({}));
    const companyId = String(body?.companyId || '').trim();
    const syncSource = String(body?.syncSource || '').trim();
    const dryRun = body?.dryRun === true;
    const limit = Math.min(5000, Math.max(1, Number.parseInt(String(body?.limit || '5000'), 10) || 5000));

    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (companyId) {
      conditions.push(`company_id = $${p++}`);
      params.push(companyId);
    }
    if (syncSource) {
      conditions.push(`sync_source = $${p++}`);
      params.push(syncSource);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: unknown;
        sync_source: string;
        payload: unknown;
        office_name: string | null;
        city: string | null;
        state_code: string | null;
        country_code: string | null;
        stage_name: string | null;
        due_date: Date | null;
        created_on: Date | null;
        source_id: string | null;
        source_name: string | null;
        source_created_by: string | null;
        source_created_at: Date | null;
      }>
    >(
      `
        SELECT id, sync_source, payload, office_name, city, state_code, country_code, stage_name, due_date, created_on, source_id, source_name, source_created_by, source_created_at
        FROM procore_project_feed
        ${whereClause}
        ORDER BY id ASC
        LIMIT $${p++}
      `,
      ...params,
      limit
    );

    const stats = {
      scanned: rows.length,
      updated: 0,
      unchanged: 0,
      skippedNoPayload: 0,
      errors: 0,
      dryRun,
    };

    const failures: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      try {
        const payload = asObject(row.payload);
        if (!payload) {
          stats.skippedNoPayload += 1;
          continue;
        }

        const officeName = firstString(asObject(payload.office)?.name, payload.office_name);
        const city = firstString(payload.city, asObject(payload.address)?.city);
        const stateCode = firstString(
          payload.state_code,
          payload.state,
          asObject(payload.address)?.state_code,
          asObject(payload.address)?.state
        );
        const countryCode = firstString(
          payload.country_code,
          payload.country,
          asObject(payload.address)?.country_code,
          asObject(payload.address)?.country
        );
        const stageName = firstString(asObject(payload.project_stage)?.name);
        const dueDate = normalizeTimestamp(firstString(payload.due_date));
        const createdOn = normalizeTimestamp(firstString(payload.created_at, payload.created_on));
        const sourceId = firstText(payload.id, payload.project_id);
        const sourceName = firstString(payload.name, payload.display_name);
        const sourceCreatedBy = firstText(
          asObject(payload.created_by)?.name,
          asObject(payload.created_by)?.email,
          asObject(payload.created_by)?.id,
          payload.created_by
        );
        const sourceCreatedAt = normalizeTimestamp(firstString(payload.created_at, payload.created_on));

        const currentDueDate = row.due_date ? row.due_date.toISOString() : null;
        const currentCreatedOn = row.created_on ? row.created_on.toISOString() : null;
        const currentSourceCreatedAt = row.source_created_at ? row.source_created_at.toISOString() : null;

        const changed =
          row.office_name !== officeName ||
          row.city !== city ||
          row.state_code !== stateCode ||
          row.country_code !== countryCode ||
          row.stage_name !== stageName ||
          currentDueDate !== dueDate ||
          currentCreatedOn !== createdOn ||
          row.source_id !== sourceId ||
          row.source_name !== sourceName ||
          row.source_created_by !== sourceCreatedBy ||
          currentSourceCreatedAt !== sourceCreatedAt;

        if (!changed) {
          stats.unchanged += 1;
          continue;
        }

        if (!dryRun) {
          await prisma.$executeRawUnsafe(
            `
              UPDATE procore_project_feed
              SET
                office_name = $1,
                city = $2,
                state_code = $3,
                country_code = $4,
                stage_name = $5,
                due_date = $6::timestamptz,
                created_on = $7::timestamptz,
                source_id = $8,
                source_name = $9,
                source_created_by = $10,
                source_created_at = $11::timestamptz,
                updated_at = NOW()
              WHERE id = $12::bigint
            `,
            officeName,
            city,
            stateCode,
            countryCode,
            stageName,
            dueDate,
            createdOn,
            sourceId,
            sourceName,
            sourceCreatedBy,
            sourceCreatedAt,
            normalizeRowId(row.id)
          );
        }

        stats.updated += 1;
      } catch (error: unknown) {
        stats.errors += 1;
        failures.push({
          id: normalizeRowId(row.id),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: dryRun
        ? 'Backfill dry run complete (no DB updates made).'
        : 'Backfill complete (promoted columns refreshed from payload).',
      data: {
        filters: {
          companyId: companyId || null,
          syncSource: syncSource || null,
          limit,
        },
        stats,
        failures: failures.slice(0, 50),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to backfill promoted feed columns: ${message}` },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const body = JSON.stringify({
    companyId: searchParams.get('companyId') || undefined,
    syncSource: searchParams.get('syncSource') || undefined,
    limit: searchParams.get('limit') || undefined,
    dryRun: String(searchParams.get('dryRun') || '').toLowerCase() === 'true',
  });

  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  );
}

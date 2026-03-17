import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureProcoreProjectFeedTable } from '@/lib/procoreProjectFeed';

export const dynamic = 'force-dynamic';

function normalizeId(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

export async function GET(request: NextRequest) {
  try {
    await ensureProcoreProjectFeedTable();

    const searchParams = request.nextUrl.searchParams;
    const companyId = String(searchParams.get('companyId') || '').trim();
    const syncSource = String(searchParams.get('syncSource') || '').trim();
    const status = String(searchParams.get('status') || '').trim();
    const officeName = String(searchParams.get('officeName') || '').trim();
    const city = String(searchParams.get('city') || '').trim();
    const stateCode = String(searchParams.get('stateCode') || '').trim();
    const sourceCreatedBy = String(searchParams.get('sourceCreatedBy') || '').trim();
    const search = String(searchParams.get('search') || '').trim();
    const unmatchedOnly = String(searchParams.get('unmatchedOnly') || '').toLowerCase() === 'true';
    const includeDeleted = String(searchParams.get('includeDeleted') || '').toLowerCase() === 'true';

    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '200', 10) || 200;
    const pageSize = Math.min(1000, Math.max(1, requestedPageSize));
    const offset = (page - 1) * pageSize;

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
    if (status) {
      conditions.push(`status = $${p++}`);
      params.push(status);
    }
    if (officeName) {
      conditions.push(`office_name = $${p++}`);
      params.push(officeName);
    }
    if (city) {
      conditions.push(`city = $${p++}`);
      params.push(city);
    }
    if (stateCode) {
      conditions.push(`state_code = $${p++}`);
      params.push(stateCode);
    }
    if (sourceCreatedBy) {
      conditions.push(`source_created_by ILIKE $${p++}`);
      params.push(`%${sourceCreatedBy}%`);
    }
    if (search) {
      conditions.push(`(project_name ILIKE $${p} OR COALESCE(project_number, '') ILIKE $${p} OR COALESCE(customer, '') ILIKE $${p})`);
      params.push(`%${search}%`);
      p += 1;
    }
    if (unmatchedOnly) {
      conditions.push('linked_project_id IS NULL');
    }
    if (!includeDeleted) {
      conditions.push('soft_deleted = FALSE');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await prisma.$queryRawUnsafe<Array<{ total: bigint | number }>>(
      `SELECT COUNT(*)::bigint AS total FROM procore_project_feed ${whereClause}`,
      ...params
    );

    const totalRaw = countRows[0]?.total ?? 0;
    const total = typeof totalRaw === 'bigint' ? Number(totalRaw) : Number(totalRaw || 0);

    const rows = await prisma.$queryRawUnsafe<Array<{
      id: unknown;
      company_id: string;
      sync_source: string;
      external_id: string;
      procore_id: string | null;
      project_number: string | null;
      project_name: string;
      status: string | null;
      customer: string | null;
      customer_source: string | null;
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
      last_modified_at: Date | null;
      estimated_value: number | null;
      linked_project_id: string | null;
      match_confidence: string | null;
      matched_at: Date | null;
      soft_deleted: boolean;
      payload: unknown;
      synced_at: Date;
      created_at: Date;
      updated_at: Date;
    }>>(
      `
        SELECT
          id,
          company_id,
          sync_source,
          external_id,
          procore_id,
          project_number,
          project_name,
          status,
          customer,
          customer_source,
          office_name,
          city,
          state_code,
          country_code,
          stage_name,
          due_date,
          created_on,
          source_id,
          source_name,
          source_created_by,
          source_created_at,
          last_modified_at,
          estimated_value,
          linked_project_id,
          match_confidence,
          matched_at,
          soft_deleted,
          payload,
          synced_at,
          created_at,
          updated_at
        FROM procore_project_feed
        ${whereClause}
        ORDER BY synced_at DESC
        LIMIT $${p++}
        OFFSET $${p++}
      `,
      ...params,
      pageSize,
      offset
    );

    return NextResponse.json({
      success: true,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      data: rows.map((row) => ({
        id: normalizeId(row.id),
        companyId: row.company_id,
        syncSource: row.sync_source,
        externalId: row.external_id,
        procoreId: row.procore_id,
        projectNumber: row.project_number,
        projectName: row.project_name,
        status: row.status,
        customer: row.customer,
        customerSource: row.customer_source,
        officeName: row.office_name,
        city: row.city,
        stateCode: row.state_code,
        countryCode: row.country_code,
        stageName: row.stage_name,
        dueDate: row.due_date,
        createdOn: row.created_on,
        sourceId: row.source_id,
        sourceName: row.source_name,
        sourceCreatedBy: row.source_created_by,
        sourceCreatedAt: row.source_created_at,
        lastModifiedAt: row.last_modified_at,
        estimatedValue: row.estimated_value,
        linkedProjectId: row.linked_project_id,
        matchConfidence: row.match_confidence,
        matchedAt: row.matched_at,
        softDeleted: row.soft_deleted,
        payload: row.payload,
        syncedAt: row.synced_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to read Procore projects feed: ${message}` },
      { status: 500 }
    );
  }
}

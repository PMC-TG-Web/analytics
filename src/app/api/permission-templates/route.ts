import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  NAVIGATION_PERMISSION_OPTIONS,
  JOB_TITLE_PERMISSION_TEMPLATES,
  JOB_TITLE_TEMPLATE_CATEGORY,
  JOB_TITLE_TEMPLATE_PREFIX,
  buildJobTitleTemplateConstantName,
  normalizeJobTitleTemplateKey,
} from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TemplatePayload = {
  jobTitle?: unknown;
  permissions?: unknown;
};

function normalizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const allowed = new Set(NAVIGATION_PERMISSION_OPTIONS);
  const deduped = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const permission = raw.trim();
    if (!permission) continue;
    if (!allowed.has(permission)) continue;
    deduped.add(permission);
  }

  return Array.from(deduped).sort((a, b) => a.localeCompare(b));
}

function parseStoredTemplateValue(value: string): { title?: string; permissions: string[] } {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (Array.isArray(parsed)) {
      return { permissions: normalizePermissions(parsed) };
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const rec = parsed as Record<string, unknown>;
      const title = typeof rec.title === 'string' ? rec.title.trim() : undefined;
      return {
        title,
        permissions: normalizePermissions(rec.permissions),
      };
    }
  } catch {
    // Ignore parse errors and fall through to empty template.
  }

  return { permissions: [] };
}

function titleFromConstantName(name: string): string {
  return name.startsWith(JOB_TITLE_TEMPLATE_PREFIX)
    ? name.slice(JOB_TITLE_TEMPLATE_PREFIX.length)
    : name;
}

export async function GET() {
  try {
    const rows = await prisma.estimatingConstant.findMany({
      where: {
        category: JOB_TITLE_TEMPLATE_CATEGORY,
        name: { startsWith: JOB_TITLE_TEMPLATE_PREFIX },
      },
      select: {
        name: true,
        value: true,
      },
      orderBy: { name: 'asc' },
    });

    const templates: Record<string, string[]> = { ...JOB_TITLE_PERMISSION_TEMPLATES };

    for (const row of rows) {
      const key = normalizeJobTitleTemplateKey(titleFromConstantName(row.name));
      if (!key) continue;
      const parsed = parseStoredTemplateValue(row.value);
      templates[key] = parsed.permissions;
    }

    return NextResponse.json({ success: true, data: { templates } });
  } catch (error) {
    console.error('Failed to load permission templates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load permission templates' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as TemplatePayload;
    const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.trim() : '';

    if (!jobTitle) {
      return NextResponse.json(
        { success: false, error: 'jobTitle is required' },
        { status: 400 }
      );
    }

    const permissions = normalizePermissions(body.permissions);
    const constantName = buildJobTitleTemplateConstantName(jobTitle);

    const saved = await prisma.estimatingConstant.upsert({
      where: { name: constantName },
      create: {
        name: constantName,
        value: JSON.stringify({ title: jobTitle, permissions }),
        category: JOB_TITLE_TEMPLATE_CATEGORY,
      },
      update: {
        value: JSON.stringify({ title: jobTitle, permissions }),
        category: JOB_TITLE_TEMPLATE_CATEGORY,
      },
      select: {
        name: true,
        value: true,
        category: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        jobTitle,
        key: normalizeJobTitleTemplateKey(jobTitle),
        permissions,
        record: saved,
      },
    });
  } catch (error) {
    console.error('Failed to save permission template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save permission template' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const jobTitle = request.nextUrl.searchParams.get('jobTitle')?.trim() || '';

    if (!jobTitle) {
      return NextResponse.json(
        { success: false, error: 'jobTitle query parameter is required' },
        { status: 400 }
      );
    }

    const constantName = buildJobTitleTemplateConstantName(jobTitle);

    await prisma.estimatingConstant.deleteMany({
      where: {
        name: constantName,
        category: JOB_TITLE_TEMPLATE_CATEGORY,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        jobTitle,
        key: normalizeJobTitleTemplateKey(jobTitle),
      },
    });
  } catch (error) {
    console.error('Failed to delete permission template:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete permission template' },
      { status: 500 }
    );
  }
}

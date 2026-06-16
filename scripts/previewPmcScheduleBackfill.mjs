import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const COMPANY_ID = '598134325805519';
const prisma = new PrismaClient();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = join(process.cwd(), 'snapshots', 'schema-audit');

function toCsv(rows, columns) {
  const escape = (value) => {
    if (value == null) return '';
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\n');
}

function normalizeProjectNumber(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const [pmcProjects, schedules, ganttProjects] = await Promise.all([
    prisma.pmcProject.findMany({
      select: {
        companyId: true,
        procoreProjectId: true,
        projectNumber: true,
        projectName: true,
        customer: true,
      },
    }),
    prisma.schedule.findMany({
      include: {
        project: {
          select: {
            id: true,
            procoreId: true,
            bidBoardId: true,
            projectNumber: true,
            projectName: true,
            customer: true,
          },
        },
        allocationsList: {
          orderBy: { period: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.ganttV2Project.findMany({
      include: {
        scopes: {
          include: {
            scheduleEntries: {
              orderBy: { workDate: 'asc' },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const pmcProjectIds = new Set(pmcProjects.map((project) => project.procoreProjectId));
  const pmcByProjectNumber = new Map();
  for (const project of pmcProjects) {
    const key = normalizeProjectNumber(project.projectNumber);
    if (!key) continue;
    if (!pmcByProjectNumber.has(key)) pmcByProjectNumber.set(key, []);
    pmcByProjectNumber.get(key).push(project);
  }

  const schedulePreview = schedules.map((schedule) => {
    const procoreProjectId = schedule.project?.procoreId ?? null;
    return {
      source: 'Schedule',
      sourceId: schedule.id,
      jobKey: schedule.jobKey,
      companyId: COMPANY_ID,
      procoreProjectId,
      projectNumber: schedule.project?.projectNumber ?? schedule.projectNumber,
      projectName: schedule.project?.projectName ?? schedule.projectName,
      customer: schedule.project?.customer ?? schedule.customer,
      canBackfill: Boolean(procoreProjectId && pmcProjectIds.has(procoreProjectId)),
      reason: procoreProjectId
        ? pmcProjectIds.has(procoreProjectId)
          ? 'exact_project_relation'
          : 'missing_pmc_project'
        : 'missing_project_relation_procore_project_id',
      allocationCount: schedule.allocationsList.length,
      monthlyAllocationHours: schedule.allocationsList.reduce((sum, allocation) => sum + Number(allocation.hours || 0), 0),
      totalHours: schedule.totalHours,
    };
  });

  const ganttPreview = ganttProjects.map((project) => {
    const exactById = pmcProjectIds.has(project.id);
    const projectNumberMatches = pmcByProjectNumber.get(normalizeProjectNumber(project.project_number)) ?? [];
    const exactProjectNumberMatch = projectNumberMatches.length === 1 ? projectNumberMatches[0] : null;
    const procoreProjectId = exactById ? project.id : null;

    return {
      source: 'GanttV2Project',
      sourceId: project.id,
      companyId: COMPANY_ID,
      procoreProjectId,
      projectNumber: project.project_number,
      projectName: project.projectName,
      customer: project.customer,
      canBackfill: exactById,
      reason: exactById
        ? 'source_id_is_procore_project_id'
        : exactProjectNumberMatch
          ? `project_number_matches_${exactProjectNumberMatch.procoreProjectId}_review_required`
          : projectNumberMatches.length > 1
            ? 'multiple_project_number_matches_review_required'
            : 'no_exact_procore_project_id_match',
      scopeCount: project.scopes.length,
      scheduleEntryCount: project.scopes.reduce((sum, scope) => sum + scope.scheduleEntries.length, 0),
      scheduledHours: project.scopes.reduce(
        (sum, scope) =>
          sum + scope.scheduleEntries.reduce((entrySum, entry) => entrySum + Number(entry.scheduledHours || 0), 0),
        0,
      ),
    };
  });

  const schedulePath = join(outputDir, `${timestamp}-schedule-backfill-preview.csv`);
  const ganttPath = join(outputDir, `${timestamp}-gantt-backfill-preview.csv`);
  writeFileSync(
    schedulePath,
    toCsv(schedulePreview, [
      'source',
      'sourceId',
      'jobKey',
      'companyId',
      'procoreProjectId',
      'projectNumber',
      'projectName',
      'customer',
      'canBackfill',
      'reason',
      'allocationCount',
      'monthlyAllocationHours',
      'totalHours',
    ]),
  );
  writeFileSync(
    ganttPath,
    toCsv(ganttPreview, [
      'source',
      'sourceId',
      'companyId',
      'procoreProjectId',
      'projectNumber',
      'projectName',
      'customer',
      'canBackfill',
      'reason',
      'scopeCount',
      'scheduleEntryCount',
      'scheduledHours',
    ]),
  );

  const summary = {
    schedules: {
      total: schedulePreview.length,
      canBackfill: schedulePreview.filter((row) => row.canBackfill).length,
      allocationRows: schedules.reduce((sum, schedule) => sum + schedule.allocationsList.length, 0),
    },
    ganttProjects: {
      total: ganttPreview.length,
      canBackfill: ganttPreview.filter((row) => row.canBackfill).length,
      reviewRequired: ganttPreview.filter((row) => !row.canBackfill).length,
      scopes: ganttProjects.reduce((sum, project) => sum + project.scopes.length, 0),
      scheduleEntries: ganttProjects.reduce(
        (sum, project) => sum + project.scopes.reduce((scopeSum, scope) => scopeSum + scope.scheduleEntries.length, 0),
        0,
      ),
    },
    files: {
      schedulePath,
      ganttPath,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

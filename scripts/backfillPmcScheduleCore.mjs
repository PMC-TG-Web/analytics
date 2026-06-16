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

function parseDateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function projectExists(procoreProjectId) {
  if (!procoreProjectId) return false;
  const row = await prisma.pmcProject.findUnique({
    where: {
      companyId_procoreProjectId: {
        companyId: COMPANY_ID,
        procoreProjectId,
      },
    },
    select: { procoreProjectId: true },
  });
  return Boolean(row);
}

async function backfillLegacyProjectScopes() {
  const scopes = await prisma.projectScope.findMany({
    include: {
      project: { select: { procoreId: true } },
    },
  });

  const written = [];
  const skipped = [];

  for (const scope of scopes) {
    const procoreProjectId = scope.project?.procoreId;
    if (!(await projectExists(procoreProjectId))) {
      skipped.push({ source: 'ProjectScope', sourceId: scope.id, reason: 'missing_exact_pmc_project' });
      continue;
    }

    const data = {
      id: scope.id,
      companyId: COMPANY_ID,
      procoreProjectId,
      title: scope.title,
      startDate: parseDateOnly(scope.startDate),
      endDate: parseDateOnly(scope.endDate),
      hours: scope.hours == null ? null : scope.hours,
      manpower: scope.manpower == null ? null : Math.round(scope.manpower),
      schedulingMode: scope.schedulingMode,
      selectedDays: scope.selectedDays,
      tasks: scope.tasks,
      color: scope.color,
      notes: scope.notes,
      predecessorId: scope.predecessorScopeId,
    };

    await prisma.pmcProjectScope.upsert({
      where: { id: scope.id },
      create: data,
      update: data,
    });
    written.push({ source: 'ProjectScope', sourceId: scope.id, procoreProjectId, title: scope.title });
  }

  return { written, skipped };
}

async function backfillLegacyScheduleAllocations() {
  const allocations = await prisma.scheduleAllocation.findMany({
    include: {
      schedule: {
        include: {
          project: { select: { procoreId: true } },
        },
      },
    },
  });

  const written = [];
  const skipped = [];

  for (const allocation of allocations) {
    const procoreProjectId = allocation.schedule.project?.procoreId;
    if (allocation.periodType !== 'month') {
      skipped.push({
        source: 'ScheduleAllocation',
        sourceId: allocation.id,
        reason: `unsupported_period_type_${allocation.periodType}`,
      });
      continue;
    }
    if (!(await projectExists(procoreProjectId))) {
      skipped.push({ source: 'ScheduleAllocation', sourceId: allocation.id, reason: 'missing_exact_pmc_project' });
      continue;
    }

    const data = {
      id: allocation.id,
      companyId: COMPANY_ID,
      procoreProjectId,
      month: allocation.period,
      hours: allocation.hours,
      percent: allocation.percent,
    };

    await prisma.pmcScheduleAllocation.upsert({
      where: {
        companyId_procoreProjectId_month: {
          companyId: COMPANY_ID,
          procoreProjectId,
          month: allocation.period,
        },
      },
      create: data,
      update: data,
    });
    written.push({
      source: 'ScheduleAllocation',
      sourceId: allocation.id,
      procoreProjectId,
      month: allocation.period,
      hours: allocation.hours,
      percent: allocation.percent,
    });
  }

  return { written, skipped };
}

async function backfillLegacyActiveScheduleEntries() {
  const entries = await prisma.activeSchedule.findMany({
    include: {
      project: { select: { procoreId: true } },
    },
  });

  const written = [];
  const skipped = [];

  for (const entry of entries) {
    const procoreProjectId = entry.project?.procoreId;
    const date = parseDateOnly(entry.date);
    if (!date) {
      skipped.push({ source: 'ActiveSchedule', sourceId: entry.id, reason: 'invalid_date' });
      continue;
    }
    if (!(await projectExists(procoreProjectId))) {
      skipped.push({ source: 'ActiveSchedule', sourceId: entry.id, reason: 'missing_exact_pmc_project' });
      continue;
    }

    const data = {
      id: entry.id,
      companyId: COMPANY_ID,
      procoreProjectId,
      scopeId: null,
      date,
      hours: entry.hours,
      manpower: entry.manpower,
      foremanId: entry.foreman,
      source: entry.source || 'legacy_active_schedule',
    };

    await prisma.pmcScheduleEntry.upsert({
      where: { id: entry.id },
      create: data,
      update: data,
    });
    written.push({
      source: 'ActiveSchedule',
      sourceId: entry.id,
      procoreProjectId,
      date: entry.date,
      hours: entry.hours,
    });
  }

  return { written, skipped };
}

async function backfillExactGanttV2() {
  const projects = await prisma.ganttV2Project.findMany({
    include: {
      scopes: {
        include: {
          scheduleEntries: true,
        },
      },
    },
  });

  const writtenScopes = [];
  const writtenEntries = [];
  const skipped = [];

  for (const project of projects) {
    const procoreProjectId = project.id;
    if (!(await projectExists(procoreProjectId))) {
      skipped.push({
        source: 'GanttV2Project',
        sourceId: project.id,
        reason: 'project_id_is_not_exact_procore_project_id',
      });
      continue;
    }

    for (const scope of project.scopes) {
      const scopeData = {
        id: scope.id,
        companyId: COMPANY_ID,
        procoreProjectId,
        title: scope.title,
        startDate: scope.startDate,
        endDate: scope.endDate,
        hours: scope.totalHours,
        manpower: scope.crewSize == null ? null : Math.round(scope.crewSize),
        schedulingMode: 'contiguous',
        notes: scope.notes,
        predecessorId: scope.predecessorScopeId,
      };

      await prisma.pmcProjectScope.upsert({
        where: { id: scope.id },
        create: scopeData,
        update: scopeData,
      });
      writtenScopes.push({ source: 'GanttV2Scope', sourceId: scope.id, procoreProjectId, title: scope.title });

      for (const entry of scope.scheduleEntries) {
        const entryData = {
          id: entry.id,
          companyId: COMPANY_ID,
          procoreProjectId,
          scopeId: scope.id,
          date: entry.workDate,
          hours: entry.scheduledHours,
          source: 'gantt_v2',
        };

        await prisma.pmcScheduleEntry.upsert({
          where: { id: entry.id },
          create: entryData,
          update: entryData,
        });
        writtenEntries.push({
          source: 'GanttV2ScheduleEntry',
          sourceId: entry.id,
          procoreProjectId,
          scopeId: scope.id,
          date: entry.workDate.toISOString().slice(0, 10),
          hours: entry.scheduledHours,
        });
      }
    }
  }

  return { writtenScopes, writtenEntries, skipped };
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const [legacyScopes, allocations, activeEntries, gantt] = await Promise.all([
    backfillLegacyProjectScopes(),
    backfillLegacyScheduleAllocations(),
    backfillLegacyActiveScheduleEntries(),
    backfillExactGanttV2(),
  ]);

  const writtenScopes = [...legacyScopes.written, ...gantt.writtenScopes];
  const writtenEntries = [...activeEntries.written, ...gantt.writtenEntries];
  const skipped = [...legacyScopes.skipped, ...allocations.skipped, ...activeEntries.skipped, ...gantt.skipped];

  const scopesPath = join(outputDir, `${timestamp}-pmc-project-scopes-backfilled.csv`);
  const allocationsPath = join(outputDir, `${timestamp}-pmc-schedule-allocations-backfilled.csv`);
  const entriesPath = join(outputDir, `${timestamp}-pmc-schedule-entries-backfilled.csv`);
  const skippedPath = join(outputDir, `${timestamp}-pmc-schedule-core-skipped.csv`);

  writeFileSync(scopesPath, toCsv(writtenScopes, ['source', 'sourceId', 'procoreProjectId', 'title']));
  writeFileSync(
    allocationsPath,
    toCsv(allocations.written, ['source', 'sourceId', 'procoreProjectId', 'month', 'hours', 'percent']),
  );
  writeFileSync(entriesPath, toCsv(writtenEntries, ['source', 'sourceId', 'procoreProjectId', 'scopeId', 'date', 'hours']));
  writeFileSync(skippedPath, toCsv(skipped, ['source', 'sourceId', 'reason']));

  console.log(
    JSON.stringify(
      {
        written: {
          projectScopes: writtenScopes.length,
          scheduleAllocations: allocations.written.length,
          scheduleEntries: writtenEntries.length,
        },
        skipped: skipped.length,
        files: {
          scopesPath,
          allocationsPath,
          entriesPath,
          skippedPath,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

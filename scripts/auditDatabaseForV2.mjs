import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = join(process.cwd(), 'snapshots', 'schema-audit');

const modelDelegates = [
  ['Project', 'project'],
  ['ProjectScope', 'projectScope'],
  ['Schedule', 'schedule'],
  ['ScheduleAllocation', 'scheduleAllocation'],
  ['ActiveSchedule', 'activeSchedule'],
  ['ScopeTracking', 'scopeTracking'],
  ['GanttV2Project', 'ganttV2Project'],
  ['GanttV2Scope', 'ganttV2Scope'],
  ['GanttV2ScheduleEntry', 'ganttV2ScheduleEntry'],
  ['ProductivityLog', 'productivityLog'],
  ['TimecardEntry', 'timecardEntry'],
  ['TimecardTimeType', 'timecardTimeType'],
  ['CommitmentContract', 'commitmentContract'],
  ['CommitmentChangeOrder', 'commitmentChangeOrder'],
  ['CommitmentChangeOrderLineItem', 'commitmentChangeOrderLineItem'],
  ['PurchaseOrderContract', 'purchaseOrderContract'],
  ['PurchaseOrderLineItemContractDetail', 'purchaseOrderLineItemContractDetail'],
  ['BudgetLineItem', 'budgetLineItem'],
  ['ConcreteOrder', 'concreteOrder'],
  ['KPIEntry', 'kPIEntry'],
  ['DashboardSummary', 'dashboardSummary'],
  ['User', 'user'],
  ['Employee', 'employee'],
  ['AuditLog', 'auditLog'],
  ['SyncLog', 'syncLog'],
  ['PmcProject', 'pmcProject'],
  ['PmcProjectScope', 'pmcProjectScope'],
  ['PmcScheduleEntry', 'pmcScheduleEntry'],
  ['PmcScheduleAllocation', 'pmcScheduleAllocation'],
  ['PmcSyncLog', 'pmcSyncLog'],
];

const projectLinkedModels = [
  ['ProjectScope', 'projectScope'],
  ['Schedule', 'schedule'],
  ['ActiveSchedule', 'activeSchedule'],
  ['ScopeTracking', 'scopeTracking'],
  ['ProductivityLog', 'productivityLog'],
  ['TimecardEntry', 'timecardEntry'],
  ['TimecardTimeType', 'timecardTimeType'],
  ['CommitmentContract', 'commitmentContract'],
  ['PurchaseOrderContract', 'purchaseOrderContract'],
  ['PurchaseOrderLineItemContractDetail', 'purchaseOrderLineItemContractDetail'],
];

const modelFamilies = {
  projectSchedulingLegacy: [
    'Project',
    'ProjectScope',
    'Schedule',
    'ScheduleAllocation',
    'ActiveSchedule',
    'ScopeTracking',
    'GanttV2Project',
    'GanttV2Scope',
    'GanttV2ScheduleEntry',
  ],
  projectSchedulingV2: [
    'PmcProject',
    'PmcProjectScope',
    'PmcScheduleEntry',
    'PmcScheduleAllocation',
    'PmcSyncLog',
  ],
  procoreMirrors: [
    'BudgetLineItem',
    'ProductivityLog',
    'TimecardEntry',
    'TimecardTimeType',
    'CommitmentContract',
    'CommitmentChangeOrder',
    'CommitmentChangeOrderLineItem',
    'PurchaseOrderContract',
    'PurchaseOrderLineItemContractDetail',
  ],
  appOwned: [
    'KPIEntry',
    'DashboardSummary',
    'User',
    'Employee',
    'AuditLog',
    'ConcreteOrder',
  ],
};

function delegate(name) {
  return prisma[name] ?? null;
}

async function safeCount(modelName, delegateName) {
  const d = delegate(delegateName);
  if (!d?.count) {
    return { model: modelName, delegate: delegateName, status: 'missing_delegate', count: null };
  }

  try {
    return { model: modelName, delegate: delegateName, status: 'ok', count: await d.count() };
  } catch (error) {
    return {
      model: modelName,
      delegate: delegateName,
      status: 'error',
      count: null,
      error: error.message,
    };
  }
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function projectScore(project) {
  let score = 0;
  if (!project.projectArchived) score += 100;
  if (project.status && !/archiv/i.test(project.status)) score += 25;
  if (project.sales != null) score += 10;
  if (project.cost != null) score += 10;
  if (project.hours != null) score += 10;
  if (project.customer) score += 5;
  if (project.projectManager) score += 5;
  if (project.estimator) score += 5;
  if (project.dateUpdated) score += 3;
  if (project.updatedAt) score += 2;
  return score;
}

function chooseProjectKeeper(projects) {
  return [...projects].sort((a, b) => {
    const scoreDiff = projectScore(b) - projectScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
  })[0];
}

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

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const rowCounts = [];
  for (const [modelName, delegateName] of modelDelegates) {
    rowCounts.push(await safeCount(modelName, delegateName));
  }

  const projectDelegate = delegate('project');
  const projects = projectDelegate
    ? await projectDelegate.findMany({
        select: {
          id: true,
          procoreId: true,
          bidBoardId: true,
          projectNumber: true,
          projectName: true,
          customer: true,
          status: true,
          sales: true,
          cost: true,
          hours: true,
          projectArchived: true,
          projectManager: true,
          estimator: true,
          dateUpdated: true,
          updatedAt: true,
        },
      })
    : [];

  const missingProcoreId = projects.filter((project) => !project.procoreId);

  const duplicateGroups = [];
  const groupMaps = {
    procoreId: new Map(),
    projectNumber: new Map(),
    normalizedName: new Map(),
  };

  for (const project of projects) {
    const keys = {
      procoreId: project.procoreId,
      projectNumber: project.projectNumber,
      normalizedName: normalize(project.projectName),
    };

    for (const [groupType, key] of Object.entries(keys)) {
      if (!key) continue;
      if (!groupMaps[groupType].has(key)) groupMaps[groupType].set(key, []);
      groupMaps[groupType].get(key).push(project);
    }
  }

  for (const [groupType, groups] of Object.entries(groupMaps)) {
    for (const [key, rows] of groups) {
      if (rows.length < 2) continue;
      const keeper = chooseProjectKeeper(rows);
      duplicateGroups.push({
        groupType,
        key,
        count: rows.length,
        keeperId: keeper.id,
        rows: rows.map((project) => ({
          id: project.id,
          procoreId: project.procoreId,
          projectNumber: project.projectNumber,
          projectName: project.projectName,
          customer: project.customer,
          status: project.status,
          projectArchived: project.projectArchived,
          score: projectScore(project),
        })),
      });
    }
  }

  const projectIds = new Set(projects.map((project) => project.id));
  const orphanReports = [];
  for (const [modelName, delegateName] of projectLinkedModels) {
    const d = delegate(delegateName);
    if (!d?.findMany) {
      orphanReports.push({ model: modelName, status: 'missing_delegate', orphanCount: null });
      continue;
    }

    try {
      const rows = await d.findMany({
        where: { projectId: { not: null } },
        select: { id: true, projectId: true },
      });
      const orphans = rows.filter((row) => row.projectId && !projectIds.has(row.projectId));
      orphanReports.push({
        model: modelName,
        status: 'ok',
        checkedRows: rows.length,
        orphanCount: orphans.length,
        sample: orphans.slice(0, 25),
      });
    } catch (error) {
      orphanReports.push({
        model: modelName,
        status: 'error',
        orphanCount: null,
        error: error.message,
      });
    }
  }

  const pmcProjectPreview = [...groupMaps.procoreId.entries()].map(([procoreProjectId, rows]) => {
    const keeper = chooseProjectKeeper(rows);
    return {
      companyId: '598134325805519',
      procoreProjectId,
      bidBoardId: keeper.bidBoardId,
      sourceProjectId: keeper.id,
      projectNumber: keeper.projectNumber,
      projectName: keeper.projectName,
      customer: keeper.customer,
      status: keeper.status,
      duplicateSourceRows: rows.length,
      needsReview: rows.length > 1,
    };
  });

  const duplicateCsvRows = duplicateGroups.flatMap((group) =>
    group.rows.map((row) => ({
      groupType: group.groupType,
      key: group.key,
      count: group.count,
      keeperId: group.keeperId,
      ...row,
    })),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    rowCounts,
    modelFamilies: Object.fromEntries(
      Object.entries(modelFamilies).map(([family, models]) => [
        family,
        models.map((model) => rowCounts.find((row) => row.model === model) ?? { model, status: 'not_counted' }),
      ]),
    ),
    projectSummary: {
      totalProjects: projects.length,
      projectsMissingProcoreId: missingProcoreId.length,
      duplicateGroups: duplicateGroups.length,
      pmcProjectPreviewRows: pmcProjectPreview.length,
    },
    missingProcoreId: missingProcoreId.slice(0, 500),
    duplicateGroups,
    orphanReports,
    pmcProjectPreview,
  };

  const reportPath = join(outputDir, `${timestamp}-v2-audit.json`);
  const duplicatesPath = join(outputDir, `${timestamp}-project-duplicates.csv`);
  const previewPath = join(outputDir, `${timestamp}-pmc-project-preview.csv`);

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeFileSync(
    duplicatesPath,
    toCsv(duplicateCsvRows, [
      'groupType',
      'key',
      'count',
      'keeperId',
      'id',
      'procoreId',
      'projectNumber',
      'projectName',
      'customer',
      'status',
      'projectArchived',
      'score',
    ]),
  );
  writeFileSync(
    previewPath,
    toCsv(pmcProjectPreview, [
      'companyId',
      'procoreProjectId',
      'bidBoardId',
      'sourceProjectId',
      'projectNumber',
      'projectName',
      'customer',
      'status',
      'duplicateSourceRows',
      'needsReview',
    ]),
  );

  console.log(`Wrote ${reportPath}`);
  console.log(`Wrote ${duplicatesPath}`);
  console.log(`Wrote ${previewPath}`);
  console.log(
    JSON.stringify(
      {
        totalProjects: report.projectSummary.totalProjects,
        projectsMissingProcoreId: report.projectSummary.projectsMissingProcoreId,
        duplicateGroups: report.projectSummary.duplicateGroups,
        orphanedModels: orphanReports.filter((item) => item.orphanCount > 0).length,
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

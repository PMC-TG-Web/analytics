import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const COMPANY_ID = '598134325805519';
const prisma = new PrismaClient();

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = join(process.cwd(), 'snapshots', 'schema-audit');

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
  if (project.bidBoardId) score += 5;
  if (project.dateUpdated) score += 3;
  if (project.updatedAt) score += 2;
  return score;
}

function chooseKeeper(projects) {
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

function toPmcProjectData(project) {
  return {
    companyId: COMPANY_ID,
    procoreProjectId: project.procoreId,
    bidBoardId: project.bidBoardId,
    projectNumber: project.projectNumber,
    projectName: project.projectName,
    customer: project.customer,
    status: project.status,
    bidBoardStatus:
      typeof project.customFields === 'object' && project.customFields
        ? project.customFields.bidBoardStatus ?? project.customFields.bidBoardStatusRaw ?? null
        : null,
    projectManager: project.projectManager,
    estimator: project.estimator,
    syncedAt: new Date(),
  };
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const projects = await prisma.project.findMany({
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
      customFields: true,
      dateUpdated: true,
      updatedAt: true,
    },
  });

  const missing = projects.filter((project) => !project.procoreId);
  const byProcoreProjectId = new Map();

  for (const project of projects) {
    if (!project.procoreId) continue;
    if (!byProcoreProjectId.has(project.procoreId)) byProcoreProjectId.set(project.procoreId, []);
    byProcoreProjectId.get(project.procoreId).push(project);
  }

  const ambiguous = [];
  const upserted = [];

  for (const [procoreProjectId, rows] of byProcoreProjectId.entries()) {
    const keeper = chooseKeeper(rows);
    const data = toPmcProjectData(keeper);

    if (rows.length > 1) {
      ambiguous.push(
        ...rows.map((project) => ({
          procoreProjectId,
          sourceProjectId: project.id,
          keeperProjectId: keeper.id,
          projectNumber: project.projectNumber,
          projectName: project.projectName,
          customer: project.customer,
          status: project.status,
          score: projectScore(project),
        })),
      );
    }

    await prisma.pmcProject.upsert({
      where: {
        companyId_procoreProjectId: {
          companyId: COMPANY_ID,
          procoreProjectId,
        },
      },
      create: data,
      update: data,
    });

    upserted.push({
      companyId: COMPANY_ID,
      procoreProjectId,
      bidBoardId: keeper.bidBoardId,
      sourceProjectId: keeper.id,
      projectNumber: keeper.projectNumber,
      projectName: keeper.projectName,
      customer: keeper.customer,
      status: keeper.status,
      duplicateSourceRows: rows.length,
    });
  }

  const missingPath = join(outputDir, `${timestamp}-pmc-projects-missing-procore-project-id.csv`);
  const ambiguousPath = join(outputDir, `${timestamp}-pmc-projects-ambiguous-source-rows.csv`);
  const upsertedPath = join(outputDir, `${timestamp}-pmc-projects-backfilled.csv`);

  writeFileSync(
    missingPath,
    toCsv(missing, [
      'id',
      'bidBoardId',
      'projectNumber',
      'projectName',
      'customer',
      'status',
      'projectArchived',
    ]),
  );
  writeFileSync(
    ambiguousPath,
    toCsv(ambiguous, [
      'procoreProjectId',
      'sourceProjectId',
      'keeperProjectId',
      'projectNumber',
      'projectName',
      'customer',
      'status',
      'score',
    ]),
  );
  writeFileSync(
    upsertedPath,
    toCsv(upserted, [
      'companyId',
      'procoreProjectId',
      'bidBoardId',
      'sourceProjectId',
      'projectNumber',
      'projectName',
      'customer',
      'status',
      'duplicateSourceRows',
    ]),
  );

  console.log(
    JSON.stringify(
      {
        sourceProjects: projects.length,
        skippedMissingProcoreProjectId: missing.length,
        uniqueProcoreProjectsBackfilled: upserted.length,
        ambiguousSourceRows: ambiguous.length,
        files: {
          missingPath,
          ambiguousPath,
          upsertedPath,
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

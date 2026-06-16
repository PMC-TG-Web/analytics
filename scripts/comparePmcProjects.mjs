import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const COMPANY_ID = '598134325805519';
const prisma = new PrismaClient();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = join(process.cwd(), 'snapshots', 'schema-audit');

function clean(value) {
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}

function sameNullableText(left, right) {
  return clean(left) === clean(right);
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

async function compare() {
  const [legacyProjects, pmcProjects] = await Promise.all([
    prisma.project.findMany({
      orderBy: [{ projectNumber: 'asc' }, { projectName: 'asc' }],
      select: {
        id: true,
        procoreId: true,
        bidBoardId: true,
        projectNumber: true,
        projectName: true,
        customer: true,
        status: true,
        projectArchived: true,
      },
    }),
    prisma.pmcProject.findMany({
      where: { companyId: COMPANY_ID },
      orderBy: [{ projectNumber: 'asc' }, { projectName: 'asc' }],
      select: {
        companyId: true,
        procoreProjectId: true,
        bidBoardId: true,
        projectNumber: true,
        projectName: true,
        customer: true,
        status: true,
      },
    }),
  ]);

  const pmcByProcoreProjectId = new Map(pmcProjects.map((project) => [project.procoreProjectId, project]));
  const legacyByProcoreProjectId = new Map();

  for (const project of legacyProjects) {
    if (!project.procoreId) continue;
    const rows = legacyByProcoreProjectId.get(project.procoreId) ?? [];
    rows.push(project);
    legacyByProcoreProjectId.set(project.procoreId, rows);
  }

  const legacyMissingProcoreProjectId = legacyProjects
    .filter((project) => !project.procoreId)
    .map((project) => ({
      legacyProjectId: project.id,
      bidBoardId: project.bidBoardId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      customer: project.customer,
      status: project.status,
      projectArchived: project.projectArchived,
    }));

  const missingInPmc = legacyProjects
    .filter((project) => project.procoreId && !pmcByProcoreProjectId.has(project.procoreId))
    .map((project) => ({
      legacyProjectId: project.id,
      procoreProjectId: project.procoreId,
      bidBoardId: project.bidBoardId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      customer: project.customer,
      status: project.status,
    }));

  const missingInLegacy = pmcProjects
    .filter((project) => !legacyByProcoreProjectId.has(project.procoreProjectId))
    .map((project) => ({
      companyId: project.companyId,
      procoreProjectId: project.procoreProjectId,
      bidBoardId: project.bidBoardId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      customer: project.customer,
      status: project.status,
    }));

  const duplicateLegacyProcoreProjectIds = [...legacyByProcoreProjectId.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([procoreProjectId, rows]) => ({
      procoreProjectId,
      count: rows.length,
      legacyProjectIds: rows.map((row) => row.id).join('|'),
    }));

  const fieldDifferences = [];
  for (const legacyProject of legacyProjects) {
    if (!legacyProject.procoreId) continue;
    const pmcProject = pmcByProcoreProjectId.get(legacyProject.procoreId);
    if (!pmcProject) continue;

    for (const field of ['bidBoardId', 'projectNumber', 'projectName', 'customer', 'status']) {
      if (sameNullableText(legacyProject[field], pmcProject[field])) continue;
      fieldDifferences.push({
        procoreProjectId: legacyProject.procoreId,
        legacyProjectId: legacyProject.id,
        field,
        legacyValue: legacyProject[field],
        pmcValue: pmcProject[field],
      });
    }
  }

  return {
    companyId: COMPANY_ID,
    generatedAt: new Date().toISOString(),
    summary: {
      legacyProjectCount: legacyProjects.length,
      legacyProjectsWithProcoreProjectId: legacyProjects.filter((project) => project.procoreId).length,
      legacyProjectsMissingProcoreProjectId: legacyMissingProcoreProjectId.length,
      pmcProjectCount: pmcProjects.length,
      missingInPmc: missingInPmc.length,
      missingInLegacy: missingInLegacy.length,
      duplicateLegacyProcoreProjectIds: duplicateLegacyProcoreProjectIds.length,
      fieldDifferences: fieldDifferences.length,
    },
    legacyMissingProcoreProjectId,
    missingInPmc,
    missingInLegacy,
    duplicateLegacyProcoreProjectIds,
    fieldDifferences,
  };
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const report = await compare();
  const reportPath = join(outputDir, `${timestamp}-pmc-projects-compare.json`);
  const missingLegacyIdPath = join(outputDir, `${timestamp}-pmc-projects-legacy-missing-procore-id.csv`);
  const missingInPmcPath = join(outputDir, `${timestamp}-pmc-projects-missing-in-pmc.csv`);
  const missingInLegacyPath = join(outputDir, `${timestamp}-pmc-projects-missing-in-legacy.csv`);
  const duplicatesPath = join(outputDir, `${timestamp}-pmc-projects-duplicate-legacy-procore-id.csv`);
  const differencesPath = join(outputDir, `${timestamp}-pmc-projects-field-differences.csv`);

  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeFileSync(
    missingLegacyIdPath,
    toCsv(report.legacyMissingProcoreProjectId, [
      'legacyProjectId',
      'bidBoardId',
      'projectNumber',
      'projectName',
      'customer',
      'status',
      'projectArchived',
    ]),
  );
  writeFileSync(
    missingInPmcPath,
    toCsv(report.missingInPmc, [
      'legacyProjectId',
      'procoreProjectId',
      'bidBoardId',
      'projectNumber',
      'projectName',
      'customer',
      'status',
    ]),
  );
  writeFileSync(
    missingInLegacyPath,
    toCsv(report.missingInLegacy, [
      'companyId',
      'procoreProjectId',
      'bidBoardId',
      'projectNumber',
      'projectName',
      'customer',
      'status',
    ]),
  );
  writeFileSync(
    duplicatesPath,
    toCsv(report.duplicateLegacyProcoreProjectIds, ['procoreProjectId', 'count', 'legacyProjectIds']),
  );
  writeFileSync(
    differencesPath,
    toCsv(report.fieldDifferences, ['procoreProjectId', 'legacyProjectId', 'field', 'legacyValue', 'pmcValue']),
  );

  console.log(
    JSON.stringify(
      {
        summary: report.summary,
        files: {
          reportPath,
          missingLegacyIdPath,
          missingInPmcPath,
          missingInLegacyPath,
          duplicatesPath,
          differencesPath,
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

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const COMPANY_ID = '598134325805519';
const API_URL = (process.env.PROCORE_API_URL || 'https://api.procore.com').replace(/\/$/, '');
const TOKEN_URL = process.env.PROCORE_TOKEN_URL || `${API_URL}/oauth/token`;
const CLIENT_ID = process.env.PROCORE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PROCORE_CLIENT_SECRET || '';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = join(process.cwd(), 'snapshots', 'schema-audit');

const prisma = new PrismaClient();

function argEnabled(name, defaultValue = false) {
  const arg = process.argv.find((value) => value === `--${name}` || value.startsWith(`--${name}=`));
  if (!arg) return defaultValue;
  if (!arg.includes('=')) return true;
  return ['true', '1', 'yes'].includes(arg.split('=').at(1)?.toLowerCase() || '');
}

const includeInactive = argEnabled('include-inactive', false);
const includeDemo = argEnabled('include-demo', false);
const includeTemplates = argEnabled('include-templates', false);
const purgeOtherCompanies = argEnabled('purge-other-companies', false);

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

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function normalizeBidBoardStatus(status) {
  const raw = String(status || '').trim();
  const normalized = raw.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');

  if (!normalized) return null;
  if (normalized === 'bid submitted' || normalized === 'bidding') return 'Bid Submitted';
  if (normalized === 'pre construction' || normalized === 'estimating') return 'Estimating';
  if (normalized === 'post construction' || normalized === 'complete') return 'Complete';
  if (normalized === 'active' || normalized === 'in progress' || normalized === 'course of construction') return 'In Progress';
  if (normalized === 'accepted') return 'Accepted';
  if (normalized === 'invitation' || normalized === 'invitations') return 'Invitations';
  if (normalized === 'lost') return 'Lost';
  if (normalized === 'to do' || normalized === 'todo') return 'To Do';

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function isTemplateProject(project) {
  const name = String(project?.name || '').toLowerCase();
  return (
    project?.template === true ||
    project?.is_template === true ||
    name.includes('template')
  );
}

async function getToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('PROCORE_CLIENT_ID and PROCORE_CLIENT_SECRET are required for fresh sync.');
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function procoreGet(token, path) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Procore-Company-Id': COMPANY_ID,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GET ${path} failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function fetchPaged(token, pathBuilder) {
  const rows = [];
  for (let page = 1; page <= 200; page += 1) {
    const data = await procoreGet(token, pathBuilder(page));
    const pageRows = Array.isArray(data)
      ? data
      : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.projects)
          ? data.projects
          : Array.isArray(data?.bid_board_projects)
            ? data.bid_board_projects
            : [];

    if (!pageRows.length) break;
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return rows;
}

async function fetchV1Projects(token) {
  const qs = (page) => {
    const params = new URLSearchParams({
      company_id: COMPANY_ID,
      page: String(page),
      per_page: '100',
    });
    if (!includeInactive) params.set('filters[active]', 'true');
    return `/rest/v1.0/projects?${params.toString()}`;
  };

  let projects = await fetchPaged(token, qs);

  // If this tenant does not honor filters[is_demo], keep the script strict in-process.
  if (!includeInactive) projects = projects.filter((project) => project.active !== false);
  if (!includeDemo) projects = projects.filter((project) => project.is_demo !== true);
  if (!includeTemplates) projects = projects.filter((project) => !isTemplateProject(project));

  return projects;
}

async function fetchBidBoardProjects(token) {
  return fetchPaged(
    token,
    (page) => `/rest/v2.0/companies/${encodeURIComponent(COMPANY_ID)}/estimating/bid_board_projects?page=${page}&per_page=100`,
  );
}

function extractCustomer(project) {
  const customerCompanyName = text(project?.customer_company?.name);
  if (customerCompanyName) return customerCompanyName;

  const customFields = project?.custom_fields && typeof project.custom_fields === 'object' ? project.custom_fields : {};
  for (const field of Object.values(customFields)) {
    const value = field?.value;
    if (value && typeof value === 'object' && typeof value.label === 'string' && value.label.trim()) return value.label.trim();
  }
  return text(project?.customer?.name) || text(project?.company?.name);
}

async function resetTargetTables() {
  await prisma.pmcSyncLog.deleteMany({ where: { companyId: COMPANY_ID } });
  await prisma.pmcScheduleEntry.deleteMany({ where: { companyId: COMPANY_ID } });
  await prisma.pmcScheduleAllocation.deleteMany({ where: { companyId: COMPANY_ID } });
  await prisma.pmcProjectScope.deleteMany({ where: { companyId: COMPANY_ID } });
  await prisma.pmcBidBoardProject.deleteMany({ where: { companyId: COMPANY_ID } });
  await prisma.pmcProject.deleteMany({ where: { companyId: COMPANY_ID } });

  await prisma.procore_bid_board_live.deleteMany({ where: { company_id: COMPANY_ID } });
  await prisma.procoreProjectStaging.deleteMany({ where: { companyId: COMPANY_ID } });

  if (purgeOtherCompanies) {
    await prisma.procore_bid_board_live.deleteMany({ where: { company_id: { not: COMPANY_ID } } });
    await prisma.procoreProjectStaging.deleteMany({ where: { companyId: { not: COMPANY_ID } } });
  }
}

async function upsertV1Project(project) {
  const procoreProjectId = text(project.id);
  if (!procoreProjectId) return;

  await prisma.procoreProjectStaging.upsert({
    where: {
      source_companyId_externalId: {
        source: 'procore_v1_projects',
        companyId: COMPANY_ID,
        externalId: procoreProjectId,
      },
    },
    create: {
      source: 'procore_v1_projects',
      companyId: COMPANY_ID,
      externalId: procoreProjectId,
      procoreProjectId,
      projectId: procoreProjectId,
      name: text(project.name),
      displayName: text(project.display_name),
      projectNumber: text(project.project_number),
      status: text(project.project_stage?.name) || text(project.status),
      customer: extractCustomer(project),
      projectOwnerType: text(project.project_owner_type?.name),
      projectOwnerTypeId: text(project.project_owner_type_id),
      createdAt: project.created_at ? new Date(project.created_at) : null,
      updatedAt: project.updated_at ? new Date(project.updated_at) : null,
      payload: project,
    },
    update: {
      procoreProjectId,
      projectId: procoreProjectId,
      name: text(project.name),
      displayName: text(project.display_name),
      projectNumber: text(project.project_number),
      status: text(project.project_stage?.name) || text(project.status),
      customer: extractCustomer(project),
      projectOwnerType: text(project.project_owner_type?.name),
      projectOwnerTypeId: text(project.project_owner_type_id),
      createdAt: project.created_at ? new Date(project.created_at) : null,
      updatedAt: project.updated_at ? new Date(project.updated_at) : null,
      payload: project,
      syncedAt: new Date(),
    },
  });
}

async function upsertBidBoardProject(project) {
  const bidBoardProjectId = text(project.id ?? project.bid_board_id);
  const procoreProjectId = text(project.project_id ?? project.procore_project_id);
  const bidBoardId = bidBoardProjectId ? `${COMPANY_ID}:${bidBoardProjectId}` : null;
  if (!bidBoardId) return null;

  const statusRaw = text(project.project_stage?.name) || text(project.status);
  const status = normalizeBidBoardStatus(statusRaw);
  const customer = extractCustomer(project);
  const customerCompanyId = text(project.customer_company?.id);

  await prisma.procore_bid_board_live.upsert({
    where: { bid_board_id: bidBoardId },
    create: {
      bid_board_id: bidBoardId,
      company_id: COMPANY_ID,
      procore_project_id: procoreProjectId,
      name: text(project.name),
      status,
      status_raw: statusRaw,
      customer,
      payload: project,
    },
    update: {
      company_id: COMPANY_ID,
      procore_project_id: procoreProjectId,
      name: text(project.name),
      status,
      status_raw: statusRaw,
      customer,
      payload: project,
      synced_at: new Date(),
    },
  });

  await prisma.pmcBidBoardProject.upsert({
    where: {
      companyId_bidBoardId: {
        companyId: COMPANY_ID,
        bidBoardId,
      },
    },
    create: {
      companyId: COMPANY_ID,
      bidBoardId,
      procoreProjectId,
      projectNumber: text(project.project_number),
      projectName: text(project.name) || bidBoardId,
      customer,
      customerCompanyId,
      status,
      statusRaw,
      payload: project,
    },
    update: {
      procoreProjectId,
      projectNumber: text(project.project_number),
      projectName: text(project.name) || bidBoardId,
      customer,
      customerCompanyId,
      status,
      statusRaw,
      payload: project,
      syncedAt: new Date(),
    },
  });

  return { procoreProjectId, bidBoardId, bidBoardProjectId, status, statusRaw, customer };
}

async function rebuildPmcProjectsFromFreshSource(projects, bidBoardByProjectId) {
  const written = [];
  const skipped = [];

  for (const project of projects) {
    const procoreProjectId = text(project.id);
    if (!procoreProjectId) {
      skipped.push({ reason: 'missing_procore_project_id', name: text(project.name) });
      continue;
    }

    if (project.company?.id && text(project.company.id) !== COMPANY_ID) {
      skipped.push({
        reason: 'wrong_company_id_in_payload',
        procoreProjectId,
        payloadCompanyId: text(project.company.id),
        name: text(project.name),
      });
      continue;
    }

    if (!includeInactive && project.active === false) {
      skipped.push({ reason: 'inactive_project', procoreProjectId, name: text(project.name) });
      continue;
    }
    if (!includeDemo && project.is_demo === true) {
      skipped.push({ reason: 'demo_project', procoreProjectId, name: text(project.name) });
      continue;
    }
    if (!includeTemplates && isTemplateProject(project)) {
      skipped.push({ reason: 'template_project', procoreProjectId, name: text(project.name) });
      continue;
    }

    const bidBoard = bidBoardByProjectId.get(procoreProjectId);
    const data = {
      companyId: COMPANY_ID,
      procoreProjectId,
      bidBoardId: bidBoard?.bidBoardId ?? null,
      projectNumber: text(project.project_number),
      projectName: text(project.name) || text(project.display_name) || procoreProjectId,
      customer: bidBoard?.customer || extractCustomer(project),
      status: normalizeBidBoardStatus(text(project.project_stage?.name) || text(project.status)),
      bidBoardStatus: bidBoard?.status ?? null,
      projectManager: text(project.project_manager?.name),
      estimator: text(project.estimator?.name),
      address: text(project.address),
      city: text(project.city),
      state: text(project.state_code),
      zip: text(project.zip),
      procoreCreatedAt: project.created_at ? new Date(project.created_at) : null,
      procoreUpdatedAt: project.updated_at ? new Date(project.updated_at) : null,
      syncedAt: new Date(),
    };

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

    written.push({
      companyId: COMPANY_ID,
      procoreProjectId,
      bidBoardId: data.bidBoardId,
      projectNumber: data.projectNumber,
      projectName: data.projectName,
      customer: data.customer,
      status: data.status,
      bidBoardStatus: data.bidBoardStatus,
    });
  }

  return { written, skipped };
}

async function main() {
  mkdirSync(outputDir, { recursive: true });

  const token = await getToken();
  await resetTargetTables();

  const [projects, bidBoardProjects] = await Promise.all([
    fetchV1Projects(token),
    fetchBidBoardProjects(token),
  ]);

  for (const project of projects) await upsertV1Project(project);

  const bidBoardByProjectId = new Map();
  const bidBoardWithoutProjectId = [];
  for (const project of bidBoardProjects) {
    const result = await upsertBidBoardProject(project);
    if (!result?.procoreProjectId) {
      bidBoardWithoutProjectId.push({
        bidBoardId: result?.bidBoardId ?? text(project.id),
        name: text(project.name),
        status: text(project.status),
      });
      continue;
    }
    if (!bidBoardByProjectId.has(result.procoreProjectId)) bidBoardByProjectId.set(result.procoreProjectId, result);
  }

  const { written, skipped } = await rebuildPmcProjectsFromFreshSource(projects, bidBoardByProjectId);

  const report = {
    generatedAt: new Date().toISOString(),
    companyId: COMPANY_ID,
    options: { includeInactive, includeDemo, includeTemplates, purgeOtherCompanies },
    fetched: {
      v1Projects: projects.length,
      bidBoardProjects: bidBoardProjects.length,
      bidBoardUniqueProjectIds: bidBoardByProjectId.size,
      bidBoardWithoutProjectId: bidBoardWithoutProjectId.length,
    },
    written: {
      pmcProjects: written.length,
      pmcBidBoardProjects: bidBoardProjects.length,
    },
    skipped: skipped.length,
  };

  const reportPath = join(outputDir, `${timestamp}-fresh-new-company-sync-report.json`);
  const writtenPath = join(outputDir, `${timestamp}-fresh-new-company-pmc-projects.csv`);
  const skippedPath = join(outputDir, `${timestamp}-fresh-new-company-skipped-projects.csv`);
  const bidBoardWithoutProjectPath = join(outputDir, `${timestamp}-fresh-new-company-bid-board-without-project-id.csv`);

  writeFileSync(reportPath, JSON.stringify({ ...report, skippedProjects: skipped, bidBoardWithoutProjectId }, null, 2));
  writeFileSync(
    writtenPath,
    toCsv(written, [
      'companyId',
      'procoreProjectId',
      'bidBoardId',
      'projectNumber',
      'projectName',
      'customer',
      'status',
      'bidBoardStatus',
    ]),
  );
  writeFileSync(
    skippedPath,
    toCsv(skipped, ['reason', 'procoreProjectId', 'payloadCompanyId', 'name']),
  );
  writeFileSync(
    bidBoardWithoutProjectPath,
    toCsv(bidBoardWithoutProjectId, ['bidBoardId', 'name', 'status']),
  );

  console.log(JSON.stringify({ ...report, files: { reportPath, writtenPath, skippedPath, bidBoardWithoutProjectPath } }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

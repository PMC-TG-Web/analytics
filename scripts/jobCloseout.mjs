import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { buildCloseout } from '../src/lib/jobCloseout.mjs';
import { closeoutQueue, discoverCloseouts } from '../src/lib/jobCloseoutStore.mjs';
import { readAia, locateAiaFolder } from './lib/jobCloseoutAia.mjs';
import { readProcore } from './lib/jobCloseoutProcore.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const db = new PrismaClient();
const company = process.env.PROCORE_COMPANY_ID;
const projectId = process.argv.find((s) => s.startsWith('--project='))?.slice(10);
const exec = promisify(execFile);
const aiaRoot =
  process.env.JOB_CLOSEOUT_AIA_ROOT ||
  path.join(
    os.homedir(),
    'Paradise Masonry',
    'Paradise Masonry - 1 SALES DEPARTMENT',
    '1. Sales And Estimating Files',
    'AIA Documents',
  );

async function prepare(review, folder) {
  let settings = {};
  try {
    settings = JSON.parse(await readFile(path.join(root, '.tmp/job-closeout-settings.json'), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw Error('Check desktop closeout settings.');
  }
  const config = settings[company + '/' + review.projectId] ?? {};
  const project = await db.pmcProject.findUnique({
    where: { companyId_procoreProjectId: { companyId: company, procoreProjectId: review.projectId } },
    select: { customer: true },
  });
  if (!project) throw Error('Canonical Procore project is missing.');
  const snapshot = await db.qboProfitabilitySnapshot.findFirst({
    where: { readOnly: true, rows: { some: { recordType: 'project' } } },
    orderBy: { sourceGeneratedAt: 'desc' },
    select: { id: true },
  });
  if (!snapshot) throw Error('Import the QBO profitability snapshot.');
  const matches = await db.qboProjectProfitabilityRow.findMany({
    where: { snapshotId: snapshot.id, recordType: 'project', procoreProjectId: review.projectId },
    select: { qboCustomerId: true },
  });
  if (matches.length !== 1 || !/^\d+$/.test(matches[0].qboCustomerId))
    throw Error('Resolve the QBO project mapping in the profitability import.');
  const customer = matches[0].qboCustomerId;
  let aia;
  try {
    folder =
      folder ||
      config.folder ||
      (await locateAiaFolder(aiaRoot, project.customer, review.projectName, review.projectNumber));
    aia = await readAia(aiaRoot, folder);
  } catch {
    aia = {
      apps: [],
      schedule: [],
      issues: ['The selected AIA folder could not be read. Check the folder and shared-drive connection.'],
      complete: false,
    };
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|WINDIR|COMSPEC|PATHEXT)$/i.test(key),
    ),
  );
  let qbo;
  try {
    const result = await exec(
      process.execPath,
      [path.join(root, 'scripts/lib/jobCloseoutQbo.mjs'), customer, company],
      {
        cwd: process.env.JOB_CLOSEOUT_QBO_ROOT || path.resolve(root, '../QBO_1'),
        env,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
        timeout: 180000,
      },
    );
    qbo = JSON.parse(result.stdout);
  } catch {
    throw Error('QuickBooks read failed. Verify the QBO host connection and project mapping, then refresh.');
  }
  const procore = await readProcore(company, review.projectId);
  const report = buildCloseout({ ...procore, qbo, aia, projectId: review.projectId, signed: config.signed ?? [] });
  return {
    folder,
    report: {
      ...report,
      company,
      projectId: review.projectId,
      qboCustomerId: customer,
      contractor: project.customer,
      folder,
      asOf: new Date().toISOString(),
    },
  };
}

async function work() {
  await discoverCloseouts(db, company);
  // Both the current PM cycle and highest revision must still be eligible.
  for (let i = 0; i < 4; i++) {
    const candidates =
      await db.$queryRaw`SELECT j.id FROM job_closeout_runs j JOIN productivity_project_reviews r ON r.id=j.review_id
      WHERE r.company_id=${company} AND (${projectId ?? null}::text IS NULL OR r.project_id=${projectId ?? null}) AND r.status='completed' AND r.completion_count=j.cycle
        AND j.state IN ('queued','running','retrying') AND j.retry_at<=now()
        AND NOT EXISTS (SELECT 1 FROM job_closeout_runs n WHERE n.review_id=j.review_id AND n.cycle=j.cycle AND n.revision>j.revision)
      ORDER BY j.requested_by IS NULL, j.requested_at LIMIT 1`;
    if (!candidates.length) break;
    const id = candidates[0].id,
      claim = randomUUID();
    const leased = await db.jobCloseoutRun.updateMany({
      where: { id, state: { in: ['queued', 'running', 'retrying'] }, retryAt: { lte: new Date() } },
      data: { state: 'running', claim, attempts: { increment: 1 }, retryAt: new Date(Date.now() + 20 * 60000) },
    });
    if (!leased.count) continue;
    const job = await db.jobCloseoutRun.findUniqueOrThrow({ where: { id }, include: { review: true } });
    const where = { id, claim, state: 'running', review: { status: 'completed', completionCount: job.cycle } };
    try {
      const { folder, report } = await prepare(job.review, job.folder);
      await db.jobCloseoutRun.updateMany({
        where,
        data: {
          state: report.complete ? 'ready' : 'partial',
          claim: null,
          error: null,
          generatedAt: new Date(),
          folder,
          report,
        },
      });
    } catch (e) {
      const transient = job.attempts < 3;
      const safeError = String(e.message).split('\n')[0].slice(0, 240);
      await db.jobCloseoutRun.updateMany({
        where,
        data: {
          state: transient ? 'retrying' : 'failed',
          error: safeError,
          claim: null,
          retryAt: new Date(Date.now() + job.attempts * 15 * 60000),
        },
      });
      console.error(job.review.projectId, safeError);
    }
  }
}
try {
  if (!company || (projectId && !/^\d+$/.test(projectId)))
    throw Error('Supply a valid project ID and company configuration.');
  const mode = process.argv[2];
  if (mode === '--work') await work();
  else if (mode === '--show')
    console.log(JSON.stringify(await closeoutQueue(db, company, projectId ?? null), null, 2));
  else if (mode === '--preview' && projectId) {
    const review = await db.productivityProjectReview.findFirstOrThrow({
      where: { companyId: company, projectId, status: 'completed' },
    });
    console.log(JSON.stringify(await prepare(review, null), null, 2));
  } else throw Error('Use --work, --show [--project=ID] or --preview --project=ID.');
} finally {
  await db.$disconnect();
}

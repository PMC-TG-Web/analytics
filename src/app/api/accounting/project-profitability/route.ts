import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { loadUserAssignedPermissionsFromDatabase } from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMAND_TIMEOUT_MS = 15 * 60 * 1000;

type CommandResult = {
  stdout: string;
  stderr: string;
};

type SpawnResult = CommandResult & {
  executable: string;
};

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

function billingByCustomerId(summary: unknown) {
  const summaryRecord = summary && typeof summary === 'object' && !Array.isArray(summary)
    ? summary as Record<string, unknown>
    : {};
  const projects = summaryRecord.qboCostDrillthroughProjects;
  return projects && typeof projects === 'object' && !Array.isArray(projects)
    ? projects as Record<string, Record<string, unknown>>
    : {};
}

function finiteBillingNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function requireAdministrator(request: NextRequest) {
  const email = await getRequestUserEmail(request);
  if (!email) return { allowed: false as const, response: noStoreJson({ error: 'Unauthorized' }, 401) };
  const assigned = await loadUserAssignedPermissionsFromDatabase(prisma, email);
  const allowed = assigned.some((permission) => [
    'OWNER',
    'ADMIN',
    'ACCOUNTING-PROJECT-PROFITABILITY',
  ].includes(permission.toUpperCase()));
  if (!allowed) return { allowed: false as const, response: noStoreJson({ error: 'Forbidden' }, 403) };
  return { allowed: true as const, email };
}

function summarizeOutput(output: string) {
  const trimmed = String(output || '').trim();
  if (!trimmed) return '';
  const lines = trimmed.split(/\r?\n/);
  const lastLines = lines.slice(-8).join('\n');
  return lastLines.length > 2000
    ? `${lastLines.slice(0, 2000)}...`
    : lastLines;
}

function normalizeHttpsUrl(value: string, label: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${label} must be an HTTPS URL without embedded credentials or hash fragments.`);
  }
  return parsed.toString();
}

function decodePairingKey(value: string) {
  let key: Buffer;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw new Error('QBO_PROFITABILITY_REFRESH_PAIRING_KEY_BASE64 must be a valid base64 value.');
  }

  if (key.length !== 32) {
    throw new Error('QBO_PROFITABILITY_REFRESH_PAIRING_KEY_BASE64 must decode to exactly 32 bytes.');
  }

  return key;
}

function extractWordPressRestRoute(absoluteUrl: string) {
  const parsed = new URL(absoluteUrl);
  const marker = '/wp-json';
  const markerIndex = parsed.pathname.indexOf(marker);
  if (markerIndex === -1) {
    return parsed.pathname;
  }
  const route = parsed.pathname.slice(markerIndex + marker.length);
  return route.startsWith('/') ? route : `/${route}`;
}

function createWordPressHmacHeaders({
  pairingKey,
  method,
  route,
  bodyText,
}: {
  pairingKey: Buffer;
  method: string;
  route: string;
  bodyText: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(24).toString('base64url');
  const canonical = [
    timestamp,
    nonce,
    method.toUpperCase(),
    route,
    crypto.createHash('sha256').update(bodyText).digest('hex'),
  ].join('\n');
  const signature = crypto.createHmac('sha256', pairingKey).update(canonical).digest('hex');

  return {
    'x-pmc-timestamp': timestamp,
    'x-pmc-nonce': nonce,
    'x-pmc-signature': signature,
  };
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveNodeExecutables() {
  const candidates = [
    process.env.QBO_NODE_EXECUTABLE,
    process.execPath,
    'node',
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return [...new Set(candidates)];
}

async function runProcess(executable: string, cwd: string, scriptPath: string) {
  return await new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(executable, [scriptPath], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`The refresh command timed out after ${Math.round(COMMAND_TIMEOUT_MS / 60000)} minutes.`));
        return;
      }
      if (code !== 0) {
        const detail = summarizeOutput(stderr) || summarizeOutput(stdout) || `Process exited with code ${code}.`;
        reject(new Error(detail));
        return;
      }
      resolve({ executable, stdout, stderr });
    });
  });
}

async function runNodeCommand(cwd: string, scriptPath: string) {
  const executables = resolveNodeExecutables();
  let lastError: unknown = null;

  for (const executable of executables) {
    try {
      const result = await runProcess(executable, cwd, scriptPath);
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : 'Unknown spawn failure.';
  throw new Error(`Unable to launch Node for refresh scripts. Tried: ${executables.join(', ')}. ${detail}`);
}

async function triggerRemoteRefreshWebhook() {
  const webhookUrlRaw = String(process.env.QBO_PROFITABILITY_REFRESH_WEBHOOK_URL || '').trim();
  if (!webhookUrlRaw) {
    return { configured: false as const };
  }

  const webhookUrl = normalizeHttpsUrl(
    webhookUrlRaw,
    'QBO_PROFITABILITY_REFRESH_WEBHOOK_URL',
  );
  const webhookSecret = String(process.env.QBO_PROFITABILITY_REFRESH_WEBHOOK_SECRET || '').trim();
  const pairingKeyBase64 = String(process.env.QBO_PROFITABILITY_REFRESH_PAIRING_KEY_BASE64 || '').trim();
  const timeoutMs = Number(process.env.QBO_PROFITABILITY_REFRESH_WEBHOOK_TIMEOUT_MS || 45_000);
  const bodyText = JSON.stringify({
    source: 'analytics-qbo-profitability-button',
    requestedAt: new Date().toISOString(),
  });

  const hmacHeaders = pairingKeyBase64
    ? createWordPressHmacHeaders({
        pairingKey: decodePairingKey(pairingKeyBase64),
        method: 'POST',
        route: extractWordPressRestRoute(webhookUrl),
        bodyText,
      })
    : {};

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(webhookSecret ? { 'x-qbo-refresh-secret': webhookSecret } : {}),
      ...hmacHeaders,
    },
    body: bodyText,
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45_000),
  });

  const responseText = await response.text();
  let responseBody: unknown = null;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = responseText;
  }

  if (!response.ok) {
    const detail = typeof responseBody === 'string'
      ? summarizeOutput(responseBody)
      : summarizeOutput(JSON.stringify(responseBody || {}));
    throw new Error(`Remote refresh webhook failed (${response.status}). ${detail}`);
  }

  return {
    configured: true as const,
    requestId: responseBody && typeof responseBody === 'object' && 'requestId' in responseBody
      ? String(responseBody.requestId || '')
      : '',
    status: responseBody && typeof responseBody === 'object' && 'status' in responseBody
      ? String(responseBody.status || '')
      : '',
    details: typeof responseBody === 'string'
      ? summarizeOutput(responseBody)
      : summarizeOutput(JSON.stringify(responseBody || {})),
  };
}

async function readRemoteRefreshStatus() {
  const webhookUrlRaw = String(process.env.QBO_PROFITABILITY_REFRESH_WEBHOOK_URL || '').trim();
  if (!webhookUrlRaw) return { configured: false as const };

  const webhookUrl = new URL(normalizeHttpsUrl(
    webhookUrlRaw,
    'QBO_PROFITABILITY_REFRESH_WEBHOOK_URL',
  ));
  webhookUrl.pathname = `${webhookUrl.pathname.replace(/\/$/, '')}/status`;
  webhookUrl.searchParams.set('_pmc_cache_bust', crypto.randomBytes(12).toString('hex'));

  const pairingKeyBase64 = String(process.env.QBO_PROFITABILITY_REFRESH_PAIRING_KEY_BASE64 || '').trim();
  if (!pairingKeyBase64) {
    throw new Error('QBO_PROFITABILITY_REFRESH_PAIRING_KEY_BASE64 is required to read refresh status.');
  }

  const timeoutMs = Number(process.env.QBO_PROFITABILITY_REFRESH_WEBHOOK_TIMEOUT_MS || 45_000);
  const response = await fetch(webhookUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
      ...createWordPressHmacHeaders({
        pairingKey: decodePairingKey(pairingKeyBase64),
        method: 'GET',
        route: extractWordPressRestRoute(webhookUrl.toString()),
        bodyText: '',
      }),
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45_000),
  });

  const responseText = await response.text();
  let responseBody: unknown = null;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = responseText;
  }

  if (!response.ok) {
    const detail = typeof responseBody === 'string'
      ? summarizeOutput(responseBody)
      : summarizeOutput(JSON.stringify(responseBody || {}));
    throw new Error(`Remote refresh status failed (${response.status}). ${detail}`);
  }

  const statusRecord = responseBody && typeof responseBody === 'object'
    ? responseBody as Record<string, unknown>
    : {};
  return {
    configured: true as const,
    status: String(statusRecord.status || 'idle'),
    requestId: String(statusRecord.requestId || ''),
    createdAt: String(statusRecord.createdAt || ''),
    startedAt: String(statusRecord.startedAt || ''),
    completedAt: String(statusRecord.completedAt || ''),
    message: String(statusRecord.message || ''),
  };
}

export async function GET(request: NextRequest) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator.allowed) return administrator.response;

    if (request.nextUrl.searchParams.get('refreshStatus') === '1') {
      const remote = await readRemoteRefreshStatus();
      return noStoreJson({ success: true, refresh: remote });
    }

    const requestedSnapshotId = String(request.nextUrl.searchParams.get('snapshotId') || '').trim();
    if (requestedSnapshotId.length > 128) {
      return noStoreJson({ error: 'Invalid snapshot ID' }, 400);
    }

    const snapshots = await prisma.qboProfitabilitySnapshot.findMany({
      orderBy: { importedAt: 'desc' },
      take: 24,
      select: {
        id: true,
        sourceGeneratedAt: true,
        startDate: true,
        endDate: true,
        accountingMethod: true,
        readOnly: true,
        sourceCounts: true,
        importedAt: true,
        _count: { select: { rows: true } },
      },
    });

    const selected = requestedSnapshotId
      ? snapshots.find((snapshot) => snapshot.id === requestedSnapshotId)
      : snapshots[0];
    if (requestedSnapshotId && !selected) {
      return noStoreJson({ error: 'Snapshot not found' }, 404);
    }

    const rows = selected
      ? await prisma.qboProjectProfitabilityRow.findMany({
          where: { snapshotId: selected.id },
          orderBy: [{ sales: 'desc' }, { fullyQualifiedName: 'asc' }],
        })
      : [];
    const selectedSummary = selected
      ? await prisma.qboProfitabilitySnapshot.findUnique({
          where: { id: selected.id },
          select: { summary: true },
        })
      : null;
    const selectedBilling = billingByCustomerId(selectedSummary?.summary);

    return noStoreJson({
      success: true,
      selectedSnapshotId: selected?.id || null,
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        sourceGeneratedAt: snapshot.sourceGeneratedAt.toISOString(),
        startDate: snapshot.startDate.toISOString().slice(0, 10),
        endDate: snapshot.endDate.toISOString().slice(0, 10),
        accountingMethod: snapshot.accountingMethod,
        readOnly: snapshot.readOnly,
        sourceCounts: snapshot.sourceCounts,
        importedAt: snapshot.importedAt.toISOString(),
        rowCount: snapshot._count.rows,
      })),
      rows: rows.map((row) => {
        const project = selectedBilling[row.qboCustomerId] || {};
        const billing = project.billing && typeof project.billing === 'object' && !Array.isArray(project.billing)
          ? project.billing as Record<string, unknown>
          : {};
        return {
          id: row.id,
          qboCustomerId: row.qboCustomerId,
          recordType: row.recordType,
          projectName: row.projectName,
          fullyQualifiedName: row.fullyQualifiedName,
          active: row.active,
          procoreProjectId: row.procoreProjectId,
          procoreProjectNumber: row.procoreProjectNumber,
          procoreProjectName: row.procoreProjectName,
          procoreMatchMethod: row.procoreMatchMethod,
          procoreDirectCost: row.procoreDirectCost == null ? null : Number(row.procoreDirectCost),
          procoreDirectCostLineCount: row.procoreDirectCostLineCount,
          procoreDirectCostStatus: row.procoreDirectCostStatus,
          qboMinusProcoreDirectCost: row.qboMinusProcoreDirectCost == null
            ? null
            : Number(row.qboMinusProcoreDirectCost),
          qboInvoiceCount: Math.max(0, Number(billing.invoiceCount || 0)),
          qboGrossInvoiced: finiteBillingNumber(billing.billed) || 0,
          qboNetBilled: finiteBillingNumber(billing.netBilled),
          qboCollected: finiteBillingNumber(billing.collected) || 0,
          qboOutstanding: finiteBillingNumber(billing.outstanding) || 0,
          qboCollectionPercent: finiteBillingNumber(billing.collectionPercent),
          qboOverdueAmount: finiteBillingNumber(billing.overdueAmount) || 0,
          qboEstimateTotal: finiteBillingNumber(billing.estimateTotal),
          qboBillingProgressPercent: finiteBillingNumber(billing.billingProgressPercent),
          qboRemainingToBill: finiteBillingNumber(billing.remainingToBill),
          qboBillingReconciliationDifference: finiteBillingNumber(billing.netBilled) == null
            ? null
            : Number((Number(billing.netBilled) - Number(row.sales)).toFixed(2)),
          sales: Number(row.sales),
          costOfGoodsSold: Number(row.costOfGoodsSold),
          operatingExpenses: Number(row.operatingExpenses),
          otherIncome: Number(row.otherIncome),
          otherExpenses: Number(row.otherExpenses),
          actualCost: Number(row.actualCost),
          profit: Number(row.profit),
          marginPercent: row.marginPercent == null ? null : Number(row.marginPercent),
          reportedNetIncome: Number(row.reportedNetIncome),
          reconciliationDifference: Number(row.reconciliationDifference),
        };
      }),
    });
  } catch (error) {
    console.error('Failed to load QBO project profitability:', error);
    return noStoreJson({ error: 'Failed to load QBO project profitability' }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const administrator = await requireAdministrator(request);
    if (!administrator.allowed) return administrator.response;

    const analyticsRoot = process.cwd();
    const qboIntegrationRoot = process.env.QBO_INTEGRATION_ROOT?.trim()
      || path.resolve(analyticsRoot, '..', 'QBO_1');

    const qboReportScriptPath = path.join(qboIntegrationRoot, 'src', 'report-project-profitability.js');
    const importScriptPath = path.join(analyticsRoot, 'scripts', 'importQboProjectProfitability.mjs');

    const [hasQboReportScript, hasImportScript] = await Promise.all([
      pathExists(qboReportScriptPath),
      pathExists(importScriptPath),
    ]);

    if (hasQboReportScript && hasImportScript) {
      const qboResult = await runNodeCommand(qboIntegrationRoot, qboReportScriptPath);
      const importResult = await runNodeCommand(analyticsRoot, importScriptPath);

      const latestSnapshot = await prisma.qboProfitabilitySnapshot.findFirst({
        orderBy: { importedAt: 'desc' },
        select: { id: true, importedAt: true, _count: { select: { rows: true } } },
      });

      return noStoreJson({
        success: true,
        refreshMode: 'local',
        message: 'Refreshed Procore and QBO profitability data and imported the latest snapshot.',
        selectedSnapshotId: latestSnapshot?.id || null,
        importedAt: latestSnapshot?.importedAt.toISOString() || null,
        rowCount: latestSnapshot?._count.rows || 0,
        details: {
          mode: 'local-scripts',
          qbo: summarizeOutput(qboResult.stdout || qboResult.stderr),
          import: summarizeOutput(importResult.stdout || importResult.stderr),
        },
      });
    }

    const remote = await triggerRemoteRefreshWebhook();
    if (!remote.configured) {
      return noStoreJson({
        error: 'Refresh is not configured for this environment. Configure QBO_PROFITABILITY_REFRESH_WEBHOOK_URL to trigger the integration-machine refresh job.',
        details: {
          qboIntegrationRoot,
          qboReportScriptPath,
          importScriptPath,
          hasQboReportScript,
          hasImportScript,
        },
      }, 503);
    }

    const latestSnapshot = await prisma.qboProfitabilitySnapshot.findFirst({
      orderBy: { importedAt: 'desc' },
      select: { id: true, importedAt: true, _count: { select: { rows: true } } },
    });

    return noStoreJson({
      success: true,
      refreshMode: 'remote',
      message: 'Refresh started on the integration machine. The new snapshot should appear shortly.',
      requestId: remote.requestId,
      refreshStatus: remote.status,
      selectedSnapshotId: latestSnapshot?.id || null,
      importedAt: latestSnapshot?.importedAt.toISOString() || null,
      rowCount: latestSnapshot?._count.rows || 0,
      details: {
        mode: 'remote-webhook',
        webhook: remote.details,
      },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Failed to refresh Procore and QBO profitability data.';
    console.error('Failed to refresh QBO project profitability:', error);
    return noStoreJson({ error: message }, 500);
  }
}

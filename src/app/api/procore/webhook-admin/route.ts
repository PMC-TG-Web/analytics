import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { procoreConfig } from '@/lib/procore';

const API_URL = (process.env.PROCORE_API_URL || 'https://api.procore.com').replace(/\/$/, '');

// Resources and event types to register triggers for.
const TRIGGER_PLAN = [
  { resourceName: 'Projects', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Timecard Entries', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Productivity Logs', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Commitment Contracts', eventTypes: ['create', 'update', 'delete'] },
];

function getDestinationUrl(): string {
  const appBase = (process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || '').replace(/\/$/, '');
  if (appBase && !appBase.includes('localhost')) {
    return `${appBase}/api/webhooks/procore`;
  }
  return 'https://analytics-nine-phi.vercel.app/api/webhooks/procore';
}

async function procoreFetch(
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
) {
  const companyId = procoreConfig.companyId;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Procore-Company-Id': companyId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }

  return { ok: res.ok, status: res.status, body: json };
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('procore_access_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'No Procore session. Log in via /procore first.' }, { status: 401 });
  }

  const companyId = procoreConfig.companyId;
  const { ok, status, body } = await procoreFetch(token, 'GET', `/rest/v2.0/companies/${companyId}/webhooks/hooks`);
  if (!ok) {
    return NextResponse.json({ error: 'Failed to list hooks', status, detail: body }, { status: 502 });
  }

  const hooks = Array.isArray((body as Record<string, unknown>)?.data)
    ? ((body as Record<string, unknown>).data as unknown[])
    : Array.isArray(body) ? (body as unknown[]) : [];

  const results = [];
  for (const hook of hooks) {
    const h = hook as Record<string, unknown>;
    const triggersRes = await procoreFetch(token, 'GET', `/rest/v2.0/companies/${companyId}/webhooks/hooks/${h.id}/triggers`);
    const triggers = Array.isArray((triggersRes.body as Record<string, unknown>)?.data)
      ? ((triggersRes.body as Record<string, unknown>).data as unknown[])
      : [];
    results.push({ ...h, triggers });
  }

  return NextResponse.json({ hooks: results });
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('procore_access_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'No Procore session. Log in via /procore first.' }, { status: 401 });
  }

  const sharedSecret = (process.env.PROCORE_WEBHOOK_SHARED_SECRET || '').trim();
  if (!sharedSecret) {
    return NextResponse.json({ error: 'PROCORE_WEBHOOK_SHARED_SECRET is not configured' }, { status: 503 });
  }

  const companyId = procoreConfig.companyId;
  const destinationUrl = getDestinationUrl();

  // Create the hook
  const hookRes = await procoreFetch(token, 'POST', `/rest/v2.0/companies/${companyId}/webhooks/hooks`, {
    payload_version: 'v2',
    namespace: 'pmc-analytics',
    destination_url: destinationUrl,
    destination_headers: {
      Authorization: `Bearer ${sharedSecret}`,
    },
  });

  if (!hookRes.ok) {
    return NextResponse.json(
      { error: 'Failed to create hook', status: hookRes.status, detail: hookRes.body },
      { status: 502 }
    );
  }

  const hookData = (hookRes.body as Record<string, unknown>)?.data ?? hookRes.body;
  const hookId = (hookData as Record<string, unknown>)?.id;
  if (!hookId) {
    return NextResponse.json({ error: 'Hook created but no id in response', raw: hookRes.body }, { status: 502 });
  }

  // Register all triggers
  const triggerResults: { resourceName: string; eventType: string; ok: boolean; detail?: unknown }[] = [];
  for (const { resourceName, eventTypes } of TRIGGER_PLAN) {
    for (const eventType of eventTypes) {
      const tRes = await procoreFetch(token, 'POST', `/rest/v2.0/companies/${companyId}/webhooks/hooks/${hookId}/triggers`, {
        resource_name: resourceName,
        event_type: eventType,
        api_version: 'v2',
      });
      triggerResults.push({
        resourceName,
        eventType,
        ok: tRes.ok,
        detail: tRes.ok ? undefined : tRes.body,
      });
    }
  }

  const failed = triggerResults.filter((t) => !t.ok);
  return NextResponse.json({
    success: true,
    hookId,
    destinationUrl,
    triggers: triggerResults,
    failedTriggers: failed.length,
  });
}

export async function DELETE(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('procore_access_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'No Procore session. Log in via /procore first.' }, { status: 401 });
  }

  const { hookId } = (await request.json().catch(() => ({}))) as { hookId?: string };
  if (!hookId) {
    return NextResponse.json({ error: 'hookId is required in request body' }, { status: 400 });
  }

  const companyId = procoreConfig.companyId;
  const delRes = await procoreFetch(token, 'DELETE', `/rest/v2.0/companies/${companyId}/webhooks/hooks/${hookId}`);
  if (!delRes.ok) {
    return NextResponse.json({ error: 'Failed to delete hook', status: delRes.status, detail: delRes.body }, { status: 502 });
  }

  return NextResponse.json({ success: true, deleted: hookId });
}

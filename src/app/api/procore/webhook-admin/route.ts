import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { procoreConfig } from '@/lib/procore';
import {
  COMPANY_WEBHOOK_TRIGGER_PLAN,
  WEBHOOK_NAMESPACE,
  resolveTriggerPlan,
} from '@/lib/procoreWebhookPlan';

const API_URL = (process.env.PROCORE_API_URL || 'https://api.procore.com').replace(/\/$/, '');

// Company-level hook only. Project-tool resources (RFIs, Task Items, Meetings,
// change orders, timecards) require per-project hooks; see
// scripts/registerProcoreWebhook.mjs --register-projects and project onboarding.

type ResourceCatalogItem = {
  name: string;
  actions: string[];
};

function getDestinationUrl(): string {
  const appBase = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  if (appBase && !appBase.includes('localhost')) {
    return `${appBase}/api/webhooks/procore`;
  }
  return 'https://analyticspmc.netlify.app/api/webhooks/procore';
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

async function listResourcesAll(token: string, companyId: string): Promise<ResourceCatalogItem[]> {
  const perPage = 100;
  const maxPages = 20;
  const all: ResourceCatalogItem[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const resourcesRes = await procoreFetch(
      token,
      'GET',
      `/rest/v2.0/companies/${companyId}/webhooks/resources?payload_version=v2.0&page=${page}&per_page=${perPage}`
    );

    if (!resourcesRes.ok) {
      throw new Error(`Resources lookup failed on page ${page}: ${JSON.stringify(resourcesRes.body)}`);
    }

    const items = Array.isArray((resourcesRes.body as Record<string, unknown>)?.data)
      ? ((resourcesRes.body as Record<string, unknown>).data as Array<Record<string, unknown>>)
      : [];

    if (!items.length) {
      break;
    }

    for (const item of items) {
      all.push({
        name: String(item.name || '').trim(),
        actions: Array.isArray(item.actions)
          ? item.actions.map((a) => String(a).trim().toLowerCase()).filter(Boolean)
          : [],
      });
    }

    if (items.length < perPage) {
      break;
    }
  }

  return all;
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('procore_access_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'No Procore session. Log in via /procore first.' }, { status: 401 });
  }

  const companyId = procoreConfig.companyId;
  const { searchParams } = new URL(request.url);
  const mode = (searchParams.get('mode') || '').trim().toLowerCase();

  // Server-side proxy for resources list to avoid browser CORS issues.
  if (mode === 'resources') {
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('per_page') || '100', 10) || 100));
    const resourcesRes = await procoreFetch(
      token,
      'GET',
      `/rest/v2.0/companies/${companyId}/webhooks/resources?payload_version=v2.0&page=${page}&per_page=${perPage}`
    );
    if (!resourcesRes.ok) {
      return NextResponse.json(
        { error: 'Failed to list resources', status: resourcesRes.status, detail: resourcesRes.body },
        { status: 502 }
      );
    }

    const resources = Array.isArray((resourcesRes.body as Record<string, unknown>)?.data)
      ? ((resourcesRes.body as Record<string, unknown>).data as unknown[])
      : [];
    const simplified = resources.map((r) => {
      const item = r as Record<string, unknown>;
      return {
        name: item.name,
        actions: item.actions,
        category: item.category,
        tool: item.tool,
        payload_version: item.payload_version,
      };
    });

    return NextResponse.json({ page, per_page: perPage, resources: simplified });
  }

  // Fetch all resources across pages (up to a safe cap) to inspect full catalog.
  if (mode === 'resources-all') {
    const perPage = 100;
    const maxPages = 20;
    const all: Array<Record<string, unknown>> = [];

    for (let page = 1; page <= maxPages; page++) {
      const resourcesRes = await procoreFetch(
        token,
        'GET',
        `/rest/v2.0/companies/${companyId}/webhooks/resources?payload_version=v2.0&page=${page}&per_page=${perPage}`
      );

      if (!resourcesRes.ok) {
        return NextResponse.json(
          {
            error: 'Failed to list resources',
            page,
            status: resourcesRes.status,
            detail: resourcesRes.body,
          },
          { status: 502 }
        );
      }

      const items = Array.isArray((resourcesRes.body as Record<string, unknown>)?.data)
        ? ((resourcesRes.body as Record<string, unknown>).data as Record<string, unknown>[])
        : [];

      if (!items.length) {
        break;
      }

      all.push(
        ...items.map((item) => ({
          name: item.name,
          actions: item.actions,
          category: item.category,
          tool: item.tool,
          payload_version: item.payload_version,
        }))
      );

      if (items.length < perPage) {
        break;
      }
    }

    return NextResponse.json({ count: all.length, resources: all });
  }

  const { ok, status, body } = await procoreFetch(
    token,
    'GET',
    `/rest/v2.0/companies/${companyId}/webhooks/hooks?namespace=${encodeURIComponent(WEBHOOK_NAMESPACE)}`
  );
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

  let resourceCatalog: ResourceCatalogItem[] = [];
  try {
    resourceCatalog = await listResourcesAll(token, companyId);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch webhook resources catalog', detail: String(err) },
      { status: 502 }
    );
  }

  const { planned: triggerPlan, resolution: resolvedResources } = resolveTriggerPlan(
    COMPANY_WEBHOOK_TRIGGER_PLAN,
    resourceCatalog,
  );

  // Create the hook
  const hookRes = await procoreFetch(token, 'POST', `/rest/v2.0/companies/${companyId}/webhooks/hooks`, {
    payload_version: 'v2.0',
    namespace: WEBHOOK_NAMESPACE,
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

  // Register valid triggers only (filtered against resources catalog)
  const triggerResults: { resourceName: string; eventType: string; ok: boolean; detail?: unknown }[] = [];
  for (const { resourceName, eventType } of triggerPlan) {
    const tRes = await procoreFetch(token, 'POST', `/rest/v2.0/companies/${companyId}/webhooks/hooks/${hookId}/triggers`, {
      resource_name: resourceName,
      event_type: eventType,
      api_version: 'v2.0',
    });
    triggerResults.push({
      resourceName,
      eventType,
      ok: tRes.ok,
      detail: tRes.ok ? undefined : tRes.body,
    });
  }

  const failed = triggerResults.filter((t) => !t.ok);
  return NextResponse.json({
    success: true,
    hookId,
    destinationUrl,
    resourceResolution: resolvedResources,
    plannedTriggers: triggerPlan,
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

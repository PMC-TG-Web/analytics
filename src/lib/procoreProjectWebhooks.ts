import { makeRequest } from "@/lib/procore";
import {
  WEBHOOK_NAMESPACE,
  WEBHOOK_PAYLOAD_VERSION,
  projectWebhookPlanForGroups,
  resolveTriggerPlan,
  triggerKeySet,
} from "@/lib/procoreWebhookPlan";

type UnknownRecord = Record<string, unknown>;

export type ProjectWebhookEnsureResult = {
  projectId: string;
  hookId: string | null;
  hookCreated: boolean;
  triggersCreated: number;
  triggersExisting: number;
  unavailable: string[];
  apiRequests: number;
};

function rows(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) return payload.filter((r): r is UnknownRecord => Boolean(r) && typeof r === "object");
  const data = (payload as UnknownRecord | null)?.data;
  return Array.isArray(data) ? data.filter((r): r is UnknownRecord => Boolean(r) && typeof r === "object") : [];
}

function record(payload: unknown): UnknownRecord | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = (payload as UnknownRecord).data;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as UnknownRecord) : (payload as UnknownRecord);
}

export function projectWebhookDestinationUrl(): string {
  const base = String(process.env.WEBHOOK_DESTINATION_URL || "").trim();
  if (base) return base;
  const app = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (app && !/localhost|127\.0\.0\.1/i.test(app)) return `${app}/api/webhooks/procore`;
  return "https://analyticspmc.netlify.app/api/webhooks/procore";
}

/**
 * Idempotently ensures a project-level Procore webhook hook exists for this
 * app's namespace and carries the requested trigger set. Every request goes
 * through the shared Procore client so cooldowns and quota tracking apply.
 */
export async function ensureProjectWebhookHook(params: {
  companyId: string;
  projectId: string;
  token: string;
  groups?: string[];
  sharedSecret?: string;
}): Promise<ProjectWebhookEnsureResult> {
  const { companyId, projectId, token } = params;
  const sharedSecret = (params.sharedSecret ?? process.env.PROCORE_WEBHOOK_SHARED_SECRET ?? "").trim();
  if (!sharedSecret) throw new Error("PROCORE_WEBHOOK_SHARED_SECRET is not configured.");

  const base = `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/webhooks`;
  const destination = projectWebhookDestinationUrl();
  let apiRequests = 0;

  const existingHooks = rows(await makeRequest(
    `${base}/hooks?namespace=${encodeURIComponent(WEBHOOK_NAMESPACE)}`,
    token,
    { cache: "no-store" },
    companyId,
  ));
  apiRequests += 1;

  let hook = existingHooks.find((h) =>
    String(h.destination_url || "").trim() === destination
    && String(h.namespace || "").trim() === WEBHOOK_NAMESPACE)
    || existingHooks.find((h) => String(h.namespace || "").trim() === WEBHOOK_NAMESPACE)
    || null;
  let hookCreated = false;

  if (!hook) {
    hook = record(await makeRequest(`${base}/hooks`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload_version: WEBHOOK_PAYLOAD_VERSION,
        namespace: WEBHOOK_NAMESPACE,
        destination_url: destination,
        destination_headers: { Authorization: `Bearer ${sharedSecret}` },
      }),
    }, companyId));
    apiRequests += 1;
    hookCreated = true;
  }

  const hookId = hook?.id != null ? String(hook.id) : null;
  if (!hookId) throw new Error(`Project ${projectId}: webhook hook has no id.`);

  const [catalogPayload, triggersPayload] = [
    await makeRequest(
      `${base}/resources?payload_version=${WEBHOOK_PAYLOAD_VERSION}&page=1&per_page=100`,
      token,
      { cache: "no-store" },
      companyId,
    ),
    await makeRequest(`${base}/hooks/${encodeURIComponent(hookId)}/triggers?page=1&per_page=100`, token, { cache: "no-store" }, companyId),
  ];
  apiRequests += 2;

  const catalog = rows(catalogPayload).map((r) => ({
    name: String(r.name || "").trim(),
    actions: Array.isArray(r.actions) ? r.actions.map((a) => String(a).toLowerCase()) : [],
  }));
  const existingTriggers = rows(triggersPayload);
  const { planned, resolution } = resolveTriggerPlan(
    projectWebhookPlanForGroups(params.groups || []),
    catalog,
    triggerKeySet(existingTriggers),
  );

  let triggersCreated = 0;
  for (const trigger of planned) {
    await makeRequest(`${base}/hooks/${encodeURIComponent(hookId)}/triggers`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resource_name: trigger.resourceName,
        event_type: trigger.eventType,
        api_version: WEBHOOK_PAYLOAD_VERSION,
      }),
    }, companyId);
    apiRequests += 1;
    triggersCreated += 1;
  }

  return {
    projectId,
    hookId,
    hookCreated,
    triggersCreated,
    triggersExisting: existingTriggers.length,
    unavailable: resolution.filter((r) => r.reason).map((r) => `${r.requested}: ${r.reason}`),
    apiRequests,
  };
}

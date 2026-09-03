/**
 * Shared Procore webhook trigger plan. Plain JS so both the operational script
 * (scripts/registerProcoreWebhook.mjs) and TypeScript lib code can import it.
 *
 * Procore exposes two webhook catalogs:
 *  - company-level: Projects, Company Users, Project Stages, ... (portfolio/company tools)
 *  - project-level: RFIs, Task Items, Meetings, change orders, timecards, ... (project tools)
 * A company hook never receives project-tool events, so those resources must be
 * registered on a hook per project.
 */

export const WEBHOOK_NAMESPACE = 'pmc-analytics';
export const WEBHOOK_PAYLOAD_VERSION = 'v2.0';

/** Company-level hook triggers. */
export const COMPANY_WEBHOOK_TRIGGER_PLAN = [
  { resourceName: 'Projects', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Bid Board Projects', eventTypes: ['create', 'update', 'delete'] },
  { resourceName: 'Estimating Projects', eventTypes: ['create', 'update', 'delete'] },
];

/**
 * Project-level hook triggers. `group` lets callers opt into higher-volume
 * resources separately from the PM dashboard / change-order priority set.
 */
export const PROJECT_WEBHOOK_TRIGGER_PLAN = [
  { group: 'priority', resourceName: 'RFIs', eventTypes: ['create', 'update', 'delete'] },
  { group: 'priority', resourceName: 'Task Items', eventTypes: ['create', 'update', 'delete'] },
  { group: 'priority', resourceName: 'Meetings', eventTypes: ['create', 'update', 'delete'] },
  { group: 'priority', resourceName: 'Potential Change Orders', eventTypes: ['create', 'update'] },
  { group: 'priority', resourceName: 'Change Order Packages', eventTypes: ['create', 'update'] },
  { group: 'actuals', resourceName: 'Timecard Entries', eventTypes: ['create', 'update', 'delete'] },
  { group: 'actuals', resourceName: 'Productivity Logs', eventTypes: ['create', 'update', 'delete'] },
];

export const DEFAULT_PROJECT_WEBHOOK_GROUPS = ['priority'];

export const RESOURCE_ALIASES = {
  Projects: ['Projects'],
  'Bid Board Projects': ['Bid Board Projects', 'Bidboard Projects', 'Bid Board Projects V2'],
  'Estimating Projects': ['Estimating Projects', 'Bid Board Projects', 'Bidboard Projects', 'Projects'],
  'Timecard Entries': ['Timecard Entries', 'Timecards', 'Timecard Entries V2'],
  'Productivity Logs': ['Productivity Logs', 'Manpower Logs'],
  'Commitment Contracts': ['Commitment Contracts', 'Subcontracts'],
  'Potential Change Orders': ['Potential Change Orders'],
  'Prime Contract Change Orders': ['Prime Contract Change Orders', 'Change Order Packages'],
  'Change Order Packages': ['Change Order Packages', 'Prime Contract Change Orders'],
  RFIs: ['RFIs', 'RFI'],
  'Task Items': ['Task Items'],
  Meetings: ['Meetings'],
};

/**
 * @param {string | string[] | undefined} groups
 * @returns {string[]}
 */
export function resolveProjectWebhookGroups(groups) {
  const raw = Array.isArray(groups) ? groups : String(groups || '').split(',');
  const cleaned = raw.map((g) => String(g || '').trim().toLowerCase()).filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)) : [...DEFAULT_PROJECT_WEBHOOK_GROUPS];
}

/**
 * @param {string[]} groups
 */
export function projectWebhookPlanForGroups(groups) {
  const wanted = new Set(resolveProjectWebhookGroups(groups));
  return PROJECT_WEBHOOK_TRIGGER_PLAN.filter((entry) => wanted.has(entry.group));
}

/**
 * Resolve desired triggers against a webhook resource catalog.
 * @param {Array<{ resourceName: string; eventTypes: string[] }>} plan
 * @param {Array<{ name: string; actions: string[] }>} catalog
 * @param {Set<string>} [existingTriggerKeys] lower-cased "resource::event" keys already registered
 */
export function resolveTriggerPlan(plan, catalog, existingTriggerKeys = new Set()) {
  const catalogByName = new Map(catalog.map((r) => [String(r.name || '').trim().toLowerCase(), r]));
  const planned = [];
  const plannedKeys = new Set(existingTriggerKeys);
  const resolution = [];

  for (const desired of plan) {
    const aliases = RESOURCE_ALIASES[desired.resourceName] || [desired.resourceName];
    const matched = aliases
      .map((alias) => catalogByName.get(alias.toLowerCase()))
      .find((item) => Boolean(item));

    if (!matched) {
      resolution.push({ requested: desired.resourceName, reason: 'resource not available in this catalog' });
      continue;
    }

    const allowed = new Set((matched.actions || []).map((a) => String(a).toLowerCase()));
    const validEvents = desired.eventTypes.map((e) => e.toLowerCase()).filter((e) => allowed.has(e));
    if (!validEvents.length) {
      resolution.push({
        requested: desired.resourceName,
        matched: matched.name,
        reason: `no overlapping actions; available=${(matched.actions || []).join(',')}`,
      });
      continue;
    }

    resolution.push({ requested: desired.resourceName, matched: matched.name });
    for (const eventType of validEvents) {
      const key = `${matched.name.toLowerCase()}::${eventType}`;
      if (plannedKeys.has(key)) continue;
      planned.push({ resourceName: matched.name, eventType });
      plannedKeys.add(key);
    }
  }

  return { planned, resolution };
}

/**
 * @param {Array<{ resource_name?: unknown; event_type?: unknown }>} triggers
 */
export function triggerKeySet(triggers) {
  return new Set(
    triggers.map((t) => `${String(t?.resource_name || '').toLowerCase()}::${String(t?.event_type || '').toLowerCase()}`),
  );
}

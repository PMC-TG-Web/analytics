import {
  selectProjectManagerRecipientsForDomain,
  type ProjectRoleLike,
  type ProjectUserLike,
} from "@/lib/timecardNotification";

const SHELLY_EMAIL = "shelly@pmcdecor.com";
const PROJECT_MANAGER_EMAIL_DOMAIN = "pmcdecor.com";
const TASK_DUE_OFFSET_DAYS = 7;

type JsonObject = Record<string, unknown>;

export type CommitmentMakerChangeOrderContext = {
  packageId: string;
  number: string;
  title: string;
  amount: number | null;
};

export type CommitmentMakerTaskRequest = (params: {
  path: string;
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
}) => Promise<unknown>;

export type CommitmentMakerTaskSpec = {
  kind: "aia_billing" | "commitment_verification";
  tag: string;
  title: string;
  description: string;
  dueDate: string;
};

export type CommitmentMakerTaskAssignees = {
  shellyAssigneeId: number;
  projectManagerAssigneeIds: number[];
};

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asRows(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) {
    return payload.map(asObject).filter((item): item is JsonObject => Boolean(item));
  }
  const record = asObject(payload);
  if (!record) return [];
  for (const candidate of [record.data, record.task_items, record.items, record.results]) {
    if (Array.isArray(candidate)) {
      return candidate.map(asObject).filter((item): item is JsonObject => Boolean(item));
    }
  }
  return [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numericId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function currency(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function userEmail(user: JsonObject): string {
  return text(user.login ?? user.email ?? user.email_address).toLowerCase();
}

function taskAssigneeIds(task: JsonObject): number[] {
  const assigned = numericId(task.assigned_id ?? task.assignedId);
  const direct = Array.isArray(task.assignee_ids) ? task.assignee_ids : [];
  const nested = Array.isArray(task.assignees)
    ? task.assignees.map((assignee) => asObject(assignee)?.id)
    : [];
  return [...new Set([assigned, ...direct.map(numericId), ...nested.map(numericId)]
    .filter((id): id is number => id !== null))];
}

function taskId(task: JsonObject): string {
  return text(task.id ?? asObject(task.task_item)?.id);
}

function taskWasNotified(task: JsonObject): boolean {
  return Boolean(text(task.date_notified ?? task.dateNotified));
}

async function fetchAll(request: CommitmentMakerTaskRequest, path: string): Promise<JsonObject[]> {
  const rows: JsonObject[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const pageRows = asRows(await request({ path: `${path}${separator}page=${page}&per_page=100` }));
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

export function buildCommitmentMakerChangeOrderTaskSpecs(params: {
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  changeOrder: CommitmentMakerChangeOrderContext;
  now?: Date;
}): CommitmentMakerTaskSpec[] {
  const dueDate = formatDate(addDays(params.now || new Date(), TASK_DUE_OFFSET_DAYS));
  const projectLabel = [params.projectNumber, params.projectName]
    .map((value) => text(value))
    .filter(Boolean)
    .join(" - ") || params.projectId;
  const changeOrderLabel = [
    params.changeOrder.number ? `CO ${params.changeOrder.number}` : "Change Order",
    params.changeOrder.title,
  ].filter(Boolean).join(" - ");
  const common = [
    "Automatically created after Commitment Maker processed this approved change order.",
    `Project: ${projectLabel}`,
    `Approved change order: ${changeOrderLabel}`,
    `Prime change order ID: ${params.changeOrder.packageId}`,
    `Change order amount: ${currency(params.changeOrder.amount)}`,
  ];

  return [
    {
      kind: "aia_billing",
      tag: `[analytics:commitment-maker-change-order:${params.changeOrder.packageId}:aia-billing]`,
      title: `Add CO ${params.changeOrder.number || params.changeOrder.packageId} to AIA Billing`,
      description: [
        `[analytics:commitment-maker-change-order:${params.changeOrder.packageId}:aia-billing]`,
        ...common,
        "Action: Add this approved change order to the project's AIA billing.",
      ].join("\n"),
      dueDate,
    },
    {
      kind: "commitment_verification",
      tag: `[analytics:commitment-maker-change-order:${params.changeOrder.packageId}:commitments]`,
      title: `Verify CO ${params.changeOrder.number || params.changeOrder.packageId} Is in Commitments`,
      description: [
        `[analytics:commitment-maker-change-order:${params.changeOrder.packageId}:commitments]`,
        ...common,
        "Action: Verify that the approved change order was added to the project's commitments.",
      ].join("\n"),
      dueDate,
    },
  ];
}

export async function resolveCommitmentMakerChangeOrderTaskAssignees(params: {
  request: CommitmentMakerTaskRequest;
  companyId: string;
  projectId: string;
  shellyCompanyUser?: ProjectUserLike | null;
}): Promise<CommitmentMakerTaskAssignees> {
  const [roles, projectUsers] = await Promise.all([
    fetchAll(params.request, `/rest/v1.0/project_roles?project_id=${encodeURIComponent(params.projectId)}`),
    fetchAll(
      params.request,
      `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users?company_id=${encodeURIComponent(params.companyId)}`,
    ),
  ]);
  const shellyProjectUser = projectUsers.find((user) => userEmail(user) === SHELLY_EMAIL) || null;
  const shellyFallback = asObject(params.shellyCompanyUser || null);
  const shelly = shellyProjectUser || (shellyFallback && userEmail(shellyFallback) === SHELLY_EMAIL
    ? shellyFallback
    : null);
  const shellyAssigneeId = numericId(shelly?.id ?? shelly?.user_id);
  if (!shellyAssigneeId) {
    throw new Error(`${SHELLY_EMAIL} could not be resolved to a Procore user for this task.`);
  }

  const projectManagerAssigneeIds = selectProjectManagerRecipientsForDomain(
    roles as ProjectRoleLike[],
    projectUsers as ProjectUserLike[],
    PROJECT_MANAGER_EMAIL_DOMAIN,
  )
    .map((recipient) => numericId(recipient.id))
    .filter((id): id is number => id !== null);
  if (projectManagerAssigneeIds.length === 0) {
    throw new Error("No Project Manager with a @pmcdecor.com email was found on this project.");
  }
  return { shellyAssigneeId, projectManagerAssigneeIds };
}

export async function ensureCommitmentMakerChangeOrderTasks(params: {
  request: CommitmentMakerTaskRequest;
  companyId: string;
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  changeOrder: CommitmentMakerChangeOrderContext;
  shellyCompanyUser?: ProjectUserLike | null;
  now?: Date;
}) {
  const [tasks, assignees] = await Promise.all([
    fetchAll(params.request, `/rest/v1.0/task_items?project_id=${encodeURIComponent(params.projectId)}`),
    resolveCommitmentMakerChangeOrderTaskAssignees(params),
  ]);

  const specs = buildCommitmentMakerChangeOrderTaskSpecs(params);
  const results: Array<{
    kind: CommitmentMakerTaskSpec["kind"];
    taskId: string;
    title: string;
    created: boolean;
    updated: boolean;
    notified: boolean;
    assigneeIds: number[];
  }> = [];

  for (const spec of specs) {
    const requiredAssigneeIds = spec.kind === "aia_billing"
      ? [assignees.shellyAssigneeId]
      : assignees.projectManagerAssigneeIds;
    const existing = tasks.find((task) => text(task.description).includes(spec.tag)) || null;
    if (existing) {
      const id = taskId(existing);
      if (!id) throw new Error(`The existing automated task "${spec.title}" is missing its ID.`);
      const currentAssigneeIds = taskAssigneeIds(existing);
      const mergedAssigneeIds = [...new Set([...currentAssigneeIds, ...requiredAssigneeIds])];
      const updated = requiredAssigneeIds.some((assigneeId) => !currentAssigneeIds.includes(assigneeId));
      if (updated) {
        await params.request({
          path: `/rest/v1.0/task_items/${encodeURIComponent(id)}?project_id=${encodeURIComponent(params.projectId)}`,
          method: "PATCH",
          body: {
            task_item: {
              assigned_id: currentAssigneeIds[0] || requiredAssigneeIds[0],
              assignee_ids: mergedAssigneeIds,
            },
          },
        });
      }
      results.push({
        kind: spec.kind,
        taskId: id,
        title: spec.title,
        created: false,
        updated,
        notified: taskWasNotified(existing),
        assigneeIds: mergedAssigneeIds,
      });
      continue;
    }

    const createdPayload = await params.request({
      path: `/rest/v1.0/task_items?project_id=${encodeURIComponent(params.projectId)}`,
      method: "POST",
      body: {
        task_item: {
          title: spec.title,
          description: spec.description,
          due_date: spec.dueDate,
          status: "initiated",
          assigned_id: requiredAssigneeIds[0],
          assignee_ids: requiredAssigneeIds,
        },
      },
    });
    const createdTask = asObject(createdPayload) || {};
    const id = taskId(createdTask);
    if (!id) throw new Error(`Procore created task "${spec.title}" without returning its ID.`);
    results.push({
      kind: spec.kind,
      taskId: id,
      title: spec.title,
      created: true,
      updated: false,
      notified: false,
      assigneeIds: requiredAssigneeIds,
    });
  }

  const unsentTaskIds = results.filter((result) => !result.notified).map((result) => result.taskId);
  if (unsentTaskIds.length > 0) {
    const sentPayload = await params.request({
      path: `/rest/v1.0/task_items/send_unsent?project_id=${encodeURIComponent(params.projectId)}`,
      method: "POST",
    });
    const sentTaskIds = new Set(asRows(sentPayload).map(taskId).filter(Boolean));
    const unsent = unsentTaskIds.filter((id) => !sentTaskIds.has(id));
    if (unsent.length > 0) {
      throw new Error(`Procore did not confirm notification delivery for Task Item ${unsent.join(", ")}.`);
    }
    for (const result of results) {
      if (sentTaskIds.has(result.taskId)) result.notified = true;
    }
  }

  return {
    success: true,
    ...assignees,
    tasks: results,
  };
}

import { makeRequest } from '@/lib/procore';
import {
  selectProjectManagerRecipientsForDomain,
  type ProjectRoleLike,
  type ProjectUserLike,
} from '@/lib/timecardNotification';

const TASK_TITLE = 'Field Productivity Review';
const TASK_TAG = '[analytics:auto-productivity-review]';
const TASK_DUE_OFFSET_DAYS = 30;
const DISTRIBUTION_GROUP = 'Project Review';
const DISTRIBUTION_MEMBER_IDS_DEFAULT = '12495259,14134125';
const PROJECT_MANAGER_EMAIL_DOMAIN = 'pmcdecor.com';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
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

function readId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const id = String(value).trim();
  return id || null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeLabel(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeDate(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : formatDate(parsed);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function readDistributionMemberIds(): number[] {
  const configured = String(
    process.env.PROCORE_PRODUCTIVITY_REVIEW_DISTRIBUTION_MEMBER_IDS
    || DISTRIBUTION_MEMBER_IDS_DEFAULT
  ).trim();
  const single = String(process.env.PROCORE_PRODUCTIVITY_REVIEW_DISTRIBUTION_MEMBER_ID || '').trim();
  const ids = [...configured.split(','), single]
    .map((value) => readNumber(value.trim()))
    .filter((value): value is number => value !== null);
  return [...new Set(ids)];
}

function readTaskDistributionMemberIds(task: JsonObject): number[] {
  const directIds = Array.isArray(task.distribution_member_ids)
    ? task.distribution_member_ids
    : [];
  const memberIds = Array.isArray(task.distribution_members)
    ? task.distribution_members.map((member) => asObject(member)?.id)
    : [];
  return [...new Set([...directIds, ...memberIds]
    .map(readNumber)
    .filter((id): id is number => id !== null))];
}

function readTaskAssigneeIds(task: JsonObject): number[] {
  const assignedId = readNumber(task.assigned_id ?? task.assignedId);
  const directIds = Array.isArray(task.assignee_ids)
    ? task.assignee_ids
    : [];
  const assigneeIds = Array.isArray(task.assignees)
    ? task.assignees.map((assignee) => asObject(assignee)?.id)
    : [];
  return [...new Set([assignedId, ...directIds, ...assigneeIds]
    .map(readNumber)
    .filter((id): id is number => id !== null))];
}

async function fetchAll(params: {
  path: string;
  token: string;
  companyId: string;
}) {
  const rows: JsonObject[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = params.path.includes('?') ? '&' : '?';
    const payload = await makeRequest(
      `${params.path}${separator}page=${page}&per_page=100`,
      params.token,
      undefined,
      params.companyId,
      [404]
    );
    const pageRows = asRows(payload);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function resolveProjectManagerAssigneeIds(params: {
  token: string;
  companyId: string;
  projectId: string;
}) {
  const [roles, users] = await Promise.all([
    fetchAll({
      ...params,
      path: `/rest/v1.0/project_roles?project_id=${encodeURIComponent(params.projectId)}`,
    }),
    fetchAll({
      ...params,
      path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users?company_id=${encodeURIComponent(params.companyId)}`,
    }),
  ]);
  return selectProjectManagerRecipientsForDomain(
    roles as ProjectRoleLike[],
    users as ProjectUserLike[],
    PROJECT_MANAGER_EMAIL_DOMAIN,
  )
    .map(({ id }) => readNumber(id))
    .filter((id): id is number => id !== null);
}

function sameIds(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function taskWasNotified(task: JsonObject): boolean {
  return Boolean(String(task.date_notified || task.dateNotified || '').trim());
}

async function sendUnsentTaskItems(params: {
  token: string;
  companyId: string;
  projectId: string;
}) {
  const payload = await makeRequest(
    `/rest/v1.0/task_items/send_unsent?project_id=${encodeURIComponent(params.projectId)}`,
    params.token,
    { method: 'POST' },
    params.companyId
  );
  return asRows(payload)
    .map((task) => readId(task.id))
    .filter((id): id is string => Boolean(id));
}

function ensureTaskWasSent(taskId: string, sentTaskIds: string[]) {
  if (!sentTaskIds.includes(taskId)) {
    throw new Error(`Procore did not confirm notification delivery for Task Item ${taskId}.`);
  }
}

export async function ensureProductivityReviewTaskOnComplete(params: {
  token: string;
  companyId: string;
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  completedAt?: Date;
}) {
  const completedAt = params.completedAt || new Date();
  const dueDate = formatDate(addDays(completedAt, TASK_DUE_OFFSET_DAYS));
  const existingTasks = await makeRequest(
    `/rest/v1.0/task_items?project_id=${encodeURIComponent(params.projectId)}&page=1&per_page=100`,
    params.token,
    undefined,
    params.companyId,
    [404]
  );
  const existingTask = asRows(existingTasks).find((task) => (
    String(task.title || '').trim().toLowerCase() === TASK_TITLE.toLowerCase()
    && normalizeDate(task.due_date || task.dueDate) === dueDate
    && String(task.description || '').includes(TASK_TAG)
  ));

  const distributionGroups = await makeRequest(
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/distribution_groups?page=1&per_page=100&view=extended&include_ancestors=true&filters%5Bsearch%5D=${encodeURIComponent(DISTRIBUTION_GROUP)}`,
    params.token,
    undefined,
    params.companyId,
    [404]
  );
  const distributionGroup = asRows(distributionGroups).find((row) => (
    normalizeLabel(row.name) === normalizeLabel(DISTRIBUTION_GROUP)
  ));
  const groupUsers = Array.isArray(distributionGroup?.users) ? distributionGroup.users : [];
  const groupMemberIds = groupUsers
    .map((user) => readNumber(asObject(user)?.id))
    .filter((id): id is number => id !== null);
  const distributionMemberIds = groupMemberIds.length
    ? [...new Set(groupMemberIds)]
    : readDistributionMemberIds();
  const projectManagerAssigneeIds = await resolveProjectManagerAssigneeIds({
    token: params.token,
    companyId: params.companyId,
    projectId: params.projectId,
  });

  if (existingTask) {
    const taskId = readId(existingTask.id);
    if (!taskId) {
      throw new Error('The existing automated Procore Task Item is missing its ID.');
    }
    const currentMemberIds = readTaskDistributionMemberIds(existingTask);
    const currentAssigneeIds = readTaskAssigneeIds(existingTask);
    const mergedAssigneeIds = [...new Set([...currentAssigneeIds, ...projectManagerAssigneeIds])];
    const patch: JsonObject = {};
    if (distributionMemberIds.length && !sameIds(currentMemberIds, distributionMemberIds)) {
      patch.distribution_member_ids = distributionMemberIds;
    }
    if (projectManagerAssigneeIds.some((id) => !currentAssigneeIds.includes(id))) {
      patch.assigned_id = currentAssigneeIds[0] || projectManagerAssigneeIds[0];
      patch.assignee_ids = mergedAssigneeIds;
    }
    if (taskId && Object.keys(patch).length) {
      await makeRequest(
        `/rest/v1.0/task_items/${encodeURIComponent(taskId)}?project_id=${encodeURIComponent(params.projectId)}`,
        params.token,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_item: patch }),
        },
        params.companyId
      );
    }
    const alreadyNotified = taskWasNotified(existingTask);
    const sentTaskIds = alreadyNotified
      ? []
      : await sendUnsentTaskItems({
          token: params.token,
          companyId: params.companyId,
          projectId: params.projectId,
        });
    if (!alreadyNotified) ensureTaskWasSent(taskId, sentTaskIds);
    return {
      created: false,
      taskId,
      dueDate,
      projectManagerAssigneeIds,
      notified: alreadyNotified || Boolean(taskId && sentTaskIds.includes(taskId)),
      sentTaskIds,
    };
  }

  const projectLabel = [params.projectNumber, params.projectName]
    .filter((value) => Boolean(String(value || '').trim()))
    .join(' - ');
  const description = [
    TASK_TAG,
    'Automatically created when this project moved to Complete.',
    `Project: ${projectLabel || params.projectId}`,
    `Complete date: ${formatDate(completedAt)}`,
    `Review due: ${dueDate}`,
  ].join('\n');

  const createdTask = await makeRequest(
    `/rest/v1.0/task_items?project_id=${encodeURIComponent(params.projectId)}`,
    params.token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_item: {
          title: TASK_TITLE,
          description,
          due_date: dueDate,
          status: 'initiated',
          ...(projectManagerAssigneeIds.length ? {
            assigned_id: projectManagerAssigneeIds[0],
            assignee_ids: projectManagerAssigneeIds,
          } : {}),
          ...(distributionMemberIds.length ? { distribution_member_ids: distributionMemberIds } : {}),
        },
      }),
    },
    params.companyId
  );
  const createdTaskObject = asObject(createdTask);
  const createdTaskInner = asObject(createdTaskObject?.task_item);
  const taskId = readId(createdTaskObject?.id) || readId(createdTaskInner?.id);
  if (!taskId) {
    throw new Error('Procore created the Task Item without returning its ID; notification was not attempted.');
  }
  const sentTaskIds = await sendUnsentTaskItems({
    token: params.token,
    companyId: params.companyId,
    projectId: params.projectId,
  });
  ensureTaskWasSent(taskId, sentTaskIds);
  return {
    created: true,
    taskId,
    dueDate,
    projectManagerAssigneeIds,
    notified: Boolean(taskId && sentTaskIds.includes(taskId)),
    sentTaskIds,
  };
}

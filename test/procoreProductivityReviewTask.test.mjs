import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule(makeRequest, notifyMissingProjectManager = async () => ({
  recipient: "todd@pmcdecor.com",
  messageId: "email-1",
})) {
  const source = fs.readFileSync("src/lib/procoreProductivityReviewTask.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/procore") return { makeRequest };
    if (id === "@/lib/missingProjectManagerNotification") {
      return { notifyMissingProjectManager };
    }
    if (id === "@/lib/timecardNotification") {
      return {
        selectProjectManagerRecipientsForDomain: (roles, users, domain) => {
          assert.equal(domain, "pmcdecor.com");
          const managerIds = new Set(
            roles
              .filter((role) => role.role === "Project Manager" && role.is_active !== false)
              .map((role) => String(role.user_id)),
          );
          return users
            .filter((user) => managerIds.has(String(user.id)))
            .filter((user) => String(user.login).toLowerCase().endsWith(`@${domain}`))
            .map((user) => ({ id: String(user.id), name: user.name, email: user.login }));
        },
      };
    }
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(
    `(function(require, module, exports) { ${output} })(require, module, module.exports);`,
    { require, module, URLSearchParams },
  );
  return module.exports;
}

test("creates the productivity review task with PMC-only assignees and no broad email dispatch", async () => {
  let createdPayload;
  let sendCalls = 0;
  const makeRequest = async (path, _token, options) => {
    if (path.startsWith("/rest/v1.0/task_items/send_unsent?")) {
      sendCalls += 1;
      return [{ id: 456 }];
    }
    if (options?.method === "POST") {
      createdPayload = JSON.parse(options.body).task_item;
      return { id: 456 };
    }
    if (path.startsWith("/rest/v1.0/task_items?")) return [];
    if (path.includes("/distribution_groups?")) {
      return [{ name: "Project Review", users: [{ id: 900 }] }];
    }
    if (path.startsWith("/rest/v1.0/project_roles?")) {
      return [
        { role: "Project Manager", user_id: 123, is_active: true },
        { role: "Project Manager", user_id: 124, is_active: true },
      ];
    }
    if (path.includes("/users?")) {
      return [
        { id: 123, name: "Internal PM", login: "pm@pmcdecor.com" },
        { id: 124, name: "External PM", login: "pm@example.com" },
      ];
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const { ensureProductivityReviewTaskOnComplete } = loadModule(makeRequest);

  const result = await ensureProductivityReviewTaskOnComplete({
    token: "token",
    companyId: "company",
    projectId: "project",
    projectNumber: "2601",
    projectName: "Test Project",
    completedAt: new Date("2026-08-01T12:00:00.000Z"),
  });

  assert.equal(result.created, true);
  assert.equal(createdPayload.assigned_id, 123);
  assert.deepEqual(createdPayload.assignee_ids, [123]);
  assert.deepEqual(createdPayload.distribution_member_ids, []);
  assert.equal(sendCalls, 0);
  assert.equal(result.notified, false);
  assert.deepEqual(Array.from(result.sentTaskIds), []);
});

test("adds the internal project manager without removing existing task recipients", async () => {
  let patchedPayload;
  let sendCalls = 0;
  const makeRequest = async (path, _token, options) => {
    if (path.startsWith("/rest/v1.0/task_items/send_unsent?")) {
      sendCalls += 1;
      return [{ id: 456 }];
    }
    if (options?.method === "PATCH") {
      patchedPayload = JSON.parse(options.body).task_item;
      return { id: 456 };
    }
    if (path.startsWith("/rest/v1.0/task_items?")) {
      return [{
        id: 456,
        title: "Field Productivity Review",
        due_date: "2026-08-31",
        description: "[analytics:auto-productivity-review]",
        assigned_id: 777,
        assignee_ids: [777],
        distribution_member_ids: [900],
      }];
    }
    if (path.includes("/distribution_groups?")) {
      return [{ name: "Project Review", users: [{ id: 900 }] }];
    }
    if (path.startsWith("/rest/v1.0/project_roles?")) {
      return [{ role: "Project Manager", user_id: 123, is_active: true }];
    }
    if (path.includes("/users?")) {
      return [{ id: 123, name: "Internal PM", login: "pm@pmcdecor.com" }];
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const { ensureProductivityReviewTaskOnComplete } = loadModule(makeRequest);

  const result = await ensureProductivityReviewTaskOnComplete({
    token: "token",
    companyId: "company",
    projectId: "project",
    projectNumber: "2601",
    projectName: "Test Project",
    completedAt: new Date("2026-08-01T12:00:00.000Z"),
  });

  assert.equal(result.created, false);
  assert.equal(patchedPayload.assigned_id, 777);
  assert.deepEqual(patchedPayload.assignee_ids, [777, 123]);
  assert.equal(patchedPayload.distribution_member_ids, undefined);
  assert.equal(sendCalls, 0);
  assert.equal(result.notified, false);
});

test("does not alter recipients or resend an automated task that Procore already notified", async () => {
  let sendCalls = 0;
  const makeRequest = async (path, _token, options) => {
    if (path.startsWith("/rest/v1.0/task_items/send_unsent?")) {
      sendCalls += 1;
      return [{ id: 456 }];
    }
    if (options?.method === "PATCH") throw new Error("Existing recipients should not be changed");
    if (path.startsWith("/rest/v1.0/task_items?")) {
      return [{
        id: 456,
        title: "Field Productivity Review",
        due_date: "2026-08-31",
        description: "[analytics:auto-productivity-review]",
        assigned_id: 123,
        assignee_ids: [123],
        distribution_member_ids: [900],
        date_notified: "2026-08-01T13:00:00Z",
      }];
    }
    if (path.includes("/distribution_groups?")) {
      return [{ name: "Project Review", users: [{ id: 900 }] }];
    }
    if (path.startsWith("/rest/v1.0/project_roles?")) {
      return [{ role: "Project Manager", user_id: 123, is_active: true }];
    }
    if (path.includes("/users?")) {
      return [{ id: 123, name: "Internal PM", login: "pm@pmcdecor.com" }];
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const { ensureProductivityReviewTaskOnComplete } = loadModule(makeRequest);

  const result = await ensureProductivityReviewTaskOnComplete({
    token: "token",
    companyId: "company",
    projectId: "project",
    projectNumber: "2601",
    projectName: "Test Project",
    completedAt: new Date("2026-08-01T12:00:00.000Z"),
  });

  assert.equal(result.created, false);
  assert.equal(result.notified, true);
  assert.equal(sendCalls, 0);
});

test("emails Todd and skips task creation when no internal project manager exists", async () => {
  const alerts = [];
  let taskCreateCalls = 0;
  const makeRequest = async (path, _token, options) => {
    if (options?.method === "POST") taskCreateCalls += 1;
    if (path.startsWith("/rest/v1.0/task_items?")) return [];
    if (path.startsWith("/rest/v1.0/project_roles?")) {
      return [{ role: "Project Manager", user_id: 777, is_active: true }];
    }
    if (path.includes("/users?")) {
      return [{ id: 777, name: "External PM", login: "pm@example.com" }];
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const { ensureProductivityReviewTaskOnComplete } = loadModule(makeRequest, async (params) => {
    alerts.push(params);
    return { recipient: "todd@pmcdecor.com", messageId: "email-1" };
  });

  const result = await ensureProductivityReviewTaskOnComplete({
    token: "token",
    companyId: "company",
    projectId: "project",
    projectNumber: "2601",
    projectName: "Test Project",
    completedAt: new Date("2026-08-01T12:00:00.000Z"),
  });

  assert.equal(taskCreateCalls, 0);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].taskTitle, "Field Productivity Review");
  assert.equal(result.skipped, true);
  assert.equal(result.taskId, null);
  assert.equal(result.fallbackEmail.recipient, "todd@pmcdecor.com");
});

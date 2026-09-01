import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule(notifyMissingProjectManager = async () => ({
  recipient: "todd@pmcdecor.com",
  messageId: "email-1",
})) {
  const source = fs.readFileSync("src/lib/procoreCommitmentMakerTasks.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/missingProjectManagerNotification") {
      return { notifyMissingProjectManager };
    }
    if (id === "@/lib/timecardNotification") {
      return {
        selectProjectManagerRecipientsForDomain: (roles, users, domain) => {
          const managerIds = new Set(
            roles
              .filter((role) => role.role === "Project Manager" && role.is_active !== false)
              .map((role) => String(role.user_id)),
          );
          return users
            .filter((user) => managerIds.has(String(user.id)))
            .filter((user) => String(user.login || "").toLowerCase().endsWith(`@${domain}`))
            .map((user) => ({ id: String(user.id), name: user.name, email: user.login }));
        },
      };
    }
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(
    `(function(require, module, exports) { ${output} })(require, module, module.exports);`,
    { require, module, Intl, URLSearchParams },
  );
  return module.exports;
}

const changeOrder = {
  packageId: "598134327089031",
  number: "001",
  title: "CO#1",
  amount: 5187.31,
};

test("builds separate AIA and commitment-verification tasks for one approved change order", () => {
  const { buildCommitmentMakerChangeOrderTaskSpecs } = loadModule();
  const specs = buildCommitmentMakerChangeOrderTaskSpecs({
    projectId: "598134326683024",
    projectNumber: "2506-SDMB",
    projectName: "Shank Door Main Building",
    changeOrder,
    now: new Date("2026-08-31T14:00:00.000Z"),
  });

  assert.equal(specs.length, 2);
  assert.equal(specs[0].title, "Add CO 001 to AIA Billing");
  assert.equal(specs[1].title, "Verify CO 001 Is in Commitments");
  assert.equal(specs[0].dueDate, "2026-08-31");
  assert.equal(specs[1].dueDate, "2026-08-31");
  assert.match(specs[0].description, /598134327089031:aia-billing/);
  assert.match(specs[1].description, /598134327089031:commitments/);
});

test("normalizes an approved Procore change order into task context", () => {
  const {
    commitmentMakerChangeOrderContextFromRecord,
    isApprovedChangeOrderStatus,
  } = loadModule();
  assert.equal(isApprovedChangeOrderStatus(" Approved "), true);
  assert.equal(isApprovedChangeOrderStatus("Pending"), false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(commitmentMakerChangeOrderContextFromRecord({
      id: 42,
      number_object: { value: "PCO-7" },
      name: "Pier revisions",
      grand_total: "1250.50",
    }))),
    {
      packageId: "42",
      number: "PCO-7",
      title: "Pier revisions",
      amount: 1250.5,
    },
  );
});

test("uses PMC's Eastern creation date for both due-today tasks", () => {
  const { buildCommitmentMakerChangeOrderTaskSpecs } = loadModule();
  const specs = buildCommitmentMakerChangeOrderTaskSpecs({
    projectId: "project",
    projectNumber: "2601",
    projectName: "Test Project",
    changeOrder,
    now: new Date("2026-09-01T02:00:00.000Z"),
  });

  assert.deepEqual(Array.from(specs, (spec) => spec.dueDate), ["2026-08-31", "2026-08-31"]);
});

test("creates only a due-today verification task without resolving Shelly", async () => {
  const { ensureCommitmentMakerChangeOrderTasks } = loadModule();
  const created = [];
  const request = async ({ path, method, body }) => {
    if (method === "POST") {
      created.push(body.task_item);
      return { id: 902 };
    }
    if (path.startsWith("/rest/v1.0/task_items?")) return [];
    if (path.startsWith("/rest/v1.0/project_roles?")) {
      return [{ role: "Project Manager", user_id: 123, is_active: true }];
    }
    if (path.includes("/users?")) {
      return [{ id: 123, name: "Internal PM", login: "pm@pmcdecor.com" }];
    }
    throw new Error(`Unexpected request: ${method || "GET"} ${path}`);
  };

  const result = await ensureCommitmentMakerChangeOrderTasks({
    request,
    companyId: "company",
    projectId: "598134326683024",
    projectNumber: "2506-SDMB",
    projectName: "Shank Door Main Building",
    changeOrder,
    taskKinds: ["commitment_verification"],
    now: new Date("2026-08-31T14:00:00.000Z"),
  });

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].kind, "commitment_verification");
  assert.equal(created[0].due_date, "2026-08-31");
  assert.deepEqual(Array.from(created[0].assignee_ids), [123]);
  assert.equal(result.shellyAssigneeId, null);
});

test("creates both tasks with PMC-only assignees and no project-wide email dispatch", async () => {
  const { ensureCommitmentMakerChangeOrderTasks } = loadModule();
  const created = [];
  let sendCalls = 0;
  const request = async ({ path, method, body }) => {
    if (path.startsWith("/rest/v1.0/task_items/send_unsent?")) {
      sendCalls += 1;
      return [{ id: 901 }, { id: 902 }];
    }
    if (method === "POST") {
      const task = body.task_item;
      created.push(task);
      return { id: created.length === 1 ? 901 : 902 };
    }
    if (path.startsWith("/rest/v1.0/task_items?")) return [];
    if (path.startsWith("/rest/v1.0/project_roles?")) {
      return [{ role: "Project Manager", user_id: 123, is_active: true }];
    }
    if (path.includes("/users?")) {
      return [
        { id: 123, name: "Internal PM", login: "pm@pmcdecor.com" },
        { id: 9549803, name: "Shelly Swinehart", email_address: "shelly@pmcdecor.com" },
      ];
    }
    throw new Error(`Unexpected request: ${method || "GET"} ${path}`);
  };

  const result = await ensureCommitmentMakerChangeOrderTasks({
    request,
    companyId: "company",
    projectId: "598134326683024",
    projectNumber: "2506-SDMB",
    projectName: "Shank Door Main Building",
    changeOrder,
    now: new Date("2026-08-31T14:00:00.000Z"),
  });

  assert.equal(result.tasks.length, 2);
  assert.equal(created[0].assigned_id, 9549803);
  assert.deepEqual(Array.from(created[0].assignee_ids), [9549803]);
  assert.deepEqual(Array.from(created[0].distribution_member_ids), []);
  assert.equal(created[1].assigned_id, 123);
  assert.deepEqual(Array.from(created[1].assignee_ids), [123]);
  assert.deepEqual(Array.from(created[1].distribution_member_ids), []);
  assert.equal(sendCalls, 0);
  assert.equal(result.tasks.every((task) => task.notified === false), true);
});

test("reuses previously notified tagged tasks on a safe retry", async () => {
  const { ensureCommitmentMakerChangeOrderTasks } = loadModule();
  let writeCalls = 0;
  let sendCalls = 0;
  const request = async ({ path, method }) => {
    if (path.startsWith("/rest/v1.0/task_items/send_unsent?")) {
      sendCalls += 1;
      return [];
    }
    if (method === "POST" || method === "PATCH") writeCalls += 1;
    if (path.startsWith("/rest/v1.0/task_items?")) {
      return [
        {
          id: 901,
          description: `[analytics:commitment-maker-change-order:${changeOrder.packageId}:aia-billing]`,
          assignee_ids: [9549803],
          date_notified: "2026-08-31T15:00:00Z",
        },
        {
          id: 902,
          description: `[analytics:commitment-maker-change-order:${changeOrder.packageId}:commitments]`,
          assignee_ids: [123],
          date_notified: "2026-08-31T15:00:00Z",
        },
      ];
    }
    if (path.startsWith("/rest/v1.0/project_roles?")) {
      return [{ role: "Project Manager", user_id: 123, is_active: true }];
    }
    if (path.includes("/users?")) {
      return [
        { id: 123, name: "Internal PM", login: "pm@pmcdecor.com" },
        { id: 9549803, name: "Shelly Swinehart", email_address: "shelly@pmcdecor.com" },
      ];
    }
    throw new Error(`Unexpected request: ${method || "GET"} ${path}`);
  };

  const result = await ensureCommitmentMakerChangeOrderTasks({
    request,
    companyId: "company",
    projectId: "598134326683024",
    projectNumber: "2506-SDMB",
    projectName: "Shank Door Main Building",
    changeOrder,
  });

  assert.equal(writeCalls, 0);
  assert.equal(sendCalls, 0);
  assert.equal(result.tasks.every((task) => task.created === false && task.notified), true);
});

test("preserves existing assignees and distribution members on automated tasks", async () => {
  const { ensureCommitmentMakerChangeOrderTasks } = loadModule();
  const patches = [];
  const request = async ({ path, method, body }) => {
    if (method === "PATCH") {
      patches.push(body.task_item);
      return { id: path.includes("/901?") ? 901 : 902 };
    }
    if (path.startsWith("/rest/v1.0/task_items?")) {
      return [
        {
          id: 901,
          description: `[analytics:commitment-maker-change-order:${changeOrder.packageId}:aia-billing]`,
          assignee_ids: [9549803, 777],
          distribution_member_ids: [888],
        },
        {
          id: 902,
          description: `[analytics:commitment-maker-change-order:${changeOrder.packageId}:commitments]`,
          assignee_ids: [123, 777],
          distribution_members: [{ id: 889 }],
        },
      ];
    }
    if (path.startsWith("/rest/v1.0/project_roles?")) {
      return [{ role: "Project Manager", user_id: 123, is_active: true }];
    }
    if (path.includes("/users?")) {
      return [
        { id: 123, name: "Internal PM", login: "pm@pmcdecor.com" },
        { id: 777, name: "External PM", login: "pm@example.com" },
        { id: 9549803, name: "Shelly Swinehart", email_address: "shelly@pmcdecor.com" },
      ];
    }
    throw new Error(`Unexpected request: ${method || "GET"} ${path}`);
  };

  const result = await ensureCommitmentMakerChangeOrderTasks({
    request,
    companyId: "company",
    projectId: "598134326683024",
    projectNumber: "2506-SDMB",
    projectName: "Shank Door Main Building",
    changeOrder,
  });

  assert.deepEqual(patches, []);
  assert.deepEqual(Array.from(result.tasks, (task) => Array.from(task.assigneeIds)), [
    [9549803, 777],
    [123, 777],
  ]);
});

test("creates Shelly's task and emails Todd instead of assigning an external PM", async () => {
  const alerts = [];
  const { ensureCommitmentMakerChangeOrderTasks } = loadModule(async (params) => {
    alerts.push(params);
    return { recipient: "todd@pmcdecor.com", messageId: "email-1" };
  });
  const created = [];
  const request = async ({ path, method, body }) => {
    if (method === "POST") {
      created.push(body.task_item);
      return { id: 901 };
    }
    if (path.startsWith("/rest/v1.0/task_items?")) return [];
    if (path.startsWith("/rest/v1.0/project_roles?")) {
      return [{ role: "Project Manager", user_id: 777, is_active: true }];
    }
    if (path.includes("/users?")) {
      return [
        { id: 777, name: "External PM", login: "pm@example.com" },
        { id: 9549803, name: "Shelly Swinehart", email_address: "shelly@pmcdecor.com" },
      ];
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  const result = await ensureCommitmentMakerChangeOrderTasks({
    request,
    companyId: "company",
    projectId: "project",
    projectNumber: "2601",
    projectName: "Test Project",
    changeOrder,
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].assigned_id, 9549803);
  assert.deepEqual(Array.from(created[0].assignee_ids), [9549803]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].taskTitle, "Verify CO 001 Is in Commitments");
  assert.equal(alerts[0].workflowKey, `commitment-maker-${changeOrder.packageId}`);
  assert.equal(result.fallbackEmail.recipient, "todd@pmcdecor.com");
  assert.equal(result.tasks[1].skipped, true);
  assert.equal(result.tasks[1].taskId, null);
});

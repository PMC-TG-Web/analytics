import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ProcoreLog = Record<string, unknown>;
type MutableJsonObject = Record<string, Prisma.InputJsonValue>;
let unpackedFieldsTableReady: Promise<void> | null = null;

type PersistProductivityLogsParams = {
  companyId?: string;
  projectId: string;
  projectName?: string;
  projectNumber?: string;
  createProjectIfMissing?: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value as string | number | boolean | null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => asJsonValue(item));
  }

  if (typeof value === "object") {
    const out: MutableJsonObject = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = asJsonValue(nested);
    }
    return out as Prisma.InputJsonObject;
  }

  return String(value);
}

function unpackPayloadFields(payload: Record<string, unknown>) {
  const scalarFields: MutableJsonObject = {};
  const jsonFields: MutableJsonObject = {};
  const allPaths: string[] = [];

  function walk(value: unknown, path: string) {
    if (path) {
      allPaths.push(path);
      jsonFields[path] = asJsonValue(value);
    }

    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      if (path) {
        scalarFields[path] = value as Prisma.InputJsonValue;
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const nextPath = path ? `${path}[${index}]` : `[${index}]`;
        walk(item, nextPath);
      });
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const nextPath = path ? `${path}.${key}` : key;
        walk(nested, nextPath);
      }
    }
  }

  walk(payload, "");

  return {
    allPaths,
    scalarFields: scalarFields as Prisma.InputJsonObject,
    jsonFields: jsonFields as Prisma.InputJsonObject,
  };
}

async function ensureUnpackedFieldsTable() {
  if (unpackedFieldsTableReady) {
    return unpackedFieldsTableReady;
  }

  unpackedFieldsTableReady = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS productivity_log_unpacked_fields (
        id BIGSERIAL PRIMARY KEY,
        log_id TEXT NOT NULL,
        field_path TEXT NOT NULL,
        value_type TEXT NOT NULL,
        value_text TEXT NULL,
        value_number DOUBLE PRECISION NULL,
        value_boolean BOOLEAN NULL,
        value_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (log_id, field_path),
        CONSTRAINT fk_productivity_unpacked_log
          FOREIGN KEY (log_id)
          REFERENCES "ProductivityLog"(id)
          ON DELETE CASCADE
      )
    `);

    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_prod_unpacked_field_path ON productivity_log_unpacked_fields(field_path)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_prod_unpacked_value_text ON productivity_log_unpacked_fields(value_text)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_prod_unpacked_value_number ON productivity_log_unpacked_fields(value_number)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_prod_unpacked_value_boolean ON productivity_log_unpacked_fields(value_boolean)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_prod_unpacked_path_text ON productivity_log_unpacked_fields(field_path, value_text)"
    );
  })();

  return unpackedFieldsTableReady;
}

function classifyUnpackedValue(value: Prisma.InputJsonValue) {
  if (value === null) {
    return {
      valueType: "null",
      valueText: null as string | null,
      valueNumber: null as number | null,
      valueBoolean: null as boolean | null,
      valueJson: null as Prisma.InputJsonValue,
    };
  }

  if (typeof value === "string") {
    return {
      valueType: "string",
      valueText: value,
      valueNumber: null as number | null,
      valueBoolean: null as boolean | null,
      valueJson: value,
    };
  }

  if (typeof value === "number") {
    return {
      valueType: "number",
      valueText: String(value),
      valueNumber: Number.isFinite(value) ? value : null,
      valueBoolean: null as boolean | null,
      valueJson: value,
    };
  }

  if (typeof value === "boolean") {
    return {
      valueType: "boolean",
      valueText: value ? "true" : "false",
      valueNumber: null as number | null,
      valueBoolean: value,
      valueJson: value,
    };
  }

  return {
    valueType: "json",
    valueText: JSON.stringify(value),
    valueNumber: null as number | null,
    valueBoolean: null as boolean | null,
    valueJson: value,
  };
}

async function syncUnpackedFieldsForLog(logId: string, unpackedJsonFields: Prisma.InputJsonObject) {
  await ensureUnpackedFieldsTable();

  const rows = Object.entries(unpackedJsonFields).map(([fieldPath, rawValue]) => {
    const value = rawValue as Prisma.InputJsonValue;
    const classified = classifyUnpackedValue(value);

    return {
      field_path: fieldPath,
      value_type: classified.valueType,
      value_text: classified.valueText,
      value_number: classified.valueNumber,
      value_boolean: classified.valueBoolean,
      value_json: classified.valueJson,
    };
  });

  await prisma.$executeRawUnsafe(
    "DELETE FROM productivity_log_unpacked_fields WHERE log_id = $1",
    logId
  );

  if (!rows.length) {
    return;
  }

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO productivity_log_unpacked_fields
        (
          log_id,
          field_path,
          value_type,
          value_text,
          value_number,
          value_boolean,
          value_json,
          updated_at
        )
      SELECT
        $1,
        row_data.field_path,
        row_data.value_type,
        row_data.value_text,
        row_data.value_number,
        row_data.value_boolean,
        COALESCE(row_data.value_json, 'null'::jsonb),
        NOW()
      FROM jsonb_to_recordset($2::jsonb) AS row_data(
        field_path TEXT,
        value_type TEXT,
        value_text TEXT,
        value_number DOUBLE PRECISION,
        value_boolean BOOLEAN,
        value_json JSONB
      )
      ON CONFLICT (log_id, field_path)
      DO UPDATE SET
        value_type = EXCLUDED.value_type,
        value_text = EXCLUDED.value_text,
        value_number = EXCLUDED.value_number,
        value_boolean = EXCLUDED.value_boolean,
        value_json = COALESCE(EXCLUDED.value_json, 'null'::jsonb),
        updated_at = NOW()
    `,
    logId,
    JSON.stringify(rows)
  );
}

export function normalizeDate(value: unknown): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const asDate = new Date(raw);
  if (Number.isNaN(asDate.getTime())) return undefined;
  return asDate.toISOString().split("T")[0];
}

function toNullableDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNullableFloat(value: unknown): number | null {
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

function toNullableInt(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : null;
}

function toNullableString(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

function extractPayloadColumns(log: ProcoreLog, companyId: string | undefined, projectId: string) {
  const createdBy =
    log.created_by && typeof log.created_by === "object"
      ? (log.created_by as Record<string, unknown>)
      : null;
  const lineItemHolder =
    log.line_item_holder && typeof log.line_item_holder === "object"
      ? (log.line_item_holder as Record<string, unknown>)
      : null;

  return {
    procoreId: toNullableString(log.id),
    procoreCompanyId: toNullableString(companyId),
    procoreProjectId: toNullableString(projectId),
    status: toNullableString(log.status),
    company: toNullableString(log.company),
    contract: toNullableString(log.contract),
    lineItemId: toNullableString(log.line_item_id),
    lineItemDescription: toNullableString(log.line_item_description),
    lineItemHolderId: lineItemHolder ? toNullableString(lineItemHolder.id) : null,
    lineItemHolderType: lineItemHolder ? toNullableString(lineItemHolder.type) : null,
    lineItemHolderTitle: lineItemHolder ? toNullableString(lineItemHolder.title) : null,
    lineItemHolderNumber: lineItemHolder ? toNullableString(lineItemHolder.number) : null,
    quantityUsed: toNullableFloat(log.quantity_used),
    quantityDelivered: toNullableFloat(log.quantity_delivered),
    previouslyUsed: toNullableFloat(log.previously_used),
    previouslyDelivered: toNullableFloat(log.previously_delivered),
    position: toNullableInt(log.position),
    createdById: createdBy ? toNullableString(createdBy.id) : null,
    createdByName: createdBy ? toNullableString(createdBy.name) : null,
    createdByLogin: createdBy ? toNullableString(createdBy.login) : null,
    createdByCollaborator:
      typeof log.created_by_collaborator === "boolean" ? log.created_by_collaborator : null,
    procoreCreatedAt: toNullableDate(log.created_at),
    procoreUpdatedAt: toNullableDate(log.updated_at),
    procoreDeletedAt: toNullableDate(log.deleted_at),
  };
}

async function resolveLinkedProject(params: PersistProductivityLogsParams) {
  const { companyId, projectId, projectName, projectNumber, createProjectIfMissing } = params;

  const matchers: Prisma.ProjectWhereInput[] = [
    {
      customFields: {
        path: ["procoreProjectId"],
        equals: projectId,
      },
    },
    {
      customFields: {
        path: ["procoreId"],
        equals: projectId,
      },
    },
    { projectNumber: projectId },
  ];

  if (projectNumber) {
    matchers.push({ projectNumber });
  }

  if (projectName && projectNumber) {
    matchers.push({ projectName, projectNumber });
  } else if (projectName) {
    matchers.push({ projectName });
  }

  const existing = await prisma.project.findFirst({
    where: {
      OR: matchers,
    },
    select: {
      id: true,
      projectNumber: true,
      projectName: true,
      customFields: true,
    },
  });

  if (existing) {
    if (createProjectIfMissing) {
      const existingCustomFields = asObject(existing.customFields);
      const existingCompanyId = String(existingCustomFields.procoreCompanyId || "").trim() || null;
      const mergedCustomFields: Prisma.InputJsonObject = {
        ...existingCustomFields,
        procoreProjectId: projectId,
        procoreCompanyId: companyId || existingCompanyId,
        syncedFrom: "procore_productivity",
        productivitySyncedAt: new Date().toISOString(),
      };

      await prisma.project.update({
        where: { id: existing.id },
        data: {
          projectNumber: existing.projectNumber || projectNumber || projectId,
          projectName: existing.projectName || projectName || `Procore Project ${projectId}`,
          customFields: mergedCustomFields,
        },
      });
    }

    return {
      project: {
        id: existing.id,
        projectNumber: existing.projectNumber,
        projectName: existing.projectName,
      },
      created: false,
    };
  }

  if (!createProjectIfMissing) {
    return {
      project: null,
      created: false,
    };
  }

  const created = await prisma.project.create({
    data: {
      projectNumber: projectNumber || projectId,
      projectName: projectName || `Procore Project ${projectId}`,
      status: "Active",
      customFields: {
        procoreProjectId: projectId,
        procoreCompanyId: companyId || null,
        syncedFrom: "procore_productivity",
        productivitySyncedAt: new Date().toISOString(),
      },
    },
    select: {
      id: true,
      projectNumber: true,
      projectName: true,
    },
  });

  return {
    project: created,
    created: true,
  };
}

export async function persistProductivityLogs(
  logs: ProcoreLog[],
  params: PersistProductivityLogsParams
) {
  if (!logs.length) {
    return {
      attempted: 0,
      saved: 0,
      skipped: 0,
      projectLinked: false,
      projectCreated: false,
      linkedProjectId: null as string | null,
    };
  }

  const linkedProjectResult = await resolveLinkedProject(params);
  await ensureUnpackedFieldsTable();

  let saved = 0;
  let skipped = 0;

  for (const log of logs) {
    const procoreId = String(log.id ?? "").trim();
    if (!procoreId) {
      skipped += 1;
      continue;
    }

    const dateText = normalizeDate(log.log_date ?? log.date);
    if (!dateText) {
      skipped += 1;
      continue;
    }

    const createdBy =
      log.created_by && typeof log.created_by === "object"
        ? (log.created_by as Record<string, unknown>)
        : null;

    const parsedHours = Number.parseFloat(String(log.hours ?? "0"));
    const unpacked = unpackPayloadFields(log);
    const payloadCols = extractPayloadColumns(log, params.companyId, params.projectId);
    const customFieldsPayload: Prisma.InputJsonObject = {
      procoreId,
      procoreCompanyId: params.companyId || null,
      procoreProjectId: params.projectId,
      dailyLogSegmentId: String(log.daily_log_segment_id ?? "") || null,
      createdById: String(createdBy?.id ?? "") || null,
      createdByName: String(createdBy?.name ?? "") || null,
      originalData: log as unknown as Prisma.InputJsonValue,
      topLevelFields: asJsonValue(log),
      unpackedPaths: unpacked.allPaths,
      unpackedScalarFields: unpacked.scalarFields,
      unpackedJsonFields: unpacked.jsonFields,
      unpackedFieldCount: unpacked.allPaths.length,
    };

    const sharedFields = {
      projectId: linkedProjectResult.project?.id,
      jobKey: linkedProjectResult.project?.projectNumber || params.projectNumber || params.projectId,
      date: new Date(`${dateText}T00:00:00.000Z`),
      foreman: String(log.foreman_name ?? log.foreman ?? "") || null,
      crew: String(log.crew_name ?? log.crew ?? "") || null,
      hours: Number.isFinite(parsedHours) ? parsedHours : null,
      scopeOfWork: String(log.scope_of_work ?? log.line_item_description ?? "") || null,
      notes: String(log.notes ?? "") || null,
      customFields: customFieldsPayload,
      ...payloadCols,
    };

    await prisma.productivityLog.upsert({
      where: { id: procoreId },
      update: sharedFields,
      create: { id: procoreId, ...sharedFields },
    });

    await syncUnpackedFieldsForLog(procoreId, unpacked.jsonFields);

    saved += 1;
  }

  return {
    attempted: logs.length,
    saved,
    skipped,
    projectLinked: Boolean(linkedProjectResult.project?.id),
    projectCreated: linkedProjectResult.created,
    linkedProjectId: linkedProjectResult.project?.id || null,
  };
}
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ProcoreTimecardTimeType = Record<string, unknown>;
type MutableJsonObject = Record<string, Prisma.InputJsonValue>;
let unpackedFieldsTableReady: Promise<void> | null = null;

type PersistTimecardTimeTypesParams = {
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
      if (path) scalarFields[path] = value as Prisma.InputJsonValue;
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, path ? `${path}[${index}]` : `[${index}]`);
      });
      return;
    }

    if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        walk(nested, path ? `${path}.${key}` : key);
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
  if (unpackedFieldsTableReady) return unpackedFieldsTableReady;

  unpackedFieldsTableReady = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS timecard_time_type_unpacked_fields (
        id BIGSERIAL PRIMARY KEY,
        type_id TEXT NOT NULL,
        field_path TEXT NOT NULL,
        value_type TEXT NOT NULL,
        value_text TEXT NULL,
        value_number DOUBLE PRECISION NULL,
        value_boolean BOOLEAN NULL,
        value_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (type_id, field_path),
        CONSTRAINT fk_tc_time_type_unpacked
          FOREIGN KEY (type_id)
          REFERENCES "TimecardTimeType"(id)
          ON DELETE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_tc_tt_unpacked_field_path ON timecard_time_type_unpacked_fields(field_path)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_tc_tt_unpacked_value_text ON timecard_time_type_unpacked_fields(value_text)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_tc_tt_unpacked_path_text ON timecard_time_type_unpacked_fields(field_path, value_text)"
    );
  })();

  return unpackedFieldsTableReady;
}

function classifyValue(value: Prisma.InputJsonValue) {
  if (value === null)
    return { valueType: "null", valueText: null as string | null, valueNumber: null as number | null, valueBoolean: null as boolean | null, valueJson: null as Prisma.InputJsonValue };
  if (typeof value === "string")
    return { valueType: "string", valueText: value, valueNumber: null as number | null, valueBoolean: null as boolean | null, valueJson: value };
  if (typeof value === "number")
    return { valueType: "number", valueText: String(value), valueNumber: Number.isFinite(value) ? value : null, valueBoolean: null as boolean | null, valueJson: value };
  if (typeof value === "boolean")
    return { valueType: "boolean", valueText: value ? "true" : "false", valueNumber: null as number | null, valueBoolean: value, valueJson: value };
  return { valueType: "json", valueText: JSON.stringify(value), valueNumber: null as number | null, valueBoolean: null as boolean | null, valueJson: value };
}

async function syncUnpackedFieldsForType(typeId: string, unpackedJsonFields: Prisma.InputJsonObject) {
  await ensureUnpackedFieldsTable();

  const rows = Object.entries(unpackedJsonFields).map(([fieldPath, rawValue]) => {
    const classified = classifyValue(rawValue as Prisma.InputJsonValue);
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
    "DELETE FROM timecard_time_type_unpacked_fields WHERE type_id = $1",
    typeId
  );

  if (!rows.length) return;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO timecard_time_type_unpacked_fields
        (type_id, field_path, value_type, value_text, value_number, value_boolean, value_json, updated_at)
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
      ON CONFLICT (type_id, field_path)
      DO UPDATE SET
        value_type = EXCLUDED.value_type,
        value_text = EXCLUDED.value_text,
        value_number = EXCLUDED.value_number,
        value_boolean = EXCLUDED.value_boolean,
        value_json = COALESCE(EXCLUDED.value_json, 'null'::jsonb),
        updated_at = NOW()
    `,
    typeId,
    JSON.stringify(rows)
  );
}

function toNullableDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNullableString(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

function extractPayloadColumns(
  record: ProcoreTimecardTimeType,
  companyId: string | undefined,
  projectId: string
) {
  return {
    procoreId: toNullableString(record.id),
    procoreCompanyId: toNullableString(companyId),
    procoreProjectId: toNullableString(projectId),
    name: toNullableString(record.name),
    active: typeof record.active === "boolean" ? record.active : null,
    global: typeof record.global === "boolean" ? record.global : null,
    procoreCreatedAt: toNullableDate(record.created_at),
    procoreUpdatedAt: toNullableDate(record.updated_at),
    procoreDeletedAt: toNullableDate(record.deleted_at),
  };
}

async function resolveLinkedProject(params: PersistTimecardTimeTypesParams) {
  const { companyId, projectId, projectName, projectNumber, createProjectIfMissing } = params;

  const matchers: Prisma.ProjectWhereInput[] = [
    { customFields: { path: ["procoreProjectId"], equals: projectId } },
    { customFields: { path: ["procoreId"], equals: projectId } },
    { projectNumber: projectId },
  ];

  if (projectNumber) matchers.push({ projectNumber });
  if (projectName && projectNumber) matchers.push({ projectName, projectNumber });
  else if (projectName) matchers.push({ projectName });

  const existing = await prisma.project.findFirst({
    where: { OR: matchers },
    select: { id: true, projectNumber: true, projectName: true, customFields: true },
  });

  if (existing) return { linkedProjectId: existing.id, projectCreated: false };

  if (!createProjectIfMissing) return { linkedProjectId: null, projectCreated: false };

  const newProject = await prisma.project.create({
    data: {
      projectNumber: projectNumber || projectId,
      projectName: projectName || `Procore Project ${projectId}`,
      customFields: {
        procoreProjectId: projectId,
        procoreCompanyId: companyId || null,
        source: "procore_timecard_time_types_sync",
      },
    },
    select: { id: true },
  });

  return { linkedProjectId: newProject.id, projectCreated: true };
}

export async function persistTimecardTimeTypes(
  records: ProcoreTimecardTimeType[],
  params: PersistTimecardTimeTypesParams
) {
  const { companyId, projectId } = params;
  const { linkedProjectId, projectCreated } = await resolveLinkedProject(params);

  let saved = 0;
  let skipped = 0;

  for (const record of records) {
    try {
      const rawId = toNullableString(asObject(record).id);
      if (!rawId) { skipped += 1; continue; }

      const uid = `tct_${rawId}_${projectId}`;
      const cols = extractPayloadColumns(record, companyId, projectId);
      const { jsonFields } = unpackPayloadFields(record);

      const sharedFields = {
        ...cols,
        jobKey: linkedProjectId || undefined,
        projectId: linkedProjectId || undefined,
        customFields: record as unknown as Prisma.InputJsonObject,
        updatedAt: new Date(),
      };

      const existing = await prisma.timecardTimeType.findFirst({
        where: { procoreId: cols.procoreId ?? undefined, procoreProjectId: projectId },
        select: { id: true },
      });

      let typeId: string;

      if (existing) {
        await prisma.timecardTimeType.update({
          where: { id: existing.id },
          data: sharedFields,
        });
        typeId = existing.id;
      } else {
        const created = await prisma.timecardTimeType.create({
          data: { id: uid, ...sharedFields },
        });
        typeId = created.id;
      }

      await syncUnpackedFieldsForType(typeId, jsonFields);
      saved += 1;
    } catch {
      skipped += 1;
    }
  }

  return { saved, skipped, linkedProjectId, projectCreated };
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveProcoreLegacyProject } from "@/lib/procoreLegacyProjectIdentity";
import { selectProcoreSourceProjectLink, reportProcoreSourceProjectLinkConflicts } from "@/lib/procoreSourceProjectLink";

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
    return;
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

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = toNullableString(value);
    if (text) return text;
  }
  return null;
}

function extractPayloadColumns(
  record: ProcoreTimecardTimeType,
  companyId: string | undefined,
  projectId: string
) {
  const payload = asObject(record);
  return {
    procoreId: toNullableString(payload.id),
    procoreCompanyId: toNullableString(companyId),
    procoreProjectId: toNullableString(projectId),
    name: firstNonEmptyString(payload.name, payload.time_type, payload.abbreviated_time_type),
    active: typeof payload.active === "boolean" ? payload.active : null,
    global: typeof payload.global === "boolean" ? payload.global : null,
    procoreCreatedAt: toNullableDate(payload.created_at),
    procoreUpdatedAt: toNullableDate(payload.updated_at),
    procoreDeletedAt: toNullableDate(payload.deleted_at),
  };
}


export async function persistTimecardTimeTypes(
  records: ProcoreTimecardTimeType[],
  params: PersistTimecardTimeTypesParams
) {
  const { companyId, projectId } = params;
  const linkedProjectResult = await resolveProcoreLegacyProject({ ...params, companyId: params.companyId, source: "procore_timecard_time_types_sync" });
  const linkedProjectId = linkedProjectResult.project?.id ?? null;
  const projectCreated = linkedProjectResult.created;

  let saved = 0;
  let skipped = 0;
  let projectLinkConflicts = 0;

  for (const record of records) {
    try {
      const rawId = toNullableString(asObject(record).id);
      if (!rawId) { skipped += 1; continue; }

      const uid = `tct_${rawId}_${projectId}`;
      const cols = extractPayloadColumns(record, companyId, projectId);
      const { jsonFields } = unpackPayloadFields(record);
      const existing = await prisma.timecardTimeType.findFirst({
        where: { procoreId: cols.procoreId ?? undefined, procoreProjectId: projectId },
        select: { id: true, projectId: true, jobKey: true },
      });
      const projectLink = selectProcoreSourceProjectLink(existing, linkedProjectResult.project, "id");
      if (projectLink.conflict) projectLinkConflicts += 1;

      const sharedFields = {
        ...cols,
        jobKey: projectLink.jobKey,
        projectId: projectLink.projectId,
        customFields: record as unknown as Prisma.InputJsonObject,
        updatedAt: new Date(),
      };

      let typeId: string;

      if (existing) {
        await prisma.timecardTimeType.update({
          where: { id: existing.id },
          data: { ...sharedFields, ...projectLink.update },
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

  reportProcoreSourceProjectLinkConflicts("timecard-time-types", params, projectLinkConflicts);
  return {
    saved, skipped, linkedProjectId, projectCreated, projectLinkConflicts,
    projectIdentity: { status: linkedProjectResult.status, reason: linkedProjectResult.reason },
  };
}

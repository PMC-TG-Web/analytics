import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ProcoreTimecardEntry = Record<string, unknown>;
type MutableJsonObject = Record<string, Prisma.InputJsonValue>;
let unpackedFieldsTableReady: Promise<void> | null = null;

type PersistTimecardEntriesParams = {
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
      CREATE TABLE IF NOT EXISTS timecard_entry_unpacked_fields (
        id BIGSERIAL PRIMARY KEY,
        entry_id TEXT NOT NULL,
        field_path TEXT NOT NULL,
        value_type TEXT NOT NULL,
        value_text TEXT NULL,
        value_number DOUBLE PRECISION NULL,
        value_boolean BOOLEAN NULL,
        value_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (entry_id, field_path),
        CONSTRAINT fk_timecard_unpacked_entry
          FOREIGN KEY (entry_id)
          REFERENCES "TimecardEntry"(id)
          ON DELETE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_tc_unpacked_field_path ON timecard_entry_unpacked_fields(field_path)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_tc_unpacked_value_text ON timecard_entry_unpacked_fields(value_text)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_tc_unpacked_value_number ON timecard_entry_unpacked_fields(value_number)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_tc_unpacked_value_boolean ON timecard_entry_unpacked_fields(value_boolean)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_tc_unpacked_path_text ON timecard_entry_unpacked_fields(field_path, value_text)"
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

async function syncUnpackedFieldsForEntry(entryId: string, unpackedJsonFields: Prisma.InputJsonObject) {
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
    "DELETE FROM timecard_entry_unpacked_fields WHERE entry_id = $1",
    entryId
  );

  if (!rows.length) return;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO timecard_entry_unpacked_fields
        (entry_id, field_path, value_type, value_text, value_number, value_boolean, value_json, updated_at)
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
      ON CONFLICT (entry_id, field_path)
      DO UPDATE SET
        value_type = EXCLUDED.value_type,
        value_text = EXCLUDED.value_text,
        value_number = EXCLUDED.value_number,
        value_boolean = EXCLUDED.value_boolean,
        value_json = COALESCE(EXCLUDED.value_json, 'null'::jsonb),
        updated_at = NOW()
    `,
    entryId,
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

function toNullableString(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

function extractPayloadColumns(
  entry: ProcoreTimecardEntry,
  companyId: string | undefined,
  projectId: string
) {
  const costCode =
    entry.cost_code && typeof entry.cost_code === "object"
      ? (entry.cost_code as Record<string, unknown>)
      : null;
  const subJob =
    entry.sub_job && typeof entry.sub_job === "object"
      ? (entry.sub_job as Record<string, unknown>)
      : null;
  const timeType =
    entry.timecard_time_type && typeof entry.timecard_time_type === "object"
      ? (entry.timecard_time_type as Record<string, unknown>)
      : null;
  const party =
    entry.party && typeof entry.party === "object"
      ? (entry.party as Record<string, unknown>)
      : null;
  const createdBy =
    entry.created_by && typeof entry.created_by === "object"
      ? (entry.created_by as Record<string, unknown>)
      : null;

  return {
    procoreId: toNullableString(entry.id),
    procoreCompanyId: toNullableString(companyId),
    procoreProjectId: toNullableString(projectId),
    status: toNullableString(entry.status),
    description: toNullableString(entry.description),
    billable: typeof entry.billable === "boolean" ? entry.billable : null,
    costCodeId: costCode ? toNullableString(costCode.id) : null,
    costCodeName: costCode ? toNullableString(costCode.name) : null,
    costCodeFullCode: costCode ? toNullableString(costCode.full_code) : null,
    subJobId: subJob ? toNullableString(subJob.id) : null,
    subJobName: subJob ? toNullableString(subJob.name) : null,
    timecardTimeTypeId: timeType ? toNullableString(timeType.id) : null,
    timecardTimeTypeName: timeType ? toNullableString(timeType.name) : null,
    partyId: party ? toNullableString(party.id) : null,
    partyName: party ? toNullableString(party.name) : null,
    partyLogin: party ? toNullableString(party.login) : null,
    createdById: createdBy ? toNullableString(createdBy.id) : null,
    createdByName: createdBy ? toNullableString(createdBy.name) : null,
    createdByLogin: createdBy ? toNullableString(createdBy.login) : null,
    timeIn: toNullableString(entry.time_in),
    timeOut: toNullableString(entry.time_out),
    lunchTime: toNullableFloat(entry.lunch_time),
    totalHoursWorked: toNullableFloat(entry.total_hours_worked),
    procoreCreatedAt: toNullableDate(entry.created_at),
    procoreUpdatedAt: toNullableDate(entry.updated_at),
    procoreDeletedAt: toNullableDate(entry.deleted_at),
  };
}

async function resolveLinkedProject(params: PersistTimecardEntriesParams) {
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

  if (existing) {
    if (createProjectIfMissing) {
      const existingCustomFields = asObject(existing.customFields);
      const existingCompanyId = String(existingCustomFields.procoreCompanyId || "").trim() || null;
      await prisma.project.update({
        where: { id: existing.id },
        data: {
          projectNumber: existing.projectNumber || projectNumber || projectId,
          projectName: existing.projectName || projectName || `Procore Project ${projectId}`,
          customFields: {
            ...existingCustomFields,
            procoreProjectId: projectId,
            procoreCompanyId: companyId || existingCompanyId,
            syncedFrom: "procore_timecards",
            timecardSyncedAt: new Date().toISOString(),
          } as Prisma.InputJsonObject,
        },
      });
    }
    return {
      project: { id: existing.id, projectNumber: existing.projectNumber, projectName: existing.projectName },
      created: false,
    };
  }

  if (!createProjectIfMissing) return { project: null, created: false };

  const created = await prisma.project.create({
    data: {
      projectNumber: projectNumber || projectId,
      projectName: projectName || `Procore Project ${projectId}`,
      status: "Active",
      customFields: {
        procoreProjectId: projectId,
        procoreCompanyId: companyId || null,
        syncedFrom: "procore_timecards",
        timecardSyncedAt: new Date().toISOString(),
      },
    },
    select: { id: true, projectNumber: true, projectName: true },
  });

  return { project: created, created: true };
}

export async function persistTimecardEntries(
  entries: ProcoreTimecardEntry[],
  params: PersistTimecardEntriesParams
) {
  if (!entries.length) {
    return { attempted: 0, saved: 0, skipped: 0, projectLinked: false, projectCreated: false, linkedProjectId: null as string | null };
  }

  const linkedProjectResult = await resolveLinkedProject(params);
  await ensureUnpackedFieldsTable();

  let saved = 0;
  let skipped = 0;

  for (const entry of entries) {
    const procoreId = String(entry.id ?? "").trim();
    if (!procoreId) { skipped += 1; continue; }

    const dateText = normalizeDate(entry.date ?? entry.log_date);
    if (!dateText) { skipped += 1; continue; }

    const party =
      entry.party && typeof entry.party === "object"
        ? (entry.party as Record<string, unknown>)
        : null;

    const parsedHours = Number.parseFloat(String(entry.hours ?? entry.total_hours_worked ?? "0"));
    const unpacked = unpackPayloadFields(entry);
    const payloadCols = extractPayloadColumns(entry, params.companyId, params.projectId);

    const customFieldsPayload: Prisma.InputJsonObject = {
      procoreId,
      procoreCompanyId: params.companyId || null,
      procoreProjectId: params.projectId,
      partyId: String(party?.id ?? "") || null,
      partyName: String(party?.name ?? "") || null,
      originalData: entry as unknown as Prisma.InputJsonValue,
      topLevelFields: asJsonValue(entry),
      unpackedPaths: unpacked.allPaths,
      unpackedScalarFields: unpacked.scalarFields,
      unpackedJsonFields: unpacked.jsonFields,
      unpackedFieldCount: unpacked.allPaths.length,
    };

    const sharedFields = {
      projectId: linkedProjectResult.project?.id,
      jobKey: linkedProjectResult.project?.projectNumber || params.projectNumber || params.projectId,
      date: new Date(`${dateText}T00:00:00.000Z`),
      party: String(party?.name ?? "") || null,
      hours: Number.isFinite(parsedHours) ? parsedHours : null,
      ...payloadCols,
      customFields: customFieldsPayload,
      updatedAt: new Date(),
    };

    try {
      const existingEntry = await prisma.timecardEntry.findFirst({
        where: {
          procoreId,
          procoreProjectId: params.projectId,
        },
        select: { id: true },
      });

      let savedEntry: { id: string };
      if (existingEntry) {
        savedEntry = await prisma.timecardEntry.update({
          where: { id: existingEntry.id },
          data: sharedFields,
          select: { id: true },
        });
      } else {
        savedEntry = await prisma.timecardEntry.create({
          data: { id: `tc_${procoreId}_${params.projectId}`, ...sharedFields },
          select: { id: true },
        });
      }

      await syncUnpackedFieldsForEntry(savedEntry.id, unpacked.jsonFields);
      saved += 1;
    } catch {
      skipped += 1;
    }
  }

  return {
    attempted: entries.length,
    saved,
    skipped,
    projectLinked: Boolean(linkedProjectResult.project),
    projectCreated: linkedProjectResult.created,
    linkedProjectId: linkedProjectResult.project?.id ?? null,
  };
}

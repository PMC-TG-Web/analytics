import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TimecardEntry" (
      id TEXT NOT NULL PRIMARY KEY,
      "jobKey" TEXT NULL,
      "projectId" TEXT NULL,
      date TIMESTAMPTZ NOT NULL,
      hours DOUBLE PRECISION NULL,
      party TEXT NULL,
      "procoreId" TEXT NULL,
      "procoreCompanyId" TEXT NULL,
      "procoreProjectId" TEXT NULL,
      status TEXT NULL,
      description TEXT NULL,
      billable BOOLEAN NULL,
      "costCodeId" TEXT NULL,
      "costCodeName" TEXT NULL,
      "costCodeFullCode" TEXT NULL,
      "subJobId" TEXT NULL,
      "subJobName" TEXT NULL,
      "timecardTimeTypeId" TEXT NULL,
      "timecardTimeTypeName" TEXT NULL,
      "partyId" TEXT NULL,
      "partyName" TEXT NULL,
      "partyLogin" TEXT NULL,
      "createdById" TEXT NULL,
      "createdByName" TEXT NULL,
      "createdByLogin" TEXT NULL,
      "timeIn" TEXT NULL,
      "timeOut" TEXT NULL,
      "lunchTime" DOUBLE PRECISION NULL,
      "totalHoursWorked" DOUBLE PRECISION NULL,
      "procoreCreatedAt" TIMESTAMPTZ NULL,
      "procoreUpdatedAt" TIMESTAMPTZ NULL,
      "procoreDeletedAt" TIMESTAMPTZ NULL,
      "customFields" JSONB NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("TimecardEntry table created (or already exists)");

  const indexes = [
    ['idx_timecard_entry_job_key',     '"TimecardEntry"("jobKey")'],
    ['idx_timecard_entry_project_id',  '"TimecardEntry"("projectId")'],
    ['idx_timecard_entry_date',        '"TimecardEntry"(date)'],
    ['idx_timecard_entry_procore_id',  '"TimecardEntry"("procoreId")'],
    ['idx_timecard_entry_party',       '"TimecardEntry"(party)'],
    ['idx_timecard_entry_status',      '"TimecardEntry"(status)'],
    ['idx_timecard_entry_cost_code_id','"TimecardEntry"("costCodeId")'],
  ];

  for (const [name, cols] of indexes) {
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS ${name} ON ${cols}`);
  }
  console.log("Indexes created");

  // FK – PostgreSQL ALTER TABLE ADD CONSTRAINT IF NOT EXISTS requires PG 9.5+
  // Wrap in DO block to avoid error if already exists
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_timecard_entry_project'
      ) THEN
        ALTER TABLE "TimecardEntry"
          ADD CONSTRAINT fk_timecard_entry_project
          FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);
  console.log("FK constraint ensured");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TimecardTimeType" (
      id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      "jobKey" TEXT,
      "projectId" TEXT,
      "procoreId" TEXT,
      "procoreCompanyId" TEXT,
      "procoreProjectId" TEXT,
      name TEXT,
      active BOOLEAN,
      global BOOLEAN,
      "procoreCreatedAt" TIMESTAMPTZ,
      "procoreUpdatedAt" TIMESTAMPTZ,
      "procoreDeletedAt" TIMESTAMPTZ,
      "customFields" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "TimecardTimeType_pkey" PRIMARY KEY (id)
    )
  `);
  console.log("TimecardTimeType table created (or already exists)");

  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TimecardTimeType_jobKey_idx" ON "TimecardTimeType"("jobKey")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TimecardTimeType_projectId_idx" ON "TimecardTimeType"("projectId")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TimecardTimeType_procoreId_idx" ON "TimecardTimeType"("procoreId")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "TimecardTimeType_name_idx" ON "TimecardTimeType"(name)`
  );
  console.log("Indexes created");

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'TimecardTimeType_projectId_fkey'
          AND table_name = 'TimecardTimeType'
      ) THEN
        ALTER TABLE "TimecardTimeType"
          ADD CONSTRAINT "TimecardTimeType_projectId_fkey"
          FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE SET NULL;
      END IF;
    END$$
  `);
  console.log("FK constraint ensured");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

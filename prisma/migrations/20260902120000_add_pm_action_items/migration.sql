CREATE TABLE "pmc_action_items" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL DEFAULT '598134325805519',
    "procore_project_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT,
    "due_at" TIMESTAMPTZ(6),
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "assignee_emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "assignee_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "source_url" TEXT,
    "payload" JSONB,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pmc_action_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pmc_action_item_sync_state" (
    "company_id" TEXT NOT NULL DEFAULT '598134325805519',
    "procore_project_id" TEXT NOT NULL,
    "last_attempt_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pmc_action_item_sync_state_pkey" PRIMARY KEY ("company_id", "procore_project_id")
);

CREATE UNIQUE INDEX "pmc_action_items_company_id_procore_project_id_source_type_source_id_key"
ON "pmc_action_items"("company_id", "procore_project_id", "source_type", "source_id");

CREATE INDEX "pmc_action_items_company_id_is_open_due_at_idx"
ON "pmc_action_items"("company_id", "is_open", "due_at");

CREATE INDEX "pmc_action_items_company_id_source_type_due_at_idx"
ON "pmc_action_items"("company_id", "source_type", "due_at");

CREATE INDEX "pmc_action_items_procore_project_id_idx"
ON "pmc_action_items"("procore_project_id");

CREATE INDEX "pmc_action_items_assignee_emails_gin_idx"
ON "pmc_action_items" USING GIN ("assignee_emails");

CREATE INDEX "pmc_action_item_sync_state_company_id_last_attempt_at_idx"
ON "pmc_action_item_sync_state"("company_id", "last_attempt_at");

CREATE INDEX "pmc_action_item_sync_state_company_id_last_success_at_idx"
ON "pmc_action_item_sync_state"("company_id", "last_success_at");

ALTER TABLE "pmc_action_items"
ADD CONSTRAINT "pmc_action_items_company_id_procore_project_id_fkey"
FOREIGN KEY ("company_id", "procore_project_id") REFERENCES "pmc_projects"("company_id", "procore_project_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pmc_action_item_sync_state"
ADD CONSTRAINT "pmc_action_item_sync_state_company_id_procore_project_id_fkey"
FOREIGN KEY ("company_id", "procore_project_id") REFERENCES "pmc_projects"("company_id", "procore_project_id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing Project Manager users may store expanded page permissions instead
-- of the PMs group name. Grant the new page without replacing custom access.
UPDATE "User" AS u
SET "permissions" = array_append(u."permissions", 'pm-dashboard'),
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Employee" AS e
WHERE lower(u."email") = lower(e."email")
  AND e."isActive" = true
  AND lower(trim(COALESCE(e."jobTitle", ''))) IN ('project manager', 'pm')
  AND NOT ('pm-dashboard' = ANY(u."permissions"));

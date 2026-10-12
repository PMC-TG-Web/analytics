-- New WIP plans deliberately do not import legacy schedule allocations.
CREATE TABLE "wip_plans" (
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "source" JSONB NOT NULL,
  "allocations" JSONB NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "updated_by" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "wip_plans_pkey" PRIMARY KEY ("company_id", "project_id"),
  CONSTRAINT "wip_plans_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id")
    REFERENCES "pmc_projects"("company_id", "procore_project_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "wip_plan_revisions" (
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "source" JSONB NOT NULL,
  "allocations" JSONB NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '',
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wip_plan_revisions_pkey" PRIMARY KEY ("company_id", "project_id", "revision"),
  CONSTRAINT "wip_plan_revisions_company_id_project_id_fkey" FOREIGN KEY ("company_id", "project_id")
    REFERENCES "wip_plans"("company_id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

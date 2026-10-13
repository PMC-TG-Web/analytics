CREATE TABLE "wip_import_drafts" (
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "allocations" JSONB NOT NULL,
  "notes" TEXT NOT NULL,
  "source_name" TEXT NOT NULL,
  PRIMARY KEY ("company_id", "project_id"),
  FOREIGN KEY ("company_id", "project_id") REFERENCES "pmc_projects"("company_id", "procore_project_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

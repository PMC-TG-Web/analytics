CREATE TABLE "procore_request_gates" (
  "company_id" TEXT PRIMARY KEY,
  "lease_id" TEXT,
  "lease_until" TIMESTAMPTZ(6),
  "interactive_until" TIMESTAMPTZ(6),
  "blocked_until" TIMESTAMPTZ(6),
  "windows" JSONB NOT NULL DEFAULT '[]',
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE TABLE "procore_wbs_caches" (
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "records" JSONB NOT NULL,
  "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("company_id", "project_id")
);

CREATE TABLE "procore_api_usage" (
  "company_id" TEXT NOT NULL,
  "hour" TIMESTAMPTZ(6) NOT NULL,
  "lane" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("company_id", "hour", "lane", "endpoint", "status")
);
CREATE INDEX "procore_api_usage_hour_idx" ON "procore_api_usage" ("hour");

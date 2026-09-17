CREATE TABLE "qbo_bill_relay_jobs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "host_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'queued',
  "result" JSONB,
  "error" TEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6)
);
CREATE INDEX "qbo_bill_relay_jobs_host_id_company_id_state_created_at_idx"
  ON "qbo_bill_relay_jobs"("host_id", "company_id", "state", "created_at");
CREATE TABLE "qbo_bill_relay_hosts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "company_id" TEXT NOT NULL,
  "writes_enabled" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);

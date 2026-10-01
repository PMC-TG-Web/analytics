CREATE TABLE "qbo_bill_batch_runs" (
  "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "month" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "activeKey" TEXT,
  "status" TEXT NOT NULL DEFAULT 'running', "retryOf" TEXT,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL, "finishedAt" TIMESTAMPTZ(6),
  CONSTRAINT "qbo_bill_batch_month" CHECK ("month" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$')
);
CREATE UNIQUE INDEX "qbo_bill_batch_runs_activeKey_key" ON "qbo_bill_batch_runs"("activeKey");
CREATE UNIQUE INDEX "qbo_bill_batch_runs_companyId_requestKey_key" ON "qbo_bill_batch_runs"("companyId", "requestKey");
CREATE INDEX "qbo_bill_batch_runs_companyId_month_createdAt_idx" ON "qbo_bill_batch_runs"("companyId", "month", "createdAt");
CREATE TABLE "qbo_bill_batch_projects" (
  "id" TEXT PRIMARY KEY, "runId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "projectName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued', "stage" TEXT NOT NULL DEFAULT 'catalog',
  "message" TEXT NOT NULL DEFAULT 'Waiting to refresh sources.', "attempts" INTEGER NOT NULL DEFAULT 0,
  "context" JSONB NOT NULL DEFAULT '{}', "issues" JSONB NOT NULL DEFAULT '[]', "issueSources" JSONB NOT NULL DEFAULT '[]',
  "billNumber" TEXT, "writeStartedAt" TIMESTAMPTZ(6),
  "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "qbo_bill_batch_projects_runId_fkey" FOREIGN KEY ("runId") REFERENCES "qbo_bill_batch_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "qbo_bill_batch_projects_runId_projectId_key" ON "qbo_bill_batch_projects"("runId", "projectId");
CREATE INDEX "qbo_bill_batch_projects_runId_status_nextAttemptAt_idx" ON "qbo_bill_batch_projects"("runId", "status", "nextAttemptAt");

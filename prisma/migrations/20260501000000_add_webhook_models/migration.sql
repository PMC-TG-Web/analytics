-- CreateTable: procore_webhook_hooks
CREATE TABLE IF NOT EXISTS "procore_webhook_hooks" (
    "id" TEXT NOT NULL,
    "procore_hook_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT,
    "namespace" TEXT,
    "payload_version" TEXT,
    "destination_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "trigger_count" INTEGER,
    "last_verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procore_webhook_hooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: procore_webhook_events
CREATE TABLE IF NOT EXISTS "procore_webhook_events" (
    "id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "procore_event_id" TEXT,
    "event_ulid" TEXT,
    "company_id" TEXT,
    "project_id" TEXT,
    "resource_name" TEXT,
    "event_type" TEXT,
    "resource_id" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procore_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: procore_webhook_queue
CREATE TABLE IF NOT EXISTS "procore_webhook_queue" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procore_webhook_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "procore_webhook_hooks_procore_hook_id_key" ON "procore_webhook_hooks"("procore_hook_id");

CREATE INDEX IF NOT EXISTS "idx_pwh_company_id" ON "procore_webhook_hooks"("company_id");
CREATE INDEX IF NOT EXISTS "idx_pwh_project_id" ON "procore_webhook_hooks"("project_id");
CREATE INDEX IF NOT EXISTS "idx_pwh_scope" ON "procore_webhook_hooks"("scope");
CREATE INDEX IF NOT EXISTS "idx_pwh_status" ON "procore_webhook_hooks"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "procore_webhook_events_event_key_key" ON "procore_webhook_events"("event_key");

CREATE INDEX IF NOT EXISTS "idx_pwe_company_id" ON "procore_webhook_events"("company_id");
CREATE INDEX IF NOT EXISTS "idx_pwe_project_id" ON "procore_webhook_events"("project_id");
CREATE INDEX IF NOT EXISTS "idx_pwe_resource_name" ON "procore_webhook_events"("resource_name");
CREATE INDEX IF NOT EXISTS "idx_pwe_event_type" ON "procore_webhook_events"("event_type");
CREATE INDEX IF NOT EXISTS "idx_pwe_received_at" ON "procore_webhook_events"("received_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_pwq_status_available" ON "procore_webhook_queue"("status", "available_at");
CREATE INDEX IF NOT EXISTS "idx_pwq_event_id" ON "procore_webhook_queue"("event_id");
CREATE INDEX IF NOT EXISTS "idx_pwq_locked_at" ON "procore_webhook_queue"("locked_at");

-- AddForeignKey
ALTER TABLE "procore_webhook_queue" ADD CONSTRAINT "procore_webhook_queue_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "procore_webhook_events"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

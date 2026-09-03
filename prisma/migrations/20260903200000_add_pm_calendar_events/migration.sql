-- Outlook calendar mirror for the PM dashboard (Microsoft Graph, application permissions).
-- Additive only.

CREATE TABLE IF NOT EXISTS "pmc_calendar_events" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_email" TEXT NOT NULL,
    "graph_event_id" TEXT NOT NULL,
    "ical_uid" TEXT,
    "series_master_id" TEXT,
    "subject" TEXT NOT NULL,
    "location" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "show_as" TEXT,
    "sensitivity" TEXT,
    "organizer_email" TEXT,
    "attendee_emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "online_meeting_url" TEXT,
    "web_link" TEXT,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pmc_calendar_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pmc_calendar_events_user_email_graph_event_id_key"
ON "pmc_calendar_events"("user_email", "graph_event_id");

CREATE INDEX IF NOT EXISTS "pmc_calendar_events_user_email_starts_at_idx"
ON "pmc_calendar_events"("user_email", "starts_at");

CREATE TABLE IF NOT EXISTS "pmc_calendar_sync_state" (
    "user_email" TEXT NOT NULL,
    "last_attempt_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "access_denied_at" TIMESTAMPTZ(6),
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pmc_calendar_sync_state_pkey" PRIMARY KEY ("user_email")
);

CREATE INDEX IF NOT EXISTS "pmc_calendar_sync_state_last_attempt_at_idx"
ON "pmc_calendar_sync_state"("last_attempt_at");

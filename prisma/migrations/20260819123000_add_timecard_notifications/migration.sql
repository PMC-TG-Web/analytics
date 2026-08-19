CREATE TABLE public.timecard_notifications (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  timesheet_id TEXT NOT NULL,
  timecard_date DATE,
  created_by_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 12,
  available_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TIMESTAMPTZ(6),
  locked_by TEXT,
  recipient_emails JSONB,
  sent_at TIMESTAMPTZ(6),
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_timecard_notification_timesheet
    UNIQUE (company_id, project_id, timesheet_id)
);

CREATE INDEX idx_timecard_notification_pending
  ON public.timecard_notifications (status, available_at);

CREATE INDEX idx_timecard_notification_project
  ON public.timecard_notifications (project_id);

CREATE INDEX idx_timecard_notification_sent
  ON public.timecard_notifications (sent_at DESC);

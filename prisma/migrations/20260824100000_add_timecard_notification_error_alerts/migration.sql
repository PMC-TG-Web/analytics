ALTER TABLE timecard_notifications
  ADD COLUMN error_alert_message TEXT,
  ADD COLUMN error_alert_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN error_alert_available_at TIMESTAMPTZ,
  ADD COLUMN error_alert_locked_at TIMESTAMPTZ,
  ADD COLUMN error_alert_locked_by TEXT,
  ADD COLUMN error_alert_sent_at TIMESTAMPTZ,
  ADD COLUMN error_alert_provider_message_id TEXT,
  ADD COLUMN error_alert_last_error TEXT;

CREATE INDEX idx_timecard_notification_error_alert
  ON timecard_notifications (error_alert_sent_at, error_alert_available_at);

UPDATE timecard_notifications
SET
  error_alert_message = last_error,
  error_alert_available_at = NOW()
WHERE last_error IS NOT NULL
  AND error_alert_message IS NULL
  AND error_alert_sent_at IS NULL;

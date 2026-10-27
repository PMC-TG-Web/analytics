-- Additive only: existing budget payloads and historical aggregates stay intact.
-- A marker records observed absence, not a provider-supplied deletion timestamp.
ALTER TABLE budgetlineitems ADD COLUMN IF NOT EXISTS source_missing_at TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS procore_budget_snapshot_states (
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  last_write_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_complete_at TIMESTAMPTZ(6),
  last_snapshot_started_at TIMESTAMPTZ(6),
  source_count INTEGER,
  CONSTRAINT procore_budget_snapshot_states_pkey PRIMARY KEY (company_id, project_id)
);

-- Ordinary view: focused project syncs are immediately visible to analytics.
-- Existing rows are active until a complete, scoped source read proves absence.
CREATE OR REPLACE VIEW budgetlineitems_active AS
SELECT * FROM budgetlineitems WHERE source_missing_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_budgetlineitems_active_company_project
  ON budgetlineitems (company_id, project_id) WHERE source_missing_at IS NULL;

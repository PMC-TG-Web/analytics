CREATE TABLE commitment_maker_change_order_applications (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_number TEXT,
  source_title TEXT,
  target_kind TEXT NOT NULL,
  requested_target_commitment_id TEXT,
  target_commitment_id TEXT,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed',
  lease_token TEXT NOT NULL,
  lease_expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX commitment_maker_co_applications_company_project_idx
  ON commitment_maker_change_order_applications (company_id, project_id);
CREATE INDEX commitment_maker_co_applications_target_idx
  ON commitment_maker_change_order_applications (target_commitment_id);
CREATE INDEX commitment_maker_co_applications_lease_idx
  ON commitment_maker_change_order_applications (status, lease_expires_at);

CREATE TABLE commitment_maker_change_order_aliases (
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, project_id, source_kind, source_id),
  CONSTRAINT commitment_maker_co_aliases_application_fk
    FOREIGN KEY (application_id)
    REFERENCES commitment_maker_change_order_applications (id)
    ON DELETE CASCADE
);

CREATE INDEX commitment_maker_co_aliases_application_idx
  ON commitment_maker_change_order_aliases (application_id);

WITH historical_applications AS (
  SELECT DISTINCT ON (
    project."company_id",
    audit."changes"->>'projectId',
    audit."changes"->'sourceChangeOrder'->>'sourceKind',
    audit."changes"->'sourceChangeOrder'->>'packageId'
  )
    project."company_id" AS company_id,
    audit."changes"->>'projectId' AS project_id,
    audit."changes"->'sourceChangeOrder'->>'sourceKind' AS source_kind,
    audit."changes"->'sourceChangeOrder'->>'packageId' AS source_id,
    audit."changes"->'sourceChangeOrder'->>'number' AS source_number,
    audit."changes"->'sourceChangeOrder'->>'title' AS source_title,
    CASE WHEN audit."action" = 'append-lines' THEN 'existing_purchase_order' ELSE 'new_purchase_order' END AS target_kind,
    audit."entityId" AS target_commitment_id,
    COALESCE(audit."changes"->>'fingerprint', 'historical') AS request_fingerprint,
    audit."createdAt" AS completed_at
  FROM "AuditLog" audit
  JOIN pmc_projects project
    ON project."procore_project_id" = audit."changes"->>'projectId'
  WHERE audit."entity" = 'ProcoreCommitmentMaker'
    AND audit."action" IN ('create', 'resume', 'append-lines')
    AND audit."changes"->'sourceChangeOrder'->>'sourceKind'
      IN ('change_order_package', 'potential_change_order')
    AND COALESCE(audit."changes"->'sourceChangeOrder'->>'packageId', '') <> ''
    AND COALESCE(audit."entityId", '') <> ''
  ORDER BY
    project."company_id",
    audit."changes"->>'projectId',
    audit."changes"->'sourceChangeOrder'->>'sourceKind',
    audit."changes"->'sourceChangeOrder'->>'packageId',
    audit."createdAt" ASC
)
INSERT INTO commitment_maker_change_order_applications (
  id, company_id, project_id, source_kind, source_id, source_number, source_title,
  target_kind, requested_target_commitment_id, target_commitment_id,
  request_fingerprint, status, lease_token, lease_expires_at, completed_at,
  created_at, updated_at
)
SELECT
  'historical:' || md5(company_id || ':' || project_id || ':' || source_kind || ':' || source_id),
  company_id,
  project_id,
  source_kind,
  source_id,
  source_number,
  source_title,
  target_kind,
  CASE WHEN target_kind = 'existing_purchase_order' THEN target_commitment_id ELSE NULL END,
  target_commitment_id,
  request_fingerprint,
  'completed',
  'historical',
  completed_at,
  completed_at,
  completed_at,
  completed_at
FROM historical_applications;

INSERT INTO commitment_maker_change_order_aliases (
  company_id, project_id, source_kind, source_id, application_id
)
SELECT company_id, project_id, source_kind, source_id, id
FROM commitment_maker_change_order_applications;

INSERT INTO commitment_maker_change_order_aliases (
  company_id, project_id, source_kind, source_id, application_id
)
SELECT
  application.company_id,
  application.project_id,
  'potential_change_order',
  potential_change_order.change_order_id,
  application.id
FROM commitment_maker_change_order_applications application
JOIN procore_potential_change_orders potential_change_order
  ON potential_change_order.company_id = application.company_id
  AND potential_change_order.project_id = application.project_id
  AND potential_change_order.package_id = application.source_id
WHERE application.source_kind = 'change_order_package'
ON CONFLICT (company_id, project_id, source_kind, source_id) DO NOTHING;

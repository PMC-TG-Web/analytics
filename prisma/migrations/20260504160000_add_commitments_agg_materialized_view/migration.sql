-- Materialize commitment/purchase-order aggregation used by projects-master query.
-- This avoids repeatedly scanning CommitmentContract and PurchaseOrderContract
-- for every request.

CREATE MATERIALIZED VIEW IF NOT EXISTS commitments_agg_mv AS
WITH combined AS (
    SELECT
        "procoreCompanyId" AS company_id,
        "procoreProjectId" AS canonical_project_id,
        'c:' || id AS scoped_id,
        COALESCE(value, 0) AS row_value,
        NULLIF(TRIM(COALESCE("vendorName", '')), '') AS vendor_name,
        NULLIF(TRIM(COALESCE(status, '')), '') AS row_status,
        TRUE AS is_commitment_contract,
        FALSE AS is_purchase_order_contract
    FROM "CommitmentContract"
    WHERE "procoreCompanyId" IS NOT NULL
      AND "procoreProjectId" IS NOT NULL

    UNION ALL

    SELECT
        "procoreCompanyId" AS company_id,
        "procoreProjectId" AS canonical_project_id,
        'p:' || id AS scoped_id,
        COALESCE(value, 0) AS row_value,
        NULLIF(TRIM(COALESCE("vendorName", '')), '') AS vendor_name,
        NULLIF(TRIM(COALESCE(status, '')), '') AS row_status,
        FALSE AS is_commitment_contract,
        TRUE AS is_purchase_order_contract
    FROM "PurchaseOrderContract"
    WHERE "procoreCompanyId" IS NOT NULL
      AND "procoreProjectId" IS NOT NULL
)
SELECT
    company_id,
    canonical_project_id,
    COUNT(DISTINCT scoped_id) FILTER (WHERE is_commitment_contract)::int AS commitment_contract_count,
    COUNT(DISTINCT scoped_id) FILTER (WHERE is_purchase_order_contract)::int AS purchase_order_contract_count,
    COUNT(DISTINCT scoped_id)::int AS commitment_total_count,
    SUM(row_value)::float AS commitment_total_value,
    STRING_AGG(DISTINCT vendor_name, ', ' ORDER BY vendor_name) AS commitment_vendors,
    STRING_AGG(DISTINCT row_status, ', ' ORDER BY row_status) AS commitment_statuses
FROM combined
GROUP BY company_id, canonical_project_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_agg_mv_company_project
    ON commitments_agg_mv (company_id, canonical_project_id);

CREATE INDEX IF NOT EXISTS idx_commitments_agg_mv_company
    ON commitments_agg_mv (company_id);

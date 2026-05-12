-- Add partial covering indexes for projects-master rollup queries.
--
-- bid_board_latest filters by company_id, removes null procore_project_id rows,
-- and uses DISTINCT ON (procore_project_id) ordered by synced_at DESC. This
-- index matches that access pattern and covers the projected columns.
CREATE INDEX IF NOT EXISTS "idx_bid_board_company_project_synced_covering"
    ON procore_bid_board_live (company_id, procore_project_id, synced_at DESC)
    INCLUDE (bid_board_id, status, customer)
    WHERE procore_project_id IS NOT NULL;

-- commitment_contract_agg is company-scoped in the query and groups by
-- procoreProjectId. INCLUDE columns cover the aggregate/count/string_agg inputs.
CREATE INDEX IF NOT EXISTS "idx_commitment_contract_company_project_covering"
    ON "CommitmentContract" ("procoreCompanyId", "procoreProjectId")
    INCLUDE (id, value, "vendorName", status)
    WHERE "procoreCompanyId" IS NOT NULL AND "procoreProjectId" IS NOT NULL;

-- purchase_order_contract_agg has the same shape as commitment_contract_agg.
CREATE INDEX IF NOT EXISTS "idx_purchase_order_contract_company_project_covering"
    ON "PurchaseOrderContract" ("procoreCompanyId", "procoreProjectId")
    INCLUDE (id, value, "vendorName", status)
    WHERE "procoreCompanyId" IS NOT NULL AND "procoreProjectId" IS NOT NULL;

-- Upgrade idx_pold_procore_id to a covering index.
-- The query joins PurchaseOrderLineItemContractDetail on procoreId and selects costCode.
-- Without INCLUDE(costCode), Postgres must heap-fetch costCode for every matched row,
-- causing excessive block reads. The covering index eliminates that heap access entirely.

DROP INDEX IF EXISTS "idx_pold_procore_id";

CREATE INDEX "idx_pold_procore_id_covering"
    ON "PurchaseOrderLineItemContractDetail" ("procoreId")
    INCLUDE ("costCode");

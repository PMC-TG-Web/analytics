-- Isolate Billing without changing the original app's active leases or quotas.
CREATE TABLE "procore_billing_request_gates" (LIKE "procore_request_gates" INCLUDING ALL);
CREATE TABLE "procore_billing_sync_controls" (LIKE "procore_sync_controls" INCLUDING ALL);
CREATE TABLE "procore_billing_api_usage" (LIKE "procore_api_usage" INCLUDING ALL);

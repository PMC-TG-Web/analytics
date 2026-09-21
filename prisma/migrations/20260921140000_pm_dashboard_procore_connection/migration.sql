-- Isolate the separately configured PM Dashboard OAuth app without changing existing live coordination.
CREATE TABLE "procore_pm_request_gates" (LIKE "procore_request_gates" INCLUDING ALL);
CREATE TABLE "procore_pm_sync_controls" (LIKE "procore_sync_controls" INCLUDING ALL);
CREATE TABLE "procore_pm_api_usage" (LIKE "procore_api_usage" INCLUDING ALL);

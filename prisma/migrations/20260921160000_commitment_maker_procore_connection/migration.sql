-- Additive coordination preserves both existing apps and their live quota during rollout.
CREATE TABLE "procore_cm_request_gates" (LIKE "procore_request_gates" INCLUDING ALL);
CREATE TABLE "procore_cm_sync_controls" (LIKE "procore_sync_controls" INCLUDING ALL);
CREATE TABLE "procore_cm_api_usage" (LIKE "procore_api_usage" INCLUDING ALL);

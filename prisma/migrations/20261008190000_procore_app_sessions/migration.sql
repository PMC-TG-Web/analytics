CREATE TABLE "app_login_sessions" (
  "token_hash" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "procore_user_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "display_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idle_expires_at" TIMESTAMP(3) NOT NULL,
  "absolute_expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "access_token" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_expires_at" TIMESTAMP(3) NOT NULL,
  "refresh_started_at" TIMESTAMP(3),
  "credentials_invalid" BOOLEAN NOT NULL DEFAULT false,
  "scope" TEXT
);
CREATE INDEX "app_login_sessions_email_idx" ON "app_login_sessions"("email");
CREATE INDEX "app_login_sessions_absolute_expires_at_idx" ON "app_login_sessions"("absolute_expires_at");

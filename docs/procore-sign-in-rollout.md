# Procore sign-in preparation

Status: prepared on `codex/procore-primary-signin`; **not launched**. The owner requested preparation only. Do not merge to `main`, push a deploy-triggering branch, apply migrations, change hosted environment variables, or update the Procore app manifest until the owner requests launch.

## Intended experience

The login page offers **Continue with Procore**. A verified Procore user who belongs to the configured company and has an active existing Analytics `User` record receives one app session. The existing User permissions still control every page and API; signing in never creates users or grants permissions. An active session works across the app without a second Auth0 login. Existing email login remains available by default pending confirmation that every user has a Procore account.

Standalone browsers authenticate in the current tab. An embedded page opens the authentication flow in a user-initiated tab, returns via `/auth/complete`, and verifies `/api/auth/me` before continuing. Storage signals, an origin-checked opener message, and bounded polling support the handoff. Browsers that block cross-site cookies retain an explicit **Open app in a new tab** action. An embedded browser is not assumed to inherit the parent Procore session automatically.

## Implementation

- `PROCORE_SIGN_IN_ENABLED` must equal `true` to activate the new provider. It defaults off. `AUTH0_EMAIL_LOGIN_ENABLED=false` disables the fallback only when Procore sign-in is enabled.
- `app_login_sessions` stores an opaque cookie's SHA-256 hash, verified Procore user ID, company ID, email, expiration, revocation and encrypted credentials. The new cookie contains only a random 256-bit identifier. Access and refresh tokens are encrypted with AES-256-GCM, bound to their session hash. No refresh token is sent to browser JavaScript or returned in response JSON.
- Sessions roll to three days after activity, bounded by an original 30-day maximum. API-token expiration does not by itself expire the app session. Reads check the active Analytics User record; deactivation and explicit logout revoke access. No database calls to create the new table happen at runtime.
- `POST /api/auth/session` verifies the session and is protected against cross-origin browser requests. Middleware uses it before protected requests, retaining existing page permission and CSRF checks. Refreshed short-lived HttpOnly access-token cookies are forwarded into the current request to preserve existing Procore tools. Ordinary analytics data still comes from PostgreSQL.
- Provider identity/company checks occur during the OAuth callback and credential renewal, through the shared Procore HTTP module. Token refresh is bounded and uses a durable compare-and-set claim so concurrent requests do not spend a rotating refresh token twice. Both new tokens are saved together. Known revocation rejects the app session; an unknown refresh outcome is not replayed and leaves saved-data access available while live Procore tools require reconnecting. An abandoned claim likewise requires reconnection.
- API identity, `/api/auth/me`, audit attribution, KPI writers and route permissions use the same app identity. An invalid Procore app cookie cannot silently select a different Auth0 account. Sign-in replaces old account/permission cookies; logout revokes the server session and clears all identity cookies without signing the user out of Procore globally.
- The new mode disables the legacy analytics link/query-parameter authentication bypass. Signed, project-specific Commitment Maker links and secret-authenticated workers retain their existing scope. In fallback mode, normal Auth0-authenticated traffic now runs the SDK middleware to renew rolling sessions.

## Configuration for later activation

Prepare these on a separately authorized test environment first:

| Variable | Requirement |
| --- | --- |
| `PROCORE_SIGN_IN_ENABLED` | `true` only when activating the new path |
| `PROCORE_APP_SESSION_SECRET` | New high-entropy server-only secret with at least 32 bytes; never commit it |
| `PROCORE_COMPANY_ID` | Existing intended company; verified against the signed-in user's memberships |
| `PROCORE_CLIENT_ID`, `PROCORE_CLIENT_SECRET` | Credentials for the intended Procore application/environment |
| `APP_BASE_URL` | Exact app origin for the test or production environment |
| `PROCORE_REDIRECT_URI` | That same origin plus `/api/auth/procore/callback`, registered in Procore |
| `AUTH0_EMAIL_LOGIN_ENABLED` | Defaults enabled; set `false` only after confirming email-only users have a replacement |
| Existing Auth0 variables | Retain while the email fallback is enabled |

The existing Procore app registration may already have the correct callback and embedded URL. Verify it instead of creating duplicate registrations. The callback refuses a different-origin configuration, preventing a local/test login from accidentally landing in production. Keep app-session encryption secrets stable for the life of existing sessions; secret rotation requires a planned session reset.

## Validation and remaining launch checks

Automated validation uses in-memory database and provider doubles; it makes no live Procore mutations and applies no migration:

Preparation validation (2026-10-08): `npm run verify` passed with 819 passing tests, 9 skipped tests, no TypeScript errors, and no lint errors (617 existing lint warnings). The direct Next.js webpack build passed with the new sign-in flag enabled only in the build process. No development server was started for this branch.

```powershell
node --test test/appSessionService.test.mjs test/procoreAppOAuth.test.mjs test/procoreAppSignIn.test.mjs test/productivityReviewAuth.test.mjs test/loginNavigation.test.mjs test/localLogoutCookies.test.mjs test/permissions.test.mjs
npx tsc --noEmit
npm test
npm run lint
```

Use the Next CLI directly for a build-only check. `npm run build` applies database migrations and is reserved for the authorized rollout with the intended database confirmed.

When launch is authorized, apply additive migration `20261008190000_procore_app_sessions`, regenerate Prisma, configure the environment above, and test an actual Procore login on an authorized test URL. Verify company membership lookup, limited-user page access, admin/accounting access, first-time authorization, a deep link, concurrent tabs across token renewal, logout, account switching, deactivated users, and embedded behavior in the browsers the team uses. These browser/provider checks cannot be established by unit tests and have not been performed against production.

Then integrate any newer `origin/main` and published production changes, repeat validation and the repository's published-commit ancestry check, merge/push through the normal Git-based Netlify release, and verify the published `commit_ref`. Rollback is disabling `PROCORE_SIGN_IN_ENABLED` and returning to the retained Auth0 path; leave the additive session table intact. Procore-only users will need the email fallback during that rollback.

References: [Procore embedded authentication](https://procore.github.io/documentation/procore-iframe-helper), [Procore authorization-code flow](https://procore.github.io/documentation/oauth-auth-grant-flow), [browser third-party cookie behavior](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies).

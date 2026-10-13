This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## QBO project profitability

The `/accounting/project-profitability` page reads normalized, read-only
QuickBooks Profit & Loss snapshots from PostgreSQL. QuickBooks and Procore
OAuth credentials remain in the separate `QBO_1` integration and are never
stored in this application or sent to the browser.

The preferred manual refresh command is run from the `QBO_1` workspace:

```powershell
.\scripts\qbo-npm.ps1 run refresh:analytics-profitability
```

To import an already-generated snapshot directly from this workspace, run:

```powershell
npm run qbo:profitability:import
```

The importer validates that the source is explicitly read-only, hashes the
source to prevent duplicate imports, and stores each refresh as an immutable
snapshot. Access to the page and API requires the
`accounting-project-profitability` permission.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Procore Iframe + Auth0 Notes

When this app is embedded inside Procore, the site must allow framing from Procore origins.

- Do not set `X-Frame-Options: DENY`.
- Use CSP `frame-ancestors` to allow Procore, for example: `https://*.procore.com`.
- Optional: add extra allowed parent origins with `FRAME_ANCESTORS` (comma-separated) in environment variables.

Auth0 must also be configured for the deployed URL and any local development origin:

- Allowed Callback URLs: include `https://<app-origin>/api/auth/callback` and, for local development, `http://localhost:3000/api/auth/callback`.
- Allowed Logout URLs and Allowed Web Origins: include the app origin (and `http://localhost:3000` when developing locally).
- Use a Regular Web Application with Token Endpoint Authentication Method set to **Post**; the Auth0 SDK exchanges the authorization code using `client_secret_post`.
- Set `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET` from that same Auth0 application. Never share or commit the secret.

After changing headers or Auth0 settings, redeploy and retest from the Procore app iframe.

## Permissions Configuration

User-to-role mappings are now loaded from environment variables instead of hardcoded source.

- `NEXT_PUBLIC_USER_PERMISSIONS_JSON` (required for client-side permission checks)
- `USER_PERMISSIONS_JSON` (optional server-side override)

JSON format:

```json
{
	"owner@example.com": ["OWNER", "employees", "onboarding"],
	"pm@example.com": ["PMs", "OPERATIONS"],
	"field@example.com": ["FIELD"]
}
```

Development login preset users are also environment-driven:

- `NEXT_PUBLIC_DEV_LOGIN_USERS_JSON`
- `NEXT_PUBLIC_MANAGER_SNAPSHOT_EMAILS` (comma-separated emails)
- `NEXT_PUBLIC_ABSENCE_NOTIFICATION_EMAILS` (comma-separated emails)

JSON format:

```json
[
	{ "email": "owner@example.com", "name": "Owner (Full Access)" },
	{ "email": "pm@example.com", "name": "Project Manager" }
]
```

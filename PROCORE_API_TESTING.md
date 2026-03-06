# Procore API Testing Guide

## Quick Start

### Test Page
Visit: **http://localhost:3000/procore/test**

This page provides a simple UI to test Procore API calls.

---

## Your Configuration

Based on your `.env.local`:

```
✓ Client ID: Configured
✓ Client Secret: Configured  
✓ Company ID: 598134325658789
✓ API URL: https://api.procore.com (Production)
✓ Auth URL: https://login.procore.com/oauth/authorize
```

---

## Available API Endpoints

### 1. Test Configuration & Connection
**GET /api/procore/test**

Returns your Procore configuration status and instructions.

```bash
curl http://localhost:3000/api/procore/test
```

**POST /api/procore/test**

Test your access token by calling the `/me` endpoint.

```bash
curl -X POST http://localhost:3000/api/procore/test \
  -H "Content-Type: application/json" \
  -d '{"accessToken": "YOUR_ACCESS_TOKEN"}'
```

### 2. Fetch Projects
**POST /api/procore/projects**

Fetch projects from your Procore account.

```bash
curl -X POST http://localhost:3000/api/procore/projects \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "YOUR_ACCESS_TOKEN",
    "page": 1,
    "perPage": 10
  }'
```

### 3. Fetch Vendors
**POST /api/procore/vendors**

Fetch vendors from your Procore company.

```bash
curl -X POST http://localhost:3000/api/procore/vendors \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "YOUR_ACCESS_TOKEN",
    "page": 1,
    "perPage": 10
  }'
```

---

## How to Get an Access Token

### Option 1: Manual Token (Quick Test)
1. Log into your Procore account
2. Go to **Settings** → **API Credentials**
3. Create or view an existing OAuth app
4. Generate an access token
5. Copy and use it in the test page

### Option 2: OAuth Flow (Production)
1. Visit: http://localhost:3000/procore
2. Click "Login with Procore"
3. Authenticate with your Procore account
4. The app will receive an access token automatically

---

## Testing with the UI

1. **Start your dev server:**
   ```bash
   npm run dev
   ```

2. **Open the test page:**
   ```
   http://localhost:3000/procore/test
   ```

3. **Paste your access token**

4. **Click test buttons:**
   - **Test Connection** - Verifies your token works
   - **Fetch Projects** - Gets your Procore projects
   - **Fetch Vendors** - Gets your company vendors

---

## What You Can Test

### User Info
```javascript
// The /me endpoint returns info about the authenticated user
{
  "id": 12345,
  "login": "user@company.com",
  "name": "John Doe",
  "is_employee": true
}
```

### Projects
```javascript
// Returns array of projects
[
  {
    "id": 123,
    "name": "Construction Project Alpha",
    "project_number": "2024-001",
    "address": "123 Main St",
    "city": "Lancaster",
    "state_code": "PA",
    "company": {
      "id": 456,
      "name": "Your Company"
    }
  }
]
```

### Vendors
```javascript
// Returns array of vendors/subcontractors
[
  {
    "id": 789,
    "name": "Acme Electrical",
    "trade": "Electrical",
    "is_active": true
  }
]
```

---

## Common API Endpoints to Explore

Once you have a working access token, you can test these endpoints:

### Projects
- `GET /rest/v1.0/projects` - List all projects
- `GET /rest/v1.0/projects/{id}` - Get specific project
- `GET /rest/v1.0/projects/{id}/budgets` - Get project budgets

### Companies
- `GET /rest/v1.0/companies/{company_id}` - Get company info
- `GET /rest/v1.0/companies/{company_id}/vendors` - List vendors

### Financials
- `GET /rest/v1.0/projects/{project_id}/prime_contracts` - Prime contracts
- `GET /rest/v1.0/projects/{project_id}/change_orders` - Change orders

### Productivity
- `GET /rest/v1.0/projects/{project_id}/daily_logs` - Daily logs
- `GET /rest/v1.0/projects/{project_id}/work_logs` - Work logs

---

## Troubleshooting

### Error: "MISSING_COMPANY_ID"
- Check that `PROCORE_COMPANY_ID` is set in your `.env.local`
- Restart your dev server after changing `.env.local`

### Error: "401 Unauthorized"
- Your access token may be expired
- Generate a new token from Procore
- Verify the token is copied correctly (no extra spaces)

### Error: "403 Forbidden"
- Your Procore user may not have permission to access that resource
- Check your Procore user role and permissions

### Error: "Connection failed"
- Verify your dev server is running
- Check that Procore's API is accessible from your network

---

## Next Steps

Once you verify the API connection works:

1. **Sync Projects** - Import Procore projects to your database
2. **Sync Productivity** - Import daily logs and work logs
3. **Automate** - Set up scheduled syncs
4. **Dashboard Integration** - Display Procore data in your analytics

---

## API Documentation

Full Procore API docs: https://developers.procore.com/reference/rest/v1/docs

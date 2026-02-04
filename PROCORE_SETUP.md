# Procore Integration Setup Guide

## What I've Created

A new **Procore Explorer Page** at `/procore` that lets you:
1. Authenticate with Procore via OAuth
2. Explore all available data from your sandbox account
3. See what endpoints and data are accessible

## Setup Steps

### 1. Add Environment Variables

Copy the credentials to your `.env.local` file:

```
# Procore Configuration
PROCORE_CLIENT_ID=3PIkg2XkefMYnOqZqMEFz54XXXu3lTmOer1PiM9eplA
PROCORE_CLIENT_SECRET=JCRLXagTQSluRIw5XFjlgQgOe4-mMPJPBEBYBFVvb9I
PROCORE_COMPANY_ID=4280877
PROCORE_API_URL=https://api.sandbox.procore.com
PROCORE_AUTH_URL=https://sandbox.procore.com/oauth/authorize
PROCORE_TOKEN_URL=https://api.sandbox.procore.com/oauth/token
NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/api/auth/procore/callback
```

### 2. Start the Development Server

```bash
npm run dev
```

### 3. Visit the Procore Page

Navigate to: **http://localhost:3000/procore**

### 4. Login and Explore

- Click "Login with Procore"
- Authenticate with your Procore sandbox account
- Click "Explore Available Data" to see what's available

## What You'll See

The page will display:
- **👤 User Info** - Your authenticated user details
- **🏢 Companies** - List of companies in your account
- **📋 Projects** - All projects (count + preview of first 10)
- **🏭 Vendors** - Vendor list
- **👥 Users** - Team members
- **📑 Project Templates** - Available project templates
- **📊 Raw JSON** - Full API response for technical review

## Files Created

1. **`src/lib/procore.ts`** - Core OAuth and API utilities
2. **`src/app/api/auth/procore/callback/route.ts`** - OAuth callback handler
3. **`src/app/api/procore/explore/route.ts`** - Data exploration endpoint
4. **`src/app/procore/page.tsx`** - Explorer UI page

## Next Steps

Once you explore and see what data is available, we can:

1. **Create more specific endpoints** to fetch particular data
2. **Build dashboard widgets** to display Procore data
3. **Integrate with your existing KPI dashboard**
4. **Sync Procore data with Firebase** if needed
5. **Create custom reports** based on Procore data

Let me know what data looks interesting to you, and I'll integrate it into the main dashboard!

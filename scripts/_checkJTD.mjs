import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env');
const envLines = readFileSync(envPath, 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

const CLIENT_ID = env.PROCORE_CLIENT_ID;
const CLIENT_SECRET = env.PROCORE_CLIENT_SECRET;
const COMPANY_ID = env.PROCORE_COMPANY_ID;
const API_URL = env.PROCORE_API_URL || 'https://api.procore.com';
const TOKEN_URL = env.PROCORE_TOKEN_URL || 'https://api.procore.com/oauth/token';
const PROJECT_ID = '598134326371113'; // Memory Care Meditation Building

// Get token
const tokenRes = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }).toString(),
});
const tokenData = await tokenRes.json();
const TOKEN = tokenData.access_token;
process.stdout.write('Got token OK\n\n');

async function procore(path) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Procore-Company-Id': COMPANY_ID, Accept: 'application/json' },
  });
  const text = await res.text();
  process.stdout.write(`GET ${path} → ${res.status}\n`);
  if (!res.ok) { process.stdout.write('  Error: ' + text.slice(0, 500) + '\n\n'); return null; }
  return JSON.parse(text);
}

// 1. List available budget views
const views = await procore(`/rest/v1.0/projects/${PROJECT_ID}/budget_views`);
if (views) {
  const viewList = Array.isArray(views) ? views : [];
  process.stdout.write('Budget views: ' + JSON.stringify(viewList.map(v => ({ id: v.id, name: v.name }))) + '\n\n');

  const firstViewId = viewList[0]?.id;
  if (firstViewId) {
    const detail = await procore(`/rest/v1.0/projects/${PROJECT_ID}/budget_views/${firstViewId}/detail?per_page=100`);
    if (detail) {
      const rows = Array.isArray(detail) ? detail : (detail?.rows ?? detail?.data ?? []);
      process.stdout.write('Budget view detail rows: ' + rows.length + '\n');
      const matching = rows.filter(r => {
        const code = r.cost_code?.code || r.wbs_code?.flat_code || r.cost_code_code || r.code || '';
        return code.includes('03-300-40-10') || code.includes('03-300');
      });
      if (matching.length > 0) {
        process.stdout.write('Matching 03-300 rows:\n' + JSON.stringify(matching, null, 2) + '\n');
      } else {
        process.stdout.write('No 03-300 match. First 2 rows (structure):\n' + JSON.stringify(rows.slice(0, 2), null, 2) + '\n');
      }
    }
  }
}

// 2. Also try the standard budget line items endpoint with more columns
process.stdout.write('\n--- Budget line items v1.1 API ---\n');
const bli = await procore(`/rest/v1.1/budget_line_items?project_id=${PROJECT_ID}&per_page=100`);
if (bli) {
  const items = Array.isArray(bli) ? bli : (bli?.budget_line_items ?? []);
  process.stdout.write('Budget line items total: ' + items.length + '\n');
  // Print all keys on first item
  if (items.length > 0) {
    process.stdout.write('Keys on first item: ' + JSON.stringify(Object.keys(items[0])) + '\n');
    // Find 03-300-40-10
    const match = items.find(r => {
      const code = r.cost_code?.code || r.wbs_code?.flat_code || '';
      return code.includes('03-300-40-10');
    });
    if (match) {
      process.stdout.write('03-300-40-10 item:\n' + JSON.stringify(match, null, 2) + '\n');
    } else {
      process.stdout.write('First item sample:\n' + JSON.stringify(items[0], null, 2) + '\n');
    }
  }
}

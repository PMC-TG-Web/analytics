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
  if (!res.ok) {
    process.stdout.write(`GET ${path} → ${res.status}: ${text.slice(0, 200)}\n`);
    return null;
  }
  return JSON.parse(text);
}

// Known commitment procore IDs from DB
const contractIds = [
  '598134327489706', '598134327489722', '598134327489718', '598134327489717',
  '598134327489776', '598134327489826', '598134327489713', '598134327541049',
];

// Fetch all commitment contracts for this project (v2.0)
process.stdout.write('--- Commitment contracts from Procore API (v2.0) ---\n');
const contracts = await procore(`/rest/v2.0/companies/${COMPANY_ID}/projects/${PROJECT_ID}/commitment_contracts?per_page=100`);
if (contracts) {
  const items = Array.isArray(contracts) ? contracts : [];
  process.stdout.write(`Total: ${items.length}\n`);
  for (const c of items) {
    process.stdout.write(`  ${c.number} | ${c.title} | value: ${c.value} | original_value: ${c.original_value} | status: ${c.status}\n`);
  }
}

// Check SOV line items on all contracts for cost code 03-300-40-10.O
process.stdout.write('\n--- SOV line items sweep for 03-300-40-10.O ---\n');
for (const contractId of contractIds) {
  const sov = await procore(`/rest/v1.0/projects/${PROJECT_ID}/commitment_contracts/${contractId}/commitment_contract_line_items?per_page=100`);
  if (!sov) continue;
  const lines = Array.isArray(sov) ? sov : [];
  const matching = lines.filter(l => {
    const code = l.cost_code?.code || l.wbs_code?.flat_code || '';
    return code.includes('03-300-40-10');
  });
  if (matching.length > 0) {
    process.stdout.write(`Contract ${contractId}: FOUND\n` + JSON.stringify(matching, null, 2) + '\n');
  } else if (lines.length > 0) {
    const codes = lines.slice(0, 3).map(l => l.cost_code?.code || l.wbs_code?.flat_code || '?').join(', ');
    process.stdout.write(`Contract ${contractId}: ${lines.length} lines, none match. Codes: ${codes}\n`);
  }
}

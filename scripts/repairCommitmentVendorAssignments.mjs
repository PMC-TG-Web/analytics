import "dotenv/config";

const API_URL = String(process.env.PROCORE_API_URL || "https://api.procore.com").replace(/\/$/, "");
const TOKEN_URL = String(process.env.PROCORE_TOKEN_URL || "https://api.procore.com/oauth/token");
const COMPANY_ID = String(process.env.REPAIR_COMMITMENT_COMPANY_ID || "").trim();
const PROJECT_ID = String(process.env.REPAIR_COMMITMENT_PROJECT_ID || "").trim();
const TARGET_VENDOR_ID = String(process.env.REPAIR_COMMITMENT_TARGET_VENDOR_ID || "").trim();
const TARGET_VENDOR_NAME = String(process.env.REPAIR_COMMITMENT_TARGET_VENDOR_NAME || "").trim();
const CONTRACT_IDS = String(process.env.REPAIR_COMMITMENT_CONTRACT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const APPLY = process.argv.includes("--apply");

if (!COMPANY_ID || !PROJECT_ID || !TARGET_VENDOR_ID || !TARGET_VENDOR_NAME || CONTRACT_IDS.length === 0) {
  throw new Error(
    "Set REPAIR_COMMITMENT_COMPANY_ID, REPAIR_COMMITMENT_PROJECT_ID, REPAIR_COMMITMENT_TARGET_VENDOR_ID, REPAIR_COMMITMENT_TARGET_VENDOR_NAME, and REPAIR_COMMITMENT_CONTRACT_IDS."
  );
}

const text = (value) => String(value ?? "").trim();
const normalizeName = (value) =>
  text(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(limited liability company|llc|incorporated|inc|corporation|corp|company|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let accessToken = "";

async function getToken() {
  if (accessToken) return accessToken;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.PROCORE_CLIENT_ID || "",
      client_secret: process.env.PROCORE_CLIENT_SECRET || "",
    }),
  });
  if (!response.ok) throw new Error(`Procore token request failed (${response.status}).`);
  accessToken = text((await response.json()).access_token);
  if (!accessToken) throw new Error("Procore token response did not include an access token.");
  return accessToken;
}

async function request(path, options = {}) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const response = await fetch(`${API_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Procore-Company-Id": COMPANY_ID,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const responseText = await response.text();
    let payload = responseText;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch {
      // Keep the text payload.
    }
    if (response.status === 401 && attempt < 8) {
      accessToken = "";
      continue;
    }
    if (response.status === 429 && attempt < 8) {
      const resetAt = Number(response.headers.get("x-rate-limit-reset") || 0);
      const retryAfter = Number(response.headers.get("retry-after") || 0);
      await sleep(Math.max(
        3_000,
        resetAt > 0 ? resetAt * 1_000 - Date.now() + 1_500 : 0,
        retryAfter > 0 ? retryAfter * 1_000 + 1_500 : 0,
      ));
      continue;
    }
    if (!response.ok) {
      throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
    }
    return payload;
  }
  throw new Error(`${options.method || "GET"} ${path} exhausted retries.`);
}

function array(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["data", "commitment_contracts", "vendors"]) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  return [];
}

async function fetchAll(pathForPage) {
  const records = [];
  for (let page = 1; page <= 50; page += 1) {
    const rows = array(await request(pathForPage(page)));
    records.push(...rows);
    if (rows.length < 100) break;
  }
  return records;
}

const vendors = await fetchAll(
  (page) => `/rest/v1.0/vendors?company_id=${encodeURIComponent(COMPANY_ID)}&page=${page}&per_page=100`
);
const targetVendor = vendors.find((vendor) => text(vendor.id) === TARGET_VENDOR_ID);
if (!targetVendor) throw new Error(`Target vendor ${TARGET_VENDOR_ID} was not found in company ${COMPANY_ID}.`);
if (normalizeName(targetVendor.name) !== normalizeName(TARGET_VENDOR_NAME)) {
  throw new Error(
    `Target vendor ${TARGET_VENDOR_ID} is "${text(targetVendor.name)}", not "${TARGET_VENDOR_NAME}".`
  );
}

const contractsPath =
  `/rest/v2.0/companies/${encodeURIComponent(COMPANY_ID)}/projects/${encodeURIComponent(PROJECT_ID)}/commitment_contracts`;
const contracts = await fetchAll((page) => `${contractsPath}?page=${page}&per_page=100`);
const contractById = new Map(contracts.map((contract) => [text(contract.id), contract]));
const planned = CONTRACT_IDS.map((contractId) => {
  const contract = contractById.get(contractId);
  if (!contract) throw new Error(`Commitment ${contractId} was not found in project ${PROJECT_ID}.`);
  return {
    id: contractId,
    number: text(contract.number),
    title: text(contract.title),
    currentVendorId: text(contract.vendor_id ?? contract.contract_company_id ?? contract.vendor?.id),
    currentVendorName: text(contract.vendor?.name ?? contract.contract_company?.name ?? contract.vendor_name),
    targetVendorId: TARGET_VENDOR_ID,
    targetVendorName: text(targetVendor.name),
    needsUpdate: text(contract.vendor_id ?? contract.contract_company_id ?? contract.vendor?.id) !== TARGET_VENDOR_ID,
  };
});

console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", companyId: COMPANY_ID, projectId: PROJECT_ID, planned }, null, 2));

if (!APPLY) process.exit(0);

for (const item of planned) {
  if (!item.needsUpdate) continue;
  await request(`${contractsPath}/${encodeURIComponent(item.id)}`, {
    method: "PATCH",
    body: { vendor_id: Number(TARGET_VENDOR_ID) },
  });
}

const verifiedContracts = await fetchAll((page) => `${contractsPath}?page=${page}&per_page=100`);
const verifiedById = new Map(verifiedContracts.map((contract) => [text(contract.id), contract]));
const verified = planned.map((item) => {
  const contract = verifiedById.get(item.id);
  const vendorId = text(contract?.vendor_id ?? contract?.contract_company_id ?? contract?.vendor?.id);
  return {
    id: item.id,
    number: text(contract?.number),
    vendorId,
    vendorName: text(contract?.vendor?.name ?? contract?.contract_company?.name ?? contract?.vendor_name),
    ok: vendorId === TARGET_VENDOR_ID,
  };
});

if (verified.some((item) => !item.ok)) {
  throw new Error(`Verification failed: ${JSON.stringify(verified)}`);
}

console.log(JSON.stringify({ success: true, verified }, null, 2));

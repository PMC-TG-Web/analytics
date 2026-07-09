import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

function loadEnv(file) {
  const env = {};
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function unwrapData(body) {
  if (body && typeof body === "object" && !Array.isArray(body) && body.data && typeof body.data === "object") {
    return body.data;
  }
  return body;
}

function pick(contract) {
  return {
    id: contract?.id,
    type: contract?.type,
    number: contract?.number,
    title: contract?.title,
    status: contract?.status,
    executed: contract?.executed,
    vendor_id: contract?.vendor_id,
    assignee_id: contract?.assignee_id,
    signature_required: contract?.signature_required,
    billing_schedule_of_values_status: contract?.billing_schedule_of_values_status,
    accounting_method: contract?.accounting_method,
    enable_ssov: contract?.enable_ssov,
    allow_change_orders_ssov: contract?.allow_change_orders_ssov,
    allow_payment_applications: contract?.allow_payment_applications,
    allow_payments: contract?.allow_payments,
    private: contract?.private,
    show_line_items_to_non_admins: contract?.show_line_items_to_non_admins,
    contract_date: contract?.contract_date,
    issued_on_date: contract?.issued_on_date,
    signed_contract_received_date: contract?.signed_contract_received_date,
    currency_iso_code: contract?.currency_iso_code,
    currency_exchange_rate: contract?.currency_exchange_rate,
    created_at: contract?.created_at,
    updated_at: contract?.updated_at,
  };
}

async function fetchContract({ companyId, projectId, token, contractId }) {
  const url = `https://api.procore.com/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/commitment_contracts/${encodeURIComponent(contractId)}?view=extended`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Procore-Company-Id": companyId,
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, ok: res.ok, url, body };
}

async function main() {
  const projectId = process.argv[2] || "598134326626273";
  const idA = process.argv[3] || "598134328354804";
  const idB = process.argv[4] || "598134328354823";

  const env = loadEnv(resolve(process.cwd(), ".env"));
  const clientId = env.PROCORE_CLIENT_ID;
  const clientSecret = env.PROCORE_CLIENT_SECRET;
  const companyId = env.PROCORE_COMPANY_ID;

  const tokenRes = await fetch("https://api.procore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok || !tokenBody.access_token) {
    throw new Error(`Token request failed (${tokenRes.status}): ${JSON.stringify(tokenBody)}`);
  }

  const token = tokenBody.access_token;
  const [a, b] = await Promise.all([
    fetchContract({ companyId, projectId, token, contractId: idA }),
    fetchContract({ companyId, projectId, token, contractId: idB }),
  ]);

  if (!a.ok || !b.ok) {
    const outErr = {
      projectId,
      companyId,
      idA,
      idB,
      fetchA: { status: a.status, ok: a.ok, url: a.url, body: a.body },
      fetchB: { status: b.status, ok: b.ok, url: b.url, body: b.body },
    };
    const errFile = resolve(process.cwd(), `tmp_contract_compare_${idA}_vs_${idB}.json`);
    writeFileSync(errFile, JSON.stringify(outErr, null, 2));
    console.log(`Fetch failed for one or both contracts. Details written to ${errFile}`);
    process.exit(1);
  }

  const contractA = unwrapData(a.body);
  const contractB = unwrapData(b.body);
  const pickedA = pick(contractA);
  const pickedB = pick(contractB);

  const keys = Array.from(new Set([...Object.keys(pickedA), ...Object.keys(pickedB)]));
  const differences = keys
    .map((field) => ({ field, a: pickedA[field], b: pickedB[field] }))
    .filter((d) => JSON.stringify(d.a) !== JSON.stringify(d.b));

  const out = {
    projectId,
    companyId,
    idA,
    idB,
    comparedFields: keys.length,
    differences,
    contractA: pickedA,
    contractB: pickedB,
    rawA: contractA,
    rawB: contractB,
  };

  const outFile = resolve(process.cwd(), `tmp_contract_compare_${idA}_vs_${idB}.json`);
  writeFileSync(outFile, JSON.stringify(out, null, 2));

  console.log(`Compared ${keys.length} fields; found ${differences.length} differences.`);
  for (const d of differences) {
    console.log(`- ${d.field}: A=${JSON.stringify(d.a)} | B=${JSON.stringify(d.b)}`);
  }
  console.log(`Report written to ${outFile}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

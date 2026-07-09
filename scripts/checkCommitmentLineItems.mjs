import { readFileSync } from "fs";
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

async function main() {
  const env = loadEnv(resolve(process.cwd(), ".env"));
  const companyId = env.PROCORE_COMPANY_ID;
  const projectId = process.argv[2] || "598134326626273";
  const ids = process.argv.slice(3);

  if (ids.length === 0) {
    throw new Error("Provide at least one contract id");
  }

  const tokenRes = await fetch("https://api.procore.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.PROCORE_CLIENT_ID,
      client_secret: env.PROCORE_CLIENT_SECRET,
    }).toString(),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok || !tokenBody.access_token) {
    throw new Error(`Token failed (${tokenRes.status}): ${JSON.stringify(tokenBody)}`);
  }

  for (const id of ids) {
    const url = `https://api.procore.com/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/commitment_contracts/${encodeURIComponent(id)}/line_items?page=1&per_page=100`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokenBody.access_token}`,
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

    const data = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
    console.log(`${id}: status=${res.status}, line_items=${data.length}`);
    if (data.length > 0) {
      const first = data[0];
      console.log(`  first.id=${first?.id}, desc=${JSON.stringify(first?.description || "")}, qty=${first?.quantity}, amount=${first?.amount}`);
    } else if (!res.ok) {
      console.log(`  error=${typeof body === "object" ? JSON.stringify(body) : String(body)}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

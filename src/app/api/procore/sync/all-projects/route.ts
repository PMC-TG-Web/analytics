import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CUSTOMER_CUSTOM_FIELD_ID = "598134331753944";

async function ensureProcoreStagingTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_project_staging (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      company_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      procore_project_id TEXT NULL,
      name TEXT NULL,
      status TEXT NULL,
      customer TEXT NULL,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(source, company_id, external_id)
    )
  `);
}

async function upsertProcoreStaging(params: {
  source: string;
  companyId: string;
  externalId: string;
  procoreProjectId?: string | null;
  name?: string | null;
  status?: string | null;
  customer?: string | null;
  payload: unknown;
}) {
  const {
    source,
    companyId,
    externalId,
    procoreProjectId,
    name,
    status,
    customer,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_project_staging
        (source, company_id, external_id, procore_project_id, name, status, customer, payload, synced_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
      ON CONFLICT (source, company_id, external_id)
      DO UPDATE SET
        procore_project_id = EXCLUDED.procore_project_id,
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        customer = EXCLUDED.customer,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `,
    source,
    companyId,
    externalId,
    procoreProjectId ?? null,
    name ?? null,
    status ?? null,
    customer ?? null,
    JSON.stringify(payload)
  );
}

function isMeaningfulCustomer(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && !["unknown", "n/a", "na", "none"].includes(trimmed.toLowerCase());
}

function extractCustomerFromCustomFields(customFields: any): string | null {
  if (!customFields || typeof customFields !== "object") return null;
  const entries = Array.isArray(customFields) ? customFields : Object.values(customFields);

  for (const field of entries as any[]) {
    if (!field || typeof field !== "object") continue;
    if (String(field.id || "") === CUSTOMER_CUSTOM_FIELD_ID && isMeaningfulCustomer(field.label)) {
      return field.label.trim();
    }
  }

  for (const field of entries as any[]) {
    if (!field || typeof field !== "object") continue;

    if (isMeaningfulCustomer(field.value) && [field.label, field.name].some((v) => String(v || "").toLowerCase() === "customer")) {
      return field.value.trim();
    }

    if (isMeaningfulCustomer(field.label_value)) {
      return field.label_value.trim();
    }

    if (isMeaningfulCustomer(field.label) && String(field.label).toLowerCase() !== "customer") {
      return field.label.trim();
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { fetchAll = true, companyId: bodyCompanyId } = body;

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("procore_access_token")?.value;
    const companyId = String(bodyCompanyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId).trim();

    if (!accessToken) {
      return NextResponse.json({ error: "Missing access token. Please login via OAuth." }, { status: 401 });
    }

    console.log(`Starting full Procore sync for company ${companyId}`);

    // 1. Fetch all V1 Projects (only first 2 pages for speed)
    const allV1Projects: any[] = [];
    let page = 1;
    while (true) {
      const endpoint = `/rest/v1.0/projects?company_id=${companyId}&page=${page}&per_page=100`;
      const data = await makeRequest(endpoint, accessToken);
      if (!Array.isArray(data) || data.length === 0) break;
      allV1Projects.push(...data);
      if (data.length < 100 || !fetchAll) break;
      page++;
      if (page > 3) break; // Reduced from 20
    }

    // 2. Fetch all V2 Bid Board Projects (only first 2 pages for speed)
    const allBidBoardProjects: any[] = [];
    page = 1;
    while (true) {
      const url = `https://api.procore.com/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?page=${page}&per_page=100`;
      const res = await fetch(url, {
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Procore-Company-Id': companyId 
        }
      });
      if (!res.ok) break;
      const json = await res.json();
      const items = Array.isArray(json) ? json : (json?.data || []);
      if (items.length === 0) break;
      allBidBoardProjects.push(...items);
      if (items.length < 100 || !fetchAll) break;
      page++;
      if (page > 3) break; // Reduced from 20
    }

    // 2.5 Fetch vendor map (used as fallback customer resolver)
    const vendorMap: Record<string, string> = {};
    try {
      let vendorPage = 1;
      while (true) {
        const endpoint = `/rest/v1.0/vendors?company_id=${companyId}&page=${vendorPage}&per_page=100`;
        const vendorData = await makeRequest(endpoint, accessToken);
        if (!Array.isArray(vendorData) || vendorData.length === 0) break;
        for (const vendor of vendorData) {
          if (vendor?.id && vendor?.name) vendorMap[String(vendor.id)] = String(vendor.name);
        }
        if (vendorData.length < 100) break;
        vendorPage++;
        if (vendorPage > 5) break;
      }
    } catch {
      console.warn("Vendor fallback map unavailable for this run.");
    }

    await ensureProcoreStagingTable();

    console.log(`Syncing ${allV1Projects.length} V1 Projects and ${allBidBoardProjects.length} Bid Board items.`);

    const results = {
      v1Synced: 0,
      bidBoardSynced: 0,
      stagingSynced: 0,
      errors: [] as string[]
    };

    // 3. Process V1 Projects (Upsert into 'Project' table)
    // We use customFields to store the Procore ID to avoid breaking existing logic
    // We DO NOT overwrite 'status' if the project is already mapped to a schedule, unless it's new
    for (const p of allV1Projects) {
      try {
        const procoreId = String(p.id);
        const name = p.name || p.display_name || "Untitled Procore Project";
        const number = p.project_number || "";
        
        // Resolve customer name: PRIORITIZE custom field label, fall back to standard fields
        let customer = "";
        const v1CustomFieldCustomer = extractCustomerFromCustomFields(p.custom_fields);
        if (isMeaningfulCustomer(v1CustomFieldCustomer)) {
          customer = v1CustomFieldCustomer;
          console.log(`Resolved project ${name} customer via custom field label: ${customer}`);
        } else {
          customer = p.customer_name || (p.company && p.company.name) || "";
        }

        // 2. Fallback to vendor map if still blank
        if (!isMeaningfulCustomer(customer) && p.company?.id && vendorMap[String(p.company.id)]) {
          customer = vendorMap[String(p.company.id)];
        }
        
        // Match by procoreProjectId, projectNumber, or projectName
        const existing = await prisma.project.findFirst({
          where: {
            OR: [
              { customFields: { path: ['procoreId'], equals: procoreId } },
              { projectNumber: number, projectName: name }
            ]
          }
        });

        const status = p.status || p.project_status?.name || p.project_stage?.name || "Active";

        await upsertProcoreStaging({
          source: "procore_v1_projects",
          companyId,
          externalId: procoreId,
          procoreProjectId: procoreId,
          name,
          status,
          customer: isMeaningfulCustomer(customer) ? customer : null,
          payload: p,
        });
        results.stagingSynced++;

        if (existing) {
          await prisma.project.update({
            where: { id: existing.id },
            data: {
              // procoreProjectId: procoreId,
              // procoreLastSync: new Date(),
              // Only fill if current values are empty or a default "Unknown" placeholder
              projectNumber: existing.projectNumber || number,
              customer: isMeaningfulCustomer(customer)
                ? customer
                : (existing.customer || customer || "UNKNOWN"),
              status: existing.status || status,
              customFields: {
                ...(typeof existing.customFields === 'object' ? (existing.customFields as any) : {}),
                procoreId: procoreId, // Storing in JSON instead of new column for now
                customerLabel: isMeaningfulCustomer(customer)
                  ? customer
                  : ((existing.customFields as any)?.customerLabel || null),
                syncedFrom: 'procore_v1',
                syncedAt: new Date().toISOString()
              }
            }
          });
        } else {
          await prisma.project.create({
            data: {
              projectName: name,
              projectNumber: number,
              customer: isMeaningfulCustomer(customer) ? customer : "UNKNOWN",
              status: status,
              // procoreProjectId: procoreId,
              customFields: { 
                procoreId: procoreId,
                customerLabel: isMeaningfulCustomer(customer) ? customer : null,
                source: 'procore_v1',
                syncedAt: new Date().toISOString()
              }
            }
          });
        }
        results.v1Synced++;
      } catch (e: any) {
        results.errors.push(`V1 ${p.name}: ${e.message}`);
      }
    }

    // 4. Process Bid Board Projects
    for (const bb of allBidBoardProjects) {
      try {
        const bidId = String(bb.id);
        const procoreProjectId = bb.project_id ? String(bb.project_id) : null;
        const name = bb.name || "Untitled Bid";
        
        // Resolve customer: PRIORITIZE custom field label over standard fields
        let customer = "";
        const bbCustomFieldCustomer = extractCustomerFromCustomFields(bb.custom_fields) 
          || extractCustomerFromCustomFields(bb.raw?.custom_fields);
        
        if (isMeaningfulCustomer(bbCustomFieldCustomer)) {
          customer = bbCustomFieldCustomer;
          console.log(`Resolved bid ${name} customer via custom field label: ${customer}`);
        } else {
          customer = bb.customer_name ||
                     bb.client?.name ||
                     bb.company?.name ||
                     (bb.raw && bb.raw.client && bb.raw.client.name) || 
                     (bb.raw && bb.raw.company && bb.raw.company.name) || 
                     (bb.raw && bb.raw.customer_name) || "";
        }
        
        // Fallback to vendor map if still blank
        if (!isMeaningfulCustomer(customer) && bb.client?.id && vendorMap[String(bb.client.id)]) {
          customer = vendorMap[String(bb.client.id)];
        }
        if (!isMeaningfulCustomer(customer) && bb.company?.id && vendorMap[String(bb.company.id)]) {
          customer = vendorMap[String(bb.company.id)];
        }
        if (!isMeaningfulCustomer(customer) && bb.raw?.client?.id && vendorMap[String(bb.raw.client.id)]) {
          customer = vendorMap[String(bb.raw.client.id)];
        }
        if (!isMeaningfulCustomer(customer) && bb.raw?.company?.id && vendorMap[String(bb.raw.company.id)]) {
          customer = vendorMap[String(bb.raw.company.id)];
        }

        // Match by customFields path instead of new columns
        const existing = await prisma.project.findFirst({
          where: {
            OR: [
              { customFields: { path: ['bidBoardId'], equals: bidId } },
              ...(procoreProjectId ? [{ customFields: { path: ['procoreId'], equals: procoreProjectId } }] : [])
            ]
          }
        });

        if (existing) {
          await prisma.project.update({
            where: { id: existing.id },
            data: {
              customer: isMeaningfulCustomer(customer) ? customer : (existing.customer || "UNKNOWN"),
              customFields: {
                ...(typeof existing.customFields === 'object' ? (existing.customFields as any) : {}),
                bidBoardId: bidId,
                procoreId: procoreProjectId || (existing.customFields as any)?.procoreId,
                customerLabel: isMeaningfulCustomer(customer)
                  ? customer
                  : ((existing.customFields as any)?.customerLabel || null),
                syncedAt: new Date().toISOString()
              }
            }
          });
        } else {
          await prisma.project.create({
            data: {
              projectName: name,
              customer: isMeaningfulCustomer(customer) ? customer : "UNKNOWN",
              status: bb.status || "Bidding",
              customFields: {
                bidBoardId: bidId,
                procoreId: procoreProjectId,
                customerLabel: isMeaningfulCustomer(customer) ? customer : null,
                source: 'procore_bid_board',
                syncedAt: new Date().toISOString()
              }
            }
          });
        }
        results.bidBoardSynced++;

        await upsertProcoreStaging({
          source: "procore_v2_bid_board",
          companyId,
          externalId: bidId,
          procoreProjectId,
          name,
          status: bb.status || "Bidding",
          customer: isMeaningfulCustomer(customer) ? customer : null,
          payload: bb,
        });
        results.stagingSynced++;
      } catch (e: any) {
        results.errors.push(`Bid ${bb.name}: ${e.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      summary: results
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

#!/usr/bin/env node

/**
 * Convert a Productivity Log-style CSV into JSON payloads for:
 * - Create Purchase Order Contract
 *
 * Usage:
 *   node scripts/convertCsvToPurchaseOrderContracts.mjs <csv-file> <project-id> [output-file]
 *
 * Example:
 *   node scripts/convertCsvToPurchaseOrderContracts.mjs "c:\\Users\\ToddGilmore\\Downloads\\Productivity_Log (7).csv" 598134326626273 purchase_order_contract_requests.json
 */

import fs from "fs";
import path from "path";

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < headers.length; c += 1) {
      row[headers[c]] = values[c] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

function parseMoney(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const cleaned = raw.replace(/[$,]/g, "").trim();
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

function parseNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const cleaned = raw.replace(/,/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
}

function parseDateToIso(mmddyy) {
  const raw = String(mmddyy ?? "").trim();
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return undefined;

  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const iso = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
  return iso;
}

function parseContractLabel(contractLabel) {
  const raw = String(contractLabel ?? "").trim();
  const m = raw.match(/^([A-Za-z]+-\d+)\s*-\s*(.+)$/);
  if (!m) {
    return {
      number: raw || "UNSPECIFIED",
      title: raw || "Imported Purchase Order Contract",
    };
  }

  return {
    number: m[1].trim(),
    title: m[2].trim(),
  };
}

function normalizeLineItemDescription(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function main() {
  const [, , csvFileArg, projectIdArg, outputFileArg] = process.argv;

  if (!csvFileArg || !projectIdArg) {
    console.error("Usage: node scripts/convertCsvToPurchaseOrderContracts.mjs <csv-file> <project-id> [output-file]");
    process.exit(1);
  }

  const csvFile = path.resolve(csvFileArg);
  if (!fs.existsSync(csvFile)) {
    console.error(`File not found: ${csvFile}`);
    process.exit(1);
  }

  const outputFile = outputFileArg
    ? path.resolve(outputFileArg)
    : path.resolve(process.cwd(), "purchase_order_contract_requests.json");

  const csvContent = fs.readFileSync(csvFile, "utf8");
  const { rows } = parseCsv(csvContent);

  if (rows.length === 0) {
    console.error("No rows found in CSV.");
    process.exit(1);
  }

  const groups = new Map();

  for (const row of rows) {
    const contractLabel = String(row["contract"] ?? "").trim();
    if (!contractLabel) continue;

    const vendor = String(row["vendor"] ?? "").trim();
    const dateIso = parseDateToIso(row["date"]);
    const lineItem = normalizeLineItemDescription(row["line item"]);
    const qtyBudgeted = parseNumber(row["quantity budgeted"]);
    const unitCost = parseMoney(row["unit cost"]);
    const totalCost = parseMoney(row["total cost"]);

    if (!groups.has(contractLabel)) {
      groups.set(contractLabel, {
        contractLabel,
        vendors: new Set(),
        dates: [],
        lineItems: new Map(),
      });
    }

    const g = groups.get(contractLabel);
    if (vendor) g.vendors.add(vendor);
    if (dateIso) g.dates.push(dateIso);

    if (lineItem) {
      const lineItemKey = lineItem.toLowerCase();
      if (!g.lineItems.has(lineItemKey)) {
        const amount = totalCost ?? (qtyBudgeted !== undefined && unitCost !== undefined ? qtyBudgeted * unitCost : undefined);
        g.lineItems.set(lineItemKey, {
          description: lineItem,
          quantity: qtyBudgeted,
          unit_cost: unitCost,
          amount,
          uom: "EA",
          // These are required by Procore line-item create but not derivable from this CSV.
          cost_code_id: null,
          line_item_type_id: null,
          budget_line_item_id: null,
        });
      }
    }
  }

  const requests = [];
  const contractLineItemTemplates = [];

  for (const [, g] of groups) {
    const { number, title } = parseContractLabel(g.contractLabel);
    const sortedDates = [...g.dates].sort();
    const contractDate = sortedDates[0];

    const vendorNames = [...g.vendors];
    const lineItems = [...g.lineItems.values()];
    const estimatedTotal = lineItems.reduce((sum, li) => sum + (li.amount ?? 0), 0);

    requests.push({
      project_id: String(projectIdArg),
      purchase_order_contract: {
        accounting_method: "amount",
        contract_date: contractDate,
        delivery_date: contractDate,
        issued_on_date: contractDate,
        number,
        title,
        description: `Imported from CSV (${path.basename(csvFile)}).`,
        status: "Draft",
        private: false,
        payment_terms: "Net 30",
      },
      source_context: {
        contract_label: g.contractLabel,
        vendor_names: vendorNames,
        estimated_contract_total: Number(estimatedTotal.toFixed(2)),
        line_item_count: lineItems.length,
      },
      // vendor_id is intentionally omitted because this CSV has vendor name, not Procore vendor_id.
      // Assign vendor_id later if needed before submit.
    });

    contractLineItemTemplates.push({
      contract_number: number,
      contract_title: title,
      line_items: lineItems,
    });
  }

  const output = {
    generated_at: new Date().toISOString(),
    source_csv: csvFile,
    project_id: String(projectIdArg),
    total_contracts: requests.length,
    create_purchase_order_contract_requests: requests,
    purchase_order_contract_line_item_templates: contractLineItemTemplates,
    notes: [
      "Create contracts first using create_purchase_order_contract_requests.",
      "Then create line items per contract using purchase_order_contract_line_item_templates.",
      "Map vendor_names to a valid Procore vendor_id if submitting non-Draft status.",
      "Line item IDs (cost_code_id, line_item_type_id, budget_line_item_id) must be provided before line-item create.",
    ],
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");

  console.log(`Parsed ${rows.length} CSV rows.`);
  console.log(`Generated ${requests.length} contract create request(s).`);
  console.log(`Output written to: ${outputFile}`);
}

main();

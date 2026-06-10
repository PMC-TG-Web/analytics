import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

type CsvRecord = Record<string, string>;

type CrosswalkEntry = {
  newUniqueKey: string;
  newCostCode: string;
  newItemId: string;
};

const COST_CODE_CANDIDATES = ["Cost Code", "cost_code", "cost code", "CostCode", "costCode"];
const ITEM_ID_CANDIDATES = ["ItemId", "Item ID", "item_id", "item id", "Line Item Type ID", "line_item_type_id"];

function normalize(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function buildKey(costCode: unknown, itemId: unknown): string {
  return `${normalize(costCode)}|${normalize(itemId)}`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function toRecords(rows: string[][]): CsvRecord[] {
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => normalize(h));
  const dataRows = rows.slice(1);

  return dataRows.map((row) => {
    const record: CsvRecord = {};
    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i];
      if (!header) continue;
      record[header] = row[i] ?? "";
    }
    return record;
  });
}

function toCsv(headers: string[], rows: CsvRecord[]): string {
  const escapeCell = (value: unknown) => {
    const text = normalize(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines: string[] = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function chooseColumn(headers: string[], candidates: string[], explicit: string | undefined, label: string): string {
  if (explicit?.trim()) {
    const wanted = explicit.trim();
    if (!headers.includes(wanted)) {
      throw new Error(`Column '${wanted}' not found for ${label}. Available columns: ${headers.join(", ")}`);
    }
    return wanted;
  }

  const lowered = new Map(headers.map((h) => [h.toLowerCase(), h]));
  for (const candidate of candidates) {
    if (headers.includes(candidate)) return candidate;
    const hit = lowered.get(candidate.toLowerCase());
    if (hit) return hit;
  }

  throw new Error(`Unable to auto-detect ${label} column. Available columns: ${headers.join(", ")}`);
}

async function loadDefaultCrosswalkCsv(): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), "catalog_lookup_crosswalk.csv"),
    path.join(process.cwd(), "public", "catalog_lookup_crosswalk.csv"),
  ];

  for (const filePath of candidates) {
    try {
      const content = await readFile(filePath, "utf8");
      if (content.trim()) return content;
    } catch {
      // try next
    }
  }

  return null;
}

function buildCrosswalkMap(crosswalkRecords: CsvRecord[]): Map<string, CrosswalkEntry> {
  const map = new Map<string, CrosswalkEntry>();

  for (const row of crosswalkRecords) {
    const oldKey = normalize(row.OldUniqueKey);
    if (!oldKey || map.has(oldKey)) continue;

    map.set(oldKey, {
      newUniqueKey: normalize(row.NewUniqueKey),
      newCostCode: normalize(row.NewCostCode),
      newItemId: normalize(row.NewItemId),
    });
  }

  return map;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      estimateCsv?: string;
      crosswalkCsv?: string;
      costCodeColumn?: string;
      itemIdColumn?: string;
    };

    const estimateCsv = normalize(body.estimateCsv);
    if (!estimateCsv) {
      return NextResponse.json({ error: "Missing estimateCsv" }, { status: 400 });
    }

    const crosswalkCsv = normalize(body.crosswalkCsv) || (await loadDefaultCrosswalkCsv()) || "";
    if (!crosswalkCsv) {
      return NextResponse.json(
        { error: "Missing crosswalk CSV. Upload one or add catalog_lookup_crosswalk.csv to project root/public." },
        { status: 400 }
      );
    }

    const estimateRows = parseCsv(estimateCsv);
    const crosswalkRows = parseCsv(crosswalkCsv);
    const estimateRecords = toRecords(estimateRows);
    const crosswalkRecords = toRecords(crosswalkRows);

    if (!estimateRows.length || !estimateRows[0]?.length) {
      return NextResponse.json({ error: "Estimate CSV is empty or missing headers." }, { status: 400 });
    }

    const headers = estimateRows[0].map((h) => normalize(h)).filter(Boolean);
    const costCodeColumn = chooseColumn(headers, COST_CODE_CANDIDATES, body.costCodeColumn, "cost-code");
    const itemIdColumn = chooseColumn(headers, ITEM_ID_CANDIDATES, body.itemIdColumn, "item-id");

    const crosswalkMap = buildCrosswalkMap(crosswalkRecords);

    const outputHeaders = [...headers, "OldUniqueKey", "NewUniqueKey", "ConversionStatus"];
    const convertedRows: CsvRecord[] = [];
    const unmatchedRows: CsvRecord[] = [];

    let matched = 0;
    let unmatched = 0;

    for (const source of estimateRecords) {
      const row: CsvRecord = { ...source };
      const oldKey = buildKey(row[costCodeColumn], row[itemIdColumn]);
      const match = crosswalkMap.get(oldKey);

      row.OldUniqueKey = oldKey;

      if (match) {
        if (match.newCostCode) {
          row[costCodeColumn] = match.newCostCode;
        }
        if (match.newItemId) {
          row[itemIdColumn] = match.newItemId;
        }
        row.NewUniqueKey = match.newUniqueKey;
        row.ConversionStatus = "MATCHED";
        matched += 1;
      } else {
        row.NewUniqueKey = "";
        row.ConversionStatus = "UNMATCHED";
        unmatched += 1;
        unmatchedRows.push({ ...row });
      }

      convertedRows.push(row);
    }

    return NextResponse.json({
      success: true,
      detectedColumns: {
        costCodeColumn,
        itemIdColumn,
      },
      rowsTotal: convertedRows.length,
      rowsMatched: matched,
      rowsUnmatched: unmatched,
      convertedCsv: toCsv(outputHeaders, convertedRows),
      unmatchedCsv: toCsv(outputHeaders, unmatchedRows),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to convert estimate", details: message }, { status: 500 });
  }
}

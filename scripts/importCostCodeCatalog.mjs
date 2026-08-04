import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "csv-parse/sync";

const sourcePath = path.resolve(process.argv[2] || "");
if (!process.argv[2]) throw new Error("Usage: node scripts/importCostCodeCatalog.mjs <Book3.csv>");

const rows = parse(await readFile(sourcePath, "utf8"), {
  columns: true,
  skip_empty_lines: true,
  trim: true,
  bom: true,
});

const catalog = {};
for (const [index, row] of rows.entries()) {
  const itemId = String(row.ItemId || "").trim();
  const itemName = String(row.Name || "").trim();
  const costCode = String(row["Cost Code"] || "").trim().toUpperCase();
  const costName = String(row["Cost Name"] || "").trim();
  const description = String(row.Description || "").trim();
  const reportingGroup = String(
    row["Coulmn to use for Grouping"] || row["Column to use for Grouping"] || "",
  ).trim();
  const topLevelGroup = String(row["Toplevel grouping"] || "").trim();

  if (!itemId || !costCode || !reportingGroup || !topLevelGroup) {
    throw new Error(`Book3 row ${index + 2} is missing ItemId, Cost Code, reporting group, or top-level group.`);
  }
  if (catalog[itemId]) throw new Error(`Duplicate ItemId ${itemId} in Book3.`);

  catalog[itemId] = { itemName, costCode, costName, description, reportingGroup, topLevelGroup };
}

const outputPath = path.resolve("config/costCodeCatalog.json");
await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Wrote ${Object.keys(catalog).length} cost-code catalog entries to ${outputPath}.`);
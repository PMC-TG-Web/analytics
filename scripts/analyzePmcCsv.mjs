import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the CSV from downloads
const csvPath = "C:\\Users\\ToddGilmore\\Downloads\\PMCGrouping.csv";
const text = readFileSync(csvPath, "utf8").replace(/\r/g, "");
const lines = text.split("\n").filter(Boolean);

console.log(`Total lines (incl header): ${lines.length}`);
console.log(`Data rows: ${lines.length - 1}`);

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
const ciIdx = headers.findIndex(h => h === "costitem");
const ctIdx = headers.findIndex(h => h === "costtype");
const pgIdx = headers.findIndex(h => h === "pmcgroup");

const rows = lines.slice(1).map(line => {
  const cols = parseCSVLine(line);
  return {
    costItem: (cols[ciIdx] || "").trim(),
    costType: (cols[ctIdx] || "").trim(),
    pmcGroup: (cols[pgIdx] || "").trim(),
  };
}).filter(r => r.costItem && r.pmcGroup);

console.log(`Valid rows after filtering: ${rows.length}`);

// Count unique by costItem+costTypeNorm+pmcGroup (same as new constraint)
const seen = new Set();
const dupes = [];
for (const r of rows) {
  const key = `${r.costItem}|${r.costType.toLowerCase()}|${r.pmcGroup}`;
  if (seen.has(key)) {
    dupes.push(r);
  } else {
    seen.add(key);
  }
}

console.log(`Unique (costItem+costTypeNorm+pmcGroup): ${seen.size}`);
console.log(`Duplicates dropped: ${dupes.length}`);
if (dupes.length > 0) {
  console.log("Sample dupes:", JSON.stringify(dupes.slice(0, 5), null, 2));
}

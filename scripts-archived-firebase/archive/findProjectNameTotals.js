const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const csvPath = path.join(__dirname, "../src/Bid_Distro-Preconstruction (2).csv");
const csv = fs.readFileSync(csvPath, "utf-8");
const records = parse(csv, { columns: true, skip_empty_lines: true });

const target = (process.argv[2] || "Broadcasting District Site").toLowerCase();
const groups = new Map();
let exactCount = 0;
let exactSales = 0;

for (const r of records) {
  const nameRaw = (r.projectName || "").toString();
  const name = nameRaw.trim();
  const norm = name.toLowerCase();
  const sales = parseFloat(String(r.sales || "").replace(/[$,\s]/g, "")) || 0;

  if (norm === target) {
    exactCount += 1;
    exactSales += sales;
  }

  if (norm.includes(target)) {
    const current = groups.get(nameRaw) || { count: 0, sales: 0 };
    current.count += 1;
    current.sales += sales;
    groups.set(nameRaw, current);
  }
}

console.log("Exact match count:", exactCount);
console.log(
  "Exact match total sales: $" +
    exactSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
);

console.log("\nProjectName variants containing target:");
for (const [name, stat] of groups.entries()) {
  console.log(
    `- "${name}" | count: ${stat.count} | sales: $${stat.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  );
}

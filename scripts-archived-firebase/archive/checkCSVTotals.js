const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

async function checkCSVTotals() {
  try {
    const csvPath = path.join(__dirname, "../src/Bid_Distro-Preconstruction (2).csv");
    const csvContent = fs.readFileSync(csvPath, "utf-8");
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });

    let totalSales = 0;
    let totalCost = 0;
    let totalHours = 0;
    let recordCount = 0;

    records.forEach((record) => {
      // Parse sales - remove $ and commas, then convert to number
      const sales = parseFloat((record.sales || "").replace(/[$,\s]/g, "")) || 0;
      const cost = parseFloat((record.cost || "").replace(/[$,\s]/g, "")) || 0;
      const hours = parseFloat(record.hours) || 0;

      totalSales += sales;
      totalCost += cost;
      totalHours += hours;
      recordCount++;
    });

    console.log("\n========================================");
    console.log("CSV File: Bid_Distro-Preconstruction (2).csv");
    console.log("========================================");
    console.log(`Total Records: ${recordCount}`);
    console.log(`Total Sales: $${totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`Total Cost: $${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`Total Margin: $${(totalSales - totalCost).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`Total Hours: ${totalHours.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log("========================================\n");

    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

checkCSVTotals();

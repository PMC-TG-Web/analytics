const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, query, where } = require("firebase/firestore");
const fs = require("fs");
const path = require("path");

let firebaseConfig;
try {
  const configPath = path.join(__dirname, "../src/firebaseConfig.json");
  firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (e) {
  console.error("Error reading Firebase config:", e.message);
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkProjectByName() {
  const projectName = process.argv[2] || "Broadcasting District Site";
  
  try {
    const q = query(collection(db, "projects"), where("projectName", "==", projectName));
    const snapshot = await getDocs(q);

    let totalSales = 0;
    let totalCost = 0;
    let totalHours = 0;
    const projects = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      totalSales += data.sales || 0;
      totalCost += data.cost || 0;
      totalHours += data.hours || 0;
      projects.push({
        projectNumber: data.projectNumber,
        customer: data.customer,
        sales: data.sales || 0,
        cost: data.cost || 0,
        status: data.status,
      });
    });

    console.log("\n========================================");
    console.log(`Project Name: ${projectName}`);
    console.log("========================================");
    console.log(`Total Line Items: ${projects.length}`);
    console.log(`Total Sales: $${totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`Total Cost: $${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`Total Margin: $${(totalSales - totalCost).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`Total Hours: ${totalHours.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log("========================================\n");

    if (projects.length > 0) {
      console.log("Details:");
      projects.forEach((p, idx) => {
        console.log(
          `  [${idx + 1}] Project #${p.projectNumber} | Customer: ${p.customer} | Sales: $${p.sales.toLocaleString()} | Cost: $${p.cost.toLocaleString()} | Status: ${p.status}`
        );
      });
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

checkProjectByName();

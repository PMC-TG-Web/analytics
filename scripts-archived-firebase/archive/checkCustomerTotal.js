const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, query, where } = require("firebase/firestore");
const fs = require("fs");
const path = require("path");

// Read Firebase config
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

async function checkCustomerTotal() {
  const customerName = process.argv[2] || "Broadcasting District Site";
  
  try {
    const q = query(collection(db, "projects"), where("customer", "==", customerName));
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
        projectName: data.projectName,
        sales: data.sales || 0,
        cost: data.cost || 0,
        status: data.status,
      });
    });

    console.log("\n========================================");
    console.log(`Customer: ${customerName}`);
    console.log("========================================");
    console.log(`Total Projects: ${projects.length}`);
    console.log(`Total Sales: $${totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`Total Cost: $${totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`Total Margin: $${(totalSales - totalCost).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log(`Total Hours: ${totalHours.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    console.log("========================================\n");

    if (projects.length > 0) {
      console.log("Projects:");
      projects.forEach((p) => {
        console.log(
          `  [${p.projectNumber}] ${p.projectName} - Sales: $${p.sales.toLocaleString()} - Status: ${p.status}`
        );
      });
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

checkCustomerTotal();

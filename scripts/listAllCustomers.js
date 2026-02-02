const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs } = require("firebase/firestore");
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

async function getAllCustomers() {
  try {
    const snapshot = await getDocs(collection(db, "projects"));
    const customers = new Map();

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const customer = data.customer || "Unknown";
      
      if (!customers.has(customer)) {
        customers.set(customer, { sales: 0, cost: 0, count: 0 });
      }
      const current = customers.get(customer);
      current.sales += data.sales || 0;
      current.cost += data.cost || 0;
      current.count += 1;
    });

    console.log(`\nAll Customers (${customers.size} total):\n`);
    
    const sorted = Array.from(customers.entries())
      .sort((a, b) => b[1].sales - a[1].sales);
    
    sorted.forEach(([customer, stats]) => {
      console.log(`${customer}`);
      console.log(`  Projects: ${stats.count} | Sales: $${stats.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })} | Cost: $${stats.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    });

    console.log("\n");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

getAllCustomers();

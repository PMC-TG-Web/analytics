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

async function searchCustomers() {
  const searchTerm = process.argv[2]?.toLowerCase() || "broadcast";
  
  try {
    const snapshot = await getDocs(collection(db, "projects"));
    const customers = new Map();

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const customer = data.customer || "Unknown";
      
      if (customer.toLowerCase().includes(searchTerm)) {
        if (!customers.has(customer)) {
          customers.set(customer, { sales: 0, count: 0 });
        }
        const current = customers.get(customer);
        current.sales += data.sales || 0;
        current.count += 1;
      }
    });

    if (customers.size === 0) {
      console.log(`\nNo customers found matching "${searchTerm}"\n`);
    } else {
      console.log(`\nCustomers matching "${searchTerm}":\n`);
      customers.forEach((stats, customer) => {
        console.log(`  ${customer}`);
        console.log(`    - Projects: ${stats.count}`);
        console.log(`    - Total Sales: $${stats.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

searchCustomers();

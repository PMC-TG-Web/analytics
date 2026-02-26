import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, getDoc } from "firebase/firestore";
import { readFileSync } from "fs";

const firebaseConfig = JSON.parse(readFileSync('src/firebaseConfig.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkData() {
  try {
    console.log("Checking Firebase connection and data...\n");
    
    // Check projects collection
    const projectsSnapshot = await getDocs(collection(db, "projects"));
    console.log(`✓ Projects collection: ${projectsSnapshot.size} documents`);
    
    // Check dashboard summary
    const summaryDoc = await getDoc(doc(db, "metadata", "dashboard_summary"));
    if (summaryDoc.exists()) {
      const data = summaryDoc.data();
      console.log(`✓ Dashboard summary exists`);
      console.log(`  Last updated: ${data.lastUpdated}`);
      console.log(`  Total sales: $${data.totalSales?.toLocaleString() || 0}`);
      console.log(`  Total projects in summary: ${Object.values(data.statusGroups || {}).reduce((sum, g) => sum + (g.count || 0), 0)}`);
    } else {
      console.log(`✗ Dashboard summary does NOT exist`);
      console.log(`  Run: node scripts/bootstrapSummary.mjs`);
    }
    
    // Check schedules
    const shortTermSnapshot = await getDocs(collection(db, "short term schedual"));
    console.log(`✓ Short term schedule: ${shortTermSnapshot.size} documents`);
    
    const longTermSnapshot = await getDocs(collection(db, "long term schedual"));
    console.log(`✓ Long term schedule: ${longTermSnapshot.size} documents`);
    
    // Check other collections
    const employeesSnapshot = await getDocs(collection(db, "employees"));
    console.log(`✓ Employees: ${employeesSnapshot.size} documents`);
    
    console.log("\n✓ Firebase connection successful!");
    
  } catch (error) {
    console.error("Error:", error);
  }
  
  process.exit(0);
}

checkData();

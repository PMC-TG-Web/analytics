import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBMMd3rm_SN0_s5vDhuULsQ9ywIF_NZBQk",
  authDomain: "pmcdatabasefirebase-sch.firebaseapp.com",
  projectId: "pmcdatabasefirebase-sch",
  storageBucket: "pmcdatabasefirebase-sch.firebasestorage.app",
  messagingSenderId: "426435888632",
  appId: "1:426435888632:web:4f2b5896c9d817a904820d",
  measurementId: "G-Y059ZR0VCK"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function bootstrap() {
  try {
    console.log("Starting full aggregation of all projects...");
    const snapshot = await getDocs(collection(db, "projects"));
    console.log(`Analyzing ${snapshot.size} projects...`);

    const summary = {
      totalSales: 0,
      totalCost: 0,
      totalHours: 0,
      statusGroups: {},
      contractors: {},
      pmcGroupHours: {},
      laborBreakdown: {},
      lastUpdated: new Date().toISOString()
    };

    snapshot.docs.forEach(projectDoc => {
      const data = projectDoc.data();
      
      const projectName = (data.projectName || "").toString().toLowerCase();
      const customer = (data.customer || "").toString().trim();
      const customerLower = customer.toLowerCase();
      const estimator = (data.estimator || "").toString().trim().toLowerCase();
      const projectNumber = (data.projectNumber || "").toString().toLowerCase();

      const isExcluded = 
        data.projectArchived === true ||
        customerLower.includes("sop inc") ||
        ["pmc operations", "pmc shop time", "pmc test project"].includes(projectName) ||
        projectName.includes("sandbox") ||
        projectName.includes("raymond king") ||
        projectName === "alexander drive addition latest" ||
        estimator === "todd gilmore" ||
        projectNumber === "701 poplar church rd";

      if (isExcluded) return;

      const sales = Number(data.sales) || 0;
      const cost = Number(data.cost) || 0;
      const hours = Number(data.hours) || 0;
      const status = data.status || "Unknown";

      summary.totalSales += sales;
      summary.totalCost += cost;
      summary.totalHours += hours;

      if (!summary.statusGroups[status]) {
        summary.statusGroups[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
      }
      summary.statusGroups[status].sales += sales;
      summary.statusGroups[status].cost += cost;
      summary.statusGroups[status].hours += hours;
      summary.statusGroups[status].count += 1;

      if (!summary.contractors[customer]) {
        summary.contractors[customer] = { sales: 0, cost: 0, hours: 0, count: 0, byStatus: {} };
      }
      const c = summary.contractors[customer];
      c.sales += sales;
      c.cost += cost;
      c.hours += hours;
      c.count += 1;
      
      if (!c.byStatus[status]) {
        c.byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
      }
      c.byStatus[status].sales += sales;
      c.byStatus[status].cost += cost;
      c.byStatus[status].hours += hours;
      c.byStatus[status].count += 1;

      const pmcGroup = (data.pmcGroup || "").toString().trim();
      if (pmcGroup) {
        const norm = pmcGroup.toLowerCase();
        if (status === "Bid Submitted" || norm.startsWith("pm")) {
          summary.pmcGroupHours[pmcGroup] = (summary.pmcGroupHours[pmcGroup] || 0) + hours;
        }
        if (status === "Bid Submitted") {
          summary.laborBreakdown[pmcGroup] = (summary.laborBreakdown[pmcGroup] || 0) + hours;
        }
      }
    });

    console.log("Aggregation complete. Saving to Firestore...");
    await setDoc(doc(db, "metadata", "dashboard_summary"), summary);
    console.log("Successfully created dashboard_summary document.");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

bootstrap();

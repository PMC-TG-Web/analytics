import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, serverTimestamp } from "firebase/firestore";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
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
      lastUpdated: serverTimestamp()
    };

    snapshot.docs.forEach(projectDoc => {
      const data = projectDoc.data();
      if (data.projectArchived === true || data.status === "Invitations") return;

      const sales = Number(data.sales) || 0;
      const cost = Number(data.cost) || 0;
      const hours = Number(data.hours) || 0;
      const status = data.status || "Unknown";
      const customer = data.customer || "Unknown";
      const pmcGroup = (data.pmcGroup || "").toString().trim();

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
      summary.contractors[customer].sales += sales;
      summary.contractors[customer].cost += cost;
      summary.contractors[customer].hours += hours;
      summary.contractors[customer].count += 1;
      
      if (!summary.contractors[customer].byStatus[status]) {
        summary.contractors[customer].byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
      }
      summary.contractors[customer].byStatus[status].sales += sales;
      summary.contractors[customer].byStatus[status].cost += cost;
      summary.contractors[customer].byStatus[status].hours += hours;
      summary.contractors[customer].byStatus[status].count += 1;

      if (pmcGroup) {
        const norm = pmcGroup.toLowerCase();
        if (status === "Bid Submitted" || norm.startsWith("pm")) {
          summary.pmcGroupHours[pmcGroup] = (summary.pmcGroupHours[pmcGroup] || 0) + hours;
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

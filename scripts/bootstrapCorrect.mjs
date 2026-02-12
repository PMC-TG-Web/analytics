import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBMMd3rm_SN0_s5vDhuULsQ9ywIF_NZBQk",
  authDomain: "pmcdatabasefirebase-sch.firebaseapp.com",
  projectId: "pmcdatabasefirebase-sch",
  appId: "1:426435888632:web:4f2b5896c9d817a904820d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") return new Date(value);
  if (value && typeof value === 'object' && value.toDate && typeof value.toDate === "function") return value.toDate();
  return null;
};

async function bootstrap() {
  try {
    console.log("Starting CORRECT aggregation... (This will take ~60 seconds)");
    const snapshot = await getDocs(collection(db, "projects"));
    const allProjects = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`Loaded ${allProjects.length} documents.`);

    // 1. FILTERING (Mirroring Dashboard)
    const filtered = allProjects.filter(p => {
      if (p.projectArchived) return false;
      const status = (p.status ?? "").toString();
      if (status === "Invitations") return false;
      
      const customer = (p.customer ?? "").toString().toLowerCase();
      if (customer.includes("sop inc")) return false;
      const projectName = (p.projectName ?? "").toString().toLowerCase();
      if (["pmc operations", "pmc shop time", "pmc test project"].includes(projectName)) return false;
      if (projectName.includes("sandbox") || projectName.includes("raymond king") || projectName === "alexander drive addition latest") return false;
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      return true;
    });
    console.log(`Filtered down to ${filtered.length} active documents.`);

    // 2. DEDUPE BY CUSTOMER (Mirroring Dashboard logic)
    const identifierMap = new Map();
    filtered.forEach(p => {
      const id = (p.projectNumber ?? p.projectName ?? "").toString().trim();
      if (!id) return;
      if (!identifierMap.has(id)) identifierMap.set(id, []);
      identifierMap.get(id).push(p);
    });

    const dedupedByCustomer = [];
    identifierMap.forEach(list => {
      const customerMap = new Map();
      list.forEach(p => {
        const c = (p.customer ?? "").toString().trim();
        if (!customerMap.has(c)) customerMap.set(c, []);
        customerMap.get(c).push(p);
      });

      if (customerMap.size > 1) {
        const priorityStatuses = ["Accepted", "In Progress", "Complete"];
        let selected = null;
        for (const [c, projs] of customerMap) {
          if (projs.some(p => priorityStatuses.includes(p.status || ""))) {
            selected = projs;
            break;
          }
        }
        if (!selected) {
          let latest = null;
          customerMap.forEach((projs, c) => {
            const m = projs.reduce((a, b) => {
              const dateA = parseDateValue(a.dateCreated) || new Date(0);
              const dateB = parseDateValue(b.dateCreated) || new Date(0);
              return dateA > dateB ? a : b;
            }, projs[0]);
            const projDate = parseDateValue(m.dateCreated) || new Date(0);
            if (!latest || projDate > latest.d) {
               latest = { d: projDate, projs };
            }
          });
          selected = latest?.projs;
        }
        if (selected) dedupedByCustomer.push(...selected);
      } else {
        list.forEach(p => dedupedByCustomer.push(p));
      }
    });
    console.log(`Deduped to ${dedupedByCustomer.length} relevant documents.`);

    // 3. AGGREGATE BY PROJECT KEY (NUMBER + CUSTOMER)
    const keyMap = new Map();
    dedupedByCustomer.forEach(p => {
      const num = (p.projectNumber ?? "").toString().trim();
      const cust = (p.customer ?? "").toString().trim();
      const key = `${num}|${cust}`;
      if (!keyMap.has(key)) keyMap.set(key, []);
      keyMap.get(key).push(p);
    });

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

    keyMap.forEach((projs, key) => {
      // Find the first project alphabetically by name as tiebreaker (like the dashboard does)
      const sorted = projs.sort((a,b) => (a.projectName||"").localeCompare(b.projectName||""));
      const base = { ...sorted[0] };
      
      const sales = projs.reduce((s, p) => s + (Number(p.sales) || 0), 0);
      const cost = projs.reduce((s, p) => s + (Number(p.cost) || 0), 0);
      const hours = projs.reduce((s, p) => s + (Number(p.hours) || 0), 0);
      
      const status = base.status || "Unknown";
      const customer = base.customer || "Unknown";

      summary.totalSales += sales;
      summary.totalCost += cost;
      summary.totalHours += hours;

      if (!summary.statusGroups[status]) summary.statusGroups[status] = { sales: 0, cost: 0, hours: 0, count: 0, laborByGroup: {} };
      summary.statusGroups[status].sales += sales;
      summary.statusGroups[status].cost += cost;
      summary.statusGroups[status].hours += hours;
      summary.statusGroups[status].count += 1;

      // Track group hours for this status
      projs.forEach(p => {
        const group = (p.pmcGroup || "Unassigned").toString().trim();
        const hrs = Number(p.hours) || 0;
        if (hrs > 0) {
          summary.statusGroups[status].laborByGroup[group] = (summary.statusGroups[status].laborByGroup[group] || 0) + hrs;
        }
      });

      if (!summary.contractors[customer]) summary.contractors[customer] = { sales: 0, cost: 0, hours: 0, count: 0, byStatus: {} };
      const c = summary.contractors[customer];
      c.sales += sales;
      c.cost += cost;
      c.hours += hours;
      c.count += 1;
      if (!c.byStatus[status]) c.byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
      c.byStatus[status].sales += sales;
      c.byStatus[status].cost += cost;
      c.byStatus[status].hours += hours;
      c.byStatus[status].count += 1;
    });

    // 4. LABOR Breakdown (Using dedupedByCustomer line items)
    dedupedByCustomer.forEach(p => {
       const status = p.status || "Unknown";
       const hours = Number(p.hours) || 0;
       const pmcGroup = (p.pmcGroup || "").toString().trim();
       if (!pmcGroup) return;

       const norm = pmcGroup.toLowerCase();
       if (status === "Bid Submitted" || norm.startsWith("pm")) {
         summary.pmcGroupHours[pmcGroup] = (summary.pmcGroupHours[pmcGroup] || 0) + hours;
       }
       if (status === "Bid Submitted") {
         summary.laborBreakdown[pmcGroup] = (summary.laborBreakdown[pmcGroup] || 0) + hours;
       }
    });

    console.log(`Final Summary Calculated: ${Object.keys(summary.contractors).length} Contractors found.`);
    await setDoc(doc(db, "metadata", "dashboard_summary"), summary);
    console.log("SUCCESS: Dashboard summary updated.");
    process.exit(0);
  } catch (err) {
    console.error("Aggregation Failed:", err);
    process.exit(1);
  }
}
bootstrap();

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

const getProjectDate = (p) => {
  const updated = parseDateValue(p.dateUpdated);
  const created = parseDateValue(p.dateCreated);
  if (updated && created) return updated > created ? updated : created;
  return updated || created || null;
};

const getProjectKey = (project) => {
  const customer = (project.customer ?? "").toString().trim();
  const number = (project.projectNumber ?? "").toString().trim();
  const name = (project.projectName ?? "").toString().trim();
  if (!customer && !number && !name) return `__noKey__${project.id}`;
  return `${customer}~${number}~${name}`;
};

const isExcludedFromDashboard = (project) => {
  if (project.projectArchived) return true;
  
  const status = (project.status || "").toString().toLowerCase().trim();
  if (status === "invitations" || status === "to do" || status === "todo" || status === "to-do") return true;

  const customer = (project.customer ?? "").toString().toLowerCase();
  if (customer.includes("sop inc")) return true;

  const projectName = (project.projectName ?? "").toString().toLowerCase();
  const excludedNames = [
    "pmc operations",
    "pmc shop time",
    "pmc test project"
  ];
  if (excludedNames.includes(projectName)) return true;
  if (projectName.includes("sandbox")) return true;
  if (projectName.includes("raymond king")) return true;

  const projectNumber = (project.projectNumber ?? "").toString().toLowerCase();
  if (projectNumber === "701 poplar church rd") return true;

  return false;
};

async function updateSummary() {
  try {
    console.log("Starting full re-aggregation for Dashboard Summary...");
    const snapshot = await getDocs(collection(db, "projects"));
    const allDocs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`Loaded ${allDocs.length} documents.`);

    // 1. Filter out excluded projects
    const filtered = allDocs.filter(p => !isExcludedFromDashboard(p));
    console.log(`Filtered to ${filtered.length} relevant documents.`);

    // 2. Group by identifier (Competitive Bidding Dedupe)
    const identifierMap = new Map();
    filtered.forEach(p => {
      const id = (p.projectNumber || p.projectName || "").toString().trim();
      if (!id) return;
      if (!identifierMap.has(id)) identifierMap.set(id, []);
      identifierMap.get(id).push(p);
    });

    const dedupedByCustomer = [];
    identifierMap.forEach(list => {
      const customerMap = new Map();
      list.forEach(p => {
        const c = (p.customer || "Unknown").toString().trim();
        if (!customerMap.has(c)) customerMap.set(c, []);
        customerMap.get(c).push(p);
      });

      if (customerMap.size > 1) {
        const priorityStatuses = ["Accepted", "In Progress", "Complete"];
        let selectedList = null;
        for (const [c, projs] of customerMap) {
          if (projs.some(p => priorityStatuses.includes(p.status))) {
            selectedList = projs;
            break;
          }
        }
        if (!selectedList) {
          let latestDate = null;
          customerMap.forEach((projs) => {
            const m = projs.reduce((l, c) => {
               const ld = parseDateValue(l.dateCreated) || new Date(0);
               const cd = parseDateValue(c.dateCreated) || new Date(0);
               return cd > ld ? c : l;
            }, projs[0]);
            const d = parseDateValue(m.dateCreated) || new Date(0);
            if (!latestDate || d > latestDate) {
              latestDate = d;
              selectedList = projs;
            }
          });
        }
        if (selectedList) dedupedByCustomer.push(...selectedList);
      } else {
        list.forEach(p => dedupedByCustomer.push(p));
      }
    });

    // 3. Aggregate by jobKey (Line item aggregation)
    const keyMap = new Map();
    dedupedByCustomer.forEach(p => {
      const key = getProjectKey(p);
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

    keyMap.forEach((projs) => {
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

      if (!summary.statusGroups[status]) {
        summary.statusGroups[status] = { sales: 0, cost: 0, hours: 0, count: 0, laborByGroup: {} };
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
      if (!c.byStatus[status]) c.byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
      c.byStatus[status].sales += sales;
      c.byStatus[status].cost += cost;
      c.byStatus[status].hours += hours;
      c.byStatus[status].count += 1;

      // Group hours aggregation
      projs.forEach(p => {
        const pmcGroup = (p.pmcGroup || "").toString().trim();
        if (pmcGroup) {
          const norm = pmcGroup.toLowerCase();
          const hrs = Number(p.hours) || 0;
          if (status === "Bid Submitted" || norm.startsWith("pm")) {
            summary.pmcGroupHours[pmcGroup] = (summary.pmcGroupHours[pmcGroup] || 0) + hrs;
          }
          if (status === "Bid Submitted") {
            summary.laborBreakdown[pmcGroup] = (summary.laborBreakdown[pmcGroup] || 0) + hrs;
          }
          // Also for statusGroups chart
          summary.statusGroups[status].laborByGroup[pmcGroup] = (summary.statusGroups[status].laborByGroup[pmcGroup] || 0) + hrs;
        }
      });
    });

    console.log(`Saving clean summary to Firestore...`);
    await setDoc(doc(db, "metadata", "dashboard_summary"), summary);
    console.log(`Final Totals: $${Math.round(summary.totalSales).toLocaleString()} sales for ${Object.keys(summary.contractors).length} customers.`);
    process.exit(0);
  } catch (err) {
    console.error("Aggregation Failed:", err);
    process.exit(1);
  }
}

updateSummary();

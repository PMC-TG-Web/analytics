const admin = require('firebase-admin');

// Initialize with just the Project ID. 
// This relies on the environment being authenticated (e.g. via firebase login)
admin.initializeApp({
  projectId: 'pmcdatabasefirebase-sch'
});

const db = admin.firestore();

async function bootstrap() {
  try {
    console.log("MARKER: STARTING_ADMIN_BOOTSTRAP_PROJECT_ID: pmcdatabasefirebase-sch");
    console.log("Starting full aggregation using Admin SDK...");
    
    // We fetch in chunks if possible, but for 22k docs, a single get() might work in Node
    const snapshot = await db.collection("projects").get();
    console.log(`Analyzing ${snapshot.docs.length} projects...`);

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
    await db.collection("metadata").doc("dashboard_summary").set(summary);
    console.log("Successfully created dashboard_summary document.");
    process.exit(0);
  } catch (err) {
    console.error("BOOTSTRAP ERROR:", err);
    process.exit(1);
  }
}

bootstrap();

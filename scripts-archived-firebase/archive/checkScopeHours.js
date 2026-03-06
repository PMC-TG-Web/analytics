const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function checkScopeHours() {
  console.log("Checking scope hours data...\n");

  // Load all projects (cost items)
  const projectsSnapshot = await getDocs(collection(db, "projects"));
  console.log(`Loaded ${projectsSnapshot.docs.length} cost items from projects collection`);

  // Build map of cost items by jobKey (excluding PM/management)
  const projectCostItems = {};
  projectsSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const customer = data.customer || "";
    const projectNumber = data.projectNumber || "";
    const projectName = data.projectName || "";
    const itemJobKey = `${customer}~${projectNumber}~${projectName}`;
    const costType = (data.costType || "").toLowerCase();

    // Skip PM and management hours
    if (costType.includes("pm") || costType.includes("management")) {
      return;
    }

    if (!projectCostItems[itemJobKey]) {
      projectCostItems[itemJobKey] = [];
    }

    projectCostItems[itemJobKey].push({
      id: doc.id,
      costitems: (data.costitems || "").toLowerCase(),
      sales: typeof data.sales === "number" ? data.sales : 0,
      cost: typeof data.cost === "number" ? data.cost : 0,
      hours: typeof data.hours === "number" ? data.hours : 0,
      costType: data.costType || "",
    });
  });

  console.log(`Cost items grouped by ${Object.keys(projectCostItems).length} unique jobKeys\n`);

  // Load scopes
  const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
  console.log(`Loaded ${scopesSnapshot.docs.length} scopes\n`);

  let scopesWithHours = 0;
  let totalHoursAggregated = 0;

  scopesSnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const jobKey = data.jobKey;
    if (!jobKey) return;

    const title = typeof data.title === "string" && data.title.trim() ? data.title : "Scope";

    // Try to match scope title to cost items and aggregate hours
    let totalHours = 0;
    let matchedItems = [];

    const costItems = projectCostItems[jobKey] || [];
    const titleLower = title.toLowerCase();

    // Match cost items
    costItems.forEach((item) => {
      // Remove quantity prefix from scope title
      const titleWithoutQty = titleLower
        .replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*[-–]\s*/i, "")
        .trim();
      if (item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems)) {
        totalHours += item.hours;
        matchedItems.push({
          costItem: item.costitems,
          hours: item.hours,
        });
      }
    });

    if (totalHours > 0) {
      scopesWithHours++;
      totalHoursAggregated += totalHours;
      console.log(`\nScope: ${title}`);
      console.log(`JobKey: ${jobKey}`);
      console.log(`Total Hours: ${totalHours.toFixed(1)}`);
      console.log(`Matched ${matchedItems.length} cost items:`);
      matchedItems.forEach((item) => {
        console.log(`  - ${item.costItem}: ${item.hours} hours`);
      });
    }
  });

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total scopes: ${scopesSnapshot.docs.length}`);
  console.log(`Scopes with hours: ${scopesWithHours}`);
  console.log(`Total hours aggregated: ${totalHoursAggregated.toFixed(1)}`);

  process.exit(0);
}

checkScopeHours().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

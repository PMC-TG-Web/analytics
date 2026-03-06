const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function analyzeMatching() {
  console.log("Analyzing matching issues...\n");

  // Focus on Giant #6582 which we know has cost items
  const targetJobKey = "Ames Construction, Inc.~2508 - GI~Giant #6582";

  // Load cost items for this project
  const projectsSnapshot = await getDocs(collection(db, "projects"));
  const costItems = [];
  
  projectsSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    const customer = data.customer || "";
    const projectNumber = data.projectNumber || "";
    const projectName = data.projectName || "";
    const itemJobKey = `${customer}~${projectNumber}~${projectName}`;
    
    if (itemJobKey === targetJobKey) {
      const costType = (data.costType || "").toLowerCase();
      // Skip PM and management hours
      if (!costType.includes("pm") && !costType.includes("management")) {
        costItems.push({
          costitems: (data.costitems || "").toLowerCase(),
          hours: typeof data.hours === "number" ? data.hours : 0,
          costType: data.costType || "",
        });
      }
    }
  });

  console.log(`Found ${costItems.length} cost items for ${targetJobKey}\n`);
  console.log("Sample cost items:");
  costItems.slice(0, 10).forEach(item => {
    console.log(`  - "${item.costitems}" (${item.hours} hrs)`);
  });

  // Load scopes for this project
  const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
  const scopes = [];
  
  scopesSnapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (data.jobKey === targetJobKey) {
      scopes.push({
        title: data.title || "Scope",
      });
    }
  });

  console.log(`\n\nFound ${scopes.length} scopes for this project\n`);
  console.log("Scope titles:");
  scopes.forEach(scope => {
    const titleLower = scope.title.toLowerCase();
    const titleWithoutQty = titleLower.replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*[-–]\s*/i, '').trim();
    
    // Check if it matches any cost items
    const matches = costItems.filter(item => 
      item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems)
    );
    
    console.log(`  "${scope.title}"`);
    console.log(`    Cleaned: "${titleWithoutQty}"`);
    if (matches.length > 0) {
      console.log(`    ✓ MATCHED ${matches.length} cost items:`);
      matches.forEach(m => console.log(`      - "${m.costitems}"`));
    } else {
      console.log(`    ✗ NO MATCH`);
    }
    console.log();
  });

  process.exit(0);
}

analyzeMatching().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function matchScopes() {
  try {
    console.log("Analyzing scope to cost item matching...\n");

    // Load a sample project with scopes
    const jobKey = "Ames Construction, Inc.~2508 - GI~Giant #6582";
    
    // Get scopes for this project
    const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
    const scopes = [];
    scopesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.jobKey === jobKey) {
        scopes.push({
          id: doc.id,
          title: data.title
        });
      }
    });
    
    console.log(`Found ${scopes.length} scopes for Giant #6582:`);
    scopes.forEach(s => console.log(`  - ${s.title}`));
    
    // Get cost items for this project
    const projectsSnapshot = await getDocs(collection(db, "projects"));
    const costItems = [];
    projectsSnapshot.forEach(doc => {
      const data = doc.data();
      // Construct jobKey from customer~projectNumber~projectName
      const itemJobKey = `${data.customer || ''}~${data.projectNumber || ''}~${data.projectName || ''}`;
      
      if (itemJobKey === jobKey) {
        costItems.push({
          id: doc.id,
          costitems: data.costitems || '',
          costType: data.costType || '',
          sales: data.sales || 0,
          cost: data.cost || 0,
          hours: data.hours || 0,
          quantity: data.quantity || 0
        });
      }
    });
    
    console.log(`\nFound ${costItems.length} cost line items for this project`);
    
    // Try to match scopes to cost items
    console.log("\n=== MATCHING ANALYSIS ===\n");
    
    scopes.forEach(scope => {
      console.log(`\nScope: "${scope.title}"`);
      
      // Try exact match
      const exactMatch = costItems.find(item => 
        item.costitems.toLowerCase() === scope.title.toLowerCase()
      );
      
      if (exactMatch) {
        console.log(`  ✅ EXACT MATCH: "${exactMatch.costitems}"`);
        console.log(`     Sales: $${exactMatch.sales}, Cost: $${exactMatch.cost}, Hours: ${exactMatch.hours}`);
      } else {
        // Try partial match
        const partialMatches = costItems.filter(item => 
          item.costitems.toLowerCase().includes(scope.title.toLowerCase()) ||
          scope.title.toLowerCase().includes(item.costitems.toLowerCase())
        );
        
        if (partialMatches.length > 0) {
          console.log(`  ⚠️  PARTIAL MATCHES (${partialMatches.length}):`);
          partialMatches.slice(0, 3).forEach(match => {
            console.log(`     - "${match.costitems}"`);
            console.log(`       Sales: $${match.sales}, Cost: $${match.cost}, Hours: ${match.hours}`);
          });
        } else {
          console.log(`  ❌ NO MATCH FOUND`);
          console.log(`     Sample cost items from project:`);
          costItems.slice(0, 3).forEach(item => {
            console.log(`     - "${item.costitems}"`);
          });
        }
      }
    });
    
    // Show summary
    console.log("\n\n=== SUMMARY ===");
    console.log(`Total scopes: ${scopes.length}`);
    console.log(`Total cost items: ${costItems.length}`);
    console.log("\nRecommendation: Scopes should store references to cost item IDs for accurate matching.");

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

matchScopes();

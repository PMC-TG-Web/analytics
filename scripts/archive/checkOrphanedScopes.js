const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function checkOrphanedScopes() {
  try {
    console.log("Checking for scopes without matching projects in schedules...\n");

    // Load all jobKeys from schedule collections
    const shortTermSnapshot = await getDocs(collection(db, "short term schedual"));
    const longTermSnapshot = await getDocs(collection(db, "long term schedual"));
    
    const scheduledJobKeys = new Set();
    
    shortTermSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.jobKey && doc.id !== "_placeholder") {
        scheduledJobKeys.add(data.jobKey);
      }
    });
    
    longTermSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.jobKey && doc.id !== "_placeholder") {
        scheduledJobKeys.add(data.jobKey);
      }
    });

    console.log(`Found ${scheduledJobKeys.size} unique jobKeys in schedule collections\n`);

    // Load all scopes and check their jobKeys
    const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
    
    const scopesByJobKey = {};
    const orphanedScopes = [];
    
    scopesSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const jobKey = data.jobKey;
      
      if (!jobKey) {
        orphanedScopes.push({
          id: doc.id,
          title: data.title || "Untitled",
          jobKey: null,
          reason: "No jobKey"
        });
        return;
      }
      
      if (!scopesByJobKey[jobKey]) {
        scopesByJobKey[jobKey] = [];
      }
      scopesByJobKey[jobKey].push({
        id: doc.id,
        title: data.title || "Untitled"
      });
      
      if (!scheduledJobKeys.has(jobKey)) {
        orphanedScopes.push({
          id: doc.id,
          title: data.title || "Untitled",
          jobKey: jobKey,
          reason: "JobKey not in any schedule"
        });
      }
    });

    console.log(`Total scopes in database: ${scopesSnapshot.docs.length}`);
    console.log(`Scopes with valid jobKeys matching schedules: ${scopesSnapshot.docs.length - orphanedScopes.length}`);
    console.log(`Orphaned scopes (no matching project): ${orphanedScopes.length}\n`);

    if (orphanedScopes.length > 0) {
      console.log("ORPHANED SCOPES:");
      console.log("================");
      orphanedScopes.forEach((scope) => {
        console.log(`\nScope ID: ${scope.id}`);
        console.log(`  Title: ${scope.title}`);
        console.log(`  JobKey: ${scope.jobKey || "(none)"}`);
        console.log(`  Issue: ${scope.reason}`);
      });
    } else {
      console.log("✅ All scopes have matching projects in schedule collections!");
    }

    // Show sample of jobKeys with scopes
    console.log("\n\nSample of projects WITH scopes:");
    console.log("================================");
    let count = 0;
    for (const [jobKey, scopes] of Object.entries(scopesByJobKey)) {
      if (count >= 5) break;
      if (scheduledJobKeys.has(jobKey)) {
        console.log(`\nJobKey: ${jobKey}`);
        console.log(`  Scopes: ${scopes.length}`);
        scopes.slice(0, 3).forEach(scope => {
          console.log(`    - ${scope.title}`);
        });
        count++;
      }
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

checkOrphanedScopes();

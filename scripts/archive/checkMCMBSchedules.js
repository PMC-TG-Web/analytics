const admin = require("firebase-admin");

const serviceAccount = require("../analytics-6dd5b-firebase-adminsdk-wz1h9-b14f894f23.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function check() {
  console.log("\n=== Checking Memory Care Meditation Building (MCMB) Schedules ===\n");

  const jobKey = "CCS Building Group~2511~Memory Care Meditation Building";
  console.log(`Looking for jobKey: ${jobKey}\n`);

  // Check long term schedual
  console.log("--- Long Term Schedule ---");
  const longTermSnap = await db.collection("long term schedual").get();
  const longTermMatches = longTermSnap.docs.filter(doc => {
    const data = doc.data();
    return (
      data.customer?.includes("CCS") || 
      data.projectNumber?.includes("2511") || 
      data.jobKey?.includes("MCMB")
    );
  });
  
  console.log(`Total docs in "long term schedual": ${longTermSnap.size}`);
  console.log(`Matches for MCMB: ${longTermMatches.length}`);
  longTermMatches.forEach(doc => {
    console.log(JSON.stringify(doc.data(), null, 2));
  });

  // Check short term schedual
  console.log("\n--- Short Term Schedule ---");
  const shortTermSnap = await db.collection("short term schedual").get();
  const shortTermMatches = shortTermSnap.docs.filter(doc => {
    const data = doc.data();
    return (
      data.customer?.includes("CCS") || 
      data.projectNumber?.includes("2511") || 
      data.jobKey?.includes("MCMB")
    );
  });
  
  console.log(`Total docs in "short term schedual": ${shortTermSnap.size}`);
  console.log(`Matches for MCMB: ${shortTermMatches.length}`);
  shortTermMatches.forEach(doc => {
    console.log(JSON.stringify(doc.data(), null, 2));
  });

  // Check projectScopes
  console.log("\n--- Project Scopes ---");
  const scopesSnap = await db.collection("projectScopes").get();
  const scopeMatches = scopesSnap.docs.filter(doc => {
    const data = doc.data();
    return data.jobKey?.includes("MCMB") || data.jobKey?.includes("2511");
  });
  
  console.log(`Total docs in "projectScopes": ${scopesSnap.size}`);
  console.log(`Matches for MCMB: ${scopeMatches.length}`);
  scopeMatches.forEach(doc => {
    console.log(JSON.stringify(doc.data(), null, 2));
  });

  // Check projects collection for MCMB
  console.log("\n--- Projects Collection ---");
  const projectsSnap = await db.collection("projects").get();
  const projectMatches = projectsSnap.docs.filter(doc => {
    const data = doc.data();
    return (
      data.customer?.includes("CCS") || 
      data.projectNumber?.includes("2511") || 
      data.projectName?.includes("Memory Care")
    );
  });
  
  console.log(`Matches for MCMB: ${projectMatches.length}`);
  projectMatches.slice(0, 3).forEach(doc => {
    const d = doc.data();
    console.log(`  ${d.projectNumber} - ${d.projectName}: Status=${d.status}, Hours=${d.hours}`);
  });

  process.exit(0);
}

check().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

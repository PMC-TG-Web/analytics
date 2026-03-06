const admin = require("firebase-admin");
const fs = require("fs");

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "pmcdatabasefirebase-sch"
  });
}
const db = admin.firestore();

async function run() {
  const snapshot = await db.collection("projects").get();
  console.log("Total Projects:", snapshot.size);
  
  let oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  let recent = 0;
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const ts = data.dateUpdated;
    if (ts) {
      let d;
      if (ts.toDate) d = ts.toDate();
      else d = new Date(ts);
      if (d > oneYearAgo) recent++;
    }
  });
  
  console.log("Projects updated in last 12 months:", recent);
  process.exit(0);
}
run();

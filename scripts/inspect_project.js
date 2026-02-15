const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, limit, query } = require("firebase/firestore");
const fs = require("fs");
const path = require("path");

let firebaseConfig;
try {
  const configPath = path.join(__dirname, "../src/firebaseConfig.json");
  firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (e) {
  console.error("Error reading Firebase config:", e.message);
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectData() {
  const q = query(collection(db, "projects"), limit(1));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    console.log(JSON.stringify(snapshot.docs[0].data(), null, 2));
  } else {
    console.log("No documents found in projects collection.");
  }
  process.exit(0);
}

inspectData();

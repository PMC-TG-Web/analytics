const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, limit, query } = require("firebase/firestore");
const fs = require("fs");
const path = require("path");

let firebaseConfig;
try {
  const configPath = path.join(__dirname, "../src/firebaseConfig.json");
  firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (e) {
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkFields() {
  const snapshot = await getDocs(query(collection(db, "projects"), limit(100)));
  const allFields = new Set();
  snapshot.docs.forEach(doc => {
    Object.keys(doc.data()).forEach(k => allFields.add(k));
  });
  console.log(Array.from(allFields).sort());
  process.exit(0);
}

checkFields();

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, limit, query } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function checkProjectsStructure() {
  try {
    console.log("Checking projects collection structure...\n");

    const q = query(collection(db, "projects"), limit(5));
    const snapshot = await getDocs(q);
    
    console.log(`Total documents in collection: ${snapshot.size}`);
    console.log("\nSample documents:\n");
    
    snapshot.forEach((doc, index) => {
      const data = doc.data();
      console.log(`\n=== Document ${index + 1} ===`);
      console.log(`ID: ${doc.id}`);
      console.log("Fields:");
      Object.keys(data).sort().forEach(key => {
        const value = data[key];
        const valueStr = typeof value === 'object' && value !== null 
          ? JSON.stringify(value).substring(0, 50) 
          : String(value).substring(0, 50);
        console.log(`  ${key}: ${valueStr}`);
      });
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

checkProjectsStructure();

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig).filter(([, value]) => !value).map(([key]) => key);
if (missingConfigKeys.length > 0) {
  const configPath = path.join(__dirname, '../src/firebaseConfig.json');
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  firebaseConfig.apiKey = fileConfig.apiKey;
  firebaseConfig.authDomain = fileConfig.authDomain;
  firebaseConfig.projectId = fileConfig.projectId;
  firebaseConfig.storageBucket = fileConfig.storageBucket;
  firebaseConfig.messagingSenderId = fileConfig.messagingSenderId;
  firebaseConfig.appId = fileConfig.appId;
}

initializeApp(firebaseConfig);
const db = getFirestore();

async function checkForemanFilter() {
  try {
    const snapshot = await getDocs(collection(db, "employees"));
    
    console.log("=== Foreman Filter Test (from dispatch page) ===");
    console.log("Filter: isActive && (jobTitle === 'Foreman' || jobTitle === 'Forman' || jobTitle === 'Lead Foreman' || jobTitle === 'Lead foreman' || jobTitle === 'Lead Foreman / Project Manager')");
    console.log("");
    
    const matchingForemen = [];
    
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const matches = data.isActive && (
        data.jobTitle === "Foreman" || 
        data.jobTitle === "Forman" || 
        data.jobTitle === "Lead Foreman" || 
        data.jobTitle === "Lead foreman" ||
        data.jobTitle === "Lead Foreman / Project Manager"
      );
      
      if (matches) {
        matchingForemen.push({
          name: `${data.firstName} ${data.lastName}`,
          title: data.jobTitle
        });
      }
    });
    
    console.log(`Found ${matchingForemen.length} matching foremen:`);
    matchingForemen.forEach((f, idx) => {
      console.log(`  ${idx + 1}. ${f.name} - ${f.title}`);
    });
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

checkForemanFilter();

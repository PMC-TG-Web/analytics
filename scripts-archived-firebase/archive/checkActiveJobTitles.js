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

async function checkActiveJobTitles() {
  try {
    const snapshot = await getDocs(collection(db, "employees"));
    const titles = new Set();
    const titleCounts = {};

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.jobTitle && data.isActive) {
        titles.add(data.jobTitle);
        titleCounts[data.jobTitle] = (titleCounts[data.jobTitle] || 0) + 1;
      }
    });

    console.log("Active employees job titles:");
    Array.from(titles)
      .sort()
      .forEach((title) => {
        console.log(`  ${title}: ${titleCounts[title]}`);
      });

    console.log("\n--- Foremen (active) ---");
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.isActive && (
        data.jobTitle === "Foreman" || 
        data.jobTitle === "Forman" || 
        data.jobTitle === "Lead Foreman" || 
        data.jobTitle === "Lead foreman" ||
        data.jobTitle === "Right Hand Man" ||
        data.jobTitle === "Right Hand Man/ Sealhard Crew Leader"
      )) {
        console.log(`  ${data.firstName} ${data.lastName} - ${data.jobTitle}`);
      }
    });

    console.log("\n--- Crew (active) ---");
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.isActive && (
        data.jobTitle === "Laborer" || 
        data.jobTitle === "Trainer" || 
        data.jobTitle === "Field Worker" || 
        data.jobTitle === "Field worker"
      )) {
        console.log(`  ${data.firstName} ${data.lastName} - ${data.jobTitle}`);
      }
    });

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

checkActiveJobTitles();

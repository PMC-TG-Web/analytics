import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkCounts() {
  try {
    const q = query(collection(db, "projects"), where("projectArchived", "==", false));
    const snapshot = await getDocs(q);
    
    const counts = {};
    snapshot.docs.forEach(doc => {
      const status = doc.data().status || "Unknown";
      counts[status] = (counts[status] || 0) + 1;
    });
    
    console.log("Non-Archived Projects by Status:");
    console.log(JSON.stringify(counts, null, 2));
    console.log("Total Non-Archived:", snapshot.size);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkCounts();

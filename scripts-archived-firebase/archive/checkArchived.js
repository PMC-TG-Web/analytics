import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
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

async function checkArchived() {
  const snapshot = await getDocs(collection(db, "projects"));
  let archived = 0;
  let notArchived = 0;
  let missing = 0;
  
  snapshot.docs.forEach(doc => {
    const val = doc.data().projectArchived;
    if (val === true) archived++;
    else if (val === false) notArchived++;
    else missing++;
  });
  
  console.log("Archived:", archived);
  console.log("Not Archived:", notArchived);
  console.log("Field Missing (counts as Not Archived):", missing);
  process.exit(0);
}

checkArchived();

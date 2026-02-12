import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, limit, query, orderBy } from "firebase/firestore";
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

async function checkDates() {
  const snapshot = await getDocs(query(collection(db, "projects"), orderBy("dateUpdated", "desc"), limit(10)));
  snapshot.docs.forEach(doc => {
    console.log(doc.data().dateUpdated);
  });
  process.exit(0);
}

checkDates();

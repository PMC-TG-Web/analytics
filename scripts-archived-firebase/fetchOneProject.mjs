import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, limit, query } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBMMd3rm_SN0_s5vDhuULsQ9ywIF_NZBQk",
  authDomain: "pmcdatabasefirebase-sch.firebaseapp.com",
  projectId: "pmcdatabasefirebase-sch",
  appId: "1:426435888632:web:4f2b5896c9d817a904820d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  try {
    console.log("Fetching one project...");
    const q = query(collection(db, "projects"), limit(5));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      console.log("No projects found.");
    } else {
      console.log("PROJECT_DOCUMENTS_START");
      snapshot.docs.forEach(doc => {
          const data = doc.data();
          console.log(JSON.stringify({ id: doc.id, ...data }, (key, value) => {
              if (value && typeof value === 'object' && value.toDate) {
                  return value.toDate().toISOString();
              }
              return value;
          }, 2));
          console.log("---");
      });
      console.log("PROJECT_DOCUMENTS_END");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

run();

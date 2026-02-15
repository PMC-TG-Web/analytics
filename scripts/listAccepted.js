import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBMMd3rm_SN0_s5vDhuULsQ9ywIF_NZBQk",
  authDomain: "pmcdatabasefirebase-sch.firebaseapp.com",
  projectId: "pmcdatabasefirebase-sch",
  appId: "1:426435888632:web:4f2b5896c9d817a904820d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function listAcceptedIdentifiers() {
  try {
    const q = query(collection(db, "projects"), where("status", "==", "Accepted"));
    const snapshot = await getDocs(q);
    
    const ids = new Set();
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const id = (data.projectNumber || data.projectName || "").toString().trim();
      if (id) ids.add(id);
    });

    console.log("Distinct Identifiers for 'Accepted' status:");
    Array.from(ids).forEach(id => console.log(` - ${id}`));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

listAcceptedIdentifiers();

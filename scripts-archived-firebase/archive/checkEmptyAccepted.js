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

async function checkEmptyIdentifiers() {
  try {
    const q = query(collection(db, "projects"), where("status", "==", "Accepted"));
    const snapshot = await getDocs(q);
    
    let emptyCount = 0;
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const id = (data.projectNumber || data.projectName || "").toString().trim();
      if (!id) {
        emptyCount++;
        console.log(`Empty ID project: DocID ${doc.id}, Customer: ${data.customer}`);
      }
    });

    console.log(`\nTotal 'Accepted' projects with empty identifiers: ${emptyCount}`);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkEmptyIdentifiers();

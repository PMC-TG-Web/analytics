import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBMMd3rm_SN0_s5vDhuULsQ9ywIF_NZBQk",
  authDomain: "pmcdatabasefirebase-sch.firebaseapp.com",
  projectId: "pmcdatabasefirebase-sch",
  appId: "1:426435888632:web:4f2b5896c9d817a904820d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkCaseInsensitiveAccepted() {
  try {
    const snapshot = await getDocs(collection(db, "projects"));
    const ids = new Set();
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const status = (data.status || "").toString().toLowerCase().trim();
      if (status === "accepted") {
        const id = (data.projectNumber || data.projectName || "").toString().trim();
        ids.add(`${id} (Actual Status: "${data.status}")`);
      }
    });

    console.log("Distinct projects with any casing of 'Accepted' status:");
    Array.from(ids).forEach(id => console.log(` - ${id}`));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkCaseInsensitiveAccepted();

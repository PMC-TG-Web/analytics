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

async function checkAllProjects() {
  try {
    const snapshot = await getDocs(collection(db, "projects"));
    const projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    const identifiers = ["2508 - SC", "John F Martin", "501-A"];
    
    console.log("Status check for specific identifiers:\n");
    
    identifiers.forEach(id => {
      const related = projects.filter(p => {
        const pId = (p.projectNumber || p.projectName || "").toString().trim();
        return pId === id;
      });
      
      console.log(`Identifier: "${id}"`);
      const statusCounts = {};
      related.forEach(p => {
        const s = p.status || "Unknown";
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      });
      console.log("  Statuses:", statusCounts);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkAllProjects();

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

async function analyzeAccepted() {
  try {
    const q = query(collection(db, "projects"), where("status", "==", "Accepted"));
    const snapshot = await getDocs(q);
    
    console.log(`Found ${snapshot.size} total docs with status 'Accepted'\n`);
    
    const projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Group by identifier like the summary script does
    const identifierMap = new Map();
    projects.forEach(p => {
      const id = (p.projectNumber || p.projectName || "").toString().trim();
      if (!identifierMap.has(id)) identifierMap.set(id, []);
      identifierMap.get(id).push(p);
    });

    console.log("Groups by Identifier (Project Number/Name):");
    for (const [id, list] of identifierMap) {
      console.log(`\nIdentifier: "${id}" (${list.length} docs)`);
      list.forEach(p => {
        console.log(`  - DocID: ${p.id}, Customer: ${p.customer}, ProjectName: ${p.projectName}, ProjectNumber: ${p.projectNumber}, Archived: ${p.projectArchived}`);
      });
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

analyzeAccepted();

const admin = require('firebase-admin');

console.log("INITIALIZING_ADMIN");
admin.initializeApp({
  projectId: 'pmcdatabasefirebase-sch'
});

const db = admin.firestore();

async function inspectProjects() {
  console.log("MARKER: SCRIPT_STARTED");
  try {
    const querySnapshot = await db.collection('projects').limit(1).get();
    
    if (querySnapshot.empty) {
      console.log('No projects found');
      return;
    }

    const doc = querySnapshot.docs[0];
    console.log("DATA_START");
    console.log(JSON.stringify({ id: doc.id, ...doc.data() }, null, 2));
    console.log("DATA_END");
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    console.log("DONE");
    process.exit(0);
  }
}

inspectProjects();

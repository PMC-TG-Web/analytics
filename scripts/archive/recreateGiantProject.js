const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, collection } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function recreateGiantProject() {
  try {
    console.log('\n=== Recreating Giant #6582 Project ===\n');
    
    // Create a basic project entry for Giant #6582
    const projectData = {
      projectNumber: '2508 - GI',
      projectName: 'Giant #6582',
      customer: 'Ames Construction, Inc.',
      status: 'In Progress',
      sales: 860636.41,
      cost: 503069.01,
      hours: 3666.69,
      laborSales: 195804,
      laborCost: 145040,
      projectArchived: false,
      estimator: 'Unknown',
      pmcGroup: 'Unknown',
      dateCreated: new Date().toISOString(),
      dateUpdated: new Date().toISOString(),
    };
    
    const docRef = doc(collection(db, 'projects'));
    await setDoc(docRef, projectData);
    
    console.log('✓ Created Giant #6582 project');
    console.log(`  Project Number: ${projectData.projectNumber}`);
    console.log(`  Project Name: ${projectData.projectName}`);
    console.log(`  Customer: ${projectData.customer}`);
    console.log(`  Status: ${projectData.status}`);
    console.log(`  Sales: $${projectData.sales.toLocaleString()}`);
    console.log(`  Document ID: ${docRef.id}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

recreateGiantProject();

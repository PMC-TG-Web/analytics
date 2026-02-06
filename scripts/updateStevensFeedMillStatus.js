const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, doc, updateDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateStevensFeedMillStatus() {
  try {
    console.log('\n========================================');
    console.log('Updating Stevens Feed Mill Schoeneck Status');
    console.log('========================================\n');

    // Query for all Stevens Feed Mill Schoeneck documents
    const q = query(
      collection(db, 'projects'),
      where('projectNumber', '==', '2509 - SFMS')
    );
    
    const snapshot = await getDocs(q);
    
    console.log(`Found ${snapshot.docs.length} line items for Stevens Feed Mill Schoeneck\n`);
    
    if (snapshot.docs.length === 0) {
      console.log('No documents found to update.');
      process.exit(0);
    }

    // Show what will be updated
    let totalHours = 0;
    let totalSales = 0;
    
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      totalHours += data.hours || 0;
      totalSales += data.sales || 0;
    });
    
    console.log('Project Summary:');
    console.log(`  Customer: Hoover Building Specialists, Inc.`);
    console.log(`  Project: Stevens Feed Mill Schoeneck`);
    console.log(`  Project Number: 2509 - SFMS`);
    console.log(`  Current Status: Bid Submitted`);
    console.log(`  New Status: In Progress`);
    console.log(`  Total Line Items: ${snapshot.docs.length}`);
    console.log(`  Total Hours: ${totalHours.toLocaleString()}`);
    console.log(`  Total Sales: $${totalSales.toLocaleString()}\n`);
    
    console.log('Updating all line items...\n');
    
    let updatedCount = 0;
    
    // Update each document
    for (const docSnap of snapshot.docs) {
      const docRef = doc(db, 'projects', docSnap.id);
      await updateDoc(docRef, {
        status: 'In Progress',
        dateUpdated: new Date().toISOString()
      });
      updatedCount++;
      
      if (updatedCount % 10 === 0) {
        console.log(`  Updated ${updatedCount} of ${snapshot.docs.length} documents...`);
      }
    }
    
    console.log(`\n✓ Successfully updated ${updatedCount} documents`);
    console.log('✓ Status changed from "Bid Submitted" to "In Progress"');
    console.log('\n========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error updating status:', error);
    process.exit(1);
  }
}

updateStevensFeedMillStatus();

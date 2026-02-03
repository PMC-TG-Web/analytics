const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, doc, updateDoc, deleteDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function consolidateGiantProject() {
  try {
    console.log('\n=== Starting Giant Food Store Project Consolidation ===\n');
    
    // Query all documents with projectNumber "2508 - GI"
    const q = query(
      collection(db, 'projects'),
      where('projectNumber', '==', '2508 - GI')
    );
    const snapshot = await getDocs(q);
    
    console.log(`Found ${snapshot.docs.length} documents for project "2508 - GI"\n`);
    
    if (snapshot.docs.length === 0) {
      console.log('No documents found. Exiting.');
      process.exit(0);
    }
    
    // Sort docs to pick a consistent primary (first by ID)
    const sortedDocs = snapshot.docs.sort((a, b) => a.id.localeCompare(b.id));
    const primaryDoc = sortedDocs[0];
    const primaryData = primaryDoc.data();
    
    console.log(`Primary document: ${primaryDoc.id}`);
    console.log(`  Project Name: ${primaryData.projectName}`);
    console.log(`  Customer: ${primaryData.customer}\n`);
    
    // Create items array from all documents
    const items = sortedDocs.map(doc => {
      const data = doc.data();
      return {
        costitems: data.costitems,
        costType: data.costType,
        quantity: data.quantity,
        sales: data.sales || 0,
        cost: data.cost || 0,
        hours: data.hours || 0,
        laborSales: data.laborSales || 0,
        laborCost: data.laborCost || 0,
      };
    });
    
    // Calculate totals
    const totals = items.reduce((acc, item) => {
      acc.sales += item.sales;
      acc.cost += item.cost;
      acc.hours += item.hours;
      acc.laborSales += item.laborSales;
      acc.laborCost += item.laborCost;
      return acc;
    }, { sales: 0, cost: 0, hours: 0, laborSales: 0, laborCost: 0 });
    
    console.log('Calculated Totals:');
    console.log(`  Sales: $${totals.sales.toLocaleString()}`);
    console.log(`  Cost: $${totals.cost.toLocaleString()}`);
    console.log(`  Hours: ${totals.hours.toLocaleString()}`);
    console.log(`  Labor Sales: $${totals.laborSales.toLocaleString()}`);
    console.log(`  Labor Cost: $${totals.laborCost.toLocaleString()}`);
    console.log(`  Items array length: ${items.length}\n`);
    
    // Update primary document with items array and totals
    const updatedData = {
      ...primaryData,
      items: items,
      sales: totals.sales,
      cost: totals.cost,
      hours: totals.hours,
      laborSales: totals.laborSales,
      laborCost: totals.laborCost,
    };
    
    await updateDoc(doc(db, 'projects', primaryDoc.id), updatedData);
    console.log('✓ Updated primary document with items array and totals\n');
    
    // Delete all other documents
    const docsToDelete = sortedDocs.slice(1); // All except first
    console.log(`Deleting ${docsToDelete.length} duplicate documents...`);
    
    let deleted = 0;
    for (const docToDelete of docsToDelete) {
      await deleteDoc(doc(db, 'projects', docToDelete.id));
      deleted++;
      if (deleted % 100 === 0) {
        console.log(`  Deleted ${deleted}/${docsToDelete.length}...`);
      }
    }
    
    console.log(`\n✓ Successfully consolidated Giant Food Store project`);
    console.log(`  Kept 1 document (${primaryDoc.id})`);
    console.log(`  Deleted ${docsToDelete.length} duplicates`);
    console.log(`  Created items array with ${items.length} entries`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

consolidateGiantProject();

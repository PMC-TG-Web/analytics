const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

// Load config
const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const firebaseConfig = {
  apiKey: fileConfig.apiKey,
  authDomain: fileConfig.authDomain,
  projectId: fileConfig.projectId,
  storageBucket: fileConfig.storageBucket,
  messagingSenderId: fileConfig.messagingSenderId,
  appId: fileConfig.appId,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkInProgressSales() {
  try {
    const snapshot = await getDocs(collection(db, 'projects'));
    const inProgressProjects = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.status === 'In Progress') {
        inProgressProjects.push({
          id: doc.id,
          customer: data.customer,
          projectNumber: data.projectNumber,
          projectName: data.projectName,
          status: data.status,
          sales: data.sales,
          hours: data.hours,
        });
      }
    });
    
    console.log('\n========== IN PROGRESS PROJECTS ==========');
    console.log(`Total: ${inProgressProjects.length}`);
    console.log('\nProjects with sales > 0:');
    
    const withSales = inProgressProjects.filter(p => (p.sales || 0) > 0);
    console.log(`Count: ${withSales.length}`);
    
    withSales.slice(0, 20).forEach(p => {
      console.log(`\n${p.customer} | ${p.projectNumber} | ${p.projectName}`);
      console.log(`  Sales: $${(p.sales || 0).toLocaleString()}`);
      console.log(`  Hours: ${p.hours || 0}`);
    });
    
    if (withSales.length === 0) {
      console.log('\nNo In Progress projects with sales > 0 found');
      console.log('\nProjects with $0 sales:');
      inProgressProjects.slice(0, 10).forEach(p => {
        console.log(`  ${p.customer} | ${p.projectNumber} | ${p.projectName}`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkInProgressSales();

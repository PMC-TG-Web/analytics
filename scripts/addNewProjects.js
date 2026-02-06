const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function addNewProjects() {
  try {
    console.log('\n========================================');
    console.log('Adding New Projects to Database');
    console.log('========================================\n');

    const projectsToAdd = [
      {
        customer: 'CHN Site',
        projectName: 'CHN Site/GSC',
        status: 'In Process',
        sales: 59447.25,
        hours: 542.2,
        dateCreated: '2026-01-01T00:00:00.000Z',
        dateUpdated: new Date().toISOString(),
        projectArchived: false,
        cost: 0,
        laborSales: 0,
        laborCost: 0,
        projectNumber: null
      },
      {
        customer: 'Hoover',
        projectName: 'Hoover/Brecknock Orchards',
        status: 'In Process',
        sales: 41604.77,
        hours: 285.6,
        dateCreated: '2026-01-01T00:00:00.000Z',
        dateUpdated: new Date().toISOString(),
        projectArchived: false,
        cost: 0,
        laborSales: 0,
        laborCost: 0,
        projectNumber: null
      },
      {
        customer: 'JE Horst',
        projectName: 'JE Horst/Jono Hardware',
        status: 'In Process',
        sales: 73210.43,
        hours: 457.52,
        dateCreated: '2026-01-01T00:00:00.000Z',
        dateUpdated: new Date().toISOString(),
        projectArchived: false,
        cost: 0,
        laborSales: 0,
        laborCost: 0,
        projectNumber: null
      },
      {
        customer: 'JE Horst',
        projectName: 'JE Horst/Jubilee Ministries',
        status: 'In Process',
        sales: 49076.68,
        hours: 214,
        dateCreated: '2026-01-01T00:00:00.000Z',
        dateUpdated: new Date().toISOString(),
        projectArchived: false,
        cost: 0,
        laborSales: 0,
        laborCost: 0,
        projectNumber: null
      }
    ];

    console.log(`Adding ${projectsToAdd.length} projects:\n`);
    
    let addedCount = 0;
    
    for (const project of projectsToAdd) {
      console.log(`${addedCount + 1}. ${project.customer} - ${project.projectName}`);
      console.log(`   Status: ${project.status}`);
      console.log(`   Sales: $${project.sales.toLocaleString()}`);
      console.log(`   Hours: ${project.hours}`);
      console.log(`   Date Created: 1/1/2026`);
      
      const docRef = await addDoc(collection(db, 'projects'), project);
      console.log(`   ✓ Added with ID: ${docRef.id}\n`);
      
      addedCount++;
    }
    
    console.log('========================================');
    console.log(`✓ Successfully added ${addedCount} projects to database`);
    console.log('========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error adding projects:', error);
    process.exit(1);
  }
}

addNewProjects();

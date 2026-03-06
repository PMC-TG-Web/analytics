const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function createScheduleEntries() {
  try {
    console.log('\n========================================');
    console.log('Creating Schedule Entries');
    console.log('========================================\n');

    const projectSchedules = [
      {
        customer: 'CHN Site',
        projectName: 'CHN Site/GSC',
        projectNumber: null,
        totalHours: 542.2,
        allocations: {}
      },
      {
        customer: 'Hoover',
        projectName: 'Hoover/Brecknock Orchards',
        projectNumber: null,
        totalHours: 285.6,
        allocations: {}
      },
      {
        customer: 'JE Horst',
        projectName: 'JE Horst/Jono Hardware',
        projectNumber: null,
        totalHours: 457.52,
        allocations: {}
      },
      {
        customer: 'JE Horst',
        projectName: 'JE Horst/Jubilee Ministries',
        projectNumber: null,
        totalHours: 214,
        allocations: {}
      }
    ];

    console.log(`Creating ${projectSchedules.length} schedule entries:\n`);
    
    let createdCount = 0;
    
    for (const schedule of projectSchedules) {
      const docRef = await addDoc(collection(db, 'schedules'), schedule);
      console.log(`✓ Created schedule for: ${schedule.projectName}`);
      console.log(`  Total Hours: ${schedule.totalHours}`);
      console.log(`  Schedule Doc ID: ${docRef.id}\n`);
      createdCount++;
    }
    
    console.log('========================================');
    console.log(`✓ Successfully created ${createdCount} schedule entries`);
    console.log('✓ Projects should now appear on scheduling page');
    console.log('✓ You can now allocate their hours by month');
    console.log('========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createScheduleEntries();

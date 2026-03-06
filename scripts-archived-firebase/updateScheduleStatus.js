const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateScheduleStatus() {
  try {
    // List of jobs to update (from previous analysis)
    const jobsToUpdate = [
      { customer: 'AB Martin', projectNumber: '2508-AB', projectName: 'AB Martin 34 Denver Road' },
      { customer: 'Benchmark Construction Co., Inc.', projectNumber: 'MW-25-001', projectName: 'UGI Middletown Warehouse' },
      { customer: 'BN Excavating Inc.', projectNumber: 'DA-25-001', projectName: 'Ducklings Ambassador Circle Site' },
      { customer: 'CCS Building Group', projectNumber: '2508 - LC', projectName: 'Loft Community Partners' },
      { customer: 'CCS Building Group', projectNumber: '2510 - LCR', projectName: 'WVC - Lakes Phase I' },
      { customer: 'CCS Building Group', projectNumber: '2512 - PPG', projectName: 'Providence Park Garage 306' },
      { customer: 'Centurion Construction Group, LLC', projectNumber: '2508 - CL', projectName: 'Coplay Loadout Addition' },
      { customer: 'Centurion Construction Group, LLC', projectNumber: '2510 - LCS', projectName: 'Harrisburg Christian School' },
      { customer: 'CGA Construction', projectNumber: '2505 - TLE', projectName: 'The Learning Experience' },
      { customer: 'CGA Construction', projectNumber: '25050 - WCFB', projectName: 'Wildflower Commons - Future Building' },
      { customer: 'Heck Construction', projectNumber: '2509 - GB', projectName: 'Guardian Barriers' },
      { customer: 'Heck Construction', projectNumber: '2509 - PCR', projectName: '701 Poplar Church Road' },
      { customer: 'Heck Construction', projectNumber: 'DAC - 25 - 001', projectName: 'Ducklings Ambassador Circle' },
      { customer: 'High Construction Company', projectNumber: 'N/A', projectName: 'Greenfield Clubhouse' },
      { customer: 'Hoover Building Specialists, Inc.', projectNumber: '2508 - PCS', projectName: 'Paragon Computing Solutions' },
      { customer: 'Hoover Building Specialists, Inc.', projectNumber: '2509 - BT', projectName: 'Burkholder Tractor' },
      { customer: 'Hoover Building Specialists, Inc.', projectNumber: '2510 - GSE', projectName: 'Goods Store - Ephrata State Street' },
      { customer: 'Hoover Building Specialists, Inc.', projectNumber: 'PAN-25-001', projectName: 'Paneling Sales- Main Building' },
      { customer: 'Hoover Building Specialists, Inc.', projectNumber: 'PV-24-002', projectName: 'Penn Valley Gas' },
      { customer: 'Scenic Ridge Construction', projectNumber: '2508 - ADA', projectName: 'Alexander Drive Addition' }
    ];

    console.log(`\nFetching all schedules...`);
    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    const schedules = schedulesSnapshot.docs.map(doc => ({
      id: doc.id,
      ref: doc.ref,
      ...doc.data()
    }));

    console.log(`Total schedules found: ${schedules.length}\n`);
    console.log('='.repeat(80));
    console.log('Updating schedules to "Complete" status:');
    console.log('='.repeat(80));

    let updatedCount = 0;
    const updateResults = [];

    for (const jobToUpdate of jobsToUpdate) {
      // Find matching schedule
      const matchingSchedule = schedules.find(s => {
        const customerMatch = (s.customer || '') === jobToUpdate.customer;
        const projectNumberMatch = (s.projectNumber || '') === jobToUpdate.projectNumber;
        const projectNameMatch = (s.projectName || '') === jobToUpdate.projectName;
        return customerMatch && projectNumberMatch && projectNameMatch;
      });

      if (matchingSchedule) {
        const oldStatus = matchingSchedule.status || 'Unknown';
        
        if (oldStatus === 'Complete') {
          console.log(`\n${updatedCount + 1}. ${jobToUpdate.customer} - ${jobToUpdate.projectName}`);
          console.log(`   Schedule ID ${matchingSchedule.id}: Already Complete (no update needed)`);
        } else {
          try {
            await updateDoc(matchingSchedule.ref, {
              status: 'Complete'
            });
            console.log(`\n${updatedCount + 1}. ${jobToUpdate.customer} - ${jobToUpdate.projectName}`);
            console.log(`   Schedule ID ${matchingSchedule.id}: Updated from "${oldStatus}" to "Complete"`);
            updatedCount++;
            updateResults.push({
              customer: jobToUpdate.customer,
              projectName: jobToUpdate.projectName,
              id: matchingSchedule.id,
              oldStatus,
              newStatus: 'Complete'
            });
          } catch (error) {
            console.error(`   Schedule ID ${matchingSchedule.id}: ERROR - ${error.message}`);
          }
        }
      } else {
        console.log(`\n⚠️  No matching schedule found for: ${jobToUpdate.customer} - ${jobToUpdate.projectName}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`SUMMARY: Updated ${updatedCount} schedule(s) to "Complete" status`);
    console.log('='.repeat(80));

    if (updateResults.length > 0) {
      console.log('\nDetailed update log:');
      updateResults.forEach((result, index) => {
        console.log(`${index + 1}. ${result.customer} - ${result.projectName}`);
        console.log(`   Status changed: "${result.oldStatus}" → "${result.newStatus}"`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

updateScheduleStatus();

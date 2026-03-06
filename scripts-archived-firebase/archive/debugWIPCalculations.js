const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function debugWIPCalculations() {
  try {
    console.log('\n========================================');
    console.log('WIP Calculations Debug');
    console.log('========================================\n');

    // Get all projects
    const projectsSnapshot = await getDocs(collection(db, 'projects'));
    const allProjects = projectsSnapshot.docs.map(d => d.data());
    
    // Get all schedules
    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    const allSchedules = schedulesSnapshot.docs.map(d => d.data());

    console.log(`Total projects: ${allProjects.length}`);
    console.log(`Total schedules: ${allSchedules.length}\n`);

    // Count projects with "In Progress" status
    const inProgressProjects = allProjects.filter(p => p.status === 'In Progress');
    console.log(`Projects with "In Progress" status: ${inProgressProjects.length}`);
    
    let totalProjectHours = 0;
    inProgressProjects.forEach(p => {
      totalProjectHours += p.hours || 0;
    });
    console.log(`Total hours from In Progress projects: ${totalProjectHours}\n`);

    // Count schedules with status
    const inProgressSchedules = allSchedules.filter(s => s.status === 'In Progress');
    console.log(`Schedules with "In Progress" status: ${inProgressSchedules.length}`);
    
    let totalScheduledHours = 0;
    inProgressSchedules.forEach(s => {
      const allocations = s.allocations || {};
      const scheduled = Object.values(allocations).reduce((sum, percent) => {
        return sum + (s.totalHours * (percent / 100));
      }, 0);
      totalScheduledHours += scheduled;
    });
    console.log(`Total scheduled hours (from allocations): ${totalScheduledHours.toFixed(1)}\n`);

    // Check new projects
    console.log('New Projects:');
    const newProjectNames = ['CHN Site/GSC', 'Hoover/Brecknock Orchards', 'JE Horst/Jono Hardware', 'JE Horst/Jubilee Ministries'];
    newProjectNames.forEach(name => {
      const proj = allProjects.find(p => p.projectName === name);
      const sched = allSchedules.find(s => s.projectName === name);
      
      console.log(`\n${name}:`);
      if (proj) {
        console.log(`  Project: status=${proj.status}, hours=${proj.hours}`);
      } else {
        console.log(`  Project: NOT FOUND`);
      }
      
      if (sched) {
        console.log(`  Schedule: status=${sched.status}, totalHours=${sched.totalHours}`);
        console.log(`  Allocations: ${JSON.stringify(sched.allocations)}`);
        
        const scheduled = Object.values(sched.allocations || {}).reduce((sum, percent) => {
          return sum + (sched.totalHours * (percent / 100));
        }, 0);
        console.log(`  Scheduled: ${scheduled.toFixed(1)} hours`);
      } else {
        console.log(`  Schedule: NOT FOUND`);
      }
    });

    console.log('\n========================================\n');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

debugWIPCalculations();

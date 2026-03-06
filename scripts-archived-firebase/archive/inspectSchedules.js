const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectSchedules() {
  try {
    // Fetch all schedules
    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    const schedules = schedulesSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`\nTotal schedules found: ${schedules.length}\n`);

    // Show first 3 schedules to see the structure
    console.log('Sample schedule data:');
    console.log('='.repeat(80));
    
    schedules.slice(0, 3).forEach((schedule, index) => {
      console.log(`\nSchedule ${index + 1}:`);
      console.log(JSON.stringify(schedule, null, 2));
      console.log('-'.repeat(80));
    });

    // Now let's fetch projects and match them
    console.log('\n\nFetching projects to match status...\n');
    const projectsSnapshot = await getDocs(collection(db, 'projects'));
    const projects = projectsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    console.log(`Total projects found: ${projects.length}\n`);

    // Create a map of project keys to status
    const projectStatusMap = new Map();
    projects.forEach(project => {
      const key = `${project.customer || ''}|${project.projectNumber || ''}|${project.projectName || ''}`;
      if (!projectStatusMap.has(key)) {
        projectStatusMap.set(key, {
          status: project.status || 'Unknown',
          hours: project.hours || 0
        });
      }
    });

    console.log('Schedules with matched project status:');
    console.log('='.repeat(80));

    const schedulesWithStatus = [];
    schedules.forEach(schedule => {
      const jobKey = schedule.jobKey || '';
      const projectInfo = projectStatusMap.get(jobKey);
      const status = projectInfo?.status || schedule.status || 'Unknown';

      schedulesWithStatus.push({
        customer: schedule.customer || 'Unknown',
        projectName: schedule.projectName || 'Unnamed',
        projectNumber: schedule.projectNumber || 'N/A',
        status: status,
        totalHours: schedule.totalHours || 0,
        jobKey: jobKey
      });
    });

    // Group by status
    const statusGroups = {};
    schedulesWithStatus.forEach(s => {
      const status = s.status;
      if (!statusGroups[status]) {
        statusGroups[status] = [];
      }
      statusGroups[status].push(s);
    });

    console.log('\nSchedules by Status:\n');
    Object.entries(statusGroups).sort((a, b) => b[1].length - a[1].length).forEach(([status, jobs]) => {
      console.log(`\n${status} (${jobs.length} jobs):`);
      jobs.forEach(job => {
        console.log(`  - ${job.customer} - ${job.projectName} (${job.totalHours} hours)`);
      });
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

inspectSchedules();

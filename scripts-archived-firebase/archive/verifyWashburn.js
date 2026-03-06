const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function checkWashburn() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  try {
    console.log('--- Checking Projects ---');
    const projectsSnap = await getDocs(collection(db, 'projects'));
    const washburnProject = projectsSnap.docs.find(d => 
      d.data().projectName?.toLowerCase().includes('washburn dam')
    );

    if (!washburnProject) {
      console.log('Washburn Dam project not found in "projects" collection.');
      process.exit(0);
    }

    const jobData = washburnProject.data();
    const jobKey = jobData.jobKey || `${jobData.customer}~${jobData.projectNumber}~${jobData.projectName}`;
    console.log(`Found Project: ${jobData.projectName}`);
    console.log(`JobKey: ${jobKey}`);

    console.log('\n--- Checking Short Term Schedule (Overrides) ---');
    const stSnapshot = await getDocs(collection(db, 'short term schedual'));
    const relevantDocs = stSnapshot.docs.filter(d => d.id.startsWith(jobKey.replace(/[^a-zA-Z0-9_-]/g, '_')));

    if (relevantDocs.length === 0) {
      console.log('No overrides found in "short term schedual" for this job.');
    } else {
      relevantDocs.forEach(doc => {
        console.log(`\nDocument: ${doc.id}`);
        const data = doc.data();
        if (data.weeks) {
          data.weeks.forEach(week => {
            if (week.days) {
              week.days.forEach(day => {
                // If it's Feb 12th, 2026:
                // We need to correlate month + week + dayNumber
                // But let's just print all days with hours > 0
                if (day.hours > 0) {
                   console.log(`  Month: ${data.month}, Week: ${week.weekNumber}, Day: ${day.dayNumber}, Hours: ${day.hours}, Foreman: ${day.foreman || 'Unassigned'}`);
                }
              });
            }
          });
        }
      });
    }

    console.log('\n--- Checking Project Scopes (Gantt) ---');
    const scopesSnap = await getDocs(collection(db, 'projectScopes'));
    const washburnScopes = scopesSnap.docs.filter(d => d.data().jobKey === jobKey);
    
    if (washburnScopes.length === 0) {
      console.log('No Gantt scopes found for Washburn Dam.');
    } else {
      washburnScopes.forEach(doc => {
        const s = doc.data();
        console.log(`  Scope: ${s.title}, Start: ${s.startDate}, End: ${s.endDate}, Manpower: ${s.manpower}, Hours: ${s.hours}`);
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkWashburn();

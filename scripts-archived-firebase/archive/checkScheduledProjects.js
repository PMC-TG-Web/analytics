const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

// Load Firebase config
const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkScheduledProjects() {
  try {
    console.log('Loading schedules and projects...\n');
    
    // Get all schedules
    const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
    const schedules = schedulesSnapshot.docs.map(doc => doc.data());
    
    // Get all projects
    const projectsSnapshot = await getDocs(collection(db, 'projects'));
    const projects = projectsSnapshot.docs.map(doc => doc.data());
    
    console.log(`Found ${schedules.length} schedules and ${projects.length} projects\n`);
    
    // For each schedule, find matching projects
    schedules.forEach((schedule, index) => {
      const key = schedule.jobKey || `${schedule.customer}|${schedule.projectNumber}|${schedule.projectName}`;
      console.log(`\n=== Schedule ${index + 1} ===`);
      console.log(`Key: "${key}"`);
      console.log(`Customer: "${schedule.customer}"`);
      console.log(`Project Number: "${schedule.projectNumber}"`);
      console.log(`Project Name: "${schedule.projectName}"`);
      console.log(`Total Hours: ${schedule.totalHours}`);
      
      // Find matching projects
      const matchingProjects = projects.filter(p => {
        const projectKey = `${p.customer}|${p.projectNumber}|${p.projectName}`;
        return projectKey === key;
      });
      
      console.log(`\nMatching projects found: ${matchingProjects.length}`);
      if (matchingProjects.length > 0) {
        matchingProjects.forEach((p, i) => {
          console.log(`  Project ${i + 1}:`);
          console.log(`    Status: "${p.status}"`);
          console.log(`    Sales: ${p.sales}`);
          console.log(`    Hours: ${p.hours}`);
        });
      } else {
        console.log(`  No exact match found. Checking for partial matches...`);
        const partialMatches = projects.filter(p => 
          (p.customer === schedule.customer && p.projectName === schedule.projectName) ||
          (p.projectName === schedule.projectName && p.projectNumber === schedule.projectNumber)
        );
        if (partialMatches.length > 0) {
          console.log(`  Found ${partialMatches.length} partial matches:`);
          partialMatches.slice(0, 3).forEach((p, i) => {
            const projectKey = `${p.customer}|${p.projectNumber}|${p.projectName}`;
            console.log(`    Partial match ${i + 1}:`);
            console.log(`      Key: "${projectKey}"`);
            console.log(`      Status: "${p.status}"`);
            console.log(`      Sales: ${p.sales}`);
          });
        }
      }
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkScheduledProjects();

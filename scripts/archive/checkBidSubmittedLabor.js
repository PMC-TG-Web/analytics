const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const path = require('path');
const fs = require('fs');

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingConfigKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingConfigKeys.length > 0) {
  const configPath = path.join(__dirname, '../src/firebaseConfig.json');
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  firebaseConfig.apiKey = fileConfig.apiKey;
  firebaseConfig.authDomain = fileConfig.authDomain;
  firebaseConfig.projectId = fileConfig.projectId;
  firebaseConfig.storageBucket = fileConfig.storageBucket;
  firebaseConfig.messagingSenderId = fileConfig.messagingSenderId;
  firebaseConfig.appId = fileConfig.appId;
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkBidSubmittedProjects() {
  try {
    const snapshot = await getDocs(collection(db, 'projects'));
    const bidSubmittedProjects = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => p.status === 'Bid Submitted');

    console.log(`\nTotal Bid Submitted projects: ${bidSubmittedProjects.length}`);
    
    // Group by pmcGroup to see labor breakdown
    const groupedByPMC = {};
    bidSubmittedProjects.forEach(p => {
      const pmcGroup = (p.pmcGroup || 'No PMC Group').toString().trim().toLowerCase();
      if (!groupedByPMC[pmcGroup]) {
        groupedByPMC[pmcGroup] = {
          count: 0,
          totalHours: 0,
          projects: []
        };
      }
      groupedByPMC[pmcGroup].count++;
      groupedByPMC[pmcGroup].totalHours += (p.hours || 0);
      if (groupedByPMC[pmcGroup].projects.length < 3) {
        groupedByPMC[pmcGroup].projects.push({
          projectNumber: p.projectNumber,
          projectName: p.projectName,
          customer: p.customer,
          hours: p.hours || 0,
        });
      }
    });

    console.log('\n=== PMC Group Labor Hours Breakdown ===');
    const targetGroups = [
      'slab on grade labor',
      'site concrete labor',
      'wall labor',
      'foundation labor',
    ];
    
    let totalTargetHours = 0;
    targetGroups.forEach(group => {
      if (groupedByPMC[group]) {
        console.log(`\n${group}: ${groupedByPMC[group].totalHours.toFixed(2)} hours (${groupedByPMC[group].count} line items)`);
        totalTargetHours += groupedByPMC[group].totalHours;
        console.log('Sample projects:');
        groupedByPMC[group].projects.forEach(p => {
          console.log(`  - ${p.customer} - ${p.projectName} (${p.projectNumber}): ${p.hours} hours`);
        });
      } else {
        console.log(`\n${group}: 0 hours (0 line items)`);
      }
    });

    console.log(`\n=== Total Target Labor Hours: ${totalTargetHours.toFixed(2)} ===`);
    
    console.log('\n=== Other PMC Groups (Top 10) ===');
    const otherGroups = Object.entries(groupedByPMC)
      .filter(([key]) => !targetGroups.includes(key))
      .sort((a, b) => b[1].totalHours - a[1].totalHours)
      .slice(0, 10);
    
    otherGroups.forEach(([group, data]) => {
      console.log(`${group}: ${data.totalHours.toFixed(2)} hours (${data.count} line items)`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkBidSubmittedProjects();

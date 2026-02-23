const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function isExcludedFromDashboard(project) {
  if (project.projectArchived) return true;
  
  const status = (project.status || "").toString().toLowerCase().trim();
  if (status === "invitations" || status === "to do" || status === "todo" || status === "to-do") return true;

  const customer = (project.customer ?? "").toString().toLowerCase();
  if (customer.includes("sop inc")) return true;

  const projectName = (project.projectName ?? "").toString().toLowerCase();
  const excludedNames = [
    "pmc operations",
    "pmc shop time",
    "pmc test project"
  ];
  if (excludedNames.includes(projectName)) return true;

  return false;
}

async function checkPMHours() {
  console.log('Fetching all projects...');
  const snapshot = await getDocs(collection(db, 'projects'));
  const allProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  const filtered = allProjects.filter(p => !isExcludedFromDashboard(p));
  
  console.log(`\n=== PM HOURS ANALYSIS ===`);
  console.log(`Total projects (after exclusions): ${filtered.length}`);
  
  const pmProjects = filtered.filter(p => {
    const groupName = (p.pmcGroup || '').toString().trim();
    const normalized = groupName.toLowerCase();
    return normalized && (normalized.startsWith('pm ') || normalized === 'pm' || normalized.startsWith('pm-'));
  });
  
  console.log(`Projects with PM-related pmcGroup: ${pmProjects.length}`);
  
  const totalPMHours = pmProjects.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
  console.log(`Total PM hours: ${totalPMHours.toLocaleString()}`);
  
  const byStatus = {};
  pmProjects.forEach(p => {
    const status = p.status || 'Unknown';
    if (!byStatus[status]) {
      byStatus[status] = { count: 0, hours: 0 };
    }
    byStatus[status].count++;
    byStatus[status].hours += (Number(p.hours) || 0);
  });
  
  console.log('\nPM Hours by Status:');
  Object.entries(byStatus)
    .sort((a, b) => b[1].hours - a[1].hours)
    .forEach(([status, data]) => {
      console.log(`  ${status}: ${data.hours.toLocaleString()} hours (${data.count} line items)`);
    });
  
  const pmGroupBreakdown = {};
  pmProjects.forEach(p => {
    const group = p.pmcGroup || 'Unassigned';
    if (!pmGroupBreakdown[group]) {
      pmGroupBreakdown[group] = { count: 0, hours: 0 };
    }
    pmGroupBreakdown[group].count++;
    pmGroupBreakdown[group].hours += (Number(p.hours) || 0);
  });
  
  console.log('\nPM Group Breakdown:');
  Object.entries(pmGroupBreakdown)
    .sort((a, b) => b[1].hours - a[1].hours)
    .forEach(([group, data]) => {
      console.log(`  ${group}: ${data.hours.toLocaleString()} hours (${data.count} line items)`);
    });
  
  process.exit(0);
}

checkPMHours().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

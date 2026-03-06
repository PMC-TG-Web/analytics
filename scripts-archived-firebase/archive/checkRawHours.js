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

async function checkTotalHours() {
  console.log('Fetching all projects...');
  const snapshot = await getDocs(collection(db, 'projects'));
  const allProjects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  console.log(`\n=== RAW DATA (All Line Items) ===`);
  console.log(`Total line items: ${allProjects.length}`);
  
  const totalHours = allProjects.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
  console.log(`Total hours (all line items): ${totalHours.toLocaleString()}`);
  
  // Group by status
  const byStatus = {};
  allProjects.forEach(p => {
    const status = p.status || 'Unknown';
    if (!byStatus[status]) {
      byStatus[status] = { count: 0, hours: 0 };
    }
    byStatus[status].count++;
    byStatus[status].hours += (Number(p.hours) || 0);
  });
  
  console.log('\nHours by Status (all line items):');
  Object.entries(byStatus)
    .sort((a, b) => b[1].hours - a[1].hours)
    .forEach(([status, data]) => {
      console.log(`  ${status}: ${data.hours.toLocaleString()} hours (${data.count} line items)`);
    });
  
  // Group by PMC Group for Bid Submitted
  console.log('\n=== BID SUBMITTED LINE ITEMS ===');
  const bidSubmitted = allProjects.filter(p => p.status === 'Bid Submitted');
  console.log(`Bid Submitted line items: ${bidSubmitted.length}`);
  
  const bidHours = bidSubmitted.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
  console.log(`Bid Submitted total hours: ${bidHours.toLocaleString()}`);
  
  const byPmcGroup = {};
  bidSubmitted.forEach(p => {
    const group = (p.pmcGroup || 'No PMC Group').toString();
    if (!byPmcGroup[group]) {
      byPmcGroup[group] = { count: 0, hours: 0 };
    }
    byPmcGroup[group].count++;
    byPmcGroup[group].hours += (Number(p.hours) || 0);
  });
  
  console.log('\nBid Submitted by PMC Group (all line items):');
  Object.entries(byPmcGroup)
    .sort((a, b) => b[1].hours - a[1].hours)
    .forEach(([group, data]) => {
      console.log(`  ${group}: ${data.hours.toLocaleString()} hours (${data.count} line items)`);
    });
  
  // Now check after filtering
  console.log('\n=== AFTER EXCLUSIONS ===');
  const filtered = allProjects.filter(p => !isExcludedFromDashboard(p));
  console.log(`Line items after exclusions: ${filtered.length}`);
  
  const filteredHours = filtered.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
  console.log(`Total hours after exclusions: ${filteredHours.toLocaleString()}`);
  
  const filteredBidSubmitted = filtered.filter(p => p.status === 'Bid Submitted');
  const filteredBidHours = filteredBidSubmitted.reduce((sum, p) => sum + (Number(p.hours) || 0), 0);
  console.log(`Bid Submitted hours after exclusions: ${filteredBidHours.toLocaleString()} (${filteredBidSubmitted.length} line items)`);
  
  process.exit(0);
}

checkTotalHours().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

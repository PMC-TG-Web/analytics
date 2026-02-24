/**
 * testActiveScheduleDisplay.js
 * 
 * Test displaying activeSchedule data for Kemper Equipment
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const KEMPER_JOB_KEY = "Hoover Building Specialists, Inc.~2505 - KE~Kemper Equipment";

async function testDisplay() {
  console.log('\n🔍 Testing activeSchedule display for 5-week window\n');
  
  // Calculate 5-week window (Mon-Fri only)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Find Monday of current week
  const currentWeekStart = new Date(today);
  const dayOfWeek = currentWeekStart.getDay();
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  currentWeekStart.setDate(currentWeekStart.getDate() + daysToMonday);
  
  const fiveWeeksEnd = new Date(currentWeekStart);
  fiveWeeksEnd.setDate(fiveWeeksEnd.getDate() + (5 * 7) - 1);
  
  const startDateStr = currentWeekStart.toISOString().split('T')[0];
  const endDateStr = fiveWeeksEnd.toISOString().split('T')[0];
  
  console.log(`📅 5-Week Window: ${startDateStr} to ${endDateStr}\n`);
  
  // Query activeSchedule for this date range
  const q = query(
    collection(db, 'activeSchedule'),
    where('date', '>=', startDateStr),
    where('date', '<=', endDateStr)
  );
  
  const snapshot = await getDocs(q);
  
  console.log(`📊 Found ${snapshot.docs.length} entries in activeSchedule\n`);
  
  // Group by date
  const byDate = {};
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    if (!byDate[data.date]) {
      byDate[data.date] = [];
    }
    byDate[data.date].push(data);
  });
  
  // Show Kemper data
  console.log('🎯 Kemper Equipment schedule:\n');
  const kemperDates = Object.entries(byDate)
    .filter(([date, entries]) => entries.some(e => e.jobKey === KEMPER_JOB_KEY))
    .sort(([a], [b]) => a.localeCompare(b));
  
  if (kemperDates.length === 0) {
    console.log('   ❌ No Kemper entries found in 5-week window\n');
  } else {
    kemperDates.forEach(([date, entries]) => {
      const kemperEntries = entries.filter(e => e.jobKey === KEMPER_JOB_KEY);
      const totalHours = kemperEntries.reduce((sum, e) => sum + e.hours, 0);
      
      const dateObj = new Date(date + 'T00:00:00');
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
      const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      console.log(`   ${dayName} ${dateStr} - ${totalHours} hrs total`);
      kemperEntries.forEach(entry => {
        console.log(`      └─ ${entry.scopeOfWork}: ${entry.hours} hrs (${entry.source})`);
      });
      console.log('');
    });
  }
  
  // Show all projects in window
  console.log('📋 All projects in 5-week window:\n');
  const projectSummary = {};
  
  Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).forEach(([date, entries]) => {
    entries.forEach(entry => {
      if (!projectSummary[entry.jobKey]) {
        projectSummary[entry.jobKey] = {
          dates: new Set(),
          totalHours: 0
        };
      }
      projectSummary[entry.jobKey].dates.add(date);
      projectSummary[entry.jobKey].totalHours += entry.hours;
    });
  });
  
  const sortedProjects = Object.entries(projectSummary)
    .sort((a, b) => b[1].totalHours - a[1].totalHours)
    .slice(0, 10); // Top 10
  
  sortedProjects.forEach(([jobKey, data]) => {
    const projectName = jobKey.split('~')[2] || jobKey;
    console.log(`   ${projectName}`);
    console.log(`      ${data.totalHours} hrs across ${data.dates.size} days`);
  });
  
  console.log(`\n   (${Object.keys(projectSummary).length} total projects)\n`);
}

testDisplay()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

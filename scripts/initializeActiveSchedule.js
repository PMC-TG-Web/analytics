/**
 * initializeActiveSchedule.js
 * 
 * Initial population script for activeSchedule and scopeTracking collections.
 * 
 * Logic:
 * 1. Read projects collection - aggregate hours by jobKey + scopeOfWork
 * 2. Read schedules collection - get month allocations
 * 3. Read projectScopes collection - get scopes with dates
 * 4. For each project:
 *    - If scope has date in projectScopes → place on that date (source="gantt")
 *    - Else → place on first Monday of allocated month (source="schedules")
 * 5. Create scopeTracking entries with total/scheduled/unscheduled
 */

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc, writeBatch, Timestamp, query, where } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Helper: Get first Monday of a month
function getFirstMondayOfMonth(year, month) {
  const date = new Date(year, month - 1, 1);
  const day = date.getDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
  date.setDate(date.getDate() + daysUntilMonday);
  return date.toISOString().split('T')[0];
}

// Helper: Sanitize for document ID
function sanitize(str) {
  return str.replace(/[\/\\#?]/g, '_');
}

// Helper: Get document ID for activeSchedule
function getActiveScheduleDocId(jobKey, scopeOfWork, date) {
  return `${sanitize(jobKey)}_${sanitize(scopeOfWork)}_${date}`;
}

// Helper: Get document ID for scopeTracking
function getScopeTrackingDocId(jobKey, scopeOfWork) {
  return `${sanitize(jobKey)}_${sanitize(scopeOfWork)}`;
}

// Helper: Calculate work days between dates
function calculateWorkDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  const current = new Date(start);
  
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++; // Not Sunday or Saturday
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

async function initializeActiveSchedule() {
  console.log('\n🚀 Initializing activeSchedule and scopeTracking...\n');
  
  // STEP 1: Read projects and aggregate by jobKey + scopeOfWork
  console.log('📊 Step 1: Reading projects collection...');
  const projectsSnapshot = await getDocs(
    query(collection(db, 'projects'),
      where('status', 'not-in', ['Bid Submitted', 'Lost']),
      where('projectArchived', '==', false))
  );
  
  const scopeTotalsByJob = {}; // { jobKey: { scopeOfWork: totalHours } }
  
  projectsSnapshot.docs.forEach(doc => {
    const project = doc.data();
    const jobKey = project.jobKey || `${project.customer}~${project.projectNumber}~${project.projectName}`;
    const scopeOfWork = (project.scopeOfWork || 'Default Scope').trim();
    const hours = project.hours || 0;
    
    if (!scopeTotalsByJob[jobKey]) {
      scopeTotalsByJob[jobKey] = {};
    }
    if (!scopeTotalsByJob[jobKey][scopeOfWork]) {
      scopeTotalsByJob[jobKey][scopeOfWork] = 0;
    }
    scopeTotalsByJob[jobKey][scopeOfWork] += hours;
  });
  
  console.log(`   Found ${Object.keys(scopeTotalsByJob).length} unique jobs`);
  
  // STEP 2: Read schedules for month allocations
  console.log('📅 Step 2: Reading schedules collection...');
  const schedulesSnapshot = await getDocs(collection(db, 'schedules'));
  const schedulesByJobKey = {};
  
  schedulesSnapshot.docs.forEach(doc => {
    const schedule = doc.data();
    schedulesByJobKey[schedule.jobKey] = schedule;
  });
  
  console.log(`   Found ${Object.keys(schedulesByJobKey).length} schedules`);
  
  // STEP 3: Read projectScopes for dated scopes
  console.log('🎯 Step 3: Reading projectScopes collection...');
  const projectScopesSnapshot = await getDocs(collection(db, 'projectScopes'));
  const datedScopesByJob = {}; // { jobKey: { scopeTitle: { startDate, endDate, manpower } } }
  
  projectScopesSnapshot.docs.forEach(doc => {
    const scope = doc.data();
    if (!scope.jobKey || !scope.title) return;
    
    if (!datedScopesByJob[scope.jobKey]) {
      datedScopesByJob[scope.jobKey] = {};
    }
    
    datedScopesByJob[scope.jobKey][scope.title.trim()] = {
      startDate: scope.startDate,
      endDate: scope.endDate,
      manpower: scope.manpower || 0,
      hours: scope.hours || 0
    };
  });
  
  console.log(`   Found ${Object.keys(datedScopesByJob).length} jobs with scopes`);
  
  // STEP 4: Populate activeSchedule
  console.log('\n✍️  Step 4: Populating activeSchedule...\n');
  
  let entriesCreated = 0;
  const batch = writeBatch(db);
  let batchCount = 0;
  
  for (const [jobKey, scopes] of Object.entries(scopeTotalsByJob)) {
    const schedule = schedulesByJobKey[jobKey];
    const datedScopes = datedScopesByJob[jobKey] || {};
    
    // Find first month with allocation
    let firstMonthDate = null;
    if (schedule && schedule.allocations) {
      const sortedMonths = Object.entries(schedule.allocations)
        .filter(([month, pct]) => pct > 0)
        .filter(([month]) => /^\d{4}-\d{2}$/.test(month)) // Validate YYYY-MM format
        .sort(([a], [b]) => a.localeCompare(b));
      
      if (sortedMonths.length > 0) {
        const [firstMonth] = sortedMonths[0];
        const [year, month] = firstMonth.split('-').map(Number);
        
        // Validate year and month
        if (year >= 2020 && year <= 2030 && month >= 1 && month <= 12) {
          try {
            firstMonthDate = getFirstMondayOfMonth(year, month);
          } catch (e) {
            console.warn(`   ⚠️  Invalid date for ${jobKey}, month ${firstMonth}: ${e.message}`);
          }
        }
      }
    }
    
    // Default to first Monday of current month if no schedule
    if (!firstMonthDate) {
      const now = new Date();
      firstMonthDate = getFirstMondayOfMonth(now.getFullYear(), now.getMonth() + 1);
    }
    
    for (const [scopeOfWork, totalHours] of Object.entries(scopes)) {
      if (totalHours === 0) continue;
      
      const datedScope = datedScopes[scopeOfWork];
      
      if (datedScope && datedScope.startDate) {
        // Scope has dates - use them
        const startDate = datedScope.startDate;
        const endDate = datedScope.endDate || startDate;
        const manpower = datedScope.manpower;
        const workDays = calculateWorkDays(startDate, endDate);
        
        // Calculate hours from manpower if available, else use total
        const hoursToSchedule = (manpower > 0 && workDays > 0) 
          ? manpower * 10 * workDays 
          : totalHours;
        
        // Place on start date
        const docId = getActiveScheduleDocId(jobKey, scopeOfWork, startDate);
        batch.set(doc(db, 'activeSchedule', docId), {
          jobKey,
          scopeOfWork,
          date: startDate,
          hours: hoursToSchedule,
          manpower: manpower || 0,
          source: 'gantt',
          lastModified: Timestamp.now()
        });
        
        entriesCreated++;
        batchCount++;
        
        console.log(`   ✓ ${scopeOfWork}: ${hoursToSchedule} hrs on ${startDate} (dated scope)`);
      } else {
        // No dates - place on first Monday of allocated month
        const docId = getActiveScheduleDocId(jobKey, scopeOfWork, firstMonthDate);
        batch.set(doc(db, 'activeSchedule', docId), {
          jobKey,
          scopeOfWork,
          date: firstMonthDate,
          hours: totalHours,
          source: 'schedules',
          lastModified: Timestamp.now()
        });
        
        entriesCreated++;
        batchCount++;
        
        console.log(`   ✓ ${scopeOfWork}: ${totalHours} hrs on ${firstMonthDate} (default)`);
      }
      
      // Commit batch every 500 operations (Firestore limit)
      if (batchCount >= 500) {
        await batch.commit();
        console.log(`   💾 Committed ${batchCount} entries...`);
        batchCount = 0;
      }
    }
  }
  
  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
  }
  
  console.log(`\n✅ Created ${entriesCreated} activeSchedule entries`);
  
  // STEP 5: Create scopeTracking entries
  console.log('\n📈 Step 5: Creating scopeTracking entries...\n');
  
  let trackingCreated = 0;
  
  for (const [jobKey, scopes] of Object.entries(scopeTotalsByJob)) {
    // Get scheduled hours from activeSchedule
    const activeScheduleSnapshot = await getDocs(
      query(collection(db, 'activeSchedule'), where('jobKey', '==', jobKey))
    );
    
    const scheduledByScope = {};
    activeScheduleSnapshot.docs.forEach(doc => {
      const entry = doc.data();
      if (!scheduledByScope[entry.scopeOfWork]) {
        scheduledByScope[entry.scopeOfWork] = 0;
      }
      scheduledByScope[entry.scopeOfWork] += entry.hours;
    });
    
    // Create scopeTracking for each scope
    for (const [scopeOfWork, totalHours] of Object.entries(scopes)) {
      const scheduledHours = scheduledByScope[scopeOfWork] || 0;
      const docId = getScopeTrackingDocId(jobKey, scopeOfWork);
      
      await setDoc(doc(db, 'scopeTracking', docId), {
        jobKey,
        scopeOfWork,
        totalHours,
        scheduledHours,
        unscheduledHours: totalHours - scheduledHours,
        lastUpdated: Timestamp.now()
      });
      
      trackingCreated++;
      console.log(`   ✓ ${scopeOfWork}: ${totalHours} total, ${scheduledHours} scheduled`);
    }
  }
  
  console.log(`\n✅ Created ${trackingCreated} scopeTracking entries`);
  console.log('\n🎉 Initialization complete!\n');
}

initializeActiveSchedule()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

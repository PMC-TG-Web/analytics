// Run this in the browser console on the short-term schedule page
// It will show you what data is loaded for Canine Partners

console.log('Checking for Canine Partners...');

// Get the data from the page's React state (this is a bit hacky but works)
const iframe = document.querySelector('iframe');
if (window.__projectData) {
  console.log('Found project data:', window.__projectData);
}

// Try to find it in indexedDB (Firebase's database)
const openDB = indexedDB.open('firebaseLocalStorageDb');
openDB.onsuccess = (e) => {
  const db = e.target.result;
  const stores = db.objectStoreNames;
  console.log('IndexedDB stores:', Array.from(stores));
};

// Alternative: Check localStorage
const keys = Object.keys(localStorage);
const fbKeys = keys.filter(k => k.includes('firebase'));
console.log('Firebase localStorage keys:', fbKeys);

// Show what's in session storage related to schedules
const sessionKeys = Object.keys(sessionStorage);
const scheduleKeys = sessionKeys.filter(k => k.includes('schedule'));
console.log('Schedule session keys:', scheduleKeys);
scheduleKeys.forEach(k => {
  try {
    const data = JSON.parse(sessionStorage.getItem(k));
    if (data.data && Array.isArray(data.data)) {
      const canine = data.data.find(p => p.projectName && p.projectName.toLowerCase().includes('canine'));
      if (canine) {
        console.log(`Found Canine in ${k}:`, canine);
      }
    }
  } catch (e) {}
});

// Check for the correct project name
console.log('\nSearching for projects with "Canine" in name:');
const allKeys = [...keys, ...sessionKeys];
allKeys.forEach(k => {
  try {
    const item = localStorage.getItem(k) || sessionStorage.getItem(k);
    if (item && item.includes('Canine')) {
      console.log(`Found in ${k}`);
    }
  } catch (e) {}
});

// Check foremanDateProjects if available
console.log('\nDebug tip: Add this to the short-term-schedule code:');
console.log('window.debugSchedules = { foremanDateProjects };');
console.log('Then check: window.debugSchedules.foremanDateProjects["__unassigned__"]');

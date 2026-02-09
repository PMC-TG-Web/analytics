const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const config = require(path.resolve(__dirname, '../src/firebaseConfig.json'));
initializeApp(config);
const db = getFirestore();

(async () => {
  // Get CSV project names
  const csvPath = path.resolve('C:\\Users\\ToddGilmore\\Downloads\\Bid_Distro-Preconstruction (4).csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const projectNameIdx = headers.indexOf('projectName');

  const csvProjects = new Set();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const parts = lines[i].split(',').map(p => p.trim().replace(/^"|"$/g, ''));
    const projectName = parts[projectNameIdx]?.trim() || '';
    if (projectName) csvProjects.add(projectName);
  }

  console.log(`CSV Projects: ${csvProjects.size}`);
  console.log('Sample CSV projects:');
  Array.from(csvProjects).slice(0, 10).forEach(p => console.log(`  "${p}"`));

  // Get Firestore project names
  const fsProjects = new Set();
  const snap = await getDocs(collection(db, 'projects'));
  snap.docs.forEach(d => {
    if (d.data().projectName) {
      fsProjects.add(d.data().projectName);
    }
  });

  console.log(`\nFirestore Projects: ${fsProjects.size}`);
  console.log('Sample Firestore projects:');
  Array.from(fsProjects).slice(0, 10).forEach(p => console.log(`  "${p}"`));

  // Find overlaps
  const matches = Array.from(csvProjects).filter(p => fsProjects.has(p));
  console.log(`\nMatches found: ${matches.length}`);
  if (matches.length > 0) {
    console.log('Matching projects:');
    matches.forEach(m => console.log(`  ✓ "${m}"`));
  }

  // Find close mismatches (case-insensitive)
  const csvLower = new Map(Array.from(csvProjects).map(p => [p.toLowerCase(), p]));
  const fsLower = new Map(Array.from(fsProjects).map(p => [p.toLowerCase(), p]));
  const caseMatches = [];
  for (const [lower, orig] of csvLower) {
    if (fsLower.has(lower) && !matches.includes(orig)) {
      caseMatches.push({ csv: orig, fs: fsLower.get(lower) });
    }
  }
  if (caseMatches.length > 0) {
    console.log(`\nCase-insensitive mismatches: ${caseMatches.length}`);
    caseMatches.slice(0, 5).forEach(m => console.log(`  "${m.csv}" vs "${m.fs}"`));
  }
})();

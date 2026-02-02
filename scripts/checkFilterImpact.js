const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/firebaseConfig.json');
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

(async () => {
  const snapshot = await getDocs(collection(db, 'projects'));
  const projects = snapshot.docs.map(d => d.data());
  
  const completeProjects = projects.filter(p => p.status === 'Complete');
  console.log(`Total Complete projects: ${completeProjects.length}`);
  
  const totalSalesBeforeFilter = completeProjects.reduce((sum, p) => sum + (p.sales || 0), 0);
  console.log(`Total Sales (before filters): $${totalSalesBeforeFilter.toLocaleString()}\n`);
  
  // Apply each filter one by one
  let filtered = [...completeProjects];
  
  // Filter 1: projectArchived
  const beforeArchived = filtered.length;
  filtered = filtered.filter(p => !p.projectArchived);
  console.log(`Filter: projectArchived = false`);
  console.log(`  Removed: ${beforeArchived - filtered.length} projects`);
  console.log(`  Remaining: ${filtered.length}`);
  console.log(`  Sales: $${filtered.reduce((s, p) => s + (p.sales || 0), 0).toLocaleString()}\n`);
  
  // Filter 2: customer "sop inc"
  const beforeSopInc = filtered.length;
  filtered = filtered.filter(p => !(p.customer ?? "").toString().toLowerCase().includes("sop inc"));
  console.log(`Filter: customer NOT includes "sop inc"`);
  console.log(`  Removed: ${beforeSopInc - filtered.length} projects`);
  console.log(`  Remaining: ${filtered.length}`);
  console.log(`  Sales: $${filtered.reduce((s, p) => s + (p.sales || 0), 0).toLocaleString()}\n`);
  
  // Filter 3: projectName filters
  const beforeProjectName = filtered.length;
  filtered = filtered.filter(p => {
    const projectName = (p.projectName ?? "").toString().toLowerCase();
    return !(projectName === "pmc operations" ||
             projectName === "pmc shop time" ||
             projectName === "pmc test project" ||
             projectName.includes("sandbox") ||
             projectName.includes("raymond king") ||
             projectName === "alexander drive addition latest");
  });
  console.log(`Filter: projectName exclusions`);
  console.log(`  Removed: ${beforeProjectName - filtered.length} projects`);
  console.log(`  Remaining: ${filtered.length}`);
  console.log(`  Sales: $${filtered.reduce((s, p) => s + (p.sales || 0), 0).toLocaleString()}\n`);
  
  // Filter 4: estimator exists
  const beforeEstimator = filtered.length;
  filtered = filtered.filter(p => {
    const estimator = (p.estimator ?? "").toString().trim();
    return estimator !== "";
  });
  console.log(`Filter: estimator exists`);
  console.log(`  Removed: ${beforeEstimator - filtered.length} projects`);
  console.log(`  Remaining: ${filtered.length}`);
  console.log(`  Sales: $${filtered.reduce((s, p) => s + (p.sales || 0), 0).toLocaleString()}\n`);
  
  // Filter 5: estimator NOT Todd Gilmore
  const beforeTodd = filtered.length;
  filtered = filtered.filter(p => {
    const estimator = (p.estimator ?? "").toString().trim().toLowerCase();
    return estimator !== "todd gilmore";
  });
  console.log(`Filter: estimator NOT "todd gilmore"`);
  console.log(`  Removed: ${beforeTodd - filtered.length} projects`);
  console.log(`  Remaining: ${filtered.length}`);
  console.log(`  Sales: $${filtered.reduce((s, p) => s + (p.sales || 0), 0).toLocaleString()}\n`);
  
  // Filter 6: projectNumber NOT "701 poplar church rd"
  const beforePoplar = filtered.length;
  filtered = filtered.filter(p => {
    const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
    return projectNumber !== "701 poplar church rd";
  });
  console.log(`Filter: projectNumber NOT "701 poplar church rd"`);
  console.log(`  Removed: ${beforePoplar - filtered.length} projects`);
  console.log(`  Remaining: ${filtered.length}`);
  console.log(`  Sales: $${filtered.reduce((s, p) => s + (p.sales || 0), 0).toLocaleString()}\n`);
  
  console.log('='.repeat(80));
  console.log(`FINAL: ${filtered.length} projects, $${filtered.reduce((s, p) => s + (p.sales || 0), 0).toLocaleString()}`);
})();

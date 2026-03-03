import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import { readFileSync } from 'fs';

const firebaseConfig = JSON.parse(readFileSync('src/firebaseConfig.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const qualifyingStatuses = ['In Progress', 'Accepted', 'Complete'];

async function getProjectSales() {
  const projectsRef = collection(db, 'projects');
  const projectSnap = await getDocs(projectsRef);
  
  const projectsByStatus = {};
  const projects2026 = [];
  
  projectSnap.forEach(doc => {
    const p = { ...doc.data(), id: doc.id };
    const status = p.status || 'Unknown';
    
    if (!projectsByStatus[status]) {
      projectsByStatus[status] = 0;
    }
    projectsByStatus[status]++;
    
    if (qualifyingStatuses.includes(status)) {
      projects2026.push({
        id: doc.id,
        customer: p.customer,
        projectNumber: p.projectNumber,
        projectName: p.projectName,
        status: p.status,
        sales: p.sales,
        jobKey: p.jobKey
      });
    }
  });
  
  console.log('\n=== Projects by Status ===');
  Object.entries(projectsByStatus).forEach(([status, count]) => {
    console.log(`${status}: ${count}`);
  });
  
  console.log(`\n=== Qualifying Projects (for Scheduled Sales Calculation) ===`);
  console.log(`Count: ${projects2026.length}`);
  
  let totalSales = 0;
  projects2026.slice(0, 10).forEach(p => {
    const sales = Number(p.sales ?? 0);
    totalSales += sales;
    console.log(`${p.customer}~${p.projectNumber}~${p.projectName}: $${sales.toLocaleString()} (status: ${p.status})`);
  });
  console.log(`... and ${Math.max(0, projects2026.length - 10)} more`);
  console.log(`Total qualifying project sales (first 10): $${totalSales.toLocaleString()}`);
  
  return projects2026;
}

async function getSchedules() {
  const schedulesRef = collection(db, 'schedules');
  const schedSnap = await getDocs(schedulesRef);
  
  const schedules2026 = [];
  const schedulesWithAllocations = [];
  
  schedSnap.forEach(doc => {
    const s = { ...doc.data(), id: doc.id };
    const allocations = s.allocations || {};
    const allocationKeys = Object.keys(allocations);
    
    // Check if has 2026 allocations
    const has2026 = allocationKeys.some(k => k.startsWith('2026'));
    
    if (has2026) {
      schedules2026.push({
        id: doc.id,
        customer: s.customer,
        projectNumber: s.projectNumber,
        projectName: s.projectName,
        jobKey: s.jobKey,
        allocations: s.allocations
      });
      schedulesWithAllocations.push(s);
    }
  });
  
  console.log(`\n=== Schedules with 2026 Allocations ===`);
  console.log(`Count: ${schedules2026.length}`);
  schedules2026.slice(0, 5).forEach(s => {
    const allocKeys = Object.keys(s.allocations).filter(k => k.startsWith('2026'));
    console.log(`${s.customer}~${s.projectNumber}~${s.projectName} (jobKey: ${s.jobKey})`);
    console.log(`  Allocations: ${allocKeys.join(', ')}`);
  });
  
  return { schedules2026, schedulesWithAllocations };
}

async function main() {
  console.log('=== Debug KPI 2026 Data ===\n');
  
  const projects = await getProjectSales();
  const { schedules2026 } = await getSchedules();
  
  // Try to match schedules to projects
  console.log(`\n=== Matching Schedules to Projects ===`);
  
  const projectMap = new Map();
  projects.forEach(p => {
    const key = `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`;
    const sales = Number(p.sales ?? 0);
    projectMap.set(key, sales);
  });
  
  let matchCount = 0;
  let totalScheduledSales = 0;
  
  schedules2026.forEach(s => {
    const key = s.jobKey || `${s.customer || ''}~${s.projectNumber || ''}~${s.projectName || ''}`;
    const projectSales = projectMap.get(key);
    
    if (projectSales) {
      matchCount++;
      const allocations = s.allocations || {};
      Object.entries(allocations).forEach(([month, percent]) => {
        if (month.startsWith('2026')) {
          const sales = projectSales * (Number(percent || 0) / 100);
          totalScheduledSales += sales;
        }
      });
    }
  });
  
  console.log(`Matched schedules: ${matchCount} / ${schedules2026.length}`);
  console.log(`Total Scheduled Sales for 2026: $${totalScheduledSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

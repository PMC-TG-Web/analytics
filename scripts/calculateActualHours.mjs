import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Calculating hour metrics from projects...');
const projectsPath = path.join(__dirname, '..', 'public', 'projects-backup.json');
const projects = JSON.parse(fs.readFileSync(projectsPath, 'utf-8'));

// Calculate hours by month
const hoursByMonth = {};
const hoursTotal = projects.reduce((total, p) => {
  if (!p.dateCreated) return total;
  
  const date = new Date(p.dateCreated);
  const month = date.getMonth(); // 0-11
  const hours = Number(p.hours) || 0;
  
  hoursByMonth[month] = (hoursByMonth[month] || 0) + hours;
  return total + hours;
}, 0);

console.log(`Total hours across all projects: ${Math.round(hoursTotal).toLocaleString()}`);

// Calculate hours by PMC category
const hoursByPMC = {};
projects.forEach(p => {
  Object.entries(p.pmcBreakdown || {}).forEach(([pmc, hours]) => {
    hoursByPMC[pmc] = (hoursByPMC[pmc] || 0) + hours;
  });
});

console.log('\nHours by PMC Category:');
Object.entries(hoursByPMC)
  .sort((a, b) => b[1] - a[1])
  .forEach(([pmc, hours]) => {
    if (hours > 0) {
      console.log(`  ${pmc}: ${Math.round(hours).toLocaleString()} hours`);
    }
  });

// Calculate labor hours (all categories except "Part" and "Subcontractor")
const laborPMCs = ['1. Labor', 'Assembly', 'Excavation And Backfill Labor', 'Finish Labor', 'Foundation Labor', 'Labor', 'PM', 'Pour And Finish Labor', 'Site Concrete Labor', 'Slab On Grade Labor', 'Stone Grading Labor', 'Travel Labor', 'Wall Labor', 'fab labor', 'welder'];
const laborHours = Object.entries(hoursByPMC)
  .filter(([pmc]) => laborPMCs.includes(pmc))
  .reduce((total, [, hours]) => total + hours, 0);

console.log(`\nTotal Labor Hours: ${Math.round(laborHours).toLocaleString()}`);

// Create month array (Jan-Dec)
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const actualHoursValues = months.map((_, i) => {
  const hours = hoursByMonth[i] || 0;
  return hours > 0 ? hours.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
});

console.log('\nRevenue Actual Hours by Month:');
months.forEach((month, i) => {
  if (actualHoursValues[i]) {
    console.log(`  ${month}: ${actualHoursValues[i]}`);
  }
});

// Update kpiCardDefaults.ts with actual hours
const defaultsPath = path.join(__dirname, '..', 'src', 'lib', 'kpiCardDefaults.ts');
let defaultsContent = fs.readFileSync(defaultsPath, 'utf-8');

// Replace the Revenue Actual Hours values
const oldRevenueActualPattern = /kpi: "Revenue Actual Hours",\s+values: \[.*?\]/s;
const newRevenueActual = `kpi: "Revenue Actual Hours",
        values: [${actualHoursValues.map(v => `"${v}"`).join(', ')}]`;

defaultsContent = defaultsContent.replace(oldRevenueActualPattern, newRevenueActual);

// Write updated defaults
fs.writeFileSync(defaultsPath, defaultsContent);

console.log('\n✓ Updated kpiCardDefaults.ts with actual hours data');

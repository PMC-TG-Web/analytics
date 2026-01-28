// scripts/analyzeData.js
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

async function analyzeData() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const querySnapshot = await getDocs(collection(db, 'projects'));
  const projects = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  console.log(`\n========== DATA ANALYSIS ==========`);
  console.log(`Total Records: ${projects.length}\n`);

  // Status breakdown
  const byStatus = {};
  projects.forEach(p => {
    const status = p.status || 'Unknown';
    if (!byStatus[status]) byStatus[status] = { count: 0, sales: 0, cost: 0, hours: 0 };
    byStatus[status].count++;
    byStatus[status].sales += p.sales || 0;
    byStatus[status].cost += p.cost || 0;
    byStatus[status].hours += p.hours || 0;
  });

  console.log('By Status:');
  Object.entries(byStatus).sort((a, b) => b[1].sales - a[1].sales).forEach(([status, data]) => {
    const rph = data.hours ? data.sales / data.hours : 0;
    const markup = data.cost ? ((data.sales - data.cost) / data.cost) * 100 : 0;
    console.log(`  ${status}: ${data.count} projects, $${Math.round(data.sales).toLocaleString()} sales, $${Math.round(data.cost).toLocaleString()} cost, ${Math.round(data.hours).toLocaleString()} hrs, $${rph.toFixed(2)} RPH, ${markup.toFixed(1)}% markup`);
  });

  // Estimator breakdown
  const byEstimator = {};
  projects.forEach(p => {
    const estimator = p.estimator || 'Unknown';
    if (!byEstimator[estimator]) byEstimator[estimator] = { count: 0, sales: 0 };
    byEstimator[estimator].count++;
    byEstimator[estimator].sales += p.sales || 0;
  });

  console.log('\nBy Estimator:');
  Object.entries(byEstimator).sort((a, b) => b[1].sales - a[1].sales).forEach(([estimator, data]) => {
    console.log(`  ${estimator}: ${data.count} projects, $${Math.round(data.sales).toLocaleString()} sales`);
  });

  // Cost Type breakdown
  const byCostType = {};
  projects.forEach(p => {
    const type = p.CostType || 'Unknown';
    if (!byCostType[type]) byCostType[type] = { count: 0, sales: 0, cost: 0 };
    byCostType[type].count++;
    byCostType[type].sales += p.sales || 0;
    byCostType[type].cost += p.cost || 0;
  });

  console.log('\nBy Cost Type:');
  Object.entries(byCostType).forEach(([type, data]) => {
    console.log(`  ${type}: ${data.count} items, $${Math.round(data.sales).toLocaleString()} sales, $${Math.round(data.cost).toLocaleString()} cost`);
  });

  // Top customers by sales
  const byCustomer = {};
  projects.forEach(p => {
    const customer = p.customer || 'Unknown';
    if (!byCustomer[customer]) byCustomer[customer] = { sales: 0, count: 0 };
    byCustomer[customer].sales += p.sales || 0;
    byCustomer[customer].count++;
  });

  console.log('\nTop 10 Customers by Sales:');
  Object.entries(byCustomer).sort((a, b) => b[1].sales - a[1].sales).slice(0, 10).forEach(([customer, data]) => {
    console.log(`  ${customer}: $${Math.round(data.sales).toLocaleString()} (${data.count} items)`);
  });

  // Date range
  const dates = projects.map(p => new Date(p.dateCreated)).filter(d => !isNaN(d));
  if (dates.length > 0) {
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    console.log(`\nDate Range: ${minDate.toLocaleDateString()} to ${maxDate.toLocaleDateString()}`);
  }

  // Overall totals
  const totals = projects.reduce((acc, p) => ({
    sales: acc.sales + (p.sales || 0),
    cost: acc.cost + (p.cost || 0),
    hours: acc.hours + (p.hours || 0)
  }), { sales: 0, cost: 0, hours: 0 });

  const overallRPH = totals.hours ? totals.sales / totals.hours : 0;
  const overallMarkup = totals.cost ? ((totals.sales - totals.cost) / totals.cost) * 100 : 0;

  console.log('\n========== OVERALL TOTALS ==========');
  console.log(`Total Sales: $${Math.round(totals.sales).toLocaleString()}`);
  console.log(`Total Cost: $${Math.round(totals.cost).toLocaleString()}`);
  console.log(`Total Hours: ${Math.round(totals.hours).toLocaleString()}`);
  console.log(`Overall RPH: $${overallRPH.toFixed(2)}`);
  console.log(`Overall Markup: ${overallMarkup.toFixed(1)}%`);
  console.log(`Overall Profit: $${Math.round(totals.sales - totals.cost).toLocaleString()}\n`);

  process.exit(0);
}

analyzeData();

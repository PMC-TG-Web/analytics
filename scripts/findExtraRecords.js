const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function normalize(val) {
  return (val || '').toString().trim().toLowerCase();
}

function parseNumber(val) {
  if (val === null || val === undefined || val === '') return '';
  const num = parseFloat(val.toString().replace(/[$,\s]/g, ''));
  return Number.isFinite(num) ? num.toFixed(2) : '';
}

function parseBoolean(val) {
  if (val === null || val === undefined || val === '') return '';
  const s = val.toString().trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1' ? 'true' : 'false';
}

function makeKey(record) {
  return [
    normalize(record.projectNumber),
    normalize(record.projectName),
    normalize(record.customer),
    normalize(record.costitems),
    normalize(record.costType),
    parseNumber(record.quantity),
    parseNumber(record.sales),
    parseNumber(record.laborSales),
    parseNumber(record.laborCost),
    parseNumber(record.cost),
    parseNumber(record.hours),
    normalize(record.status),
    normalize(record.dateCreated),
    normalize(record.estimator),
    normalize(record.projectStage),
    normalize(record.reasonForLoss),
    parseBoolean(record.projectArchived),
    parseBoolean(record.testProject),
    parseBoolean(record.active),
    normalize(record.dateUpdated),
    normalize(record.projectUpdateDate),
  ].join('||');
}

async function findExtraRecords() {
  try {
    const csvPath = path.join(__dirname, '../src/Bid_Distro-Preconstruction (3).csv');
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const csvRecords = csv.parse(fileContent, { columns: true, skip_empty_lines: true });

    const csvCounts = new Map();
    csvRecords.forEach(r => {
      const key = makeKey({
        projectNumber: r.projectNumber,
        projectName: r.projectName,
        customer: r.customer,
        costitems: r.Costitems,
        costType: r.CostType,
        quantity: r.Quantity,
        sales: r.sales,
        laborSales: r.LaborSales,
        laborCost: r.LaborCost,
        cost: r.cost,
        hours: r.hours,
        status: r.status,
        dateCreated: r.dateCreated,
        estimator: r.estimator,
        projectStage: r.ProjectStage,
        reasonForLoss: r.ReasonForLoss,
        projectArchived: r.ProjectArchived,
        testProject: r.TestProject,
        active: r.Active,
        dateUpdated: r.dateUpdated,
        projectUpdateDate: r.ProjectUpdateDate,
      });
      csvCounts.set(key, (csvCounts.get(key) || 0) + 1);
    });

    const snapshot = await getDocs(collection(db, 'projects'));
    const extras = [];
    const statusCounts = {};

    snapshot.forEach(doc => {
      const data = doc.data();
      const key = makeKey({
        projectNumber: data.projectNumber,
        projectName: data.projectName,
        customer: data.customer,
        costitems: data.costitems,
        costType: data.costType,
        quantity: data.quantity,
        sales: data.sales,
        laborSales: data.laborSales,
        laborCost: data.laborCost,
        cost: data.cost,
        hours: data.hours,
        status: data.status,
        dateCreated: data.dateCreated,
        estimator: data.estimator,
        projectStage: data.projectStage,
        reasonForLoss: data.reasonForLoss,
        projectArchived: data.projectArchived,
        testProject: data.testProject,
        active: data.active,
        dateUpdated: data.dateUpdated,
        projectUpdateDate: data.projectUpdateDate,
      });

      const remaining = csvCounts.get(key) || 0;
      if (remaining > 0) {
        csvCounts.set(key, remaining - 1);
      } else {
        extras.push({ id: doc.id, ...data });
        const status = data.status || 'null';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }
    });

    console.log(`Total DB records: ${snapshot.size}`);
    console.log(`Total CSV records: ${csvRecords.length}`);
    console.log(`Extra records in DB (not in CSV): ${extras.length}`);

    console.log('\nExtras by status:');
    Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
      });

    console.log('\nSample extras (first 20):');
    extras.slice(0, 20).forEach((r, idx) => {
      console.log(
        `${idx + 1}. ${r.projectName || 'null'} | ${r.customer || 'null'} | ${r.costitems || 'null'} | ${r.projectNumber || 'null'} | ${r.status || 'null'} | ${r.sales || 'null'}`
      );
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

findExtraRecords();

const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, deleteDoc } = require('firebase/firestore');

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

async function deleteExtras() {
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

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
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
        extras.push(docSnap.id);
      }
    });

    console.log(`Extra records to delete: ${extras.length}`);

    let deleted = 0;
    for (const id of extras) {
      await deleteDoc(doc(db, 'projects', id));
      deleted++;
      if (deleted % 100 === 0) {
        console.log(`  Deleted ${deleted}/${extras.length}`);
      }
    }

    console.log(`✅ Delete complete. Deleted: ${deleted}`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

deleteExtras();

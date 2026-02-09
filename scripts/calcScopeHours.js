const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function calc() {
  const jobKey = 'Ames Construction, Inc.~2508 - GI~Giant #6582';
  const scopeTitle = '53,281 Sq Ft. - 4" Interior Slab on Grade';

  const snap = await getDocs(collection(db, 'projects'));
  const items = [];

  snap.docs.forEach((doc) => {
    const data = doc.data();
    const customer = data.customer || '';
    const projectNumber = data.projectNumber || '';
    const projectName = data.projectName || '';
    const itemJobKey = data.jobKey || `${customer}~${projectNumber}~${projectName}`;

    if (itemJobKey !== jobKey) return;

    const costType = (data.costType || '').toLowerCase();
    if (costType.includes('management')) return;

    items.push({
      costitems: (data.costitems || '').toLowerCase(),
      hours: typeof data.hours === 'number' ? data.hours : 0,
      costType: data.costType || '',
    });
  });

  const titleLower = scopeTitle.toLowerCase();
  const titleWithoutQty = titleLower
    .replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf)?\s*[-–]\s*/i, '')
    .trim();

  const matched = items.filter(
    (item) => item.costitems.includes(titleWithoutQty) || titleWithoutQty.includes(item.costitems)
  );

  const totalHours = matched.reduce((sum, item) => sum + item.hours, 0);

  console.log(`Scope: ${scopeTitle}`);
  console.log(`JobKey: ${jobKey}`);
  console.log(`Matched items: ${matched.length}`);
  matched.forEach((item) => {
    console.log(`- ${item.costitems} | ${item.costType} | ${item.hours}`);
  });
  console.log(`Total hours (excluding Management): ${totalHours}`);
}

calc().catch((error) => {
  console.error(error);
  process.exit(1);
});

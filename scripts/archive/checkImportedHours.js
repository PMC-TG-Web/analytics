const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function checkImport() {
  const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
  let totalHours = 0;
  let scopesWithHours = 0;
  
  scopesSnapshot.docs.forEach(doc => {
    const data = doc.data();
    const hours = typeof data.hours === 'number' ? data.hours : 0;
    if (hours > 0) scopesWithHours++;
    totalHours += hours;
  });
  
  console.log(`Total scopes: ${scopesSnapshot.docs.length}`);
  console.log(`Scopes with hours > 0: ${scopesWithHours}`);
  console.log(`Total hours: ${totalHours.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  
  process.exit(0);
}

checkImport().catch(e => {
  console.error(e);
  process.exit(1);
});

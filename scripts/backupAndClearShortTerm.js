const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function backupAndClearShortTerm() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const collectionName = 'short term schedual';

  try {
    console.log(`Fetching all documents from ${collectionName}...`);
    const querySnapshot = await getDocs(collection(db, collectionName));
    console.log(`Found ${querySnapshot.size} documents.`);

    const backup = querySnapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    }));

    const backupDir = path.join(__dirname, 'backups');
    const backupFile = path.join(backupDir, `short-term-schedual-${getTimestamp()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`Backup saved to ${backupFile}`);

    if (querySnapshot.size === 0) {
      console.log('No documents to delete.');
      process.exit(0);
    }

    console.log('Deleting documents...');
    let count = 0;
    for (const docSnap of querySnapshot.docs) {
      await deleteDoc(docSnap.ref);
      count += 1;
      if (count % 10 === 0) {
        console.log(`Deleted ${count} documents...`);
      }
    }

    console.log(`\nDone. Deleted ${count} documents from ${collectionName}.`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

backupAndClearShortTerm();

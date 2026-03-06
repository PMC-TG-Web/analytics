const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, setDoc } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function fixJobKeys() {
  try {
    const snapshot = await getDocs(collection(db, 'long term schedual'));
    
    let fixed = 0;
    let errors = 0;
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const oldJobKey = data.jobKey;
      
      if (!oldJobKey) continue;
      
      // Convert pipe format to tilde format
      if (oldJobKey.includes('|')) {
        const newJobKey = oldJobKey.replace(/\|/g, '~');
        
        console.log(`Fixing: "${oldJobKey}" → "${newJobKey}"`);
        
        // Update the document
        await setDoc(doc(db, 'long term schedual', docSnap.id), {
          ...data,
          jobKey: newJobKey,
        });
        fixed++;
      }
    }
    
    console.log(`\n✅ Fixed ${fixed} documents with pipe format jobKeys`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

fixJobKeys();

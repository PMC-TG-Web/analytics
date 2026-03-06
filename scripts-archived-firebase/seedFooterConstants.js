const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, getDocs, query, where, updateDoc, serverTimestamp } = require('firebase/firestore');
const firebaseConfig = require('../src/firebaseConfig.json');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const footerConstants = [
  { name: 'Ends', value: 2, category: 'footer' },
  { name: 'Concrete Waste', value: 10, category: 'footer' },
  { name: 'Corner Dowels', value: 1, category: 'footer' },
  { name: 'Pier Dowels', value: 2, category: 'footer' },
  { name: 'Rebar Stick Length', value: 20, category: 'footer' }
];

async function seedFooterConstants() {
  console.log('Seeding footer constants...');
  const collectionRef = collection(db, 'estimatingConstants');
  
  for (const constant of footerConstants) {
    const q = query(collectionRef, where('name', '==', constant.name));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      await addDoc(collectionRef, {
        ...constant,
        updatedAt: serverTimestamp()
      });
      console.log(`Added: ${constant.name}`);
    } else {
      const docRef = querySnapshot.docs[0].ref;
      await updateDoc(docRef, {
        value: constant.value,
        updatedAt: serverTimestamp()
      });
      console.log(`Updated: ${constant.name}`);
    }
  }
  console.log('Seeding complete!');
  process.exit();
}

seedFooterConstants().catch(console.error);

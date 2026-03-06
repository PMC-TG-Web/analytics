const {initializeApp}=require('firebase/app');
const {getFirestore,collection,getDocs}=require('firebase/firestore');
const config=require('./src/firebaseConfig.json');

initializeApp(config);
const db=getFirestore();

(async()=>{
  const scopes=await getDocs(collection(db,'projectScopes'));
  let total=0;
  let count=0;
  
  scopes.docs.forEach(d=>{
    const h=d.data().hours||0;
    if(h>0)count++;
    total+=h;
  });
  
  console.log('Total scopes:', scopes.docs.length);
  console.log('Scopes with hours:', count);
  console.log('Total hours:', Math.round(total));
  
  process.exit(0);
})();

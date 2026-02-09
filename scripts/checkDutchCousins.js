const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = require('../src/firebaseConfig.json');
initializeApp(firebaseConfig);
const db = getFirestore();

async function check() {
  try {
    console.log("Checking Dutch Cousins Campground...\n");

    const jobKey = "J.E. Horst Building and Remodeling~2510 - DCC~Dutch Cousins Campground";
    
    // Check scopes
    const scopesSnapshot = await getDocs(collection(db, "projectScopes"));
    const dutchScopes = [];
    scopesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.jobKey === jobKey) {
        dutchScopes.push({
          id: doc.id,
          title: data.title,
          startDate: data.startDate,
          endDate: data.endDate,
          manpower: data.manpower
        });
      }
    });
    
    console.log(`Found ${dutchScopes.length} scopes for Dutch Cousins:`);
    dutchScopes.forEach(scope => {
      console.log(`  - ${scope.title}`);
      console.log(`    Start: ${scope.startDate || 'not set'}`);
      console.log(`    End: ${scope.endDate || 'not set'}`);
    });
    
    // Check short term schedule
    const shortSnapshot = await getDocs(collection(db, "short term schedual"));
    let foundShort = false;
    shortSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.jobKey === jobKey) {
        foundShort = true;
        console.log(`\n✅ Found in SHORT TERM SCHEDULE (${data.month}):`);
        console.log(`  Customer: ${data.customer}`);
        console.log(`  Project Number: ${data.projectNumber}`);
        console.log(`  Project Name: ${data.projectName}`);
        console.log(`  Weeks: ${data.weeks?.length || 0}`);
        if (data.weeks && data.weeks.length > 0) {
          data.weeks.forEach(week => {
            console.log(`    Week ${week.weekNumber}: ${week.days?.length || 0} days scheduled`);
          });
        }
      }
    });
    
    if (!foundShort) {
      console.log("\n❌ NOT found in short term schedule");
    }
    
    // Check long term schedule
    const longSnapshot = await getDocs(collection(db, "long term schedual"));
    let foundLong = false;
    longSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.jobKey === jobKey) {
        foundLong = true;
        console.log(`\n✅ Found in LONG TERM SCHEDULE (${data.month}):`);
        console.log(`  Customer: ${data.customer}`);
        console.log(`  Project Number: ${data.projectNumber}`);
        console.log(`  Project Name: ${data.projectName}`);
        console.log(`  Weeks: ${data.weeks?.length || 0}`);
        console.log(`  Total Hours: ${data.totalHours || 0}`);
        if (data.weeks && data.weeks.length > 0) {
          data.weeks.forEach(week => {
            console.log(`    Week ${week.weekNumber}: ${week.hours || 0} hours`);
          });
        }
      }
    });
    
    if (!foundLong) {
      console.log("\n❌ NOT found in long term schedule");
    }
    
    if (!foundShort && !foundLong) {
      console.log("\n⚠️ PROBLEM: Dutch Cousins has scopes but NO schedule entries!");
      console.log("This is why the project won't appear on the Gantt chart.");
    }

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

check();

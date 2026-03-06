/**
 * cleanupGenericScopes.js
 * 
 * Removes all scopes with title "Scope" or "Scheduled Work" from:
 * - projectScopes collection
 * - scopeTracking collection
 * - activeSchedule entries referencing these scopes
 */

const admin = require('firebase-admin');
const serviceAccount = require('../src/firebaseConfig.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function cleanupGenericScopes() {
  try {
    console.log('🧹 Starting cleanup of generic scopes...\n');

    // Find all scopes with title "Scope" or "Scheduled Work"
    const scopesSnapshot = await db.collection('projectScopes').get();
    const genericScopes = scopesSnapshot.docs.filter(doc => {
      const title = doc.data().title || '';
      return title === 'Scope' || title === 'Scheduled Work';
    });

    console.log(`Found ${genericScopes.length} generic scopes to delete\n`);

    if (genericScopes.length === 0) {
      console.log('✅ No generic scopes found. Cleanup complete.');
      return;
    }

    // Collect scope info for clean up
    const scopesToDelete = genericScopes.map(doc => ({
      id: doc.id,
      jobKey: doc.data().jobKey,
      scopeOfWork: doc.data().title,
      title: doc.data().title
    }));

    // Delete from projectScopes
    console.log('Deleting from projectScopes collection...');
    for (const scope of scopesToDelete) {
      await db.collection('projectScopes').doc(scope.id).delete();
      console.log(`  ✓ Deleted scope: ${scope.title} (${scope.jobKey})`);
    }

    // Delete corresponding scopeTracking entries
    console.log('\nDeleting from scopeTracking collection...');
    for (const scope of scopesToDelete) {
      const trackingId = `${scope.jobKey.replace(/[\/\\#?]/g, '_')}_${scope.scopeOfWork.replace(/[\/\\#?]/g, '_')}`;
      const trackingDoc = await db.collection('scopeTracking').doc(trackingId).get();
      if (trackingDoc.exists) {
        await db.collection('scopeTracking').doc(trackingId).delete();
        console.log(`  ✓ Deleted tracking: ${scope.jobKey} - ${scope.scopeOfWork}`);
      }
    }

    // Delete activeSchedule entries referencing these scopes
    console.log('\nDeleting activeSchedule entries...');
    let activeScheduleDeleted = 0;
    for (const scope of scopesToDelete) {
      const activeScheduleQuery = await db.collection('activeSchedule')
        .where('jobKey', '==', scope.jobKey)
        .where('scopeOfWork', '==', scope.scopeOfWork)
        .get();
      
      for (const doc of activeScheduleQuery.docs) {
        await doc.ref.delete();
        activeScheduleDeleted++;
      }
      console.log(`  ✓ Deleted ${activeScheduleQuery.size} activeSchedule entries for ${scope.jobKey}`);
    }

    console.log(`\n✅ Cleanup complete!`);
    console.log(`   - Deleted ${scopesToDelete.length} projectScopes`);
    console.log(`   - Deleted scopeTracking entries`);
    console.log(`   - Deleted ${activeScheduleDeleted} activeSchedule entries`);

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupGenericScopes().then(() => {
  process.exit(0);
});

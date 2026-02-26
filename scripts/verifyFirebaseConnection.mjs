/**
 * Safe Firebase Data Verification
 * 
 * This script safely verifies Firebase data without making destructive changes.
 * It uses pagination and delays to avoid rate limiting.
 * 
 * Usage: node scripts/verifyFirebaseConnection.mjs
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
  './serviceAccountKey.json';

let db;
try {
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'pmcdatabasefirebase-sch'
  });
  db = admin.firestore();
  console.log('✓ Firebase Admin SDK initialized\n');
} catch (error) {
  console.error('Failed to load service account. Using default credentials...');
  admin.initializeApp({
    projectId: 'pmcdatabasefirebase-sch'
  });
  db = admin.firestore();
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function countCollection(collectionName, pageSize = 100) {
  let count = 0;
  let query = db.collection(collectionName).limit(pageSize);
  let page = 0;

  while (true) {
    page++;
    try {
      const snapshot = await query.get();
      
      if (snapshot.empty) break;
      
      count += snapshot.size;
      const lastDoc = snapshot.docs[snapshot.docs.length - 1];
      query = db.collection(collectionName).startAfter(lastDoc).limit(pageSize);
      
      await delay(100);
      
    } catch (error) {
      console.error(`  Error counting ${collectionName}:`, error.message);
      break;
    }
  }
  
  return count;
}

async function verifyConnection() {
  console.log('═══════════════════════════════════════');
  console.log('Firebase Connection Verification');
  console.log('═══════════════════════════════════════\n');

  try {
    // Test 1: Read a single document
    console.log('Test 1: Reading dashboard summary...');
    const summaryDoc = await db.collection('metadata').doc('dashboard_summary').get();
    if (summaryDoc.exists) {
      const data = summaryDoc.data();
      console.log('✓ Dashboard summary found');
      console.log(`  Last updated: ${data.lastUpdated}`);
      console.log(`  Total sales: $${(data.totalSales || 0).toLocaleString()}`);
      console.log(`  Status groups: ${Object.keys(data.statusGroups || {}).length}`);
      console.log(`  Contractors: ${Object.keys(data.contractors || {}).length}\n`);
    } else {
      console.log('⚠ Dashboard summary does NOT exist');
      console.log('  This is expected if bootstrap has not been run yet\n');
    }

    // Test 2: Count collections
    console.log('Test 2: Counting documents in collections...');
    
    const collections = [
      'projects',
      'short term schedual',
      'long term schedual',
      'activeSchedule',
      'employees',
      'announcements',
      'metadata'
    ];

    for (const collName of collections) {
      console.log(`  Counting ${collName}...`);
      try {
        const count = await countCollection(collName, 50);
        console.log(`  ✓ ${collName}: ${count} documents`);
      } catch (error) {
        console.log(`  ✗ ${collName}: Error - ${error.message}`);
      }
      await delay(200);
    }
    console.log('');

    // Test 3: Sample data
    console.log('Test 3: Sampling first project document...');
    const projectsSnapshot = await db.collection('projects').limit(1).get();
    if (!projectsSnapshot.empty) {
      const sampleProject = projectsSnapshot.docs[0].data();
      console.log('✓ Found sample project:');
      console.log(`  Name: ${sampleProject.projectName}`);
      console.log(`  Number: ${sampleProject.projectNumber}`);
      console.log(`  Customer: ${sampleProject.customer}`);
      console.log(`  Status: ${sampleProject.status}`);
      console.log(`  Sales: $${(sampleProject.sales || 0).toLocaleString()}`);
      console.log(`  Hours: ${(sampleProject.hours || 0).toLocaleString()}\n`);
    } else {
      console.log('⚠ No projects found\n');
    }

    // Test 4: Check for scheduling data
    console.log('Test 4: Checking scheduling data...');
    const shortTermCount = await countCollection('short term schedual', 50);
    const longTermCount = await countCollection('long term schedual', 50);
    console.log(`  Short term schedule entries: ${shortTermCount}`);
    console.log(`  Long term schedule entries: ${longTermCount}\n`);

    console.log('═══════════════════════════════════════');
    console.log('✓ Verification complete');
    console.log('═══════════════════════════════════════');
    
    process.exit(0);

  } catch (error) {
    console.error('\n✗ Verification FAILED');
    console.error('Error:', error.message);
    
    if (error.code === 'PERMISSION_DENIED' || error.code === 'UNAUTHENTICATED') {
      console.error('\nThe Firebase project may still be suspended.');
      console.error('Check the Google Cloud Console for status.');
    }
    
    process.exit(1);
  }
}

verifyConnection().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

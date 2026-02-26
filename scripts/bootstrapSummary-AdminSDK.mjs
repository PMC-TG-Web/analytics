/**
 * Bootstrap Summary - Optimized with Admin SDK
 * 
 * This is a simpler aggregation that runs faster than bootstrapCorrect.
 * Use this for quick updates.
 * 
 * Key improvements:
 * - Uses Firebase Admin SDK (faster)
 * - Implements pagination
 * - Adds delays between batches
 * - Better logging and error handling
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Initialize with service account
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
  console.log('✓ Firebase Admin SDK initialized');
} catch (error) {
  console.error('Failed to load service account. Using default credentials...');
  admin.initializeApp({
    projectId: 'pmcdatabasefirebase-sch'
  });
  db = admin.firestore();
}

// Utility: Delay between operations
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function readProjectsWithPagination() {
  console.log('Reading projects with pagination...');
  const allProjects = [];
  const pageSize = 100;
  let query = db.collection('projects').limit(pageSize);
  let pageNum = 0;

  while (true) {
    pageNum++;
    
    try {
      const snapshot = await query.get();
      
      if (snapshot.empty) {
        console.log(`  Page ${pageNum}: Collection complete`);
        break;
      }

      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      allProjects.push(...docs);
      console.log(`  Page ${pageNum}: ${docs.length} documents (total: ${allProjects.length})`);

      const lastDoc = snapshot.docs[snapshot.docs.length - 1];
      query = db.collection('projects').startAfter(lastDoc).limit(pageSize);

      // Delay between pages
      await delay(500);
      
    } catch (error) {
      console.error(`Error on page ${pageNum}:`, error.message);
      await delay(2000);
    }
  }

  console.log(`✓ Read ${allProjects.length} projects\n`);
  return allProjects;
}

async function bootstrap() {
  const startTime = Date.now();
  
  try {
    console.log('═══════════════════════════════════════');
    console.log('Bootstrap Summary - Admin SDK Version');
    console.log('═══════════════════════════════════════\n');

    // Read all projects
    const snapshot = await readProjectsWithPagination();

    const summary = {
      totalSales: 0,
      totalCost: 0,
      totalHours: 0,
      statusGroups: {},
      contractors: {},
      pmcGroupHours: {},
      laborBreakdown: {},
      lastUpdated: new Date().toISOString()
    };

    console.log('Aggregating data...');
    let processedCount = 0;

    snapshot.forEach(projectDoc => {
      const data = projectDoc;
      
      const projectName = (data.projectName || '').toString().toLowerCase();
      const customer = (data.customer || '').toString().trim();
      const customerLower = customer.toLowerCase();
      const estimator = (data.estimator || '').toString().trim().toLowerCase();
      const projectNumber = (data.projectNumber || '').toString().toLowerCase();

      // Dashboard exclusion logic
      const isExcluded = 
        data.projectArchived === true ||
        data.status === 'Invitations' ||
        customerLower.includes('sop inc') ||
        ['pmc operations', 'pmc shop time', 'pmc test project'].includes(projectName) ||
        projectName.includes('sandbox') ||
        projectName.includes('raymond king') ||
        projectName === 'alexander drive addition latest' ||
        estimator === 'todd gilmore' ||
        projectNumber === '701 poplar church rd';

      if (isExcluded) return;

      processedCount++;

      const sales = Number(data.sales) || 0;
      const cost = Number(data.cost) || 0;
      const hours = Number(data.hours) || 0;
      const status = data.status || 'Unknown';

      summary.totalSales += sales;
      summary.totalCost += cost;
      summary.totalHours += hours;

      // Status groups
      if (!summary.statusGroups[status]) {
        summary.statusGroups[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
      }
      summary.statusGroups[status].sales += sales;
      summary.statusGroups[status].cost += cost;
      summary.statusGroups[status].hours += hours;
      summary.statusGroups[status].count += 1;

      // Contractors
      if (!summary.contractors[customer]) {
        summary.contractors[customer] = { sales: 0, cost: 0, hours: 0, count: 0, byStatus: {} };
      }
      const c = summary.contractors[customer];
      c.sales += sales;
      c.cost += cost;
      c.hours += hours;
      c.count += 1;
      
      if (!c.byStatus[status]) {
        c.byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
      }
      c.byStatus[status].sales += sales;
      c.byStatus[status].cost += cost;
      c.byStatus[status].hours += hours;
      c.byStatus[status].count += 1;

      // PMC Group Hours
      const pmcGroup = (data.pmcGroup || '').toString().trim();
      if (pmcGroup) {
        const norm = pmcGroup.toLowerCase();
        if (status === 'Bid Submitted' || norm.startsWith('pm')) {
          summary.pmcGroupHours[pmcGroup] = (summary.pmcGroupHours[pmcGroup] || 0) + hours;
        }
        if (status === 'Bid Submitted') {
          summary.laborBreakdown[pmcGroup] = (summary.laborBreakdown[pmcGroup] || 0) + hours;
        }
      }
    });

    console.log(`✓ Processed ${processedCount} projects\n`);
    
    console.log('Summary:');
    console.log(`  Sales: $${summary.totalSales.toLocaleString()}`);
    console.log(`  Cost: $${summary.totalCost.toLocaleString()}`);
    console.log(`  Hours: ${summary.totalHours.toLocaleString()}`);
    console.log(`  Status Groups: ${Object.keys(summary.statusGroups).length}`);
    console.log(`  Contractors: ${Object.keys(summary.contractors).length}\n`);

    // Write to Firestore with retry
    console.log('Writing summary to Firestore...');
    let retries = 3;
    while (retries > 0) {
      try {
        await db.collection('metadata').doc('dashboard_summary').set(summary);
        console.log('✓ Successfully created dashboard_summary document\n');
        break;
      } catch (error) {
        retries--;
        if (retries > 0) {
          console.log(`Write failed, retrying... (${retries} attempts left)`);
          await delay(2000);
        } else {
          throw error;
        }
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log('═══════════════════════════════════════');
    console.log(`✓ Bootstrap completed in ${elapsed}s`);
    console.log('═══════════════════════════════════════');
    
    process.exit(0);
    
  } catch (err) {
    console.error('\n✗ Bootstrap FAILED:');
    console.error(err.message);
    if (err.code) console.error(`Code: ${err.code}`);
    process.exit(1);
  }
}

bootstrap().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

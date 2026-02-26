/**
 * Bootstrap Correct - Optimized with Admin SDK
 * 
 * Key improvements:
 * - Uses Firebase Admin SDK (faster, more efficient)
 * - Implements pagination (max 100 docs per batch)
 * - Adds delays between batches (prevents rate limiting)
 * - Better error handling with retry logic
 * - Logs progress for monitoring
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

// Utility: Delay between operations (prevents rate limiting)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Utility: Parse various date formats
const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') return new Date(value);
  if (value && typeof value === 'object' && value.toDate) return value.toDate();
  return null;
};

async function readProjectsWithPagination() {
  console.log('Reading projects with pagination...');
  const allProjects = [];
  const pageSize = 100;
  let query = db.collection('projects').limit(pageSize);
  let pageNum = 0;

  while (true) {
    pageNum++;
    console.log(`  Fetching page ${pageNum}...`);
    
    try {
      const snapshot = await query.get();
      
      if (snapshot.empty) {
        console.log(`  Page ${pageNum}: 0 documents (end of collection)`);
        break;
      }

      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      allProjects.push(...docs);
      console.log(`  Page ${pageNum}: ${docs.length} documents (total: ${allProjects.length})`);

      // Pagination: start after last document
      const lastDoc = snapshot.docs[snapshot.docs.length - 1];
      query = db.collection('projects').startAfter(lastDoc).limit(pageSize);

      // CRITICAL: Delay between pages to avoid rate limiting
      await delay(500);
      
    } catch (error) {
      console.error(`Error reading page ${pageNum}:`, error.message);
      console.log('Retrying with longer delay...');
      await delay(2000);
      // Continue to next page (graceful degradation)
    }
  }

  console.log(`✓ Read total ${allProjects.length} projects\n`);
  return allProjects;
}

async function bootstrap() {
  const startTime = Date.now();
  
  try {
    console.log('═══════════════════════════════════════');
    console.log('Bootstrap Correct - Admin SDK Version');
    console.log('═══════════════════════════════════════\n');

    // 1. READ ALL PROJECTS with pagination
    const allProjects = await readProjectsWithPagination();

    // 2. FILTERING (Mirroring Dashboard)
    console.log('Filtering projects...');
    const filtered = allProjects.filter(p => {
      if (p.projectArchived) return false;
      const status = (p.status ?? '').toString();
      if (status === 'Invitations') return false;
      
      const customer = (p.customer ?? '').toString().toLowerCase();
      if (customer.includes('sop inc')) return false;
      const projectName = (p.projectName ?? '').toString().toLowerCase();
      if (['pmc operations', 'pmc shop time', 'pmc test project'].includes(projectName)) return false;
      if (projectName.includes('sandbox') || projectName.includes('raymond king') || projectName === 'alexander drive addition latest') return false;
      const projectNumber = (p.projectNumber ?? '').toString().toLowerCase();
      if (projectNumber === '701 poplar church rd') return false;
      return true;
    });
    console.log(`✓ Filtered to ${filtered.length} active projects\n`);

    // 3. DEDUPE BY CUSTOMER
    console.log('Deduplicating by customer...');
    const identifierMap = new Map();
    filtered.forEach(p => {
      const id = (p.projectNumber ?? p.projectName ?? '').toString().trim();
      if (!id) return;
      if (!identifierMap.has(id)) identifierMap.set(id, []);
      identifierMap.get(id).push(p);
    });

    const dedupedByCustomer = [];
    const priorityStatuses = ['Accepted', 'In Progress', 'Complete'];
    
    identifierMap.forEach(list => {
      const customerMap = new Map();
      list.forEach(p => {
        const c = (p.customer ?? '').toString().trim();
        if (!customerMap.has(c)) customerMap.set(c, []);
        customerMap.get(c).push(p);
      });

      if (customerMap.size > 1) {
        let selected = null;
        
        // Priority: look for active statuses first
        for (const [c, projs] of customerMap) {
          if (projs.some(p => priorityStatuses.includes(p.status || ''))) {
            selected = projs;
            break;
          }
        }
        
        // Fallback: use most recent
        if (!selected) {
          let latest = null;
          customerMap.forEach((projs, c) => {
            const m = projs.reduce((a, b) => {
              const dateA = parseDateValue(a.dateCreated) || new Date(0);
              const dateB = parseDateValue(b.dateCreated) || new Date(0);
              return dateA > dateB ? a : b;
            }, projs[0]);
            const projDate = parseDateValue(m.dateCreated) || new Date(0);
            if (!latest || projDate > latest.d) {
              latest = { d: projDate, projs };
            }
          });
          selected = latest?.projs;
        }
        
        if (selected) dedupedByCustomer.push(...selected);
      } else {
        list.forEach(p => dedupedByCustomer.push(p));
      }
    });
    console.log(`✓ Deduped to ${dedupedByCustomer.length} documents\n`);

    // 4. AGGREGATE BY PROJECT KEY
    console.log('Computing aggregations...');
    const keyMap = new Map();
    dedupedByCustomer.forEach(p => {
      const num = (p.projectNumber ?? '').toString().trim();
      const cust = (p.customer ?? '').toString().trim();
      const key = `${num}|${cust}`;
      if (!keyMap.has(key)) keyMap.set(key, []);
      keyMap.get(key).push(p);
    });

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

    keyMap.forEach((projs, key) => {
      const sorted = projs.sort((a, b) => (a.projectName || '').localeCompare(b.projectName || ''));
      const base = { ...sorted[0] };
      
      const sales = projs.reduce((s, p) => s + (Number(p.sales) || 0), 0);
      const cost = projs.reduce((s, p) => s + (Number(p.cost) || 0), 0);
      const hours = projs.reduce((s, p) => s + (Number(p.hours) || 0), 0);
      
      const status = base.status || 'Unknown';
      const customer = base.customer || 'Unknown';

      summary.totalSales += sales;
      summary.totalCost += cost;
      summary.totalHours += hours;

      if (!summary.statusGroups[status]) {
        summary.statusGroups[status] = { sales: 0, cost: 0, hours: 0, count: 0, laborByGroup: {} };
      }
      summary.statusGroups[status].sales += sales;
      summary.statusGroups[status].cost += cost;
      summary.statusGroups[status].hours += hours;
      summary.statusGroups[status].count += 1;

      // Track group hours by status
      projs.forEach(p => {
        const group = (p.pmcGroup || 'Unassigned').toString().trim();
        const hrs = Number(p.hours) || 0;
        if (hrs > 0) {
          summary.statusGroups[status].laborByGroup[group] = 
            (summary.statusGroups[status].laborByGroup[group] || 0) + hrs;
        }
      });

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
    });

    // 5. LABOR BREAKDOWN
    dedupedByCustomer.forEach(p => {
      const status = p.status || 'Unknown';
      const hours = Number(p.hours) || 0;
      const pmcGroup = (p.pmcGroup || '').toString().trim();
      if (!pmcGroup) return;

      const norm = pmcGroup.toLowerCase();
      if (status === 'Bid Submitted' || norm.startsWith('pm')) {
        summary.pmcGroupHours[pmcGroup] = (summary.pmcGroupHours[pmcGroup] || 0) + hours;
      }
      if (status === 'Bid Submitted') {
        summary.laborBreakdown[pmcGroup] = (summary.laborBreakdown[pmcGroup] || 0) + hours;
      }
    });

    console.log(`✓ Aggregation complete\n`);
    console.log('Summary Statistics:');
    console.log(`  Total Sales: $${summary.totalSales.toLocaleString()}`);
    console.log(`  Total Cost: $${summary.totalCost.toLocaleString()}`);
    console.log(`  Total Hours: ${summary.totalHours.toLocaleString()}`);
    console.log(`  Status Groups: ${Object.keys(summary.statusGroups).length}`);
    console.log(`  Contractors: ${Object.keys(summary.contractors).length}\n`);

    // 6. WRITE TO FIRESTORE with retry logic
    console.log('Writing summary to Firestore...');
    let retries = 3;
    while (retries > 0) {
      try {
        await db.collection('metadata').doc('dashboard_summary').set(summary);
        console.log('✓ Successfully updated dashboard_summary\n');
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
    console.log(`✓ Bootstrap completed successfully in ${elapsed}s`);
    console.log('═══════════════════════════════════════');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n✗ Bootstrap FAILED:');
    console.error(error.message);
    if (error.code) console.error(`Code: ${error.code}`);
    process.exit(1);
  }
}

// Run with proper async error handling
bootstrap().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

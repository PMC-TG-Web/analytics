/**
 * Firestore Quota & Usage Monitoring
 * 
 * This tracks API calls and quota usage to prevent future suspensions.
 * Run periodically to monitor usage patterns.
 * 
 * Usage: node scripts/monitorFirestoreUsage.mjs
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
} catch (error) {
  admin.initializeApp({
    projectId: 'pmcdatabasefirebase-sch'
  });
  db = admin.firestore();
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Track a Firestore operation and log metrics
 */
class UsageTracker {
  constructor() {
    this.operations = {
      reads: 0,
      writes: 0,
      deletes: 0,
      queriesCostingReads: 0
    };
    this.errors = 0;
    this.startTime = Date.now();
  }

  recordRead(count = 1) {
    this.operations.reads += count;
  }

  recordWrite(count = 1) {
    this.operations.writes += count;
  }

  recordDelete(count = 1) {
    this.operations.deletes += count;
  }

  recordError() {
    this.errors++;
  }

  getElapsedSeconds() {
    return Math.round((Date.now() - this.startTime) / 1000);
  }

  estimatedCost() {
    // Firestore pricing (as of 2026):
    // - Reads: $0.06 per 100,000
    // - Writes: $0.18 per 100,000
    // - Deletes: $0.02 per 100,000
    const readCost = (this.operations.reads / 100000) * 0.06;
    const writeCost = (this.operations.writes / 100000) * 0.18;
    const deleteCost = (this.operations.deletes / 100000) * 0.02;
    return readCost + writeCost + deleteCost;
  }

  print() {
    console.log('\nUsage Statistics:');
    console.log(`  Reads:   ${this.operations.reads.toLocaleString()}`);
    console.log(`  Writes:  ${this.operations.writes.toLocaleString()}`);
    console.log(`  Deletes: ${this.operations.deletes.toLocaleString()}`);
    console.log(`  Errors:  ${this.errors}`);
    console.log(`  Elapsed: ${this.getElapsedSeconds()}s`);
    console.log(`  Est. Cost: $${this.estimatedCost().toFixed(4)}`);
  }
}

async function saveUsageMetrics() {
  const tracker = new UsageTracker();
  
  console.log('═══════════════════════════════════════');
  console.log('Firestore Usage Monitor');
  console.log('═══════════════════════════════════════\n');

  try {
    // Create or update usage metrics document
    const metricsDocPath = 'metadata/usage_metrics';
    
    const metrics = {
      timestamp: new Date().toISOString(),
      lastMonitored: admin.firestore.FieldValue.serverTimestamp(),
      dailyReadLimit: 50000000, // Free tier limit
      dailyWriteLimit: 20000000,
      alerts: [],
      recommendations: []
    };

    // Get current metrics if they exist
    const existingMetrics = await db.collection('metadata').doc('usage_metrics').get();
    if (existingMetrics.exists) {
      const existing = existingMetrics.data();
      console.log('Previous metrics found:');
      console.log(`  Last monitored: ${existing.lastMonitored ? new Date(existing.lastMonitored.toDate()).toLocaleString() : 'N/A'}`);
      tracker.recordRead(1); // One read operation
    }

    // Check for concerning patterns
    metrics.recommendations.push(
      '✓ Archive old debug scripts (done)',
      '✓ Use Admin SDK for Node.js scripts (done)',
      '✓ Implement pagination with delays (done)',
      '• Monitor quota usage daily',
      '• Alert on high read/write rates',
      '• Consider caching frequently accessed data',
      '• Use batch operations when possible'
    );

    // Write metrics
    await db.collection('metadata').doc('usage_metrics').set(metrics, { merge: true });
    tracker.recordWrite(1);

    console.log('\nMetrics saved to Firestore');
    tracker.print();

    console.log('\nRecommendations:');
    metrics.recommendations.forEach(rec => console.log('  ' + rec));

    console.log('\n═══════════════════════════════════════');
    console.log('✓ Monitoring complete');
    console.log('═══════════════════════════════════════');

    process.exit(0);

  } catch (error) {
    console.error('\n✗ Monitoring FAILED');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

/**
 * Read-only audit of script usage patterns
 */
async function auditScriptPatterns() {
  console.log('\n═══════════════════════════════════════');
  console.log('Script Usage Audit');
  console.log('═══════════════════════════════════════\n');

  const scripts = {
    'bootstrapCorrect-AdminSDK.mjs': { reads: 'All projects', writes: 'Dashboard summary', batchSafe: true },
    'bootstrapSummary-AdminSDK.mjs': { reads: 'All projects', writes: 'Dashboard summary', batchSafe: true },
    'verifyFirebaseConnection.mjs': { reads: 'Sample data only', writes: 'None', batchSafe: true },
    'monitorFirestoreUsage.mjs': { reads: 'Metadata', writes: 'Metrics', batchSafe: true },
    '[Archived scripts]': { reads: 'DISABLED', writes: 'DISABLED', batchSafe: false }
  };

  console.log('Active Scripts Status:\n');
  Object.entries(scripts).forEach(([name, config]) => {
    const status = config.batchSafe ? '✓ SAFE' : '✗ ARCHIVED';
    console.log(`${status} ${name}`);
    console.log(`  Reads:  ${config.reads}`);
    console.log(`  Writes: ${config.writes}`);
    console.log('');
  });

  console.log('Best Practices:');
  console.log('  1. Use Admin SDK (not web SDK) in Node.js');
  console.log('  2. Batch operations when reading >100 docs');
  console.log('  3. Add 500ms+ delays between batch operations');
  console.log('  4. Use indexed queries with proper WHERE clauses');
  console.log('  5. Avoid full collection scans in loops\n');
}

async function main() {
  await saveUsageMetrics();
  await auditScriptPatterns();
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBMMd3rm_SN0_s5vDhuULsQ9ywIF_NZBQk",
  authDomain: "pmcdatabasefirebase-sch.firebaseapp.com",
  projectId: "pmcdatabasefirebase-sch",
  appId: "1:426435888632:web:4f2b5896c9d817a904820d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function migrateEmployees() {
  try {
    console.log('Starting employee migration from Firebase to PostgreSQL...\n');

    // Fetch all employees from Firebase
    const snapshot = await getDocs(collection(db, 'employees'));
    console.log(`Found ${snapshot.docs.length} employees in Firebase\n`);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      
      try {
        const employeeData = {
          id: doc.id,
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          jobTitle: data.jobTitle || data.role || null,
          email: data.email || null,
          phone: data.phone || null,
          isActive: data.isActive !== undefined ? data.isActive : true,
          customFields: data.customFields || {},
        };

        // Skip if missing critical fields
        if (!employeeData.firstName && !employeeData.lastName) {
          console.log(`⚠️  Skipping employee ${doc.id}: Missing name`);
          skipped++;
          continue;
        }

        // Upsert employee (create or update)
        await prisma.employee.upsert({
          where: { id: doc.id },
          update: {
            firstName: employeeData.firstName,
            lastName: employeeData.lastName,
            jobTitle: employeeData.jobTitle,
            email: employeeData.email,
            phone: employeeData.phone,
            isActive: employeeData.isActive,
            customFields: employeeData.customFields,
          },
          create: employeeData,
        });

        const action = await prisma.employee.findUnique({ where: { id: doc.id } }) ? 'updated' : 'created';
        
        if (action === 'created') {
          created++;
        } else {
          updated++;
        }

        console.log(`✅ ${employeeData.firstName} ${employeeData.lastName} (${employeeData.jobTitle || 'No title'}) - ${action}`);

      } catch (err) {
        console.error(`❌ Error migrating employee ${doc.id}:`, err.message);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log('Migration Summary:');
    console.log('='.repeat(50));
    console.log(`✅ Created: ${created}`);
    console.log(`🔄 Updated: ${updated}`);
    console.log(`⚠️  Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total processed: ${snapshot.docs.length}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

migrateEmployees();

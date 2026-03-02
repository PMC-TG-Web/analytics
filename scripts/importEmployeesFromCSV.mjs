import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

async function importEmployees() {
  try {
    console.log('Importing employees from CSV...\n');

    // Read and parse CSV
    const csvContent = readFileSync('c:\\Users\\ToddGilmore\\Downloads\\Company Directory (2).csv', 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    console.log(`Found ${records.length} employees in CSV\n`);

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const record of records) {
      try {
        // Clean phone numbers (remove formatting)
        const cleanPhone = (phone) => {
          if (!phone) return null;
          return phone.replace(/[\s()-+]/g, '');
        };

        // Clean email - ensure empty emails are null, not empty string
        const cleanEmail = (email) => {
          if (!email || email.trim() === '') return null;
          return email.trim();
        };

        const employeeData = {
          id: record.Id || `emp_${Date.now()}_${Math.random()}`,
          firstName: record.FirstName || '',
          lastName: record.LastName || '',
          jobTitle: record['Job Title'] || null,
          email: cleanEmail(record.WorkEmail || record.Other_Email),
          phone: cleanPhone(record.EmployeePhone || record.WorkPhone),
          isActive: true,
          customFields: {
            country: record.Country,
            address: record.Address,
            city: record.City,
            state: record.State,
            zip: record.Zip,
            workPhone: record.WorkPhone,
            employeePhone: record.EmployeePhone,
            otherEmail: record.Other_Email,
          }
        };

        // Skip if missing both first and last name
        if (!employeeData.firstName && !employeeData.lastName) {
          console.log(`⚠️  Skipping record: Missing name`);
          continue;
        }

        // Upsert employee
        await prisma.employee.upsert({
          where: { id: employeeData.id },
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

        // Check if it was an update or create
        const existing = await prisma.employee.count({
          where: { id: employeeData.id }
        });

        if (existing > 0) {
          updated++;
        } else {
          created++;
        }

        const displayName = `${employeeData.firstName} ${employeeData.lastName}`.trim();
        const displayTitle = employeeData.jobTitle || 'No title';
        console.log(`✅ ${displayName} (${displayTitle})`);

      } catch (err) {
        console.error(`❌ Error importing ${record.FirstName} ${record.LastName}:`, err.message);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Import Summary:');
    console.log('='.repeat(60));
    console.log(`✅ Successfully imported: ${created + updated}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Total processed: ${records.length}`);
    console.log('='.repeat(60));

    // Show sample of imported employees
    console.log('\nVerifying import - Sample employees:');
    const sample = await prisma.employee.findMany({
      take: 5,
      orderBy: { lastName: 'asc' }
    });
    
    sample.forEach(emp => {
      console.log(`  - ${emp.firstName} ${emp.lastName} (${emp.jobTitle || 'No title'})`);
    });

  } catch (error) {
    console.error('Import failed:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

importEmployees();

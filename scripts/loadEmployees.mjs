import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: path.join(__dirname, '..', '.env.local') });

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.PRISMA_DATABASE_URL ||
    '';
}

const prisma = new PrismaClient();

async function loadEmployees() {
  try {
    const csvPath = path.join(__dirname, '..', 'Company Directory (2).csv');
    
    console.log('Reading employee CSV file...');
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    console.log(`Found ${records.length} employee records\n`);
    
    // Preview first record
    if (records.length > 0) {
      console.log('Sample record:', records[0]);
      console.log('');
    }
    
    let created = 0;
    let updated = 0;
    let skipped = 0;
    
    for (const record of records) {
      const firstName = record.FirstName?.trim();
      const lastName = record.LastName?.trim();
      const jobTitle = record['Job Title']?.trim() || null;
      
      // Skip if no name
      if (!firstName || !lastName) {
        console.log(`⚠️  Skipping record with missing name: ${JSON.stringify(record)}`);
        skipped++;
        continue;
      }
      
      // Use WorkEmail as primary, fallback to Other_Email
      const email = record.WorkEmail?.trim() || record.Other_Email?.trim() || null;
      
      // Use WorkPhone as primary, fallback to EmployeePhone
      const phone = record.WorkPhone?.trim() || record.EmployeePhone?.trim() || null;
      
      // Store additional data in customFields
      const customFields = {
        procoreId: record.Id,
        country: record.Country,
        address: record.Address,
        city: record.City,
        state: record.State,
        zip: record.Zip,
        workPhone: record.WorkPhone,
        employeePhone: record.EmployeePhone,
        workEmail: record.WorkEmail,
        otherEmail: record.Other_Email
      };
      
      try {
        // Try to find existing employee by email or name
        let existingEmployee = null;
        
        if (email) {
          existingEmployee = await prisma.employee.findUnique({
            where: { email }
          });
        }
        
        if (!existingEmployee) {
          existingEmployee = await prisma.employee.findFirst({
            where: {
              firstName,
              lastName
            }
          });
        }
        
        if (existingEmployee) {
          // Update existing employee
          await prisma.employee.update({
            where: { id: existingEmployee.id },
            data: {
              firstName,
              lastName,
              jobTitle,
              email,
              phone,
              customFields
            }
          });
          console.log(`✅ Updated: ${firstName} ${lastName} (${jobTitle || 'No title'})`);
          updated++;
        } else {
          // Create new employee
          await prisma.employee.create({
            data: {
              firstName,
              lastName,
              jobTitle,
              email,
              phone,
              isActive: true,
              customFields
            }
          });
          console.log(`✨ Created: ${firstName} ${lastName} (${jobTitle || 'No title'})`);
          created++;
        }
      } catch (error) {
        console.error(`❌ Error processing ${firstName} ${lastName}:`, error.message);
        skipped++;
      }
    }
    
    console.log(`\n=== Import Summary ===`);
    console.log(`Created: ${created}`);
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Total: ${records.length}`);
    
    // Display current employee count
    const totalEmployees = await prisma.employee.count();
    const activeEmployees = await prisma.employee.count({
      where: { isActive: true }
    });
    
    console.log(`\n=== Database Status ===`);
    console.log(`Total Employees: ${totalEmployees}`);
    console.log(`Active Employees: ${activeEmployees}`);
    
    // Show job title breakdown
    const jobTitles = await prisma.employee.groupBy({
      by: ['jobTitle'],
      _count: true,
      where: { isActive: true }
    });
    
    console.log(`\n=== Job Titles ===`);
    jobTitles
      .sort((a, b) => b._count - a._count)
      .forEach(jt => {
        console.log(`${jt.jobTitle || '(No title)'}: ${jt._count}`);
      });
    
  } catch (error) {
    console.error('Error loading employees:', error);
  } finally {
    await prisma.$disconnect();
  }
}

loadEmployees();

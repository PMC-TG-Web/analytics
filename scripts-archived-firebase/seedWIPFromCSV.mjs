import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

async function seedWIPFromCSV() {
  try {
    console.log('Starting WIP CSV seed...');
    
    // Read CSV file
    const csvPath = path.join(__dirname, '..', 'scripts', 'WIP2.csv');
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    
    // Parse CSV manually to handle quoted columns correctly
    const lines = fileContent.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    console.log('CSV Headers:', headers);
    
    const records = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Parse CSV line handling quoted values
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim().replace(/"/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim().replace(/"/g, ''));
      
      const record = {};
      headers.forEach((header, idx) => {
        record[header] = values[idx] || '';
      });
      records.push(record);
    }
    
    console.log(`Loaded ${records.length} records from WIP2.csv`);
    
    // Get all projects for matching
    const allProjects = await prisma.project.findMany({
      select: {
        customer: true,
        projectName: true,
        projectNumber: true,
        hours: true,
        sales: true,
        status: true,
        id: true
      }
    });
    
    console.log(`Found ${allProjects.length} projects in database`);
    
    let schedulesCreated = 0;
    let allocationsCreated = 0;
    const monthMap = {
      '1': '01', '2': '02', '3': '03', '4': '04',
      '5': '05', '6': '06', '7': '07', '8': '08',
      '9': '09', '10': '10', '11': '11', '12': '12'
    };
    
    // Process each CSV record
    for (const record of records) {
      const csvCustomer = record.Customer?.trim() || '';
      const csvProjectName = record.Projectname?.trim() || '';
      const csvMonth = record.WIPMonth?.trim() || '';
      const csvPercent = parseFloat(record['%InMonth']?.replace('%', '') || '0');
      
      if (!csvCustomer || !csvProjectName || !csvMonth || csvPercent <= 0) {
        console.log(`Skipping invalid record: ${csvCustomer} / ${csvProjectName}`);
        continue;
      }
      
      // Parse month from MM/DD/YYYY format
      const [month, day, year] = csvMonth.split('/');
      const monthStr = monthMap[month] || month.padStart(2, '0');
      const yearStr = year;
      const monthKey = `${yearStr}-${monthStr}`;
      
      // Find matching project, or use default hours
      let totalHours = 1000; // Default estimate
      const matchedProject = allProjects.find(p => 
        p.customer?.toLowerCase() === csvCustomer.toLowerCase() &&
        p.projectName?.toLowerCase() === csvProjectName.toLowerCase()
      );
      
      if (matchedProject) {
        totalHours = matchedProject.hours || 1000;
        console.log(`Matched project: ${csvCustomer} / ${csvProjectName} (${totalHours} hours)`);
      } else {
        console.log(`No exact match for: ${csvCustomer} / ${csvProjectName}, using default ${totalHours} hours`);
      }
      
      // Calculate hours from percentage
      const allocatedHours = (totalHours * csvPercent) / 100;
      
      // Create or update schedule
      let schedule = await prisma.schedule.findFirst({
        where: {
          customer: csvCustomer,
          projectName: csvProjectName
        }
      });
      
      if (!schedule) {
        schedule = await prisma.schedule.create({
          data: {
            jobKey: `${csvCustomer}~UNKNOWN~${csvProjectName}`,
            customer: csvCustomer,
            projectName: csvProjectName,
            projectNumber: 'UNKNOWN',
            status: 'In Progress',
            totalHours: totalHours
          }
        });
        schedulesCreated++;
        console.log(`Created schedule: ${schedule.jobKey}`);
      } else {
        console.log(`Using existing schedule: ${schedule.jobKey}`);
      }
      
      // Create allocation if not already exists
      const existingAlloc = await prisma.scheduleAllocation.findFirst({
        where: {
          scheduleId: schedule.id,
          period: monthKey
        }
      });
      
      if (!existingAlloc) {
        const allocation = await prisma.scheduleAllocation.create({
          data: {
            scheduleId: schedule.id,
            period: monthKey,
            periodType: 'month',
            hours: allocatedHours,
            percent: csvPercent
          }
        });
        allocationsCreated++;
      }
    }
    
    console.log(`\n✅ Seed complete!`);
    console.log(`Schedules created: ${schedulesCreated}`);
    console.log(`Allocations created: ${allocationsCreated}`);
    
    // Verify
    const scheduleCount = await prisma.schedule.count();
    const allocationCount = await prisma.scheduleAllocation.count();
    console.log(`\nDatabase now has:`);
    console.log(`  - ${scheduleCount} total schedules`);
    console.log(`  - ${allocationCount} total allocations`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error during seed:', error);
    process.exit(1);
  }
}

seedWIPFromCSV();

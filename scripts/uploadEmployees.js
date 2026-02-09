const { initializeApp } = require('firebase/app');
const { getFirestore, collection, doc, setDoc } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

// Initialize Firebase
const firebaseConfig = require('../src/firebaseConfig.json');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Role mapping - map CSV titles to standardized roles
function mapRole(jobTitle) {
  const title = jobTitle.toLowerCase();
  
  if (title.includes('president') || title.includes('vice president')) return 'Executive';
  if (title.includes('partner')) return 'Executive';
  if (title.includes('project manager')) return 'Project Manager';
  if (title.includes('estimator')) return 'Estimator';
  if (title.includes('foreman') || title.includes('forman')) return 'Foreman';
  if (title.includes('superintendent')) return 'Superintendent';
  if (title.includes('controller') || title.includes('hr manager') || title.includes('office')) return 'Office Staff';
  if (title.includes('mechanic') || title.includes('shop')) return 'Office Staff';
  if (title.includes('laborer') || title.includes('right hand') || title.includes('driver') || title.includes('operator')) return 'Field Worker';
  
  return 'Other';
}

function formatPhone(phone) {
  if (!phone) return '';
  
  // Remove all non-numeric characters first
  let cleaned = phone.replace(/\D/g, '');
  
  if (!cleaned) return '';
  
  // Remove leading 1 (country code)
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    cleaned = cleaned.slice(1);
  }
  
  // Format as XXX-XXX-XXXX for 10 digit numbers
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  
  // For other lengths, just return the cleaned numbers
  return cleaned;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

async function uploadEmployees() {
  try {
    // Read the CSV file from Downloads folder
    const csvPath = 'C:\\Users\\ToddGilmore\\Downloads\\Company Directory (1).csv';
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    
    // Split by newlines but handle multi-line records
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    console.log('Starting employee upload...\n');
    
    let successCount = 0;
    let errorCount = 0;
    
    // Process each line (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Parse CSV line properly
      const fields = parseCSVLine(line);
      if (fields.length < 5) continue;
      
      const id = fields[0];
      const firstName = fields[1];
      const lastName = fields[2];
      const company = fields[3];
      const jobTitle = fields[4] || '';
      const businessPhone = fields[5] || '';
      const mobilePhone = fields[6] || '';
      const email = fields[7] || '';
      
      if (!firstName || !lastName) continue;
      
      const role = mapRole(jobTitle);
      const phone = formatPhone(mobilePhone || businessPhone);
      const employeeId = `emp_procore_${id}`;
      const now = new Date().toISOString();
      
      const employeeData = {
        id: employeeId,
        firstName: firstName,
        lastName: lastName,
        email: email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@pmcdecor.com`,
        phone: phone,
        role: role,
        department: company === 'Paradise Masonry, LLC' ? 'Paradise Masonry' : company,
        hourlyRate: 0,
        isActive: true,
        hireDate: '',
        notes: `Original Job Title: ${jobTitle}\nProcore ID: ${id}${businessPhone ? `\nBusiness Phone: ${businessPhone}` : ''}${mobilePhone ? `\nMobile Phone: ${mobilePhone}` : ''}`,
        procoreId: id,
        createdAt: now,
        updatedAt: now,
      };
      
      try {
        await setDoc(doc(db, 'employees', employeeId), employeeData);
        console.log(`✓ Added: ${firstName} ${lastName} - ${jobTitle}`);
        successCount++;
      } catch (error) {
        console.error(`✗ Error adding ${firstName} ${lastName}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`Upload Complete!`);
    console.log(`  Success: ${successCount} employees`);
    console.log(`  Errors: ${errorCount} employees`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Error uploading employees:', error);
  } finally {
    process.exit(0);
  }
}

uploadEmployees();

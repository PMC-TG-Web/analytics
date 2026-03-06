import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

function normalizePhone(phone) {
  if (!phone) return null;
  
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');
  
  // Remove leading 1 if it's 11 digits (US country code)
  if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.substring(1);
  }
  
  // Format as (XXX) XXX-XXXX if 10 digits
  if (digits.length === 10) {
    return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
  }
  
  // Return as-is if not 10 digits
  return digits || null;
}

async function normalizePhoneNumbers() {
  try {
    console.log('Normalizing phone numbers...\n');
    
    const employees = await prisma.employee.findMany({
      where: {
        isActive: true
      }
    });
    
    let updated = 0;
    
    for (const employee of employees) {
      const originalPhone = employee.phone;
      const normalizedPhone = normalizePhone(originalPhone);
      
      // Also normalize phones in customFields
      let customFields = employee.customFields;
      let customFieldsUpdated = false;
      
      if (customFields && typeof customFields === 'object') {
        const normalizedWorkPhone = normalizePhone(customFields.workPhone);
        const normalizedEmployeePhone = normalizePhone(customFields.employeePhone);
        
        if (normalizedWorkPhone !== customFields.workPhone || 
            normalizedEmployeePhone !== customFields.employeePhone) {
          customFields = {
            ...customFields,
            workPhone: normalizedWorkPhone,
            employeePhone: normalizedEmployeePhone
          };
          customFieldsUpdated = true;
        }
      }
      
      // Update if phone changed or customFields changed
      if (normalizedPhone !== originalPhone || customFieldsUpdated) {
        await prisma.employee.update({
          where: { id: employee.id },
          data: {
            phone: normalizedPhone,
            ...(customFieldsUpdated ? { customFields } : {})
          }
        });
        
        console.log(`✅ ${employee.firstName} ${employee.lastName}`);
        if (originalPhone !== normalizedPhone) {
          console.log(`   Phone: ${originalPhone || '(none)'} → ${normalizedPhone || '(none)'}`);
        }
        if (customFieldsUpdated) {
          console.log(`   CustomFields: Updated work/employee phones`);
        }
        updated++;
      }
    }
    
    console.log(`\n=== Summary ===`);
    console.log(`Total employees: ${employees.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`No changes: ${employees.length - updated}`);
    
    // Show some examples
    console.log(`\n=== Sample Phone Numbers ===`);
    const sample = await prisma.employee.findMany({
      where: {
        phone: { not: null }
      },
      select: {
        firstName: true,
        lastName: true,
        phone: true
      },
      take: 5
    });
    
    sample.forEach(emp => {
      console.log(`${emp.firstName} ${emp.lastName}: ${emp.phone}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

normalizePhoneNumbers();

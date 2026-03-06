import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

async function updatePMCMappings() {
  try {
    console.log('Reading PMCGrouping.csv...');
    const csvContent = fs.readFileSync('PMCGrouping.csv', 'utf8');
    
    // Parse CSV with proper handling of quoted fields
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    console.log(`Found ${records.length} cost item mappings`);

    // Get unique PMC groups
    const pmcGroups = new Set();
    records.forEach(record => {
      if (record.PMCGroup) {
        pmcGroups.add(record.PMCGroup.trim());
      }
    });

    console.log('\nUnique PMC Groups found:');
    const sortedGroups = Array.from(pmcGroups).sort();
    sortedGroups.forEach((group, i) => {
      console.log(`${i + 1}. ${group}`);
    });

    console.log('\n--- Sample Mappings ---');
    records.slice(0, 10).forEach(r => {
      console.log(`${r.CostItem} -> ${r.PMCGroup}`);
    });

    // Clear existing mappings
    console.log('\nClearing existing PMC mappings...');
    await prisma.costitemPMCMapping.deleteMany({});

    // Get or create PMC groups
    console.log('Ensuring PMC groups exist...');
    const pmcGroupMap = {};
    
    for (const groupName of sortedGroups) {
      const code = groupName.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
      
      // Upsert: update if exists, create if not
      const group = await prisma.pMCGroup.upsert({
        where: { code },
        update: {
          name: groupName
        },
        create: {
          code,
          name: groupName,
          color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0'),
          displayOrder: sortedGroups.indexOf(groupName) + 1
        }
      });
      
      console.log(`  ${group.id ? 'Updated' : 'Created'} PMC group: ${groupName} (${code})`);
      pmcGroupMap[groupName] = group.id;
    }

    // Insert new mappings
    console.log('\nInserting cost item mappings...');
    let inserted = 0;
    let updated = 0;
    
    for (const record of records) {
      const costitem = record.CostItem?.trim();
      const pmcGroup = record.PMCGroup?.trim();
      
      if (!costitem || !pmcGroup) continue;
      
      const pmcGroupId = pmcGroupMap[pmcGroup];
      if (!pmcGroupId) {
        console.warn(`  Warning: No PMC group ID for "${pmcGroup}"`);
        continue;
      }

      // Use upsert to handle duplicates
      const mapping = await prisma.costitemPMCMapping.upsert({
        where: { costitem },
        update: { pmcGroupId },
        create: {
          costitem,
          pmcGroupId
        }
      });
      
      if (mapping) {
        inserted++;
        if (inserted % 100 === 0) {
          console.log(`  Processed ${inserted} mappings...`);
        }
      }
    }

    console.log(`\n✓ Successfully processed ${inserted} PMC mappings`);
    console.log('\nNext step: Re-run the project import to apply new PMC groups.');

  } catch (error) {
    console.error('Error updating PMC mappings:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updatePMCMappings();

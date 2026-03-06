/**
 * PMC Groups and Mappings Seed Script
 * 
 * Populates the database with:
 * 1. PMCGroup entries (9 major categories)
 * 2. CostitemPMCMapping entries (all 1,702+ unique Costitems)
 * 
 * Usage: node scripts/seedPMCGroups.mjs
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { loadPMCConfig, mapCostitemToPMC, clearMappingCache } from '../utils/pmcGrouping.mjs';

const prisma = new PrismaClient();

// ==================== INITIALIZATION ====================

async function main() {
  console.log('🚀 Starting PMC Groups and Mappings Seed...\n');
  
  try {
    // Load configuration
    const config = loadPMCConfig();
    console.log(`✓ Loaded PMC configuration with ${config.pmcGroups.length} groups\n`);
    
    // Step 1: Create PMC Groups
    console.log('📦 Step 1: Creating PMC Groups...');
    const pmcGroupIds = await seedPMCGroups(config.pmcGroups);
    console.log(`✓ Created ${Object.keys(pmcGroupIds).length} PMC groups\n`);
    
    // Step 2: Extract all unique Costitems from CSV
    console.log('📊 Step 2: Extracting unique Costitems from CSV...');
    const allCostitems = await extractAllCostitems();
    console.log(`✓ Found ${allCostitems.length} unique Costitems\n`);
    
    // Step 3: Create Costitem-PMC Mappings
    console.log('🔗 Step 3: Creating Costitem-PMC Mappings...');
    const mappings = await seedCostitemMappings(allCostitems, pmcGroupIds);
    console.log(`✓ Created ${mappings.created} new mappings`);
    console.log(`✓ Updated ${mappings.updated} existing mappings\n`);
    
    // Step 4: Distribution analysis
    console.log('📈 Step 4: Mapping Distribution Analysis...');
    await analyzeDistribution(allCostitems);
    
    console.log('\n✅ PMC Seeding completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// ==================== PMC GROUPS SEEDING ====================

async function seedPMCGroups(pmcGroups) {
  const pmcGroupIds = {};
  
  for (const group of pmcGroups) {
    try {
      const created = await prisma.pMCGroup.upsert({
        where: { code: group.code },
        update: {
          name: group.name,
          description: group.description,
          color: group.color,
          displayOrder: group.displayOrder,
          isActive: true
        },
        create: {
          code: group.code,
          name: group.name,
          description: group.description,
          color: group.color,
          displayOrder: group.displayOrder,
          isActive: true
        }
      });
      
      pmcGroupIds[group.code] = created.id;
      console.log(`  ✓ ${group.code}: ${group.name}`);
      
    } catch (error) {
      console.error(`  ✗ Failed to create/update ${group.code}:`, error.message);
    }
  }
  
  return pmcGroupIds;
}

// ==================== COSTITEM EXTRACTION ====================

async function extractAllCostitems() {
  const costitems = new Set();
  
  try {
    const csvPath = path.join(process.cwd(), 'ProjectFilePrisma.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf8');
    
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true
    });
    
    for (const record of records) {
      if (record.Costitems && record.Costitems.trim()) {
        costitems.add(record.Costitems.trim());
      }
    }
    
  } catch (error) {
    console.error('Error reading CSV:', error.message);
    throw error;
  }
  
  return Array.from(costitems).sort();
}

// ==================== COSTITEM MAPPING SEEDING ====================

async function seedCostitemMappings(allCostitems, pmcGroupIds) {
  let created = 0;
  let updated = 0;
  const batchSize = 500;
  
  console.log(`  Processing ${allCostitems.length} Costitems in batches of ${batchSize}...`);
  
  // Clear cache to ensure fresh mappings
  clearMappingCache();
  
  for (let i = 0; i < allCostitems.length; i += batchSize) {
    const batch = allCostitems.slice(i, i + batchSize);
    const batchLabel = `[${i + 1}-${Math.min(i + batchSize, allCostitems.length)}/${allCostitems.length}]`;
    
    for (const costitem of batch) {
      try {
        const pmcCode = mapCostitemToPMC(costitem);
        const pmcGroupId = pmcGroupIds[pmcCode] || null;
        
        const existing = await prisma.costitemPMCMapping.findUnique({
          where: { costitem }
        });
        
        if (existing) {
          // Update existing mapping
          await prisma.costitemPMCMapping.update({
            where: { costitem },
            data: {
              pmcGroupId,
              pmcGroupCode: pmcCode,
              source: 'seed'
            }
          });
          updated++;
        } else {
          // Create new mapping
          await prisma.costitemPMCMapping.create({
            data: {
              costitem,
              pmcGroupId,
              pmcGroupCode: pmcCode,
              source: 'seed'
            }
          });
          created++;
        }
        
      } catch (error) {
        console.error(`  ✗ Failed to map "${costitem}":`, error.message);
      }
    }
    
    console.log(`  ✓ Processed ${batchLabel}`);
  }
  
  return { created, updated };
}

// ==================== DISTRIBUTION ANALYSIS ====================

async function analyzeDistribution(allCostitems) {
  const distribution = {};
  
  // Clear cache first
  clearMappingCache();
  
  // Categorize all Costitems
  for (const costitem of allCostitems) {
    const pmcCode = mapCostitemToPMC(costitem);
    if (!distribution[pmcCode]) {
      distribution[pmcCode] = 0;
    }
    distribution[pmcCode] += 1;
  }
  
  // Get PMC group names
  const pmcGroups = await prisma.pMCGroup.findMany();
  const codeToName = Object.fromEntries(pmcGroups.map(g => [g.code, g.name]));
  
  // Print distribution report
  console.log('\n  Distribution of Costitems by PMC Group:');
  console.log('  ' + '='.repeat(60));
  
  const sorted = Object.entries(distribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20); // Show top 20
  
  for (const [code, count] of sorted) {
    const name = codeToName[code] || 'Unknown';
    const percentage = ((count / allCostitems.length) * 100).toFixed(1);
    console.log(`  ${code.padEnd(12)} ${name.padEnd(30)} ${count.toString().padStart(5)} (${percentage.padStart(5)}%)`);
  }
  
  console.log('  ' + '='.repeat(60));
}

// ==================== EXECUTION ====================

main().catch(error => {
  console.error(error);
  process.exit(1);
});

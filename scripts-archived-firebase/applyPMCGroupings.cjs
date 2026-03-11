/**
 * applyPMCGroupings.cjs
 * Reads PMCGrouping.csv (CostItem,CostType,PMCGroup) and for every project
 * with lineItems in customFields, sums hours by PMCGroup then writes
 * pmcBreakdown and pmcGroup back to the project.
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

function buildCostItemMap(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const map = new Map(); // normalised costItem -> pmcGroup
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Simple CSV split (no embedded commas in these fields)
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const costItem = parts[0].trim();
    const pmcGroup = parts[parts.length - 1].trim(); // last column
    if (!costItem || !pmcGroup) continue;
    map.set(costItem.toLowerCase(), pmcGroup);
  }
  return map;
}

function choosePrimaryGroup(breakdown) {
  const entries = Object.entries(breakdown);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

async function main() {
  const csvPath = path.join(__dirname, '..', 'PMCGrouping.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('PMCGrouping.csv not found at', csvPath);
    process.exit(1);
  }

  console.log('Building cost-item → PMC group map from PMCGrouping.csv...');
  const costItemMap = buildCostItemMap(csvPath);
  console.log(`  Loaded ${costItemMap.size} cost-item mappings`);

  console.log('Fetching all projects...');
  const projects = await prisma.project.findMany({
    select: { id: true, customFields: true },
  });
  console.log(`  ${projects.length} projects found`);

  let updated = 0;
  let skippedNoLineItems = 0;
  let skippedNoHours = 0;

  for (const project of projects) {
    const cf = project.customFields;
    if (!cf || typeof cf !== 'object' || Array.isArray(cf)) {
      skippedNoLineItems++;
      continue;
    }

    const lineItems = cf.lineItems;
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      skippedNoLineItems++;
      continue;
    }

    // Sum hours per PMCGroup from line items
    const breakdown = {};
    for (const item of lineItems) {
      const costItem = (item.costitems || '').toString().trim().toLowerCase();
      const hours = Number(item.hours || 0);
      if (!costItem || hours <= 0) continue;

      const pmcGroup = costItemMap.get(costItem);
      if (!pmcGroup) continue;

      breakdown[pmcGroup] = (breakdown[pmcGroup] || 0) + hours;
    }

    if (Object.keys(breakdown).length === 0) {
      skippedNoHours++;
      continue;
    }

    const primaryGroup = choosePrimaryGroup(breakdown);
    const existingCf = typeof cf === 'object' && !Array.isArray(cf) ? cf : {};

    await prisma.project.update({
      where: { id: project.id },
      data: {
        customFields: {
          ...existingCf,
          pmcGroup: breakdown,
          pmcBreakdown: breakdown,
          pmcMappingSource: 'PMCGrouping.csv',
        },
      },
    });
    updated++;

    if (updated % 50 === 0) console.log(`  ...updated ${updated} so far`);
  }

  console.log('\nDone.');
  console.log(`  Updated:            ${updated}`);
  console.log(`  Skipped (no lines): ${skippedNoLineItems}`);
  console.log(`  Skipped (no match): ${skippedNoHours}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});

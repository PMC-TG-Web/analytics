import fs from 'fs';

const filePath = 'src/app/procore/page.tsx';
const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

console.log(`File has ${lines.length} total lines\n`);

// Exact absolute line boundaries from analyzeProcorePage.mjs (1-based, inclusive)
const sections = [
  { name: 'Procore REST Command Runner', start: 7065, end: 7142 },
  { name: 'Drawings Migration Inventory', start: 7269, end: 7643 },
  { name: 'Clone Correspondences', start: 7791, end: 7922 },
  { name: 'Clone Submittals', start: 7924, end: 8098 },
  { name: 'Clone Photos', start: 8100, end: 8287 },
  { name: 'Clone Change Events', start: 8289, end: 8464 },
  { name: 'Clone Time and Material', start: 8466, end: 8628 },
  { name: 'Clone Daily Productivity and Timecards', start: 8708, end: 8969 },
  { name: 'Bid Board Project Import (Step 1)', start: 9923, end: 9996 },
  { name: 'Clone Estimate or Change Order', start: 10472, end: 10773 },
  { name: 'Clone Commitments', start: 10775, end: 11078 },
  { name: 'Clone Prime Contracts', start: 11080, end: 11291 }
];

// Extract each section (convert 1-based to 0-based array indices)
const extractedSections = {};
for (const sec of sections) {
  const startIdx = sec.start - 1;
  const endIdx = sec.end - 1;
  const content = lines.slice(startIdx, endIdx + 1).join('\n');
  extractedSections[sec.name] = {
    lines: content.split('\n'),
    lineCount: endIdx - startIdx + 1
  };
  console.log(`Extracted: ${sec.name} (lines ${sec.start}-${sec.end}, ${extractedSections[sec.name].lineCount} lines)`);
}

// Desired new order
const newOrder = [
  'Bid Board Project Import (Step 1)',
  'Clone Estimate or Change Order',
  'Clone Prime Contracts',
  'Clone Correspondences',
  'Clone Submittals',
  'Clone Change Events',
  'Clone Time and Material',
  'Clone Commitments',
  'Clone Daily Productivity and Timecards',
  'Clone Photos',
  'Drawings Migration Inventory',
  'Procore REST Command Runner'
];

console.log('\nDesired new order:');
newOrder.forEach((name, idx) => console.log(`  ${idx + 1}. ${name}`));

// Save all content to a backup
const beforeFirstSection = lines.slice(0, sections[0].start - 1);
const afterLastSection = lines.slice(sections[sections.length - 1].end);

console.log(`\nBefore first section: ${beforeFirstSection.length} lines`);
console.log(`After last section: ${afterLastSection.length} lines`);

// Build new file with reordered sections
const newLines = [];
newLines.push(...beforeFirstSection);

// Add reordered sections (but NO content between them - we'll lose the hidden sections!)
// This is the problem - I need to also include everything between visible sections
// For now, let's just reconstruct with proper spacing

for (const name of newOrder) {
  newLines.push(...extractedSections[name].lines);
  // Add blank line between sections for formatting
  if (name !== newOrder[newOrder.length - 1]) {
    newLines.push('');
  }
}

newLines.push(...afterLastSection);

console.log(`\nOriginal file: ${lines.length} lines`);
console.log(`New file: ${newLines.length} lines`);
console.log(`Difference: ${lines.length - newLines.length} lines`);

if (Math.abs(lines.length - newLines.length) > 100) {
  console.error('ERROR: Too many lines lost or gained!');
  // Calculate what we're losing
  let extracted = 0;
  for (const sec of sections) {
    extracted += sec.end - sec.start + 1;
  }
  console.error(`Extracted visible sections: ${extracted} lines`);
  console.error(`Before + After: ${beforeFirstSection.length} + ${afterLastSection.length} = ${beforeFirstSection.length + afterLastSection.length}`);
  console.error(`Total should be: ${beforeFirstSection.length + afterLastSection.length + extracted}`);
  process.exit(1);
}

// Save backup of original
fs.writeFileSync('src/app/procore/page.tsx.backup', lines.join('\n'));
console.log('\n✓ Backed up original to page.tsx.backup');

// Save new file
fs.writeFileSync('src/app/procore/page.tsx', newLines.join('\n'));
console.log('✓ Wrote reordered file to page.tsx');

console.log('\nWARNING: This reordering may have lost hidden sections between visible sections.');
console.log('Next: Run `npm run build` to check for errors.');

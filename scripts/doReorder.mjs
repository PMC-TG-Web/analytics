import fs from 'fs';

const filePath = 'src/app/procore/page.tsx';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

// All segments (visible + hidden between them)
const segments = [
  { type: 'visible', name: 'REST Command Runner', start: 7065, end: 7142 },
  { type: 'hidden', name: 'Drawing Sets Transfer', start: 7143, end: 7268 },
  { type: 'visible', name: 'Drawings Migration Inventory', start: 7269, end: 7643 },
  { type: 'hidden', name: 'Estimating Plans Probe', start: 7644, end: 7790 },
  { type: 'visible', name: 'Clone Correspondences', start: 7791, end: 7922 },
  { type: 'visible', name: 'Clone Submittals', start: 7924, end: 8098 },
  { type: 'gap', name: '', start: 8099, end: 8099 },
  { type: 'visible', name: 'Clone Photos', start: 8100, end: 8287 },
  { type: 'gap', name: '', start: 8288, end: 8288 },
  { type: 'visible', name: 'Clone Change Events', start: 8289, end: 8464 },
  { type: 'gap', name: '', start: 8465, end: 8465 },
  { type: 'visible', name: 'Clone Time and Material', start: 8466, end: 8628 },
  { type: 'hidden', name: '', start: 8629, end: 8707 },
  { type: 'visible', name: 'Clone Daily Productivity and Timecards', start: 8708, end: 8969 },
  { type: 'hidden', name: '', start: 8970, end: 9922 },
  { type: 'visible', name: 'Bid Board Project Import (Step 1)', start: 9923, end: 9996 },
  { type: 'hidden', name: '', start: 9997, end: 10471 },
  { type: 'visible', name: 'Clone Estimate or Change Order', start: 10472, end: 10773 },
  { type: 'gap', name: '', start: 10774, end: 10774 },
  { type: 'visible', name: 'Clone Commitments', start: 10775, end: 11078 },
  { type: 'gap', name: '', start: 11079, end: 11079 },
  { type: 'visible', name: 'Clone Prime Contracts', start: 11080, end: 11291 }
];

// Extract content for each segment
const extractedSegments = segments.map(seg => ({
  ...seg,
  content: lines.slice(seg.start - 1, seg.end).join('\n')
}));

console.log('Extracted all segments');

// Group visible sections with their following hidden sections
const visibleGroups = [];
let i = 0;
while (i < extractedSegments.length) {
  const seg = extractedSegments[i];
  
  if (seg.type === 'visible') {
    const group = { visible: seg, hidden: [] };
    
    // Collect any following hidden/gap sections until next visible
    i++;
    while (i < extractedSegments.length && extractedSegments[i].type !== 'visible') {
      group.hidden.push(extractedSegments[i]);
      i++;
    }
    
    visibleGroups.push(group);
  } else {
    i++;
  }
}

console.log(`Grouped ${visibleGroups.length} visible sections with their trailing hidden sections`);

// Define the new order by visible section names
const newVisibleOrder = [
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
  'REST Command Runner'
];

// Reorder the groups
const reorderedGroups = [];
for (const name of newVisibleOrder) {
  const group = visibleGroups.find(g => g.visible.name === name);
  if (!group) {
    console.error(`ERROR: Could not find section: ${name}`);
    process.exit(1);
  }
  reorderedGroups.push(group);
}

console.log('Reordered groups successfully');

// Build the new content
let reorderedLines = lines.slice(0, segments[0].start - 1); // Everything before first section

for (const group of reorderedGroups) {
  // Add visible section
  reorderedLines.push(group.visible.content);
  
  // Add trailing hidden sections
  for (const hidden of group.hidden) {
    reorderedLines.push(hidden.content);
  }
}

// Add everything after last section
reorderedLines = reorderedLines.concat(lines.slice(segments[segments.length - 1].end, lines.length));

console.log(`\nReordering complete:`);
console.log(`  Original: ${lines.length} lines`);
console.log(`  Reordered: ${reorderedLines.length} lines`);

if (Math.abs(lines.length - reorderedLines.length) > 2) {
  console.error('ERROR: Line count mismatch!');
  process.exit(1);
}

// Write the reordered file
const reorderedContent = reorderedLines.join('\n');
fs.writeFileSync('src/app/procore/page.tsx.reordered', reorderedContent);

console.log('\n✓ Reordered file saved to src/app/procore/page.tsx.reordered');
console.log('\nNew section order:');
newVisibleOrder.forEach((name, idx) => {
  console.log(`  ${idx + 1}. ${name}`);
});

import fs from 'fs';

const filePath = 'src/app/procore/page.tsx';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

// Section data (1-based, but we'll convert to 0-based for array indexing)
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

// Desired new order (indices in sections array above)
const newOrder = [8, 9, 11, 2, 3, 5, 6, 10, 7, 4, 1, 0];

// Extract sections with their preceding whitespace/hidden sections
console.log('Extracting sections with surrounding content...');

const extractedSections = [];
let prevEnd = 0;

for (let i = 0; i < sections.length; i++) {
  const section = sections[i];
  const startIdx = section.start - 1; // Convert to 0-based
  const endIdx = section.end - 1;      // Convert to 0-based
  
  // Include preceding blank lines/hidden sections
  let actualStart = prevEnd;
  if (prevEnd < startIdx) {
    // Check if there's a hidden section or just whitespace
    actualStart = prevEnd;
  }
  
  const sectionContent = lines.slice(startIdx, endIdx + 1).join('\n');
  const precedingContent = prevEnd < startIdx ? lines.slice(prevEnd, startIdx).join('\n') : '';
  
  extractedSections.push({
    ...section,
    index: i,
    sectionContent,
    precedingContent
  });
  
  prevEnd = endIdx + 1;
}

// Build the reordered content
console.log('Building reordered content...');

let reorderedLines = lines.slice(0, sections[0].start - 1); // Everything before first section

for (let i = 0; i < newOrder.length; i++) {
  const newIdx = newOrder[i];
  const section = extractedSections[newIdx];
  
  // Add preceding content (but not for the very first one)
  if (i > 0) {
    reorderedLines.push(section.precedingContent);
  }
  
  // Add section content
  reorderedLines.push(section.sectionContent);
}

// Add any trailing content after last section
const lastSection = sections[sections.length - 1];
reorderedLines = reorderedLines.concat(lines.slice(lastSection.end, lines.length));

// Write analysis
console.log('\n=== REORDERING PLAN ===\n');
console.log('Desired new order:');
newOrder.forEach((idx, pos) => {
  console.log(`${pos + 1}. ${sections[idx].name} (currently position ${idx + 1})`);
});

// Save the reordered content
const reorderedContent = reorderedLines.join('\n');

// Verify the file is valid
if (reorderedLines.length < lines.length * 0.9) {
  console.error('ERROR: Reordered content lost too many lines!');
  console.error(`Original: ${lines.length} lines, New: ${reorderedLines.length} lines`);
  process.exit(1);
}

// Save as temp file
fs.writeFileSync('src/app/procore/page.reordered.tsx', reorderedContent);
console.log('\n✓ Reordered file saved to src/app/procore/page.reordered.tsx (for review)');
console.log(`  Original lines: ${lines.length}, Reordered lines: ${reorderedLines.length}`);

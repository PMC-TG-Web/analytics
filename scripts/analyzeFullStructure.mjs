import fs from 'fs';

const filePath = 'src/app/procore/page.tsx';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

console.log(`File total lines: ${lines.length}`);

// Segments covering visible sections (lines 7065-11291) plus trailing hidden sections
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

// Find where the section block actually ends (where the last closing occurs)
let sectionBlockEnd = 11291;
for (let i = 11291; i < lines.length; i++) {
  const line = lines[i];
  if (line.trim() === '' || line.includes('{false &&')) {
    // Continue through hidden sections and gaps
    continue;
  }
  if (line.includes('</main>') || line.includes('</div>') && i > 11500) {
    // Likely end of the visible/hidden section block
    sectionBlockEnd = i;
    break;
  }
}

console.log(`Section block: lines 7065 to approximately ${sectionBlockEnd}`);

// Extract all content in the section block
const beforeSections = lines.slice(0, 7064).join('\n');
const sectionBlockContent = lines.slice(7064, sectionBlockEnd).join('\n');
const afterSections = lines.slice(sectionBlockEnd, lines.length).join('\n');

console.log(`Before sections: ${beforeSections.split('\n').length} lines`);
console.log(`Section block: ${sectionBlockContent.split('\n').length} lines`);
console.log(`After sections: ${afterSections.split('\n').length} lines`);

// Parse the section block to find visible sections only (not the full structure with hidden)
// Actually, let me take a simpler approach: extract based on visible headers

const sectionBlockLines = sectionBlockContent.split('\n');

// Find all visible section headers in the block
const visibleHeaders = [
  'Procore REST Command Runner',
  'Drawings Migration Inventory',
  'Clone Correspondences',
  'Clone Submittals',
  'Clone Photos',
  'Clone Change Events',
  'Clone Time and Material',
  'Clone Daily Productivity and Timecards',
  'Bid Board Project Import (Step 1)',
  'Clone Estimate or Change Order',
  'Clone Commitments',
  'Clone Prime Contracts'
];

// Find where each visible header appears in the block
const visibleSectionPositions = [];
for (const header of visibleHeaders) {
  for (let i = 0; i < sectionBlockLines.length; i++) {
    if (sectionBlockLines[i].includes(`<h2`) && sectionBlockLines[i].includes(header)) {
      // Find the start of this section's <div>
      for (let j = i; j >= Math.max(0, i - 20); j--) {
        if (sectionBlockLines[j].includes(`<div className="bg-white rounded-lg shadow`)) {
          visibleSectionPositions.push({
            header,
            headerLineInBlock: i,
            divStartLineInBlock: j
          });
          break;
        }
      }
      break;
    }
  }
}

console.log(`Found ${visibleSectionPositions.length} visible sections`);
visibleSectionPositions.forEach((pos, idx) => {
  console.log(`  ${idx + 1}. ${pos.header} at block line ~${pos.divStartLineInBlock}`);
});

// For a simpler and safer approach, let me just copy the file and do the multi_replace
// Save the boundaries to help guide the multi_replace operations

fs.writeFileSync('scripts/section-positions.json', JSON.stringify({
  beforeSections,
  visibleSectionPositions,
  sectionBlockStartLine: 7065,
  sectionBlockEndLine: sectionBlockEnd
}, null, 2));

console.log('\n✓ Analysis saved to scripts/section-positions.json');
console.log('\nGiven the complexity, will use a different strategy: direct multi_replace with extracted sections');

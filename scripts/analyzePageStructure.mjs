import fs from 'fs';

const filePath = 'src/app/procore/page.tsx';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

// Define what we need to extract: from the first visible section to the last
// Including all hidden sections between them

const firstVisibleStart = 7065; // REST Command Runner
const lastVisibleEnd = 11291;   // Clone Prime Contracts

// Extract the entire block (1-based converted to 0-based)
const entireBlock = lines.slice(firstVisibleStart - 1, lastVisibleEnd).join('\n');
console.log(`Extracted block size: ${entireBlock.split('\n').length} lines`);

// Now I need to find and extract individual sections from this block
// The sections are:
// 1. 7065-7142: REST Command Runner
// 2. 7143-7268: Hidden (Drawing Sets Transfer)
// 3. 7269-7643: Drawings Migration Inventory  
// 4. 7644-7790: Hidden (Estimating Plans Probe)
// 5. 7791-7922: Clone Correspondences
// ... and so on

// Let me just create a mapping of what needs to move where

// First, get all the delimiters (start/end of each section and hidden block)
const segments = [
  { type: 'visible', name: 'REST Command Runner', fileStart: 7065, fileEnd: 7142 },
  { type: 'hidden', name: 'Drawing Sets Transfer', fileStart: 7143, fileEnd: 7268 },
  { type: 'visible', name: 'Drawings Migration Inventory', fileStart: 7269, fileEnd: 7643 },
  { type: 'hidden', name: 'Estimating Plans Probe', fileStart: 7644, fileEnd: 7790 },
  { type: 'visible', name: 'Clone Correspondences', fileStart: 7791, fileEnd: 7922 },
  { type: 'visible', name: 'Clone Submittals', fileStart: 7924, fileEnd: 8098 },
  { type: 'hidden', name: '', fileStart: 8099, fileEnd: 8099 }, // Gap
  { type: 'visible', name: 'Clone Photos', fileStart: 8100, fileEnd: 8287 },
  { type: 'hidden', name: '', fileStart: 8288, fileEnd: 8288 }, // Gap
  { type: 'visible', name: 'Clone Change Events', fileStart: 8289, fileEnd: 8464 },
  { type: 'hidden', name: '', fileStart: 8465, fileEnd: 8465 }, // Gap
  { type: 'visible', name: 'Clone Time and Material', fileStart: 8466, fileEnd: 8628 },
  { type: 'hidden', name: '', fileStart: 8629, fileEnd: 8707 }, // Gap with hidden
  { type: 'visible', name: 'Clone Daily Productivity and Timecards', fileStart: 8708, fileEnd: 8969 },
  { type: 'hidden', name: '', fileStart: 8970, fileEnd: 9922 }, // Large gap with hidden sections
  { type: 'visible', name: 'Bid Board Project Import (Step 1)', fileStart: 9923, fileEnd: 9996 },
  { type: 'hidden', name: '', fileStart: 9997, fileEnd: 10471 }, // Gap
  { type: 'visible', name: 'Clone Estimate or Change Order', fileStart: 10472, fileEnd: 10773 },
  { type: 'hidden', name: '', fileStart: 10774, fileEnd: 10774 }, // Gap
  { type: 'visible', name: 'Clone Commitments', fileStart: 10775, fileEnd: 11078 },
  { type: 'hidden', name: '', fileStart: 11079, fileEnd: 11079 }, // Gap
  { type: 'visible', name: 'Clone Prime Contracts', fileStart: 11080, fileEnd: 11291 }
];

// Extract each segment
const extractedSegments = [];
for (const seg of segments) {
  const startIdx = seg.fileStart - 1;
  const endIdx = seg.fileEnd - 1;
  const content = lines.slice(startIdx, endIdx + 1).join('\n');
  
  extractedSegments.push({
    ...seg,
    content,
    lines: endIdx - startIdx + 1
  });
}

console.log(`Total extracted segments: ${extractedSegments.length}`);
console.log(`Total lines in segments: ${extractedSegments.reduce((sum, s) => sum + s.lines, 0)}`);

// Now reorder: put visible sections in new order, keeping hidden sections attached
const visibleIndices = segments.map((s, i) => s.type === 'visible' ? i : -1).filter(i => i >= 0);
console.log('Visible section indices:', visibleIndices);

const newVisibleOrder = [
  'Bid Board Project Import (Step 1)', // was position 8 (index in segments)
  'Clone Estimate or Change Order',    // was position 16
  'Clone Prime Contracts',              // was position 21
  'Clone Correspondences',              // was position 4
  'Clone Submittals',                   // was position 5
  'Clone Change Events',                // was position 9
  'Clone Time and Material',            // was position 11
  'Clone Commitments',                  // was position 18
  'Clone Daily Productivity and Timecards', // was position 13
  'Clone Photos',                       // was position 7
  'Drawings Migration Inventory',       // was position 2
  'REST Command Runner'                 // was position 0
];

console.log('\nDesired reordering:');
newVisibleOrder.forEach((name, idx) => {
  const currentPos = segments.findIndex(s => s.name === name);
  console.log(`${idx + 1}. ${name} (currently at segment ${currentPos})`);
});

// Save the analysis
fs.writeFileSync('scripts/segment-analysis.json', JSON.stringify({
  totalSegments: extractedSegments.length,
  totalLines: extractedSegments.reduce((sum, s) => sum + s.lines, 0),
  segments: extractedSegments.map(s => ({name: s.name, type: s.type, lines: s.lines}))
}, null, 2));

console.log('\n✓ Analysis saved to scripts/segment-analysis.json');

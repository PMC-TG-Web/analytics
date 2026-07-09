import fs from 'fs';

const filePath = 'src/app/procore/page.tsx';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\n');

// Section headers
const headers = [
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

const sections = [];

for (const header of headers) {
  // Find header line
  let headerLineNum = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`<h2 className=`) && lines[i].includes(header)) {
      headerLineNum = i;
      break;
    }
  }
  
  if (headerLineNum === -1) {
    console.log(`NOT FOUND: ${header}`);
    continue;
  }
  
  // Find the div opening (going backwards from header)
  let startLineNum = headerLineNum;
  for (let i = headerLineNum; i >= Math.max(0, headerLineNum - 10); i--) {
    if (lines[i].includes('<div className="bg-white rounded-lg shadow')) {
      startLineNum = i;
      break;
    }
  }
  
  // Find the section closing (going forward from header)
  // Look for the closing </div> that closes the section (should be followed by empty line or another section)
  let endLineNum = headerLineNum;
  let divCount = 0;
  let foundOpening = false;
  
  for (let i = startLineNum; i < lines.length; i++) {
    const line = lines[i];
    const openDivCount = (line.match(/<div/g) || []).length;
    const closeDivCount = (line.match(/<\/div>/g) || []).length;
    
    if (openDivCount > 0) foundOpening = true;
    
    divCount += openDivCount - closeDivCount;
    
    // When we get back to 0 divs after opening, we've closed the main section
    if (foundOpening && divCount === 0 && i > headerLineNum) {
      endLineNum = i;
      break;
    }
  }
  
  sections.push({
    header,
    startLine: startLineNum + 1, // Convert to 1-based
    endLine: endLineNum + 1,      // Convert to 1-based
    lines: endLineNum - startLineNum + 1
  });
}

console.log('SECTION BOUNDARIES (1-based line numbers):');
console.log('='.repeat(80));
sections.forEach((s, idx) => {
  console.log(`${idx + 1}. ${s.header}`);
  console.log(`   Start: ${s.startLine}, End: ${s.endLine}, Lines: ${s.lines}`);
});

// Export boundaries as JSON for use in replacement
fs.writeFileSync('scripts/section-boundaries.json', JSON.stringify(sections, null, 2));
console.log('\nBoundaries saved to scripts/section-boundaries.json');

import fs from 'fs';

const filePath = 'src/app/procore/page.tsx';
const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

console.log(`\nFile has ${lines.length} total lines\n`);

// Get the exact slice boundaries
const FIRST_VISIBLE_LINE = 7065 - 1; // Convert to 0-based
const LAST_VISIBLE_LINE = 11291; // 1-based, will be used as exclusive end

const contentBefore = lines.slice(0, FIRST_VISIBLE_LINE);
const contentBlock = lines.slice(FIRST_VISIBLE_LINE, LAST_VISIBLE_LINE);
const contentAfter = lines.slice(LAST_VISIBLE_LINE);

console.log(`Before first visible (lines 1-${FIRST_VISIBLE_LINE}): ${contentBefore.length} lines`);
console.log(`Section block (lines ${FIRST_VISIBLE_LINE + 1}-${LAST_VISIBLE_LINE}): ${contentBlock.length} lines`);
console.log(`After last visible (lines ${LAST_VISIBLE_LINE + 1}-${lines.length}): ${contentAfter.length} lines`);

const totalRecovered = contentBefore.length + contentBlock.length + contentAfter.length;
console.log(`Total recovered: ${totalRecovered} lines (original: ${lines.length})`);

if (totalRecovered !== lines.length) {
  console.error(`ERROR: Lost ${lines.length - totalRecovered} lines!`);
  process.exit(1);
}

// Now extract visible sections from the content block
const visibleSections = [
  { name: 'REST Command Runner', blockStart: 0, blockEnd: 78 },
  { name: 'Drawings Migration Inventory', blockStart: 204, blockEnd: 579 },
  { name: 'Clone Correspondences', blockStart: 726, blockEnd: 857 },
  { name: 'Clone Submittals', blockStart: 859, blockEnd: 1033 },
  { name: 'Clone Photos', blockStart: 1035, blockEnd: 1222 },
  { name: 'Clone Change Events', blockStart: 1224, blockEnd: 1399 },
  { name: 'Clone Time and Material', blockStart: 1401, blockEnd: 1563 },
  { name: 'Clone Daily Productivity and Timecards', blockStart: 1643, blockEnd: 1904 },
  { name: 'Bid Board Project Import (Step 1)', blockStart: 3858, blockEnd: 3931 },
  { name: 'Clone Estimate or Change Order', blockStart: 4407, blockEnd: 4708 },
  { name: 'Clone Commitments', blockStart: 4710, blockEnd: 5013 },
  { name: 'Clone Prime Contracts', blockStart: 5015, blockEnd: 5226 }
];

console.log('\nExtracting visible sections...');

// Extract each visible section
const extracted = {};
for (const section of visibleSections) {
  const start = section.blockStart;
  const end = section.blockEnd;
  const sectionLines = contentBlock.slice(start, end + 1);
  extracted[section.name] = sectionLines;
  console.log(`  ${section.name}: lines ${start}-${end} (${sectionLines.length} lines)`);
}

// Now I need to extract the hidden/gap sections between them
// because when I rearrange visible sections, I need to know what hidden content goes with them

// Map visible sections to their following hidden content (everything until the next visible section or end)
const sectionGroupings = [];
let currentPos = 0;

for (let i = 0; i < visibleSections.length; i++) {
  const visibleStart = visibleSections[i].blockStart;
  const visibleEnd = visibleSections[i].blockEnd;
  
  // Content before this visible section (from end of previous, or start if first)
  const precedingStart = currentPos;
  const precedingEnd = visibleStart;
  const precedingLines = contentBlock.slice(precedingStart, precedingEnd);
  
  // The visible section itself
  const visibleLines = contentBlock.slice(visibleStart, visibleEnd + 1);
  
  // Find content after this visible section until next visible section (or end)
  let followingEnd = LAST_VISIBLE_LINE - FIRST_VISIBLE_LINE - 1;
  if (i < visibleSections.length - 1) {
    followingEnd = visibleSections[i + 1].blockStart;
  }
  const followingStart = visibleEnd + 1;
  const followingLines = contentBlock.slice(followingStart, followingEnd);
  
  sectionGroupings.push({
    name: visibleSections[i].name,
    preceding: precedingLines,
    visible: visibleLines,
    following: followingLines
  });
  
  currentPos = followingEnd;
}

console.log(`\nExtracted ${sectionGroupings.length} section groupings`);

// Desired new order
const newOrder = ['Bid Board Project Import (Step 1)', 'Clone Estimate or Change Order', 'Clone Prime Contracts',
  'Clone Correspondences', 'Clone Submittals', 'Clone Change Events', 'Clone Time and Material',
  'Clone Commitments', 'Clone Daily Productivity and Timecards', 'Clone Photos',
  'Drawings Migration Inventory', 'REST Command Runner'];

console.log('\nDesired new order:');
newOrder.forEach((name, idx) => console.log(`  ${idx + 1}. ${name}`));

// Build new block
const newBlockLines = [];
for (const name of newOrder) {
  const grouping = sectionGroupings.find(g => g.name === name);
  if (!grouping) {
    console.error(`ERROR: Could not find section ${name}`);
    process.exit(1);
  }
  
  // Add preceding, visible, and following for each reordered section
  newBlockLines.push(...grouping.preceding);
  newBlockLines.push(...grouping.visible);
  newBlockLines.push(...grouping.following);
}

// Check size
console.log(`\nOriginal block: ${contentBlock.length} lines`);
console.log(`New block: ${newBlockLines.length} lines`);

if (newBlockLines.length !== contentBlock.length) {
  console.error(`ERROR: Block size mismatch! Lost ${contentBlock.length - newBlockLines.length} lines`);
  process.exit(1);
}

// Build final file
const finalLines = [...contentBefore, ...newBlockLines, ...contentAfter];

console.log(`\nFinal file: ${finalLines.length} lines`);
if (finalLines.length !== lines.length) {
  console.error(`ERROR: Final file size mismatch! Lost ${lines.length - finalLines.length} lines`);
  process.exit(1);
}

// Save
const finalContent = finalLines.join('\n');
fs.writeFileSync('src/app/procore/page.tsx', finalContent);

console.log('\n✓ Successfully reordered page.tsx!');
console.log('  - All sections moved to user-specified order');
console.log('  - All hidden sections and spacing preserved');
console.log('  - File line count verified (no content lost)');

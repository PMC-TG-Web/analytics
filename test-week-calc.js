// Test week calculation logic
const testDates = [
  '2025-02-01', // Day 1 of month - should be week 1
  '2025-02-07', // Day 7 of month - should be week 1
  '2025-02-08', // Day 8 of month - should be week 2
  '2025-02-14', // Day 14 of month - should be week 2
  '2025-02-15', // Day 15 of month - should be week 3
];

console.log('Testing week calculation using Math.ceil(dayOfMonth / 7):\n');
testDates.forEach(dateStr => {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const dayOfMonth = date.getUTCDate();
  const weekNumber = Math.ceil(dayOfMonth / 7);
  console.log(`Date: ${dateStr}, Day: ${dayOfMonth}, Week: ${weekNumber}`);
});

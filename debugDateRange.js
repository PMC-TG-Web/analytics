// Debug the 5-week date range calculation
const today = new Date('2026-02-24');
today.setHours(0, 0, 0, 0);

console.log('Today:', today.toDateString());

// Find the Monday of the current week
const currentWeekStart = new Date(today);
const dayOfWeek = currentWeekStart.getDay();
const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
console.log('Day of week (0=Sun, 1=Mon):', dayOfWeek);
console.log('Days to Monday:', daysToMonday);

currentWeekStart.setDate(currentWeekStart.getDate() + daysToMonday);
currentWeekStart.setHours(0, 0, 0, 0);

const fiveWeeksFromStart = new Date(currentWeekStart);
fiveWeeksFromStart.setDate(fiveWeeksFromStart.getDate() + (5 * 7));

console.log('\n✓ 5-Week Window:');
console.log('Start:', currentWeekStart.toDateString(), `(${currentWeekStart.toISOString().split('T')[0]})`);
console.log('End:', fiveWeeksFromStart.toDateString(), `(${fiveWeeksFromStart.toISOString().split('T')[0]})`);

// Check March overlap
const marchStart = new Date(2026, 2, 1);
const marchEnd = new Date(2026, 3, 0); // Last day of March

console.log('\n📅 March 2026:');
console.log('Start:', marchStart.toDateString());
console.log('End:', marchEnd.toDateString());

const doesntOverlap = marchEnd < currentWeekStart || marchStart >= fiveWeeksFromStart;
console.log('\nDoes March overlap with 5-week window?', !doesntOverlap);

if (doesntOverlap) {
  console.log('Reason why it doesn\'t overlap:');
  if (marchEnd < currentWeekStart) {
    console.log('  - March ends before 5-week window starts');
  }
  if (marchStart >= fiveWeeksFromStart) {
    console.log('  - March starts on or after 5-week window ends');
  }
}

// Get Mondays in March that fall within 5-week window
const monthMondays = [];
let current = new Date(marchStart);

if (current.getDay() !== 1) {
  while (current.getDay() !== 1 && current < marchEnd) {
    current.setDate(current.getDate() + 1);
  }
}

while (current <= marchEnd) {
  if (current.getMonth() === 2) { // March = month 2
    monthMondays.push(new Date(current));
  }
  current.setDate(current.getDate() + 7);
}

console.log('\n🗓️ Mondays in March:', monthMondays.map(d => d.toDateString()));

const validMondays = monthMondays.filter(d => d >= currentWeekStart && d < fiveWeeksFromStart);
console.log('Mondays within 5-week window:', validMondays.map(d => d.toDateString()));

if (validMondays.length > 0) {
  const totalHours = 531;
  const percent = 50;
  const monthHours = (totalHours * percent) / 100;
  const hoursPerWeek = monthHours / validMondays.length;
  const hoursPerDay = hoursPerWeek / 5;
  
  console.log('\n📊 Canine Partners Calculation (50% for March):');
  console.log(`Total hours: ${totalHours}`);
  console.log(`Percent: ${percent}%`);
  console.log(`Month hours: ${monthHours}`);
  console.log(`Valid Mondays in window: ${validMondays.length}`);
  console.log(`Hours per week: ${hoursPerWeek.toFixed(2)}`);
  console.log(`Hours per day: ${hoursPerDay.toFixed(2)}`);
}

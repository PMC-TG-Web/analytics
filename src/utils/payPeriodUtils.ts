/**
 * Pay Period Utilities
 * Calculates hour distribution across months based on pay periods,
 * accounting for weekdays only and excluding holidays
 */

export type PayPeriod = {
  begin: string; // MM/DD/YYYY
  end: string; // MM/DD/YYYY
  payDate: string; // MM/DD/YYYY
};

// US Federal Holidays for 2026 (add more as needed)
const HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents Day
  '2026-05-25', // Memorial Day
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-10-12', // Columbus Day
  '2026-11-11', // Veterans Day
  '2026-11-26', // Thanksgiving
  '2026-11-27', // Day after Thanksgiving
  '2026-12-25', // Christmas
];

/**
 * Parse CSV date format (M/D/YYYY) to Date object
 */
function parseCSVDate(dateStr: string): Date {
  const [month, day, year] = dateStr.split('/').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format date to YYYY-MM-DD for comparison
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a date is a weekend
 */
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

/**
 * Check if a date is a holiday
 */
function isHoliday(date: Date): boolean {
  return HOLIDAYS_2026.includes(formatDate(date));
}

/**
 * Count weekdays (excluding holidays) in a date range
 */
export function countWeekdays(startDate: Date, endDate: Date): number {
  let count = 0;
  const current = new Date(startDate);
  
  while (current <= endDate) {
    if (!isWeekend(current) && !isHoliday(current)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  
  return count;
}

/**
 * Count weekdays in a specific month within a date range
 */
export function countWeekdaysInMonth(
  yearMonth: string, // YYYY-MM format
  rangeStart: Date,
  rangeEnd: Date
): number {
  const [year, month] = yearMonth.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // Last day of month
  
  // Find the overlap between the range and the month
  const overlapStart = rangeStart > monthStart ? rangeStart : monthStart;
  const overlapEnd = rangeEnd < monthEnd ? rangeEnd : monthEnd;
  
  // No overlap
  if (overlapStart > overlapEnd) {
    return 0;
  }
  
  return countWeekdays(overlapStart, overlapEnd);
}

/**
 * Get all months covered by a date range
 */
export function getMonthsInRange(startDate: Date, endDate: Date): string[] {
  const months: string[] = [];
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  
  while (current <= end) {
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const yearMonth = `${year}-${month}`;
    
    months.push(yearMonth);
    
    current.setMonth(current.getMonth() + 1);
  }
  
  return months;
}

/**
 * Distribute hours across months based on pay period
 */
export function distributeHours(
  payPeriod: PayPeriod,
  totalHours: number
): Record<string, number> {
  const startDate = parseCSVDate(payPeriod.begin);
  const endDate = parseCSVDate(payPeriod.end);
  
  // Get total weekdays in the pay period
  const totalWeekdays = countWeekdays(startDate, endDate);
  
  if (totalWeekdays === 0) {
    return {};
  }
  
  // Get all months in the range
  const months = getMonthsInRange(startDate, endDate);
  
  // Calculate hours per month based on weekday proportion
  const distribution: Record<string, number> = {};
  
  months.forEach(month => {
    const weekdaysInMonth = countWeekdaysInMonth(month, startDate, endDate);
    const proportion = weekdaysInMonth / totalWeekdays;
    distribution[month] = Math.round(totalHours * proportion * 100) / 100; // Round to 2 decimals
  });
  
  return distribution;
}

/**
 * Load pay periods from CSV
 */
export async function loadPayPeriods(): Promise<PayPeriod[]> {
  try {
    const response = await fetch('/paydates.csv');
    const text = await response.text();
    
    const lines = text.trim().split('\n');
    const data: PayPeriod[] = [];
    
    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const [begin, end, payDate] = line.split(',');
      data.push({
        begin: begin.trim(),
        end: end.trim(),
        payDate: payDate.trim(),
      });
    }
    
    return data;
  } catch (error) {
    console.error('Error loading pay periods:', error);
    return [];
  }
}

/**
 * Format pay period for display
 */
export function formatPayPeriod(payPeriod: PayPeriod): string {
  return `${payPeriod.begin} to ${payPeriod.end} (Pay: ${payPeriod.payDate})`;
}

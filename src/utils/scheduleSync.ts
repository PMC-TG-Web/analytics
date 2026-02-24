import { collection, query, where, getDocs, doc, setDoc, getDoc, addDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { Scope } from "@/types";

interface MonthAllocation {
  month: string;
  hours: number;
}

/**
 * Recalculates the monthly WIP (allocations) for a project based on its most granular scheduling data.
 * Priority order:
 * 1. Short Term Schedule (Daily overrides/assignments)
 * 2. Project Scopes (Gantt chart)
 * 3. Long Term Schedule (Weekly overrides)
 */
export async function syncProjectWIP(jobKey: string) {
  if (!jobKey) return;

  try {
    const [customer, projectNumber, projectName] = jobKey.split("~");
    
    // 1. Fetch all scheduling data for this job
    const [scopesSnap, shortTermSnap, longTermSnap] = await Promise.all([
      getDocs(query(collection(db, "projectScopes"), where("jobKey", "==", jobKey))),
      getDocs(query(collection(db, "short term schedual"), where("jobKey", "==", jobKey))),
      getDocs(query(collection(db, "long term schedual"), where("jobKey", "==", jobKey)))
    ]);

    const monthlyHours: Record<string, number> = {};

    // 2. Process Gantt Scopes (Base layer)
    const scopes = scopesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Scope));
    scopes.forEach(scope => {
      if (!scope.startDate || !scope.endDate) return;
      
      const start = new Date(scope.startDate + 'T00:00:00');
      const end = new Date(scope.endDate + 'T00:00:00');
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

      const totalHours = scope.hours ? parseFloat(String(scope.hours)) : 0;
      if (totalHours <= 0) return;

      // Distribute hours across months
      let workDays = 0;
      let curr = new Date(start);
      while (curr <= end) {
        if (curr.getDay() !== 0 && curr.getDay() !== 6) workDays++;
        curr.setDate(curr.getDate() + 1);
      }

      if (workDays > 0) {
        const hourlyRate = totalHours / workDays;
        curr = new Date(start);
        while (curr <= end) {
          if (curr.getDay() !== 0 && curr.getDay() !== 6) {
            const monthKey = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}`;
            monthlyHours[monthKey] = (monthlyHours[monthKey] || 0) + hourlyRate;
          }
          curr.setDate(curr.getDate() + 1);
        }
      }
    });

    // 3. Apply Overrides (Short Term / Daily)
    // In this bi-lateral sync, manual overrides in Short Term take precedence
    shortTermSnap.docs.forEach(docSnap => {
      const data = docSnap.data();
      const monthKey = data.month;
      if (!monthKey) return;

      let monthTotal = 0;
      (data.weeks || []).forEach((week: any) => {
        (week.days || []).forEach((day: any) => {
          if (day.hours > 0) monthTotal += day.hours;
        });
      });

      if (monthTotal > 0) {
        monthlyHours[monthKey] = monthTotal;
      }
    });

    // 4. Update 'schedules' collection (WIP)
    const schedulesRef = collection(db, "schedules");
    const q = query(schedulesRef, where("jobKey", "==", jobKey));
    const schedSnap = await getDocs(q);
    
    let schedDocRef;
    let existingData = {};
    
    if (!schedSnap.empty) {
      schedDocRef = schedSnap.docs[0].ref;
      existingData = schedSnap.docs[0].data();
    } else {
      schedDocRef = doc(db, "schedules", jobKey.replace(/[^a-zA-Z0-9_-]/g, "_"));
    }

    // Convert monthlyHours to allocations format (Record<string, number>)
    // We keep total hours for the record
    const totalHours = Object.values(monthlyHours).reduce((sum, h) => sum + h, 0);

    await setDoc(schedDocRef, {
      ...existingData,
      jobKey,
      customer,
      projectNumber,
      projectName,
      allocations: monthlyHours,
      totalHours,
      updatedAt: new Date().toISOString(),
      syncSource: "auto-bi-lateral"
    }, { merge: true });

    console.log(`Synced WIP for ${jobKey}: ${totalHours} total hours`);

    // 5. Update 'long term schedual' collection
    // We'll aggregate weekly for the next 15 weeks
    const weeklyHours: Record<string, number> = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay();
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(currentWeekStart.getDate() + daysToMonday);

    for (let i = 0; i < 15; i++) {
        const weekStart = new Date(currentWeekStart);
        weekStart.setDate(weekStart.getDate() + (i * 7));
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekKey = weekStart.toISOString();

        let weekTotal = 0;
        // Search through all daily/Gantt data for this week
        // For simplicity, we'll use the monthlyHours distributed or re-calculate from scopes
        scopes.forEach(scope => {
            if (!scope.startDate || !scope.endDate) return;
            const start = new Date(scope.startDate + 'T00:00:00');
            const end = new Date(scope.endDate + 'T00:00:00');
            
            const overlapStart = start > weekStart ? start : weekStart;
            const overlapEnd = end < weekEnd ? end : weekEnd;

            if (overlapStart <= overlapEnd) {
                let overlapWorkDays = 0;
                let c = new Date(overlapStart);
                while (c <= overlapEnd) {
                    if (c.getDay() !== 0 && c.getDay() !== 6) overlapWorkDays++;
                    c.setDate(c.getDate() + 1);
                }
                
                const totalHours = scope.hours ? parseFloat(String(scope.hours)) : 0;
                let workDaysInRange = 0;
                let c2 = new Date(start);
                while (c2 <= end) {
                    if (c2.getDay() !== 0 && c2.getDay() !== 6) workDaysInRange++;
                    c2.setDate(c2.getDate() + 1);
                }
                
                if (workDaysInRange > 0) {
                    weekTotal += (totalHours / workDaysInRange) * overlapWorkDays;
                }
            }
        });
        if (weekTotal > 0) weeklyHours[weekKey] = weekTotal;
    }

    // Update long term docs group by month
    // This part is a bit complex as long term docs are month-based
    // For now, let's focus on WIP as the primary bi-lateral sink
  } catch (error) {
    console.error(`Error syncing WIP for ${jobKey}:`, error);
  }
}

/**
 * Updates the startDate and endDate of a project's scopes based on its short-term assignments.
 * Useful when a user drags a project to a new date in the Short Term view.
 */
export async function syncGanttWithShortTerm(jobKey: string) {
  try {
    const shortTermSnap = await getDocs(query(collection(db, "short term schedual"), where("jobKey", "==", jobKey)));
    if (shortTermSnap.empty) return;

    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    shortTermSnap.docs.forEach(docSnap => {
      const data = docSnap.data();
      const monthStr = data.month;
      if (!monthStr) return;
      
      const [year, month] = monthStr.split("-").map(Number);
      
      // Get week starts for this month
      const monthStart = new Date(year, month - 1, 1);
      while (monthStart.getDay() !== 1) monthStart.setDate(monthStart.getDate() + 1);
      const weekStarts: Date[] = [];
      let curr = new Date(monthStart);
      while (curr.getMonth() === month - 1) {
        weekStarts.push(new Date(curr));
        curr.setDate(curr.getDate() + 7);
      }

      (data.weeks || []).forEach((week: any) => {
        const weekStart = weekStarts[week.weekNumber - 1];
        if (!weekStart) return;
        
        (week.days || []).forEach((day: any) => {
          if (day.hours > 0) {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + (day.dayNumber - 1));
            
            if (!minDate || d < minDate) minDate = new Date(d);
            if (!maxDate || d > maxDate) maxDate = new Date(d);
          }
        });
      });
    });

    if (minDate && maxDate) {
      const startDate = (minDate as Date).toISOString().split('T')[0];
      const endDate = (maxDate as Date).toISOString().split('T')[0];

      const scopesSnap = await getDocs(query(collection(db, "projectScopes"), where("jobKey", "==", jobKey)));

      if (scopesSnap.empty) return;

      const scheduledScopeDoc = scopesSnap.docs.find((docSnap) => {
        const data = docSnap.data() as { title?: string };
        return (data.title || "").trim().toLowerCase() === "scheduled work";
      });

      if (!scheduledScopeDoc) return;

      await setDoc(scheduledScopeDoc.ref, { startDate, endDate }, { merge: true });
    }
  } catch (error) {
    console.error("Error syncing Gantt with ShortTerm:", error);
  }
}

interface DayData {
  dayNumber: number;
  hours: number;
  foreman?: string;
  employees?: string[];
}

interface WeekData {
  weekNumber: number;
  days: DayData[];
}

interface ScheduleDoc {
  jobKey: string;
  customer: string;
  projectNumber: string;
  projectName: string;
  month: string;
  weeks: WeekData[];
  updatedAt?: string;
}

/**
 * Updates the short-term schedule when a scope is saved with specific dates and hours
 */
export async function updateShortTermFromScope(
  jobKey: string,
  startDate: string,
  endDate: string,
  dailyHours: number,
  foremanId?: string
) {
  if (!jobKey || !startDate || !endDate || dailyHours <= 0) return;

  try {
    const [customer, projectNumber, projectName] = jobKey.split("~");
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

    // Group dates by month
    const datesByMonth: Record<string, Date[]> = {};
    let curr = new Date(start);
    
    while (curr <= end) {
      // Skip weekends
      if (curr.getDay() !== 0 && curr.getDay() !== 6) {
        const monthKey = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}`;
        if (!datesByMonth[monthKey]) datesByMonth[monthKey] = [];
        datesByMonth[monthKey].push(new Date(curr));
      }
      curr.setDate(curr.getDate() + 1);
    }


    // Update each month document
    for (const [monthKey, dates] of Object.entries(datesByMonth)) {
      const docId = `${jobKey}_${monthKey}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      const docRef = doc(db, "short term schedual", docId);
      const docSnapshot = await getDoc(docRef);
      
      let docData: ScheduleDoc;
      
      if (docSnapshot.exists()) {
        docData = docSnapshot.data() as ScheduleDoc;
      } else {
        docData = {
          jobKey,
          customer: customer || "",
          projectNumber: projectNumber || "",
          projectName: projectName || "",
          month: monthKey,
          weeks: []
        };
      }

      // Clean invalid week numbers that don't exist for this month
      const validWeekCount = getMonthWeekStarts(monthKey).length;
      if (validWeekCount > 0 && docData.weeks.length > 0) {
        docData.weeks = docData.weeks.filter(
          (week) => week.weekNumber >= 1 && week.weekNumber <= validWeekCount
        );
      }

      // Update or add days
      dates.forEach(date => {
        const position = getWeekDayPositionForDate(monthKey, date);
        if (!position) return;
        const { weekNumber, dayNumber } = position;
        
        let week = docData.weeks.find(w => w.weekNumber === weekNumber);
        if (!week) {
          week = { weekNumber, days: [] };
          docData.weeks.push(week);
        }
        
        let day = week.days.find(d => d.dayNumber === dayNumber);
        if (day) {
          day.hours = dailyHours;
          if (foremanId) day.foreman = foremanId;
        } else {
          week.days.push({
            dayNumber,
            hours: dailyHours,
            foreman: foremanId || ""
          });
        }
      });

      // Sort weeks and days for consistency
      docData.weeks.sort((a, b) => a.weekNumber - b.weekNumber);
      docData.weeks.forEach(w => w.days.sort((a, b) => a.dayNumber - b.dayNumber));

      await setDoc(docRef, { ...docData, updatedAt: new Date().toISOString() }, { merge: true });
    }
  } catch (error) {
    console.error("Error updating short-term schedule from scope:", error);
  }
}

function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + i);
    dates.push(date);
  }
  return dates;
}

function getMonthWeekStarts(monthStr: string): Date[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) return [];
  const [year, month] = monthStr.split("-").map(Number);
  const dates: Date[] = [];

  const startDate = new Date(year, month - 1, 1);
  while (startDate.getDay() !== 1) {
    startDate.setDate(startDate.getDate() + 1);
  }

  while (startDate.getMonth() === month - 1) {
    dates.push(new Date(startDate));
    startDate.setDate(startDate.getDate() + 7);
  }

  return dates;
}

function getWeekDayPositionForDate(
  monthStr: string,
  targetDate: Date
): { weekNumber: number; dayNumber: number } | null {
  const monthWeekStarts = getMonthWeekStarts(monthStr);

  for (let i = 0; i < monthWeekStarts.length; i++) {
    const weekDates = getWeekDates(monthWeekStarts[i]);
    for (let d = 0; d < weekDates.length; d++) {
      if (weekDates[d].toDateString() === targetDate.toDateString()) {
        return { weekNumber: i + 1, dayNumber: d + 1 };
      }
    }
  }

  return null;
}

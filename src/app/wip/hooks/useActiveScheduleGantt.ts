import { useState, useEffect, useCallback, useMemo } from 'react';

export interface GanttEntry {
  jobKey: string;
  projectName: string;
  customer: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  totalHours: number;
  dailyHours: Record<string, number>; // date -> hours
}

/**
 * Hook to fetch activeSchedule data and prepare for Gantt visualization
 */
export function useActiveScheduleGantt(
  startDate?: string,
  endDate?: string
) {
  const [entries, setEntries] = useState<GanttEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch activeSchedule data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(
        `/api/short-term-schedule?action=active-schedule${params.toString() ? '&' + params.toString() : ''}`,
        { credentials: 'include' }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch active schedule: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Unknown error');
      }

      // Group by jobKey and aggregate
      const grouped: Record<string, any> = {};

      for (const entry of data.data || []) {
        if (!grouped[entry.jobKey]) {
          grouped[entry.jobKey] = {
            jobKey: entry.jobKey,
            dates: new Set<string>(),
            dailyHours: {} as Record<string, number>,
            totalHours: 0,
          };
        }

        grouped[entry.jobKey].dates.add(entry.date);
        grouped[entry.jobKey].dailyHours[entry.date] = (grouped[entry.jobKey].dailyHours[entry.date] || 0) + entry.hours;
        grouped[entry.jobKey].totalHours += entry.hours;
      }

      // Transform to GanttEntry format
      const ganttEntries: GanttEntry[] = Object.values(grouped).map((g) => {
        const sortedDates = Array.from(g.dates).sort() as string[];
        return {
          jobKey: g.jobKey,
          projectName: g.jobKey.split('~')[2] || g.jobKey,
          customer: g.jobKey.split('~')[0] || '',
          startDate: sortedDates[0] || new Date().toISOString().split('T')[0],
          endDate: sortedDates[sortedDates.length - 1] || new Date().toISOString().split('T')[0],
          totalHours: g.totalHours,
          dailyHours: g.dailyHours,
        };
      });

      setEntries(ganttEntries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    entries,
    loading,
    error,
    refetch: fetchData,
  };
}

/**
 * Hook to compute Gantt timeline units and positioning
 */
export function useGanttTimeline(
  entries: GanttEntry[],
  viewMode: 'day' | 'week' | 'month' = 'week'
) {
  const units = useMemo(() => {
    if (entries.length === 0) return [];

    // Get date range
    const allDates = entries.flatMap((e) => [e.startDate, e.endDate]).sort();
    const startDate = new Date(allDates[0]);
    const endDate = new Date(allDates[allDates.length - 1]);

    const units: Array<{ key: string; label: string; date: Date }> = [];

    if (viewMode === 'day') {
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        units.push({
          key: d.toISOString().split('T')[0],
          label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          date: new Date(d),
        });
      }
    } else if (viewMode === 'week') {
      // ISO weeks
      for (
        let d = new Date(startDate);
        d <= endDate;
        d.setDate(d.getDate() + 7)
      ) {
        const weekNum = Math.ceil(
          ((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) /
            86400000 +
            1) /
            7
        );
        units.push({
          key: `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`,
          label: `W${weekNum}`,
          date: new Date(d),
        });
      }
    } else {
      // month
      for (
        let d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        d <= endDate;
        d.setMonth(d.getMonth() + 1)
      ) {
        units.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
          date: new Date(d),
        });
      }
    }

    return units;
  }, [entries, viewMode]);

  return { units };
}

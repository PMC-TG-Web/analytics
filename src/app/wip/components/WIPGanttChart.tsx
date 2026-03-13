'use client';
import React, { memo } from 'react';
import { GanttEntry } from '../hooks/useActiveScheduleGantt';

interface WIPGanttChartProps {
  entries: GanttEntry[];
  units: Array<{ key: string; label: string; date: Date }>;
  unitWidth: number;
  loading?: boolean;
}

export const WIPGanttChart = memo(function WIPGanttChart({
  entries,
  units,
  unitWidth,
  loading = false,
}: WIPGanttChartProps) {
  const getPositionInTimeline = (date: string): number => {
    const d = new Date(date);
    const firstUnitDate = units[0]?.date || new Date();
    const daysFromStart = Math.floor((d.getTime() - firstUnitDate.getTime()) / 86400000);
    return daysFromStart;
  };

  const getBarWidth = (startDate: string, endDate: string): number => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
    return Math.max(unitWidth, days * unitWidth);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500 font-semibold">Loading Gantt chart...</div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-400 font-semibold">No scheduled work found</div>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div
        className="grid border-b border-gray-200 bg-gradient-to-r from-stone-800 to-stone-900"
        style={{ gridTemplateColumns: `320px repeat(${units.length}, ${unitWidth}px)` }}
      >
        <div className="sticky left-0 z-40 px-6 py-4 text-white font-bold text-sm uppercase tracking-wider">
          Project
        </div>
        {units.map((unit) => (
          <div key={unit.key} className="px-2 py-3 text-center text-white text-xs font-bold">
            <div className="text-orange-400">{unit.label}</div>
          </div>
        ))}
      </div>

      {/* Rows */}
      <div>
        {entries.map((entry) => {
          const startPos = getPositionInTimeline(entry.startDate);
          const barWidth = getBarWidth(entry.startDate, entry.endDate);
          const marginLeft = startPos * unitWidth;

          return (
            <div
              key={entry.jobKey}
              className="grid border-b border-gray-100 hover:bg-orange-50 transition-colors"
              style={{ gridTemplateColumns: `320px repeat(${units.length}, ${unitWidth}px)` }}
            >
              {/* Project name */}
              <div className="sticky left-0 z-10 bg-white px-6 py-4 border-r border-gray-200">
                <div className="text-sm font-semibold text-gray-900 truncate" title={entry.projectName}>
                  {entry.projectName}
                </div>
                <div className="text-xs text-gray-500 truncate">{entry.customer}</div>
                <div className="mt-2 text-xs font-bold text-orange-600">{entry.totalHours.toFixed(1)} hrs</div>
              </div>

              {/* Timeline bar */}
              <div className="relative col-span-full h-16 flex items-center bg-white">
                <div
                  className="relative h-10 bg-gradient-to-r from-orange-500 to-orange-600 rounded-md shadow-md hover:shadow-lg transition-shadow flex items-center justify-center text-white text-xs font-bold cursor-pointer group"
                  style={{
                    marginLeft,
                    width: barWidth,
                    minWidth: '60px',
                  }}
                  title={`${entry.startDate} to ${entry.endDate}`}
                >
                  <span className="truncate px-2">{(entry.totalHours / 8).toFixed(1)} days</span>
                  
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-gray-900 text-white text-xs rounded px-3 py-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                    {entry.startDate} -> {entry.endDate}
                    <br />
                    {entry.totalHours.toFixed(1)} hours
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

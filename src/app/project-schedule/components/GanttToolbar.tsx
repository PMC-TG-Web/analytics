import React from "react";
import Navigation from "@/components/Navigation";
import { ViewMode } from "@/types";

interface GanttToolbarProps {
  startFilter: string;
  setStartFilter: (value: string) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

export function GanttToolbar({
  startFilter,
  setStartFilter,
  viewMode,
  setViewMode,
}: GanttToolbarProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Project Schedule</h1>
        <p className="text-gray-600 mt-1">Gantt view with day, week, and month zoom levels</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
          Start
          <input
            type="date"
            value={startFilter}
            onChange={(e) => setStartFilter(e.target.value)}
            className="px-2 py-1 border border-gray-300 rounded-md text-xs text-black"
          />
        </label>
        <div className="inline-flex rounded-md shadow-sm overflow-hidden border border-gray-200">
          {(["day", "week", "month"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
                viewMode === mode
                  ? "bg-orange-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <Navigation currentPage="project-schedule" />
      </div>
    </div>
  );
}

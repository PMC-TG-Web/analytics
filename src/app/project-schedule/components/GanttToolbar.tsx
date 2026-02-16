import React from "react";
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
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
        Start
        <input
          type="date"
          value={startFilter}
          onChange={(e) => setStartFilter(e.target.value)}
          className="px-2 py-1 border border-gray-300 rounded-md text-xs text-black shadow-sm focus:ring-1 focus:ring-orange-500 focus:border-orange-500 outline-none"
        />
      </label>
      <div className="inline-flex rounded-md shadow-sm overflow-hidden border border-gray-200">
        {(["day", "week", "month"] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={`px-3 py-2 text-[10px] font-black uppercase tracking-wider transition-colors ${
              viewMode === mode
                ? "bg-orange-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>
    </div>
  );
}

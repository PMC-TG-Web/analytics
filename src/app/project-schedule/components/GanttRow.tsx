import React, { memo } from "react";
import { GanttTask, Scope } from "@/types";

interface GanttRowProps {
  task: GanttTask & { startIndex: number; endIndex: number; outOfRange?: boolean };
  unitWidth: number;
  unitsCount: number;
  scopesByJobKey: Record<string, Scope[]>;
  expandedProjects: Record<string, boolean>;
  onToggleProject: (jobKey: string) => void;
  onOpenTask: (task: GanttTask) => void;
}

export const GanttRow = memo(function GanttRow({
  task,
  unitWidth,
  unitsCount,
  scopesByJobKey,
  expandedProjects,
  onToggleProject,
  onOpenTask,
}: GanttRowProps) {
  const isOutOfRange = Boolean(task.outOfRange);
  const left = isOutOfRange ? 0 : task.startIndex * unitWidth;
  const width = isOutOfRange ? 0 : (task.endIndex - task.startIndex + 1) * unitWidth;

  return (
    <div
      className="grid border-t border-gray-200"
      style={{ gridTemplateColumns: `260px repeat(${unitsCount}, ${unitWidth}px)` }}
    >
      <div className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-200">
        {task.type === "project" ? (
          <>
            <div className="text-sm font-semibold text-gray-900 truncate" title={task.projectName}>
              {task.projectName}
            </div>
            <div className="text-xs text-gray-500 truncate">{task.customer}</div>
            {scopesByJobKey[task.jobKey]?.length ? (
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onToggleProject(task.jobKey)}
                  className="text-[11px] font-semibold text-orange-600 hover:text-orange-700"
                >
                  {expandedProjects[task.jobKey] ? "–" : "+"}
                </button>
                <div className="text-[11px] text-gray-400">
                  {scopesByJobKey[task.jobKey].length} scope{scopesByJobKey[task.jobKey].length === 1 ? "" : "s"}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="pl-4">
            <div className="text-xs font-semibold text-gray-700 truncate" title={task.title || "Scope"}>
              {task.title || "Scope"}
            </div>
            <div className="flex gap-3 text-[11px] text-gray-400 mt-1">
              {typeof task.sales === "number" && task.sales > 0 && (
                <span>Sales: ${task.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              )}
              {typeof task.hours === "number" && task.hours > 0 && (
                <span>Hours: {task.hours.toFixed(1)}</span>
              )}
              {typeof task.manpower === "number" && (
                <span>Crew: {task.manpower}</span>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="relative col-span-full" style={{ gridColumn: `2 / span ${unitsCount}` }}>
        <div className="absolute inset-0 flex items-center">
          {isOutOfRange ? (
            <div className="text-[11px] text-gray-400 px-2">Out of range</div>
          ) : (
            <button
              type="button"
              onClick={() => onOpenTask(task)}
              className={`h-8 rounded-md text-white text-xs font-semibold px-3 shadow-sm transition-colors ${
                task.type === "project" ? "bg-orange-500 hover:bg-orange-600" : "bg-blue-500 hover:bg-blue-600"
              }`}
              style={{ marginLeft: left, width }}
            >
              {task.type === "project" ? `${task.totalHours.toFixed(1)} hrs` : task.title || "Scope"}
            </button>
          )}
        </div>
        <div className="h-12"></div>
      </div>
    </div>
  );
});

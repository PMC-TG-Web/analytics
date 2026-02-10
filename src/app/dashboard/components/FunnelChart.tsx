"use client";

import React from "react";
import { Project } from "@/types";

interface FunnelChartProps {
  statusGroups: Record<string, Project[]>;
  onStatusClick?: (status: string, projects: Project[]) => void;
}

export function FunnelChart({ statusGroups, onStatusClick }: FunnelChartProps) {
  const statuses = ["Bid Submitted", "Accepted", "In Progress", "Complete"];
  const maxCount = Math.max(...statuses.map(s => statusGroups[s]?.length || 0), 1);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Bid Submitted": return "bg-orange-500";
      case "Accepted": return "bg-blue-500";
      case "In Progress": return "bg-emerald-500";
      case "Complete": return "bg-gray-500";
      default: return "bg-gray-400";
    }
  };

  return (
    <div className="space-y-6">
      {statuses.map((status) => {
        const projects = statusGroups[status] || [];
        const count = projects.length;
        const width = (count / maxCount) * 100;
        
        return (
          <div 
            key={status} 
            className={`group cursor-pointer transition-all ${onStatusClick ? 'hover:translate-x-1' : ''}`}
            onClick={() => onStatusClick?.(status, projects)}
          >
            <div className="flex justify-between items-end mb-2">
              <span className="text-sm font-bold text-gray-700 uppercase tracking-tight">{status}</span>
              <span className="text-sm font-bold text-[#15616D]">{count} <span className="text-gray-400 font-normal">Projects</span></span>
            </div>
            <div className="h-4 bg-gray-100 rounded-full overflow-hidden border border-gray-200 shadow-inner">
              <div 
                className={`h-full transition-all duration-1000 ease-out ${getStatusColor(status)} shadow-lg`}
                style={{ width: `${Math.max(width, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import React from "react";
import { Project } from "@/types";

interface FunnelChartProps {
  statusGroups: Record<string, any>;
  onStatusClick?: (status: string, projects: Project[]) => void;
}

export function FunnelChart({ statusGroups, onStatusClick }: FunnelChartProps) {
  // Simple horizontal bar chart visualization
  const funnelStages = [
    { key: "Estimating", label: "Estimating", color: "#3b82f6" },
    { key: "Bid Submitted", label: "Bid Submitted", color: "#f59e0b" },
    { key: "Accepted", label: "Accepted", color: "#10b981" },
    { key: "In Progress", label: "In Progress", color: "#8b5cf6" },
  ];

  const totalPossible = (statusGroups["Estimating"]?.count || 0) + 
                       (statusGroups["Bid Submitted"]?.count || 0) + 
                       (statusGroups["Accepted"]?.count || 0) + 
                       (statusGroups["In Progress"]?.count || 0) || 1;

  return (
    <div style={{ background: '#ffffff', borderRadius: 12, padding: 24, border: '1px solid #ddd', marginBottom: 24 }}>
      {/* Chart Segments */}
      <div style={{ display: 'flex', height: 40, borderRadius: 20, overflow: 'hidden', backgroundColor: '#f1f5f9', marginBottom: 16 }}>
        {funnelStages.map(stage => {
          const count = statusGroups[stage.key]?.count || 0;
          const percentage = (count / totalPossible) * 100;
          return (
            <div
              key={stage.key}
              style={{
                width: `${percentage}%`,
                backgroundColor: stage.color,
                transition: 'width 0.5s ease-in-out'
              }}
              title={`${stage.label}: ${count}`}
            />
          );
        })}
      </div>

      {/* Aligned Labels with Color Dots */}
      <div style={{ display: 'flex', width: '100%' }}>
        {funnelStages.map(stage => {
          const count = statusGroups[stage.key]?.count || 0;
          const percentage = (count / totalPossible) * 100;
          return (
            <div 
              key={stage.key} 
              style={{ 
                width: `${percentage}%`, 
                textAlign: 'center', 
                cursor: 'pointer',
                minWidth: percentage > 0 ? '60px' : '0px',
                flexShrink: 0,
                flexGrow: percentage === 0 ? 1 : 0
              }} 
              onClick={() => onStatusClick?.(stage.key, [])}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: stage.color, marginBottom: 4 }} />
                <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                  {count}
                </div>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {stage.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

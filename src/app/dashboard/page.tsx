"use client";

import React, { useState, useMemo } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { useDashboardData } from "./hooks/useDashboardData";
import { SummaryCard } from "./components/SummaryCard";
import { DashboardToolbar } from "./components/DashboardToolbar";
import { FunnelChart } from "./components/FunnelChart";
import { JobsListModal } from "./components/JobsListModal";
import { JobDetailsModal } from "./components/JobDetailsModal";
import { Project } from "@/types";

export default function Dashboard() {
  return (
    <ProtectedPage page="dashboard">
      <DashboardContent />
    </ProtectedPage>
  );
}

function DashboardContent() {
  const {
    loading,
    aggregatedProjects,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
  } = useDashboardData();

  const [jobsListOpen, setJobsListOpen] = useState(false);
  const [jobsListData, setJobsListData] = useState<Project[]>([]);
  const [jobsListTitle, setJobsListTitle] = useState("");

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);

  const totalSales = useMemo(() => aggregatedProjects.reduce((sum, p) => sum + (p.sales ?? 0), 0), [aggregatedProjects]);
  const totalCost = useMemo(() => aggregatedProjects.reduce((sum, p) => sum + (p.cost ?? 0), 0), [aggregatedProjects]);
  const totalHours = useMemo(() => aggregatedProjects.reduce((sum, p) => sum + (p.hours ?? 0), 0), [aggregatedProjects]);
  const rph = totalHours ? totalSales / totalHours : 0;
  const markup = totalCost ? ((totalSales - totalCost) / totalCost) * 100 : 0;

  // Win Rate Calculation
  // Simplified for now based on previous logic
  const wonProjects = useMemo(() => aggregatedProjects.filter(p => ["Accepted", "In Progress", "Complete"].includes(p.status || "")).length, [aggregatedProjects]);
  const totalBids = useMemo(() => aggregatedProjects.filter(p => ["Bid Submitted", "Lost"].includes(p.status || "")).length, [aggregatedProjects]);
  const winRate = totalBids > 0 ? (wonProjects / totalBids) * 100 : 0;

  const statusGroups = useMemo(() => {
    const groups: Record<string, Project[]> = {};
    aggregatedProjects.forEach((p) => {
      const status = p.status || 'Unknown';
      if (!groups[status]) groups[status] = [];
      groups[status].push(p);
    });
    return groups;
  }, [aggregatedProjects]);

  const handleStatusClick = (status: string, projects: Project[]) => {
    setJobsListTitle(`${status} Projects`);
    setJobsListData(projects);
    setJobsListOpen(true);
  };

  const handleProjectSelect = (project: Project) => {
    setSelectedProject(project);
    setDetailsModalOpen(true);
  };

  if (loading) {
    return (
      <main className="p-8 bg-[#1a1d23] min-h-screen text-gray-200">
        <div>Loading dashboard data...</div>
      </main>
    );
  }

  return (
    <main className="p-8 bg-[#f5f5f5] min-h-screen text-gray-900 font-sans">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-[#15616D]">Paradise Masonry Estimating Dashboard</h1>
        <Navigation currentPage="dashboard" />
      </div>

      <DashboardToolbar
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5 mb-10">
        <SummaryCard label="Sales" value={totalSales} prefix="$" large />
        <SummaryCard label="Cost" value={totalCost} prefix="$" large />
        <SummaryCard label="Hours" value={totalHours} large />
        <SummaryCard label="RPH" value={rph} prefix="$" decimals={2} large />
        <SummaryCard label="Markup %" value={markup} suffix="%" decimals={1} large />
        <SummaryCard label="Win Rate" value={winRate} suffix="%" decimals={1} large />
      </div>

      <div className="grid lg:grid-cols-2 gap-10">
        <div>
          <h2 className="text-2xl font-bold text-[#15616D] mb-6">Sales Funnel</h2>
          <FunnelChart statusGroups={statusGroups} onStatusClick={handleStatusClick} />
        </div>
        
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <h2 className="text-xl font-bold text-[#15616D] mb-6">Status Breakdown</h2>
          <div className="space-y-4">
            {Object.entries(statusGroups).sort((a, b) => b[1].length - a[1].length).map(([status, group]) => {
              const sSales = group.reduce((sum, p) => sum + (p.sales ?? 0), 0);
              return (
                <div 
                  key={status} 
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors border border-transparent hover:border-[#15616D]/20 group"
                  onClick={() => handleStatusClick(status, group)}
                >
                  <div className="flex flex-col">
                    <span className="font-bold text-gray-800 group-hover:text-[#15616D]">{status.toUpperCase()}</span>
                    <span className="text-xs text-gray-500 font-medium">{group.length} projects</span>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-[#15616D]">${Math.round(sSales).toLocaleString()}</div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Total Potential</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <JobsListModal
        isOpen={jobsListOpen}
        projects={jobsListData}
        title={jobsListTitle}
        onClose={() => setJobsListOpen(false)}
        onSelectProject={handleProjectSelect}
      />

      <JobDetailsModal
        isOpen={detailsModalOpen}
        project={selectedProject}
        onClose={() => setDetailsModalOpen(false)}
        onBack={() => setDetailsModalOpen(false)}
      />
    </main>
  );
}


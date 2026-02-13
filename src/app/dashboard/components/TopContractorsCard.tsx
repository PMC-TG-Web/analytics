"use client";

import React, { useMemo } from "react";
import { Project } from "@/types";

interface ContractorAggregate {
  name: string;
  sales: number;
  cost: number;
  hours: number;
  projectCount: number;
  byStatus: Record<string, { sales: number; cost: number; hours: number; count: number }>;
}

interface TopContractorsCardProps {
  aggregatedProjects: Project[];
  summaryContractors?: Record<string, { sales: number; cost: number; hours: number; count: number; byStatus: any }>;
  topContractorLimit: string;
  setTopContractorLimit: (value: string) => void;
  onOpenJobsList: (customerName: string, status?: string) => void;
}

export function TopContractorsCard({ aggregatedProjects, summaryContractors, topContractorLimit, setTopContractorLimit, onOpenJobsList }: TopContractorsCardProps) {
  const topContractors = useMemo(() => {
    if (summaryContractors && aggregatedProjects.length === 0) {
      // Use summary data
      const sorted = Object.entries(summaryContractors).map(([name, data]) => {
        // Filter out Invitations from status breakdown and recalculate totals if necessary
        const byStatus: Record<string, any> = {};
        let filteredSales = 0;
        let filteredCost = 0;
        let filteredHours = 0;
        let filteredCount = 0;

        Object.entries(data.byStatus).forEach(([status, sData]: [string, any]) => {
          if (status === "Invitations") return;
          byStatus[status] = sData;
          filteredSales += sData.sales || 0;
          filteredCost += sData.cost || 0;
          filteredHours += sData.hours || 0;
          filteredCount += sData.count || 0;
        });

        return {
          name,
          sales: filteredSales,
          cost: filteredCost,
          hours: filteredHours,
          projectCount: filteredCount,
          byStatus
        };
      }).filter(c => c.projectCount > 0)
        .sort((a, b) => b.sales - a.sales);
      
      const limit = topContractorLimit === "all" ? sorted.length : parseInt(topContractorLimit);
      return sorted.slice(0, limit);
    }

    // Fallback to original aggregation logic
    const contractorMap = new Map<string, ContractorAggregate>();
    
    aggregatedProjects.forEach(project => {
      const customerName = project.customer || "Unknown";
      const sales = project.sales || 0;
      const cost = project.cost || 0;
      const hours = project.hours || 0;
      const status = project.status || "Unknown";
      
      if (contractorMap.has(customerName)) {
        const existing = contractorMap.get(customerName)!;
        existing.sales += sales;
        existing.cost += cost;
        existing.hours += hours;
        existing.projectCount += 1;
        
        if (!existing.byStatus[status]) {
          existing.byStatus[status] = { sales: 0, cost: 0, hours: 0, count: 0 };
        }
        existing.byStatus[status].sales += sales;
        existing.byStatus[status].cost += cost;
        existing.byStatus[status].hours += hours;
        existing.byStatus[status].count += 1;
      } else {
        contractorMap.set(customerName, {
          name: customerName,
          sales: sales,
          cost: cost,
          hours: hours,
          projectCount: 1,
          byStatus: {
            [status]: { sales, cost, hours, count: 1 }
          }
        });
      }
    });
    
    // Sort by sales descending
    const sorted = Array.from(contractorMap.values())
      .sort((a, b) => b.sales - a.sales);
    
    // Apply limit
    const limit = topContractorLimit === "all" ? sorted.length : parseInt(topContractorLimit);
    return sorted.slice(0, limit);
  }, [aggregatedProjects, summaryContractors, topContractorLimit]);

  const handleDownloadCSV = () => {
    const headers = ["Contractor", "Sales", "Cost", "Hours", "Project Count", "Markup %"];
    const rows = topContractors.map(c => [
      `"${c.name}"`,
      c.sales.toFixed(2),
      c.cost.toFixed(2),
      c.hours.toFixed(1),
      c.projectCount.toString(),
      (c.cost > 0 ? ((c.sales - c.cost) / c.cost * 100).toFixed(1) : '0.0')
    ]);

    let csvContent = headers.join(",") + "\n" + rows.map(e => e.join(",")).join("\n");
    
    // Add status breakdown per contractor
    csvContent += "\n\nContractor Status Breakdown\n";
    csvContent += "Contractor,Status,Sales,Cost,Hours,Count,Markup %\n";
    topContractors.forEach(c => {
      Object.entries(c.byStatus).forEach(([status, data]: [string, any]) => {
        const d = data as { sales: number; cost: number; hours: number; count: number };
        const markup = d.cost > 0 ? ((d.sales - d.cost) / d.cost * 100).toFixed(1) : '0.0';
        csvContent += `"${c.name}","${status}",${d.sales.toFixed(2)},${d.cost.toFixed(2)},${d.hours.toFixed(1)},${d.count},${markup}\n`;
      });
    });

    // Add comprehensive Project List for all displayed contractors
    csvContent += "\n\nAll Projects for Selected Contractors\n";
    csvContent += "Contractor,Project Number,Project Name,Status,Sales,Cost,Hours,Preconst Hours,Date Updated\n";
    topContractors.forEach(c => {
      const contractorProjects = aggregatedProjects.filter(p => (p.customer ?? "Unknown") === c.name);
      contractorProjects.forEach(p => {
        csvContent += `"${c.name}","${p.projectNumber || ''}","${p.projectName || ''}","${p.status || ''}",${(p.sales || 0).toFixed(2)},${(p.cost || 0).toFixed(2)},${(p.hours || 0).toFixed(1)},${(p.projectedPreconstHours || 0).toFixed(1)},"${p.dateUpdated || ''}"\n`;
      });
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `contractor_data_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadSingleCSV = (contractor: ContractorAggregate) => {
    // 1. Status Breakdown
    const headersBreakdown = ["Contractor", "Status", "Sales", "Cost", "Hours", "Count", "Markup %"];
    const rowsBreakdown = Object.entries(contractor.byStatus).map(([status, data]: [string, any]) => {
      const d = data as { sales: number; cost: number; hours: number; count: number };
      const markup = d.cost > 0 ? ((d.sales - d.cost) / d.cost * 100).toFixed(1) : '0.0';
      return [
        `"${contractor.name}"`,
        `"${status}"`,
        d.sales.toFixed(2),
        d.cost.toFixed(2),
        d.hours.toFixed(1),
        d.count.toString(),
        markup
      ];
    });

    // 2. Project List
    const headersProjects = ["Contractor", "Project Number", "Project Name", "Status", "Sales", "Cost", "Hours", "Preconst Hours", "Date Updated"];
    const rowsProjects = aggregatedProjects
      .filter(p => (p.customer ?? "Unknown") === contractor.name)
      .map(p => [
        `"${contractor.name}"`,
        `"${p.projectNumber || ''}"`,
        `"${p.projectName || ''}"`,
        `"${p.status || ''}"`,
        (Number(p.sales) || 0).toFixed(2),
        (Number(p.cost) || 0).toFixed(2),
        (Number(p.hours) || 0).toFixed(1),
        (Number(p.projectedPreconstHours) || 0).toFixed(1),
        `"${p.dateUpdated || ''}"`
      ]);

    let csvContent = "CONTRACTOR SUMMARY\n";
    csvContent += headersBreakdown.join(",") + "\n" + rowsBreakdown.map(e => e.join(",")).join("\n");
    csvContent += "\n\nPROJECT LIST\n";
    csvContent += headersProjects.join(",") + "\n" + rowsProjects.map(e => e.join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${contractor.name.replace(/[^a-z0-9]/gi, '_')}_data_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="mb-12">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <div className="w-2 h-8 bg-teal-600 rounded-full shadow-lg shadow-teal-600/20"></div>
          <h2 className="text-teal-800 text-2xl font-black uppercase tracking-tight italic">Top Contractors</h2>
        </div>
        <div className="flex gap-4 items-center">
          <button
            onClick={handleDownloadCSV}
            className="bg-teal-600 hover:bg-teal-700 text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 shadow-md shadow-teal-600/10 transition-all active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export All
          </button>
          <select
            value={topContractorLimit}
            onChange={(e) => setTopContractorLimit(e.target.value)}
            className="bg-white border border-gray-200 text-gray-500 text-[10px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl focus:outline-none focus:ring-4 focus:ring-teal-500/10 shadow-sm cursor-pointer transition-all"
          >
            <option value="5">Top 5</option>
            <option value="10">Top 10</option>
            <option value="15">Top 15</option>
            <option value="all">All Contractors</option>
          </select>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {topContractors.map((contractor) => (
          <div
            key={contractor.name}
            className="bg-white border border-gray-100 rounded-3xl p-6 shadow-md hover:shadow-xl transition-all duration-300 group"
          >
            <div className="flex justify-between items-start mb-6">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Contractor</div>
                <button
                  type="button"
                  onClick={() => onOpenJobsList(contractor.name)}
                  className="text-xl font-black text-teal-800 uppercase tracking-tight hover:text-orange-600 transition-colors text-left break-words leading-tight"
                >
                  {contractor.name}
                </button>
              </div>
              <button
                onClick={() => handleDownloadSingleCSV(contractor)}
                title="Download CSV for this contractor"
                className="p-2.5 hover:bg-teal-50 rounded-xl text-gray-300 hover:text-teal-600 transition-all active:scale-90"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="bg-gray-50/50 p-4 rounded-2xl border border-gray-50">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Sales</div>
                <div className="text-xl font-black text-teal-600">
                  ${contractor.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="bg-gray-50/50 p-4 rounded-2xl border border-gray-50">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Projects</div>
                <div className="text-xl font-black text-orange-600">
                  {contractor.projectCount}
                </div>
              </div>
              <div className="bg-gray-50/50 p-4 rounded-2xl border border-gray-50">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Hours</div>
                <div className="text-xl font-black text-gray-900">
                  {contractor.hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="bg-gray-50/50 p-4 rounded-2xl border border-gray-50">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Avg Markup</div>
                <div className="text-xl font-black text-teal-600">
                  {(contractor.cost > 0 ? ((contractor.sales - contractor.cost) / contractor.cost * 100) : 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100">
              <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-600 animate-pulse"></span>
                Status Distribution
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(contractor.byStatus).map(([status, data]: [string, any]) => (
                  <button
                    key={status}
                    onClick={() => onOpenJobsList(contractor.name, status)}
                    className="flex flex-col bg-white border border-gray-100 hover:border-teal-500/30 hover:shadow-sm px-3 py-1.5 rounded-xl transition-all group/status"
                  >
                    <span className="text-[8px] font-black text-gray-400 uppercase tracking-tight group-hover/status:text-teal-600">{status}</span>
                    <span className="text-xs font-black text-gray-800">${(data.sales / 1000).toFixed(0)}k</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

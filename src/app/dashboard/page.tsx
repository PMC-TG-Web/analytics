"use client";
// Trigger redeploy
import React, { useEffect, useMemo, useState } from "react";
import { JobsListModal } from "./components/JobsListModal";
import { JobDetailsModal } from "./components/JobDetailsModal";
import { getAllProjectsForDashboard, getDashboardSummary, getProjectsByCustomer, type Project, type DashboardSummary } from "./projectQueries";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { 
  calculateAggregated, 
  getProjectDate, 
  getProjectKey,
  isExcludedFromDashboard
} from "@/utils/projectUtils";
import { SummaryCard } from "./components/SummaryCard";
import { FunnelChart } from "./components/FunnelChart";
import { TopContractorsCard } from "./components/TopContractorsCard";


export default function Dashboard() {
  return (
    <ProtectedPage page="dashboard">
      <DashboardContent />
    </ProtectedPage>
  );
}


function DashboardContent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFullScan, setIsFullScan] = useState(false);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [jobsListOpen, setJobsListOpen] = useState(false);
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Project | null>(null);
  const [jobsListData, setJobsListData] = useState<Project[]>([]);
  const [jobsListTitle, setJobsListTitle] = useState("");
  const [topContractorLimit, setTopContractorLimit] = useState<string>("10");

  const refreshData = async () => {
    setLoading(true);
    // Clear summary cache and reload
    const summaryData = await getDashboardSummary();
    if (summaryData) {
      setSummary(summaryData);
    }
    
    // If we're in full scan mode, reload projects too
    if (isFullScan) {
      const data = await getAllProjectsForDashboard();
      setProjects(data);
    }
    setLoading(false);
  };

  useEffect(() => {
    async function fetchData() {
      // First try to get the summary (extremely fast)
      const summaryData = await getDashboardSummary();
      if (summaryData) {
        setSummary(summaryData);
        setLoading(false);
      }
      
      // We only perform the full scan if summary doesn't exist or if needed later
      if (!summaryData) {
        const data = await getAllProjectsForDashboard();
        setProjects(data);
        setIsFullScan(true);
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Effect to handle full scan when date range is applied
  useEffect(() => {
    if ((startDate || endDate) && !isFullScan) {
      setLoading(true);
      getAllProjectsForDashboard().then(data => {
        setProjects(data);
        setIsFullScan(true);
        setLoading(false);
      });
    }
  }, [startDate, endDate, isFullScan]);

  const filteredProjects = useMemo(() => {
    if (!isFullScan && !startDate && !endDate) return [];
    return projects.filter(p => {
      // Apply centralized dashboard exclusions
      if (isExcludedFromDashboard(p)) return false;

      // Apply date range filter
      if (startDate || endDate) {
        const projectDate = getProjectDate(p);
        if (!projectDate) return false;
        
        if (startDate) {
          const start = new Date(startDate);
          start.setHours(0, 0, 0, 0);
          if (projectDate < start) return false;
        }
        
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          if (projectDate > end) return false;
        }
      }
      return true;
    });
  }, [projects, isFullScan, startDate, endDate]);

  const { aggregated: aggregatedProjects, dedupedByCustomer } = useMemo(() => {
    return calculateAggregated(filteredProjects);
  }, [filteredProjects]);

  // Calculate summary metrics
  const useSummary = !!summary && !startDate && !endDate && !isFullScan;

  const totalSales = useSummary ? summary.totalSales : aggregatedProjects.reduce((sum, p) => sum + (p.sales ?? 0), 0);
  const totalCost = useSummary ? summary.totalCost : aggregatedProjects.reduce((sum, p) => sum + (p.cost ?? 0), 0);
  const totalHours = useSummary ? summary.totalHours : aggregatedProjects.reduce((sum, p) => sum + (p.hours ?? 0), 0);
  const rph = totalHours ? totalSales / totalHours : 0;
  const markup = totalCost ? ((totalSales - totalCost) / totalCost) * 100 : 0;

  const openContractorJobs = async (customerName: string, status?: string) => {
    let customerProjects: Project[] = [];
    
    if (useSummary) {
      // Lazy load projects for this customer
      setLoading(true);
      const rawCustomerProjects = await getProjectsByCustomer(customerName);
      // We must apply the same aggregation logic to these raw records
      const { aggregated } = calculateAggregated(
        rawCustomerProjects.filter(p => !isExcludedFromDashboard(p))
      );
      customerProjects = aggregated;
      setLoading(false);
    } else {
      customerProjects = aggregatedProjects;
    }

    const filtered = customerProjects.filter((project) => {
      const matchesCustomer = (project.customer || "Unknown") === customerName;
      const matchesStatus = status ? (project.status || "Unknown") === status : true;
      return matchesCustomer && matchesStatus;
    });

    const title = status
      ? `${customerName} - ${status}`
      : `${customerName} - All Jobs`;

    setJobsListData(filtered);
    setJobsListTitle(title);
    setJobsListOpen(true);
  };

  // Prepare status data for processing
  const displayStatusGroups = useMemo(() => {
    if (useSummary && summary) {
      // Map summary data to the format components expect
      return Object.entries(summary.statusGroups).reduce((acc, [status, data]) => {
        const norm = status.toLowerCase().trim();
        const excluded = ["invitations", "to do", "todo", "to-do", "unknown"];
        if (excluded.includes(norm)) return acc;
        acc[status] = data;
        return acc;
      }, {} as Record<string, any>);
    }
    
    // Fallback: Calculate from dedupedByCustomer to preserve PMC group breakdown
    const groups: Record<string, any> = {};
    
    // First pass: calculate sales, cost, hours from aggregated projects
    aggregatedProjects.forEach((p) => {
      const status = p.status || 'Unknown';
      if (isExcludedFromDashboard(p)) return;
      if (!groups[status]) groups[status] = { sales: 0, cost: 0, hours: 0, count: 0, laborByGroup: {} };
      groups[status].sales += (p.sales ?? 0);
      groups[status].cost += (p.cost ?? 0);
      groups[status].hours += (p.hours ?? 0);
      groups[status].count += 1;
    });
    
    // Second pass: calculate laborByGroup from dedupedByCustomer (line items)
    dedupedByCustomer.forEach((p) => {
      const status = p.status || 'Unknown';
      if (isExcludedFromDashboard(p)) return;
      if (!groups[status]) return; // Skip if status doesn't exist in groups
      
      const pmcGroup = p.pmcGroup || 'Unassigned';
      const hours = Number(p.hours ?? 0);
      
      if (!groups[status].laborByGroup[pmcGroup]) {
        groups[status].laborByGroup[pmcGroup] = 0;
      }
      groups[status].laborByGroup[pmcGroup] += hours;
    });
    
    return groups;
  }, [aggregatedProjects, dedupedByCustomer, useSummary, summary]);

  const bidSubmittedLabor = useMemo(() => {
    const targetGroups = [
      'slab on grade labor',
      'site concrete labor',
      'wall labor',
      'foundation labor',
    ];
    const totals: Record<string, number> = {
      'Slab On Grade Labor': 0,
      'Site Concrete Labor': 0,
      'Wall Labor': 0,
      'Foundation Labor': 0,
    };

    if (useSummary && summary?.laborBreakdown) {
      Object.entries(summary.laborBreakdown).forEach(([groupName, hours]) => {
        const normalized = groupName.toLowerCase();
        if (normalized === targetGroups[0]) totals['Slab On Grade Labor'] += hours;
        if (normalized === targetGroups[1]) totals['Site Concrete Labor'] += hours;
        if (normalized === targetGroups[2]) totals['Wall Labor'] += hours;
        if (normalized === targetGroups[3]) totals['Foundation Labor'] += hours;
      });
    } else {
      // Use dedupedByCustomer (line items after competitive bidding dedup) to preserve individual PMC groups
      const bidProjects = (dedupedByCustomer || []).filter(p => p.status === 'Bid Submitted');
      bidProjects.forEach((p) => {
        const groupName = (p.pmcGroup ?? '').toString().trim();
        const normalized = groupName.toLowerCase();
        if (!normalized) return;
        const hours = Number(p.hours ?? 0);
        if (!Number.isFinite(hours)) return;

        if (normalized === targetGroups[0]) totals['Slab On Grade Labor'] += hours;
        if (normalized === targetGroups[1]) totals['Site Concrete Labor'] += hours;
        if (normalized === targetGroups[2]) totals['Wall Labor'] += hours;
        if (normalized === targetGroups[3]) totals['Foundation Labor'] += hours;
      });
    }

    const totalHours = Object.values(totals).reduce((sum, value) => sum + value, 0);
    const breakdown = Object.entries(totals).map(([label, value]) => ({
      label,
      hours: value,
      percent: totalHours > 0 ? (value / totalHours) * 100 : 0,
    }));

    return { totalHours, breakdown };
  }, [dedupedByCustomer, useSummary, summary]);

  // All status labor breakdown (across all project statuses)
  const allStatusesLabor = useMemo(() => {
    const targetGroups = [
      'slab on grade labor',
      'site concrete labor',
      'wall labor',
      'foundation labor',
    ];
    const totals: Record<string, number> = {
      'Slab On Grade Labor': 0,
      'Site Concrete Labor': 0,
      'Wall Labor': 0,
      'Foundation Labor': 0,
    };

    // Use ALL dedupedByCustomer (not filtered by status)
    const allProjects = dedupedByCustomer || [];
    allProjects.forEach((p) => {
      const groupName = (p.pmcGroup ?? '').toString().trim();
      const normalized = groupName.toLowerCase();
      if (!normalized) return;
      const hours = Number(p.hours ?? 0);
      if (!Number.isFinite(hours)) return;

      if (normalized === targetGroups[0]) totals['Slab On Grade Labor'] += hours;
      if (normalized === targetGroups[1]) totals['Site Concrete Labor'] += hours;
      if (normalized === targetGroups[2]) totals['Wall Labor'] += hours;
      if (normalized === targetGroups[3]) totals['Foundation Labor'] += hours;
    });

    const totalHours = Object.values(totals).reduce((sum, value) => sum + value, 0);
    const breakdown = Object.entries(totals).map(([label, value]) => ({
      label,
      hours: value,
      percent: totalHours > 0 ? (value / totalHours) * 100 : 0,
    }));

    return { totalHours, breakdown };
  }, [dedupedByCustomer]);

  const pmHours = useMemo(() => {
    const pmGroupTotals: Record<string, number> = {};
    
    if (useSummary && summary?.pmcGroupHours) {
      // Use summary data
      Object.entries(summary.pmcGroupHours).forEach(([label, hours]) => {
        pmGroupTotals[label] = hours;
      });
    } else {
      // Calculate from dedupedByCustomer (only Bid Submitted)
      const allProjects = (dedupedByCustomer || []).filter(
        p => p.status === 'Bid Submitted' && !p.projectArchived
      );
      
      allProjects.forEach((p) => {
        const groupName = (p.pmcGroup ?? '').toString().trim();
        const normalized = groupName.toLowerCase();
        // Only match groups that start with "pm" or are exactly "pm labor", "pm hours", etc.
        if (!normalized || !(normalized.startsWith('pm ') || normalized === 'pm' || normalized.startsWith('pm-'))) return;
        
        const hours = Number(p.hours ?? 0);
        if (!Number.isFinite(hours)) return;
        
        const displayName = p.pmcGroup ?? 'PM (Unassigned)';
        pmGroupTotals[displayName] = (pmGroupTotals[displayName] ?? 0) + hours;
      });
    }

    const totalHours = Object.values(pmGroupTotals).reduce((sum, value) => sum + value, 0);
    const breakdown = Object.entries(pmGroupTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([label, hours]) => ({
        label,
        hours,
        percent: totalHours > 0 ? (hours / totalHours) * 100 : 0,
      }));

    return { totalHours, breakdown };
  }, [dedupedByCustomer, useSummary, summary]);

  if (loading) {
    return (
      <main className="p-8 bg-gray-900 min-h-screen text-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="font-medium italic">Loading dashboard data...</span>
        </div>
      </main>
    );
  }

  const getUniqueProjectCount = (statusKey: string) => {
    if (useSummary && summary) {
      return summary.statusGroups[statusKey]?.count || 0;
    }
    return displayStatusGroups[statusKey]?.count || 0;
  };
  
  const wonProjects = getUniqueProjectCount('In Progress') + getUniqueProjectCount('Accepted');
  const totalBids = getUniqueProjectCount('Bid Submitted') + getUniqueProjectCount('Lost');
  const winRate = totalBids > 0 ? (wonProjects / totalBids) * 100 : 0;

  const handleExportCSV = () => {
    // Collect projects to export - prefer the full list if available
    const dataToExport = projects.length > 0 ? projects : (dedupedByCustomer || []);
    if (dataToExport.length === 0) {
      alert("No data available to export. Try applying a date range to trigger a full scan.");
      return;
    }

    const headers = [
      "Job Key", "Project Number", "Project Name", "Customer", "Status", 
      "Estimator", "PMC Group", "Hours", "Sales", "Cost", "Date Created", "Date Updated"
    ];

    const rows = dataToExport.map(p => {
      const jobKey = getProjectKey(p);
      return [
        `"${jobKey}"`,
        `"${p.projectNumber || ""}"`,
        `"${p.projectName || ""}"`,
        `"${p.customer || ""}"`,
        `"${p.status || ""}"`,
        `"${p.estimator || ""}"`,
        `"${p.pmcGroup || ""}"`,
        p.hours || 0,
        p.sales || 0,
        p.cost || 0,
        `"${p.dateCreated || ""}"`,
        `"${p.dateUpdated || ""}"`
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `PMC_Projects_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main className="p-8 bg-gray-50 min-h-screen text-gray-900 font-sans">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-teal-800 text-3xl font-black tracking-tight uppercase italic">Paradise Estimating Dashboard</h1>
          <button 
            onClick={handleExportCSV}
            className="mt-2 text-xs bg-teal-600 hover:bg-teal-700 text-white font-bold py-1 px-3 rounded shadow transition-colors flex items-center gap-1"
          >
            <span>↓</span> Export Projects to CSV
          </button>
        </div>
        <Navigation currentPage="dashboard" />
      </div>
      
      {/* Date Range Filter */}
      <div className="bg-white rounded-2xl px-6 py-4 mb-8 border border-gray-200 flex flex-wrap items-center gap-5 shadow-sm">
        <div className="text-gray-500 font-black uppercase text-xs tracking-widest">Date Range Filter</div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-gray-400 text-[10px] font-bold uppercase">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
            />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-gray-400 text-[10px] font-bold uppercase">To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-teal-500/20 transition-all"
            />
          </label>
          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              className="bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg shadow-sm transition-all"
            >
              Clear
            </button>
          )}
        </div>
        {(startDate || endDate) && (
          <div className="ml-auto bg-orange-50 text-orange-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border border-orange-100 italic">
            {Array.from(new Set(aggregatedProjects.map(p => getProjectKey(p)))).length} active projects in range
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-12">
        <SummaryCard label="Sales" value={totalSales} prefix="$" large />
        <SummaryCard label="Cost" value={totalCost} prefix="$" large />
        <SummaryCard label="Hours" value={totalHours} large />
        <SummaryCard label="RPH" value={rph} prefix="$" decimals={2} large />
        <SummaryCard label="Markup %" value={markup} suffix="%" decimals={1} large />
        <SummaryCard label="Win Rate" value={winRate} suffix="%" decimals={1} large />
      </div>

      <div className="space-y-12">
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-2 h-8 bg-teal-600 rounded-full shadow-lg shadow-teal-600/20"></div>
            <h2 className="text-teal-800 text-2xl font-black uppercase tracking-tight italic">Sales Funnel</h2>
          </div>
          <FunnelChart statusGroups={displayStatusGroups} />
        </section>
        
        <section>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-2 h-8 bg-teal-600 rounded-full shadow-lg shadow-teal-600/20"></div>
            <h2 className="text-teal-800 text-2xl font-black uppercase tracking-tight italic">Status Breakdown</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {Object.entries(displayStatusGroups)
              .sort(([a], [b]) => {
                const order = ["Estimating", "Bid Submitted", "Accepted", "In Progress", "Complete", "Delayed", "Lost"];
                const idxA = order.indexOf(a);
                const idxB = order.indexOf(b);
                if (idxA === -1 && idxB === -1) return a.localeCompare(b);
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
              })
              .map(([status, metrics]) => {
                const { sales, cost, hours, laborByGroup } = metrics;
              const rph = hours ? sales / hours : 0;
              const markup = cost ? ((sales - cost) / cost) * 100 : 0;
              const excludedGroupPatterns = ['part', 'equipment', 'subcontract'];
              
              const laborGroupEntries = Object.entries(laborByGroup || {})
                .filter(([groupName, value]) => {
                  if (value === 0) return false;
                  const normalized = (groupName as string).toLowerCase();
                  return !excludedGroupPatterns.some((pattern) => normalized.includes(pattern));
                })
                .sort((a, b) => (b[1] as number) - (a[1] as number));

              return (
                <div key={status} className="bg-white rounded-3xl p-6 shadow-md border border-gray-100 flex flex-col hover:shadow-lg transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="font-black text-xl text-teal-800 uppercase tracking-tight">{status}</h3>
                    <div className="px-2 py-1 bg-gray-50 rounded text-[9px] font-black text-gray-400 uppercase tracking-widest leading-none">Status Metrics</div>
                  </div>

                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between items-center group">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Sales</span>
                      <button 
                        onClick={async () => {
                          if (useSummary) {
                            setLoading(true);
                            const raw = await getAllProjectsForDashboard(); 
                            const filtered = raw.filter(p => !p.projectArchived && p.status === status);
                            const { aggregated } = calculateAggregated(filtered);
                            setJobsListData(aggregated);
                            setLoading(false);
                          } else {
                            const group = aggregatedProjects.filter(p => p.status === status);
                            setJobsListData(group);
                          }
                          setJobsListTitle(`${status} Projects`);
                          setJobsListOpen(true);
                        }}
                        className="text-lg font-black text-orange-600 hover:text-orange-700 hover:scale-105 transition-all outline-none"
                      >
                        {`$${(sales as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-50">
                      <div>
                        <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest block mb-0.5">Cost</span>
                        <span className="text-sm font-black text-gray-900">{`$${(cost as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest block mb-0.5">Hours</span>
                        <span className="text-sm font-black text-gray-900">{(hours as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-50">
                      <div>
                        <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest block mb-0.5">RPH</span>
                        <span className="text-sm font-black text-teal-600">{`$${rph.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest block mb-0.5">Markup</span>
                        <span className="text-sm font-black text-teal-600">{`${markup.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto pt-4 border-t border-gray-100">
                    <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>
                       Hours by PMC Group
                    </div>
                    {laborGroupEntries.length === 0 ? (
                      <div className="text-xs text-gray-400 italic font-medium py-2">No hours reported</div>
                    ) : (
                      <div className="space-y-1.5">
                        {laborGroupEntries.map(([pmcGroup, labor]) => (
                          <div key={pmcGroup} className="flex justify-between items-center text-[11px] bg-gray-50 px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 transition-colors">
                            <span className="text-gray-500 font-bold uppercase tracking-tight truncate max-w-[140px]">{pmcGroup}</span>
                            <span className="text-gray-900 font-black">
                              {(labor as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Bid Submitted Labor Card */}
            <div className="bg-gray-900 rounded-3xl p-6 shadow-xl shadow-gray-900/10 flex flex-col border border-gray-800">
              <div className="flex justify-between items-start mb-6">
                <h3 className="font-black text-xl text-white uppercase tracking-tight italic">Estimated hours Distro</h3>
                <div className="px-2 py-1 bg-white/10 rounded text-[9px] font-black text-teal-400 uppercase tracking-widest leading-none">Pre-Con</div>
              </div>

              <div className="mb-6 bg-white/5 rounded-2xl p-4 border border-white/5">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Total Estimated Hours</span>
                <span className="text-3xl font-black text-teal-400">
                  {bidSubmittedLabor.totalHours.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </div>

              <div className="space-y-2 mb-6">
                <div className="text-[9px] font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                   <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
                   Backlog Breakdown
                </div>
                {bidSubmittedLabor.breakdown.map((item) => (
                  <div key={item.label} className="bg-white/5 rounded-xl px-3 py-2 border border-white/5 group hover:bg-white/10 transition-colors">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{item.label}</span>
                      <span className="text-[10px] text-teal-400 font-black">{item.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%</span>
                    </div>
                    <div className="text-sm font-black text-white">{item.hours.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-[10px] opacity-40">hrs</span></div>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-4 border-t border-white/10">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest italic">PM Focus Hours</span>
                  <span className="text-xs font-black text-orange-400">{pmHours.totalHours.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="space-y-1.5">
                  {pmHours.breakdown.slice(0, 3).map((item) => (
                    <div key={item.label} className="flex justify-between text-[10px]">
                      <span className="text-gray-500 font-bold truncate max-w-[120px]">{item.label}</span>
                      <span className="text-gray-300 font-bold">{item.hours.toLocaleString()}<span className="text-[8px] opacity-50 ml-0.5">h</span></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Footer Info */}
      <div className="mt-12 pt-8 border-t border-gray-200 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-gray-400 italic">
        <div>Active Tracking Monitor v2.0</div>
        <div>
          Total Project Count: {
            useSummary ? 
            (getUniqueProjectCount('Bid Submitted') + getUniqueProjectCount('In Progress') + getUniqueProjectCount('Accepted')) : 
            Array.from(
              new Set(
                aggregatedProjects
                  .filter(p => ['Bid Submitted', 'In Progress', 'Accepted'].includes(p.status || ''))
                  .map(p => getProjectKey(p))
              )
            ).length
          }
        </div>
      </div>

      {/* Top Contractors Card */}
      <TopContractorsCard 
        aggregatedProjects={aggregatedProjects}
        summaryContractors={useSummary ? summary?.contractors : undefined}
        onOpenJobsList={openContractorJobs}
        topContractorLimit={topContractorLimit}
        setTopContractorLimit={setTopContractorLimit}
      />

      {/* Drill-through Modals */}
      <JobsListModal
        isOpen={jobsListOpen}
        onClose={() => setJobsListOpen(false)}
        projects={jobsListData}
        title={jobsListTitle}
        onSelectProject={(project) => {
          setSelectedJob(project);
          setJobsListOpen(false);
          setJobDetailsOpen(true);
        }}
      />
      <JobDetailsModal
        isOpen={jobDetailsOpen}
        onClose={() => setJobDetailsOpen(false)}
        project={selectedJob}
        onBack={() => {
          setJobDetailsOpen(false);
          setJobsListOpen(true);
        }}
        onStatusUpdate={refreshData}
      />
    </main>
  );
}


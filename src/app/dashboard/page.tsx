"use client";
// Trigger redeploy
import React, { useEffect, useMemo, useState } from "react";
import { JobsListModal } from "./components/JobsListModal";
import { JobDetailsModal } from "./components/JobDetailsModal";
import { getAllProjectsForDashboard, getDashboardSummary, getProjectsByCustomer, type Project, type DashboardSummary } from "./projectQueries";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";


export default function Dashboard() {
  return (
    <ProtectedPage page="dashboard">
      <DashboardContent />
    </ProtectedPage>
  );
}

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

function TopContractorsCard({ aggregatedProjects, summaryContractors, topContractorLimit, setTopContractorLimit, onOpenJobsList }: TopContractorsCardProps) {
  const topContractors = useMemo(() => {
    if (summaryContractors && aggregatedProjects.length === 0) {
      // Use summary data
      const sorted = Object.entries(summaryContractors).map(([name, data]) => ({
        name,
        ...data,
        projectCount: data.count
      })).sort((a, b) => b.sales - a.sales);
      
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
  }, [aggregatedProjects, topContractorLimit]);

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#333', margin: 0 }}>Top Contractors</h2>
        <select
          value={topContractorLimit}
          onChange={(e) => setTopContractorLimit(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid #374151',
            backgroundColor: '#1f2937',
            color: '#fff',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          <option value="5">Top 5</option>
          <option value="10">Top 10</option>
          <option value="15">Top 15</option>
          <option value="all">All Contractors</option>
        </select>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {topContractors.map((contractor) => (
          <div
            key={contractor.name}
            style={{
              background: '#ffffff',
              border: '1px solid #ddd',
              borderRadius: 12,
              padding: 16,
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contractor</div>
              <button
                type="button"
                onClick={() => onOpenJobsList(contractor.name)}
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: '#333',
                  padding: 0,
                  margin: 0,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {contractor.name}
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Total Sales</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#10b981' }}>
                  ${contractor.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Total Projects</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#3b82f6' }}>
                  {contractor.projectCount}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Total Hours</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#f59e0b' }}>
                  {contractor.hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Markup %</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#8b5cf6' }}>
                  {contractor.cost > 0 ? ((contractor.sales - contractor.cost) / contractor.cost * 100).toFixed(1) : '0.0'}%
                </div>
              </div>
            </div>
            
            {/* Status Breakdown */}
            <div style={{ borderTop: '1px solid #ddd', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 8, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>By Status</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(contractor.byStatus)
                  .sort((a, b) => b[1].sales - a[1].sales)
                  .map(([status, data]) => {
                    const markup = data.cost > 0 ? ((data.sales - data.cost) / data.cost * 100).toFixed(1) : '0.0';
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => onOpenJobsList(contractor.name, status)}
                        style={{
                          fontSize: 11,
                          padding: 0,
                          margin: 0,
                          border: 'none',
                          background: 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <div style={{ color: '#555', fontWeight: 600 }}>{status}</div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <span style={{ color: '#10b981' }}>
                              ${data.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                            <span style={{ color: '#3b82f6', minWidth: 25, textAlign: 'right' }}>
                              {data.count}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingRight: 0, fontSize: 10, color: '#666' }}>
                          <span style={{ color: '#f59e0b' }}>
                            {data.hours.toLocaleString(undefined, { maximumFractionDigits: 0 })} hrs
                          </span>
                          <span style={{ color: '#8b5cf6', minWidth: 45, textAlign: 'right' }}>
                            {markup}% markup
                          </span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const parseDateValue = (value: unknown) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value !== null && "toDate" in value) {
    const hasToDate = value as { toDate: () => unknown };
    if (typeof hasToDate.toDate === "function") {
      const d = hasToDate.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }
  }
  return null;
};

const getProjectDate = (project: Project) => {
  const updated = parseDateValue(project.dateUpdated);
  const created = parseDateValue(project.dateCreated);
  if (updated && created) return updated > created ? updated : created;
  return updated || created || null;
};

const getProjectKey = (project: Project) => {
  const number = (project.projectNumber ?? "").toString().trim();
  const customer = (project.customer ?? "").toString().trim();
  return `${number}|${customer}` || `__noKey__${project.id}`;
};

function calculateAggregated(projects: Project[]) {
    // Group by project number/name to find duplicates with different customers
    const projectIdentifierMap = new Map<string, Project[]>();
    projects.forEach((project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      
      if (!projectIdentifierMap.has(identifier)) {
        projectIdentifierMap.set(identifier, []);
      }
      projectIdentifierMap.get(identifier)!.push(project);
    });
    
    // For each project identifier, keep only the most recent customer version
    const dedupedByCustomer: Project[] = [];
    projectIdentifierMap.forEach((projectList) => {
      // Group by customer
      const customerMap = new Map<string, Project[]>();
      projectList.forEach(p => {
        const customer = (p.customer ?? "").toString().trim();
        if (!customerMap.has(customer)) {
          customerMap.set(customer, []);
        }
        customerMap.get(customer)!.push(p);
      });
      
      // If multiple customers, prioritize by status first, then by date
      if (customerMap.size > 1) {
        const priorityStatuses = ["Accepted", "In Progress", "Complete"];
        let selectedProjects: Project[] = [];
        
        let foundPriorityCustomer = false;
        customerMap.forEach((projs) => {
          const hasPriorityStatus = projs.some(p => priorityStatuses.includes(p.status || ""));
          if (hasPriorityStatus && !foundPriorityCustomer) {
            selectedProjects = projs;
            foundPriorityCustomer = true;
          }
        });
        
        if (!foundPriorityCustomer) {
          let latestDate: Date | null = null;
          let latestCustomerProjs: Project[] = [];
          
          customerMap.forEach((projs) => {
            const mostRecentProj = projs.reduce((latest, current) => {
              const currentDate = parseDateValue(current.dateCreated);
              const latestDateVal = parseDateValue(latest.dateCreated);
              if (!currentDate) return latest;
              if (!latestDateVal) return current;
              return currentDate > latestDateVal ? current : latest;
            }, projs[0]);
            
            const projDate = parseDateValue(mostRecentProj.dateCreated);
            if (projDate && (!latestDate || projDate > latestDate)) {
              latestDate = projDate;
              latestCustomerProjs = projs;
            }
          });
          
          selectedProjects = latestCustomerProjs;
        }
        dedupedByCustomer.push(...selectedProjects);
      } else {
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });
    
    // Now aggregate by projectNumber + customer
    const keyGroupMap = new Map<string, Project[]>();
    dedupedByCustomer.forEach((project) => {
      const key = getProjectKey(project);
      if (!keyGroupMap.has(key)) {
        keyGroupMap.set(key, []);
      }
      keyGroupMap.get(key)!.push(project);
    });
    
    const map = new Map<string, Project>();
    keyGroupMap.forEach((projects, key) => {
      const sortedProjects = projects.sort((a, b) => {
        const nameA = (a.projectName ?? "").toString().toLowerCase();
        const nameB = (b.projectName ?? "").toString().toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      const baseProject = { ...sortedProjects[0] };
      baseProject.sales = sortedProjects.reduce((sum, p) => sum + (p.sales ?? 0), 0);
      baseProject.cost = sortedProjects.reduce((sum, p) => sum + (p.cost ?? 0), 0);
      baseProject.hours = sortedProjects.reduce((sum, p) => sum + (p.hours ?? 0), 0);
      baseProject.laborSales = sortedProjects.reduce((sum, p) => sum + (p.laborSales ?? 0), 0);
      baseProject.laborCost = sortedProjects.reduce((sum, p) => sum + (p.laborCost ?? 0), 0);
      
      const mostRecentProject = sortedProjects.reduce((latest, current) => {
        const latestDate = getProjectDate(latest);
        const currentDate = getProjectDate(current);
        if (!currentDate) return latest;
        if (!latestDate) return current;
        return currentDate > latestDate ? current : latest;
      }, sortedProjects[0]);
      
      baseProject.dateUpdated = mostRecentProject.dateUpdated;
      baseProject.dateCreated = mostRecentProject.dateCreated;
      
      map.set(key, baseProject);
    });
    return { aggregated: Array.from(map.values()), dedupedByCustomer };
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
      if (p.projectArchived) return false;
      if (p.status === "Invitations") return false;
      
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
      const customer = (p.customer ?? "").toString().toLowerCase();
      if (customer.includes("sop inc")) return false;
      const projectName = (p.projectName ?? "").toString().toLowerCase();
      if (projectName === "pmc operations") return false;
      if (projectName === "pmc shop time") return false;
      if (projectName === "pmc test project") return false;
      if (projectName.includes("sandbox")) return false;
      if (projectName.includes("raymond king")) return false;
      if (projectName === "alexander drive addition latest") return false;
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      return true;
    });
  }, [projects, startDate, endDate]);

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
      const { aggregated } = calculateAggregated(rawCustomerProjects);
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
        acc[status] = data;
        return acc;
      }, {} as Record<string, any>);
    }
    
    // Fallback to grouped projects
    const groups: Record<string, any> = {};
    aggregatedProjects.forEach((p) => {
      const status = p.status || 'Unknown';
      if (!groups[status]) groups[status] = { sales: 0, cost: 0, hours: 0, count: 0, laborByGroup: {} };
      groups[status].sales += (p.sales ?? 0);
      groups[status].cost += (p.cost ?? 0);
      groups[status].hours += (p.hours ?? 0);
      groups[status].count += 1;
      
      // We'd need projects to do deeper labor breakdown here, or use statusGroupsForLabor
    });
    return groups;
  }, [aggregatedProjects, useSummary, summary]);

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

  const pmHours = useMemo(() => {
    const pmGroupTotals: Record<string, number> = {};
    
    if (useSummary && summary?.pmcGroupHours) {
      Object.entries(summary.pmcGroupHours).forEach(([label, hours]) => {
        const normalized = label.toLowerCase();
        if (!normalized || !(normalized.startsWith('pm ') || normalized === 'pm' || normalized.startsWith('pm-'))) return;
        pmGroupTotals[label] = hours;
      });
    } else {
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
      <main className="p-8" style={{ background: '#1a1d23', minHeight: '100vh', color: '#e5e7eb' }}>
        <div>Loading...</div>
      </main>
    );
  }

  const getUniqueProjectCount = (statusKey: string) => {
    if (useSummary && summary) {
      return summary.statusGroups[statusKey]?.count || 0;
    }
    // Fallback: search displayStatusGroups but it might not be deduped properly if projects are empty
    return displayStatusGroups[statusKey]?.count || 0;
  };
  
  const wonProjects = getUniqueProjectCount('In Progress') + getUniqueProjectCount('Accepted');
  const totalBids = getUniqueProjectCount('Bid Submitted') + getUniqueProjectCount('Lost');
  const winRate = totalBids > 0 ? (wonProjects / totalBids) * 100 : 0;

  return (
    <main className="p-8" style={{ fontFamily: 'sans-serif', background: '#f5f5f5', minHeight: '100vh', color: '#222' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ color: '#15616D', fontSize: 32, margin: 0 }}>Paradise Masonry Estimating Dashboard</h1>
        <Navigation currentPage="dashboard" />
      </div>
      
      {/* Date Range Filter */}
      <div style={{ 
        background: '#ffffff', 
        borderRadius: 12, 
        padding: '16px 24px', 
        marginBottom: 32,
        border: '1px solid #ddd',
        display: 'flex',
        alignItems: 'center',
        gap: 20
      }}>
        <div style={{ color: '#666', fontWeight: 600 }}>Date Range:</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#666', fontSize: 14 }}>From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: '6px 12px',
                color: '#222',
                fontSize: 14
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#666', fontSize: 14 }}>To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: 6,
                padding: '6px 12px',
                color: '#222',
                fontSize: 14
              }}
            />
          </label>
          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              style={{
                background: '#E06C00',
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Clear
            </button>
          )}
        </div>
        {(startDate || endDate) && (
          <div style={{ color: '#E06C00', fontSize: 14, marginLeft: 'auto' }}>
            {Array.from(new Set(aggregatedProjects.map(p => getProjectKey(p)))).length} projects in date range
          </div>
        )}
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 20, marginBottom: 48 }}>
        <SummaryCard label="Sales" value={totalSales} prefix="$" large />
        <SummaryCard label="Cost" value={totalCost} prefix="$" large />
        <SummaryCard label="Hours" value={totalHours} large />
        <SummaryCard label="RPH" value={rph} prefix="$" decimals={2} large />
        <SummaryCard label="Markup %" value={markup} suffix="%" decimals={1} large />
        <SummaryCard label="Win Rate" value={winRate} suffix="%" decimals={1} large />
      </div>
      <h2 style={{ color: '#15616D', marginBottom: 24, fontSize: 24 }}>Sales Funnel</h2>
      <FunnelChart statusGroups={displayStatusGroups} />
      
      <h2 style={{ color: '#15616D', marginBottom: 24, marginTop: 64, fontSize: 24 }}>Status Breakdown</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 48 }}>
        {Object.entries(displayStatusGroups).map(([status, metrics]) => {
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
            <div key={status} style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: '24px 32px',
              minWidth: 330,
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              border: '1px solid #ddd',
              marginBottom: 12,
            }}>
              <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 18, color: '#15616D' }}>{status}</div>
              <dl style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#666' }}>Sales</dt>
                  <dd 
                    style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#E06C00', cursor: 'pointer' }}
                    onClick={async () => {
                      if (useSummary) {
                        setLoading(true);
                        // Filter summary by status logic
                        const raw = await getAllProjectsForDashboard(); 
                        const filtered = raw.filter(p => !p.projectArchived && p.status === status);
                        const { aggregated } = calculateAggregated(filtered);
                        setJobsListData(aggregated);
                        setLoading(false);
                      } else {
                        // Filter from current projects
                        const group = aggregatedProjects.filter(p => p.status === status);
                        setJobsListData(group);
                      }
                      setJobsListTitle(`${status} Projects`);
                      setJobsListOpen(true);
                    }}
                  >
                    {`$${(sales as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  </dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#666' }}>Cost</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#222' }}>{`$${(cost as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#666' }}>Hours</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#222' }}>{(hours as number).toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#666' }}>RPH</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#222' }}>{`$${rph.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <dt style={{ color: '#666' }}>Markup %</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#222' }}>{`${markup.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</dd>
                </div>
              </dl>
              <div style={{ marginTop: 16, borderTop: '1px solid #ddd', paddingTop: 12 }}>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Hours by PMC Group
                </div>
                {laborGroupEntries.length === 0 ? (
                  <div style={{ color: '#999', fontSize: 12 }}>No hours</div>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {laborGroupEntries.map(([pmcGroup, labor]) => (
                      <div key={pmcGroup} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: '#666' }}>{pmcGroup}</span>
                        <span style={{ color: '#222', fontWeight: 600 }}>
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
        <div style={{
          background: '#ffffff',
          borderRadius: 12,
          padding: '24px 32px',
          minWidth: 330,
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          border: '1px solid #ddd',
          marginBottom: 12,
        }}>
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 18, color: '#15616D' }}>
            Bid Submitted Labor (Hours)
          </div>
          <dl style={{ margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <dt style={{ color: '#666' }}>Total Hours</dt>
              <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#E06C00' }}>
                {bidSubmittedLabor.totalHours.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </dd>
            </div>
          </dl>
          <div style={{ marginTop: 16, borderTop: '1px solid #ddd', paddingTop: 12 }}>
            <div style={{ color: '#666', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Breakdown
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {bidSubmittedLabor.breakdown.map((item) => (
                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: '#666' }}>{item.label}</span>
                  <span style={{ color: '#222', fontWeight: 600 }}>
                    {item.hours.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({item.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 16, borderTop: '1px solid #ddd', paddingTop: 12 }}>
            <div style={{ color: '#666', fontSize: 12, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              PM Hours
            </div>
            <dl style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <dt style={{ color: '#666' }}>Total Hours</dt>
                <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 14, color: '#E06C00' }}>
                  {pmHours.totalHours.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </dd>
              </div>
            </dl>
            {pmHours.breakdown.length > 0 && (
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {pmHours.breakdown.map((item) => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#666' }}>{item.label}</span>
                    <span style={{ color: '#222', fontWeight: 600 }}>
                      {item.hours.toLocaleString(undefined, { maximumFractionDigits: 0 })} ({item.percent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Unique project count by project number */}
      <div style={{ color: '#9ca3af', marginBottom: 24 }}>
        Project count: {
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
      />
    </main>
  );
}

// Funnel Chart Component
function FunnelChart({ statusGroups }: { statusGroups: Record<string, any> }) {
  // Define funnel stages in order
  const funnelStages = [
    { key: 'Estimating', label: 'Estimating', color: '#E06C00' },
    { key: 'Bid Submitted', label: 'Bid Submitted', color: '#15616D' },
    { key: 'Accepted', label: 'Accepted', color: '#15616D' },
    { key: 'In Progress', label: 'In Progress', color: '#E06C00' },
    { key: 'Complete', label: 'Complete', color: '#059669' },
  ];

  const getFunnelData = (stageKey: string) => {
    const data = statusGroups[stageKey];
    if (!data) return { sales: 0, count: 0 };
    
    // If it's the summary data, it has .sales and .count
    if (typeof data.sales === 'number') {
      return { sales: data.sales, count: data.count || 0 };
    }
    
    // Fallback if it was an array (shouldn't happen with displayStatusGroups)
    return { sales: 0, count: 0 };
  };

  // Calculate total unique projects across all funnel stages
  const totalProjects = funnelStages.reduce((sum, stage) => {
    return sum + getFunnelData(stage.key).count;
  }, 0);

  return (
    <div style={{ marginBottom: 48, background: '#ffffff', borderRadius: 12, padding: 32, border: '1px solid #ddd' }}>
      {/* Metrics Row */}
      <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 24 }}>
        {funnelStages.map((stage) => {
          const { count } = getFunnelData(stage.key);
          const percentage = totalProjects > 0 ? ((count / totalProjects) * 100).toFixed(1) : '0.0';
          return (
            <div key={stage.key} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>{stage.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#222', marginBottom: 2 }}>
                {count}
              </div>
              <div style={{ fontSize: 12, color: stage.color }}>
                {percentage}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Horizontal Funnel Bar */}
      <div style={{ display: 'flex', height: 120, gap: 2, marginBottom: 16 }}>
        {funnelStages.map((stage, index) => {
          const { count } = getFunnelData(stage.key);
          const percentage = totalProjects > 0 ? (count / totalProjects) * 100 : 0;
          const minWidth = 10; // Minimum width percentage
          const width = Math.max(percentage, minWidth);

          return (
            <div
              key={stage.key}
              style={{
                flex: width,
                background: stage.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{ 
                position: 'absolute', 
                bottom: -24, 
                fontSize: 12, 
                color: '#666',
                whiteSpace: 'nowrap'
              }}>
                Step {index + 1}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stage Labels */}
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 32 }}>
        {funnelStages.map((stage, index) => (
          <div key={stage.key} style={{ textAlign: 'center', fontSize: 12, color: '#666' }}>
            Step {index + 1}<br />{stage.label}
          </div>
        ))}
      </div>

      {/* Lost Section */}
      {statusGroups['Lost'] && (
        <div style={{ marginTop: 32, padding: 20, background: '#fff5f5', borderRadius: 8, border: '1px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, color: '#666' }}>Lost Opportunities</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444', marginTop: 4 }}>
                {getFunnelData('Lost').count} projects
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#ef4444' }}>
                ${getFunnelData('Lost').sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                {totalProjects > 0 ? (getFunnelData('Lost').count / totalProjects * 100).toFixed(1) : '0.0'}% dropoff
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type SummaryCardProps = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  large?: boolean;
};

function SummaryCard({ label, value, prefix = '', suffix = '', decimals = 0, large = false }: SummaryCardProps) {
  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 12,
      padding: large ? '24px 20px' : '20px 32px',
      minWidth: large ? 180 : 120,
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      border: '1px solid #ddd',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: large ? 14 : 16, color: '#666', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: large ? 36 : 28, fontWeight: 700, color: '#E06C00' }}>
        {prefix}{value?.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
      </div>
    </div>
  );
}


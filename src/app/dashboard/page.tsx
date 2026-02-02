"use client";
import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
// Dynamically import Chart.js to avoid SSR issues
const Line = dynamic(() => import('react-chartjs-2').then(mod => mod.Line), { ssr: false });
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";
import { JobsListModal, JobDetailsModal } from "./DrillThroughModals";

type Project = {
  id: string;
  [key: string]: any;
};

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [jobsListOpen, setJobsListOpen] = useState(false);
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Project | null>(null);
  const [jobsListData, setJobsListData] = useState<Project[]>([]);
  const [jobsListTitle, setJobsListTitle] = useState("");

  useEffect(() => {
    async function fetchData() {
      const querySnapshot = await getDocs(collection(db, "projects"));
      const data = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setProjects(data);
      setLoading(false);
    }
    fetchData();
  }, []);


  if (loading) {
    return (
      <main className="p-8" style={{ background: '#1a1d23', minHeight: '100vh', color: '#e5e7eb' }}>
        <div>Loading...</div>
      </main>
    );
  }

  const parseDateValue = (value: any) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string") {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === "object" && typeof value.toDate === "function") {
      const d = value.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
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

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (p.projectArchived) return false;
      
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
      const estimator = (p.estimator ?? "").toString().trim();
      if (!estimator) return false;
      if (estimator.toLowerCase() === "todd gilmore") return false;
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      return true;
    });
  }, [projects, startDate, endDate]);

  const { aggregated: aggregatedProjects, dedupedByCustomer } = useMemo(() => {
    const activeProjects = filteredProjects;
    
    // Group by project number/name to find duplicates with different customers
    const projectIdentifierMap = new Map<string, Project[]>();
    activeProjects.forEach((project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      
      if (!projectIdentifierMap.has(identifier)) {
        projectIdentifierMap.set(identifier, []);
      }
      projectIdentifierMap.get(identifier)!.push(project);
    });
    
    // For each project identifier, keep only the most recent customer version
    const dedupedByCustomer: Project[] = [];
    projectIdentifierMap.forEach((projectList, identifier) => {
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
        let selectedCustomer: string = "";
        let selectedProjects: Project[] = [];
        
        // First, check if any customer has priority status
        let foundPriorityCustomer = false;
        customerMap.forEach((projs, customer) => {
          const hasPriorityStatus = projs.some(p => priorityStatuses.includes(p.status || ""));
          if (hasPriorityStatus && !foundPriorityCustomer) {
            selectedCustomer = customer;
            selectedProjects = projs;
            foundPriorityCustomer = true;
          }
        });
        
        // If no priority status found, use date logic
        if (!foundPriorityCustomer) {
          let latestCustomer: string = "";
          let latestDate: Date | null = null;
          
          customerMap.forEach((projs, customer) => {
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
              latestCustomer = customer;
            }
          });
          
          selectedCustomer = latestCustomer;
          selectedProjects = customerMap.get(latestCustomer) || [];
        }
        
        // Only keep projects from the selected customer
        dedupedByCustomer.push(...selectedProjects);
      } else {
        // Only one customer, keep all
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });
    
    // Now aggregate by projectNumber + customer
    // First group all projects by key
    const keyGroupMap = new Map<string, Project[]>();
    dedupedByCustomer.forEach((project) => {
      const key = getProjectKey(project);
      if (!keyGroupMap.has(key)) {
        keyGroupMap.set(key, []);
      }
      keyGroupMap.get(key)!.push(project);
    });
    
    // Then for each group, apply tiebreaker logic and aggregate
    const map = new Map<string, Project>();
    keyGroupMap.forEach((projects, key) => {
      // Sort by projectName alphabetically for tiebreaker
      const sortedProjects = projects.sort((a, b) => {
        const nameA = (a.projectName ?? "").toString().toLowerCase();
        const nameB = (b.projectName ?? "").toString().toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      // Use first project alphabetically as base, then sum all values
      const baseProject = { ...sortedProjects[0] };
      
      // Sum all values
      baseProject.sales = sortedProjects.reduce((sum, p) => sum + (p.sales ?? 0), 0);
      baseProject.cost = sortedProjects.reduce((sum, p) => sum + (p.cost ?? 0), 0);
      baseProject.hours = sortedProjects.reduce((sum, p) => sum + (p.hours ?? 0), 0);
      baseProject.laborSales = sortedProjects.reduce((sum, p) => sum + (p.laborSales ?? 0), 0);
      baseProject.laborCost = sortedProjects.reduce((sum, p) => sum + (p.laborCost ?? 0), 0);
      
      // Keep the most recent date across all
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
  }, [filteredProjects]);

  // Calculate summary metrics
  const totalSales = aggregatedProjects.reduce((sum, p) => sum + (p.sales ?? 0), 0);
  const totalCost = aggregatedProjects.reduce((sum, p) => sum + (p.cost ?? 0), 0);
  const totalHours = aggregatedProjects.reduce((sum, p) => sum + (p.hours ?? 0), 0);
  const rph = totalHours ? totalSales / totalHours : 0;
  const markup = totalCost ? ((totalSales - totalCost) / totalCost) * 100 : 0;

  // Group by status
  const statusGroups: Record<string, typeof aggregatedProjects> = {};
  aggregatedProjects.forEach((p) => {
    const status = p.status || 'Unknown';
    if (!statusGroups[status]) statusGroups[status] = [];
    statusGroups[status].push(p);
  });

  const statusGroupsForLabor = useMemo(() => {
    const groups: Record<string, Project[]> = {};
    dedupedByCustomer.forEach((p) => {
      const status = p.status || 'Unknown';
      if (!groups[status]) groups[status] = [];
      groups[status].push(p);
    });
    return groups;
  }, [dedupedByCustomer]);

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
    const bidProjects = statusGroupsForLabor['Bid Submitted'] || [];
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

    const totalHours = Object.values(totals).reduce((sum, value) => sum + value, 0);
    const breakdown = Object.entries(totals).map(([label, value]) => ({
      label,
      hours: value,
      percent: totalHours > 0 ? (value / totalHours) * 100 : 0,
    }));

    return { totalHours, breakdown };
  }, [statusGroupsForLabor]);

  const pmHours = useMemo(() => {
    const allProjects = (statusGroupsForLabor['Bid Submitted'] || []).filter(
      p => !p.projectArchived
    );
    const pmGroupTotals: Record<string, number> = {};
    
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

    const totalHours = Object.values(pmGroupTotals).reduce((sum, value) => sum + value, 0);
    const breakdown = Object.entries(pmGroupTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([label, hours]) => ({
        label,
        hours,
        percent: totalHours > 0 ? (hours / totalHours) * 100 : 0,
      }));

    return { totalHours, breakdown };
  }, [statusGroupsForLabor]);

  // Calculate win rate including archived jobs as lost
  // For win rate, we need to count archived projects with same filters applied
  const archivedProjects = projects.filter(p => {
    if (!p.projectArchived) return false;
    // Apply same exclusion filters as activeProjects
    const customer = (p.customer ?? "").toString().toLowerCase();
    if (customer.includes("sop inc")) return false;
    const projectName = (p.projectName ?? "").toString().toLowerCase();
    if (projectName === "pmc operations") return false;
    if (projectName === "pmc shop time") return false;
    if (projectName === "pmc test project") return false;
    if (projectName.includes("sandbox")) return false;
    if (projectName.includes("raymond king")) return false;
    if (projectName === "alexander drive addition latest") return false;
    const estimator = (p.estimator ?? "").toString().trim();
    if (!estimator) return false;
    if (estimator.toLowerCase() === "todd gilmore") return false;
    const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
    if (projectNumber === "701 poplar church rd") return false;
    return true;
  });
  const archivedCount = new Set(archivedProjects.map(p => getProjectKey(p))).size;
  
  const getUniqueProjectCount = (statusKey: string) => {
    const group = statusGroups[statusKey] || [];
    return new Set(group.map(p => getProjectKey(p))).size;
  };
  
  const wonProjects = getUniqueProjectCount('Complete') + getUniqueProjectCount('In Progress') + getUniqueProjectCount('Accepted');
  const totalBids = getUniqueProjectCount('Bid Submitted') + getUniqueProjectCount('Lost') + archivedCount;
  const winRate = totalBids > 0 ? (wonProjects / totalBids) * 100 : 0;

  return (
    <main className="p-8" style={{ fontFamily: 'sans-serif', background: '#f5f5f5', minHeight: '100vh', color: '#222' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ color: '#003DA5', fontSize: 32, margin: 0 }}>Paradise Masonry Estimating Dashboard</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="/scheduling" style={{ padding: '8px 16px', background: '#003DA5', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>
            Scheduling
          </a>
          <a href="/wip" style={{ padding: '8px 16px', background: '#0066CC', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>
            WIP Report
          </a>
          <a href="/long-term-schedule" style={{ padding: '8px 16px', background: '#10b981', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>
            Long-Term Schedule
          </a>
        </div>
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
                background: '#0066CC',
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
          <div style={{ color: '#0066CC', fontSize: 14, marginLeft: 'auto' }}>
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
      <h2 style={{ color: '#003DA5', marginBottom: 24, fontSize: 24 }}>Sales Funnel</h2>
      <FunnelChart statusGroups={statusGroups} />
      
      <h2 style={{ color: '#003DA5', marginBottom: 24, marginTop: 64, fontSize: 24 }}>Status Breakdown</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 48 }}>
        {Object.entries(statusGroups).map(([status, group]) => {
          const sales = group.reduce((sum, p) => sum + (p.sales ?? 0), 0);
          const cost = group.reduce((sum, p) => sum + (p.cost ?? 0), 0);
          const hours = group.reduce((sum, p) => sum + (p.hours ?? 0), 0);
          const rph = hours ? sales / hours : 0;
          const markup = cost ? ((sales - cost) / cost) * 100 : 0;
          const excludedGroupPatterns = ['part', 'equipment', 'subcontract'];
          const laborGroupSource = statusGroupsForLabor[status] || [];
          const laborByGroup = laborGroupSource.reduce((acc, p) => {
            const key = (p.pmcGroup ?? 'Unassigned').toString().trim() || 'Unassigned';
            const labor = Number(p.hours ?? 0);
            acc[key] = (acc[key] ?? 0) + (Number.isFinite(labor) ? labor : 0);
            return acc;
          }, {} as Record<string, number>);
          const laborGroupEntries = Object.entries(laborByGroup)
            .filter(([groupName, value]) => {
              if (value === 0) return false;
              const normalized = groupName.toLowerCase();
              return !excludedGroupPatterns.some((pattern) => normalized.includes(pattern));
            })
            .sort((a, b) => b[1] - a[1]);
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
              <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 18, color: '#003DA5' }}>{status}</div>
              <dl style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#666' }}>Sales</dt>
                  <dd 
                    style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#0066CC', cursor: 'pointer' }}
                    onClick={() => {
                      setJobsListData(group);
                      setJobsListTitle(`${status} Projects`);
                      setJobsListOpen(true);
                    }}
                  >
                    {`$${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                  </dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#9ca3af' }}>Cost</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#e5e7eb' }}>{`$${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#9ca3af' }}>Hours</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#e5e7eb' }}>{hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#9ca3af' }}>RPH</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#e5e7eb' }}>{`$${rph.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <dt style={{ color: '#9ca3af' }}>Markup %</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#e5e7eb' }}>{`${markup.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</dd>
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
                          {labor.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
          <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 18, color: '#003DA5' }}>
            Bid Submitted Labor (Hours)
          </div>
          <dl style={{ margin: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <dt style={{ color: '#666' }}>Total Hours</dt>
              <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#0066CC' }}>
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
                <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 14, color: '#0066CC' }}>
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
          Array.from(
            new Set(
              aggregatedProjects
                .filter(p => ['Bid Submitted', 'In Progress', 'Accepted'].includes(p.status || ''))
                .map(p => getProjectKey(p))
            )
          ).length
        }
      </div>

      {/* Time Series Line Chart by Month/Year for Hours by Status */}
      <div style={{ marginTop: 64, background: '#2b2d31', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.3)', border: '1px solid #3a3d42', padding: 32 }}>
        <h2 style={{ marginBottom: 24, color: '#fff', fontSize: 20 }}>Hours by Month/Year (Submitted, In Progress, Accepted)</h2>
        <TimeSeriesChart projects={aggregatedProjects} />
      </div>

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
      />
    </main>
  );
}

// Funnel Chart Component
function FunnelChart({ statusGroups }: { statusGroups: Record<string, any[]> }) {
  // Define funnel stages in order
  const funnelStages = [
    { key: 'Estimating', label: 'Estimating', color: '#0066CC' },
    { key: 'Bid Submitted', label: 'Bid Submitted', color: '#003DA5' },
    { key: 'Accepted', label: 'Accepted', color: '#10b981' },
    { key: 'In Progress', label: 'In Progress', color: '#f59e0b' },
    { key: 'Complete', label: 'Complete', color: '#059669' },
  ];

  const getFunnelData = (stageKey: string) => {
    const group = statusGroups[stageKey] || [];
    const sales = group.reduce((sum, p) => sum + (p.sales ?? 0), 0);
    // Count distinct customer+projectNumber combinations
    const uniqueProjects = new Set(
      group.map(p => ((p.projectNumber ?? p.id) || "").toString().trim())
    );
    const count = uniqueProjects.size;
    return { sales, count };
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
          const { sales, count } = getFunnelData(stage.key);
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
      {statusGroups['Lost'] && statusGroups['Lost'].length > 0 && (
        <div style={{ marginTop: 32, padding: 20, background: '#fff5f5', borderRadius: 8, border: '1px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, color: '#666' }}>Lost Opportunities</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444', marginTop: 4 }}>
                {new Set(statusGroups['Lost'].map(p => ((p.projectNumber ?? p.id) || "").toString().trim())).size} projects
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#ef4444' }}>
                ${(statusGroups['Lost'].reduce((sum, p) => sum + (p.sales ?? 0), 0) / 1000000).toFixed(1)}M
              </div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
                {((new Set(statusGroups['Lost'].map(p => ((p.projectNumber ?? p.id) || "").toString().trim())).size / totalProjects) * 100).toFixed(1)}% dropoff
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Time series chart component
function TimeSeriesChart({ projects }: { projects: any[] }) {
  // Helper to get YYYY-MM from a date string
  function getMonthYear(dateStr: string) {
    if (!dateStr) return 'Unknown';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Unknown';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // Aggregate hours by month/year and status
  const statusKeys = [
    { key: 'In Progress', color: 'rgba(255, 206, 86, 1)' },
    { key: 'Accepted', color: 'rgba(75, 192, 192, 1)' },
    { key: 'Bid Submitted', color: 'rgba(153, 102, 255, 1)' },
  ];
  const dataByStatus: Record<string, Record<string, number>> = {};
  statusKeys.forEach(({ key }) => (dataByStatus[key] = {}));

  projects.forEach((p) => {
    const status = p.status;
    const date = p.dateCreated || p.dateUpdated;
    const monthYear = getMonthYear(date);
    const hours = Number(p.hours ?? 0);
    statusKeys.forEach(({ key }) => {
      if (status === key) {
        dataByStatus[key][monthYear] = (dataByStatus[key][monthYear] || 0) + hours;
      }
    });
  });

  // Get all unique month/year labels, sorted
  const allMonths = Array.from(
    new Set(
      statusKeys.flatMap(({ key }) => Object.keys(dataByStatus[key]))
    )
  ).filter(m => m !== 'Unknown').sort();

  const chartData = {
    labels: allMonths,
    datasets: statusKeys.map(({ key, color }) => ({
      label: key,
      data: allMonths.map(month => dataByStatus[key][month] || 0),
      borderColor: color,
      backgroundColor: color.replace('1)', '0.2)'),
      tension: 0.3,
      fill: false,
      yAxisID: key === 'Bid Submitted' ? 'y1' : 'y',
    })),
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'top' as const },
      title: { display: false },
    },
    scales: {
      y: {
        type: 'linear' as const,
        beginAtZero: true,
        title: { display: true, text: 'Hours (Submitted, In Progress, Accepted)' },
        position: 'left' as const,
      },
      y1: {
        type: 'linear' as const,
        beginAtZero: true,
        title: { display: true, text: 'Hours (Bid Submitted)' },
        position: 'right' as const,
        grid: { drawOnChartArea: false },
      },
      x: { title: { display: true, text: 'Month/Year' } },
    },
  };

  return (
    <div style={{ width: '100%', minHeight: 400 }}>
      <Line data={chartData} options={options} />
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
      <div style={{ fontSize: large ? 36 : 28, fontWeight: 700, color: '#0066CC' }}>
        {prefix}{value?.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
      </div>
    </div>
  );
}
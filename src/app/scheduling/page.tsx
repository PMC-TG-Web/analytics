"use client";
import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

type Project = {
  id: string;
  customer?: string;
  projectName?: string;
  projectNumber?: string;
  hours?: number;
  status?: string;
};

type JobSchedule = {
  jobKey: string;
  customer: string;
  projectName: string;
  status: string;
  totalHours: number;
  allocations: Record<string, number>;
};

function formatMonthLabel(month: string) {
  const [year, m] = month.split("-");
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function parseDateValue(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value.toDate) return value.toDate();
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function getNextMonths(count: number) {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export default function SchedulingPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [schedules, setSchedules] = useState<JobSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("schedulingMonths");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return getNextMonths(6);
        }
      }
    }
    return getNextMonths(6);
  });
  const [saving, setSaving] = useState(false);
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [jobFilter, setJobFilter] = useState<string>("");
  const [sortColumn, setSortColumn] = useState<string>("customer");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [savingJobKey, setSavingJobKey] = useState<string>("");

  useEffect(() => {
    async function fetchData() {
      try {
        const projectsSnapshot = await getDocs(collection(db, "projects"));
        const projectsData = projectsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as Omit<Project, "id">),
        }));
        setProjects(projectsData);

        const schedulesRes = await fetch("/api/scheduling");
        const schedulesJson = await schedulesRes.json();
        const schedulesArray = (schedulesJson.data || []).map((s: any) => ({
          jobKey: s.jobKey,
          customer: s.customer,
          projectName: s.projectName,
          status: s.status || "Unknown",
          totalHours: s.totalHours,
          allocations: s.allocations.reduce((acc: Record<string, number>, alloc: any) => {
            acc[alloc.month] = alloc.percent;
            return acc;
          }, {}),
        }));
        setSchedules(schedulesArray);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    // Save months to localStorage and optionally to database
    localStorage.setItem("schedulingMonths", JSON.stringify(months));
  }, [months]);

  const uniqueJobs = useMemo(() => {
    const qualifyingStatuses = ["Accepted", "In Progress"];
    const priorityStatuses = ["Accepted", "In Progress", "Complete"];
    
    // Step 1: Filter active projects with exclusions
    const activeProjects = projects.filter((p) => {
      if ((p as any).projectArchived) return false;
      const customer = (p.customer ?? "").toString().toLowerCase();
      if (customer.includes("sop inc")) return false;
      const projectName = (p.projectName ?? "").toString().toLowerCase();
      if (projectName === "pmc operations") return false;
      if (projectName === "pmc shop time") return false;
      if (projectName === "pmc test project") return false;
      if (projectName.includes("sandbox")) return false;
      if (projectName.includes("raymond king")) return false;
      if (projectName === "alexander drive addition latest") return false;
      const estimator = ((p as any).estimator ?? "").toString().trim();
      if (!estimator) return false;
      if (estimator.toLowerCase() === "todd gilmore") return false;
      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;
      return true;
    });
    
    // Step 2: Group by project identifier to find duplicates with different customers
    const projectIdentifierMap = new Map<string, typeof activeProjects>();
    activeProjects.forEach((project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      if (!projectIdentifierMap.has(identifier)) {
        projectIdentifierMap.set(identifier, []);
      }
      projectIdentifierMap.get(identifier)!.push(project);
    });
    
    // Step 3: Deduplicate by customer (pick one customer per project identifier)
    const dedupedByCustomer: typeof activeProjects = [];
    projectIdentifierMap.forEach((projectList) => {
      const customerMap = new Map<string, typeof projectList>();
      projectList.forEach(p => {
        const customer = (p.customer ?? "").toString().trim();
        if (!customerMap.has(customer)) {
          customerMap.set(customer, []);
        }
        customerMap.get(customer)!.push(p);
      });
      
      if (customerMap.size > 1) {
        let selectedCustomer = "";
        let selectedProjects: typeof projectList = [];
        let foundPriorityCustomer = false;
        
        customerMap.forEach((projs, customer) => {
          const hasPriorityStatus = projs.some(p => priorityStatuses.includes(p.status || ""));
          if (hasPriorityStatus && !foundPriorityCustomer) {
            selectedCustomer = customer;
            selectedProjects = projs;
            foundPriorityCustomer = true;
          }
        });
        
        if (!foundPriorityCustomer) {
          let latestCustomer = "";
          let latestDate: Date | null = null;
          
          customerMap.forEach((projs, customer) => {
            const mostRecentProj = projs.reduce((latest, current) => {
              const currentDate = parseDateValue((current as any).dateCreated);
              const latestDateVal = parseDateValue((latest as any).dateCreated);
              if (!currentDate) return latest;
              if (!latestDateVal) return current;
              return currentDate > latestDateVal ? current : latest;
            }, projs[0]);
            
            const projDate = parseDateValue((mostRecentProj as any).dateCreated);
            if (projDate && (!latestDate || projDate > latestDate)) {
              latestDate = projDate;
              latestCustomer = customer;
            }
          });
          
          selectedCustomer = latestCustomer;
          selectedProjects = customerMap.get(latestCustomer) || [];
        }
        
        dedupedByCustomer.push(...selectedProjects);
      } else {
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });
    
    // Step 4: Filter by qualifying statuses
    const filteredByStatus = dedupedByCustomer.filter(p => qualifyingStatuses.includes(p.status || ""));
    
    // Step 5: Group by key (projectNumber + customer)
    const keyMap = new Map<string, typeof filteredByStatus>();
    filteredByStatus.forEach((p) => {
      const key = `${p.customer ?? ""}|${p.projectNumber ?? ""}|${p.projectName ?? ""}`;
      if (!keyMap.has(key)) {
        keyMap.set(key, []);
      }
      keyMap.get(key)!.push(p);
    });
    
    // Step 6: Apply alphabetic tiebreaker and aggregate
    const results: Array<{ key: string; customer: string; projectName: string; status: string; totalHours: number }> = [];
    keyMap.forEach((projectGroup, key) => {
      const sorted = projectGroup.sort((a, b) => {
        const nameA = (a.projectName ?? "").toString().toLowerCase();
        const nameB = (b.projectName ?? "").toString().toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      const representative = sorted[0];
      const totalHours = projectGroup.reduce((sum, p) => sum + (p.hours ?? 0), 0);
      
      results.push({
        key,
        customer: representative.customer ?? "Unknown",
        projectName: representative.projectName ?? "Unnamed",
        status: representative.status ?? "Unknown",
        totalHours,
      });
    });
    
    return results;
  }, [projects]);

  function updatePercent(jobKey: string, month: string, percent: number) {
    const validPercent = Math.max(0, Math.min(100, isNaN(percent) ? 0 : percent));
    setSchedules((prev) => {
      const existing = prev.find((s) => s.jobKey === jobKey);
      if (existing) {
        // Update existing schedule
        return prev.map((s) =>
          s.jobKey === jobKey
            ? { ...s, allocations: { ...s.allocations, [month]: validPercent } }
            : s
        );
      } else {
        // Add new schedule if it doesn't exist yet
        const job = uniqueJobs.find((j) => j.key === jobKey);
        if (!job) return prev;
        
        const allocations: Record<string, number> = {};
        months.forEach((m) => {
          allocations[m] = m === month ? validPercent : 0;
        });
        
        return [
          ...prev,
          {
            jobKey: job.key,
            customer: job.customer,
            projectName: job.projectName,
            status: job.status,
            totalHours: job.totalHours,
            allocations,
          },
        ];
      }
    });
  }

  function addMonth() {
    const last = months[months.length - 1];
    const [year, m] = last.split("-");
    const next = new Date(Number(year), Number(m), 1);
    const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
    setMonths((prev) => [...prev, nextMonth]);
  }

  async function saveSchedule(jobKey: string) {
    setSavingJobKey(jobKey);
    try {
      // Find the job in allJobs (which includes both saved schedules and new jobs)
      const job = allJobs.find((j) => j.jobKey === jobKey);
      if (!job) {
        console.error("Job not found:", jobKey);
        return;
      }

      const allocations = months.map((month) => ({
        month,
        percent: job.allocations[month] || 0,
      }));

      const projectInfo = uniqueJobs.find((j) => j.key === job.jobKey);
      const projectNumber = projectInfo?.key.split("|")[1] || "";

      await fetch("/api/scheduling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobKey: job.jobKey,
          customer: job.customer,
          projectNumber: projectNumber,
          projectName: job.projectName,
          status: job.status,
          totalHours: job.totalHours,
          allocations,
        }),
      });
      alert("Schedule saved successfully!");
    } catch (error) {
      console.error("Failed to save schedule:", error);
      alert("Failed to save schedule");
    } finally {
      setSavingJobKey("");
    }
  }

  async function saveAllSchedules() {
    setSaving(true);
    try {
      for (const schedule of schedules) {
        const allocations = months.map((month) => ({
          month,
          percent: schedule.allocations[month] || 0,
        }));

        const job = uniqueJobs.find((j) => j.key === schedule.jobKey);
        if (!job) continue;

        await fetch("/api/scheduling", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobKey: schedule.jobKey,
            customer: schedule.customer,
            projectNumber: job.key.split("|")[1],
            projectName: schedule.projectName,
            status: schedule.status,
            totalHours: schedule.totalHours,
            allocations,
          }),
        });
      }
      alert("All schedules saved successfully!");
    } catch (error) {
      console.error("Failed to save schedules:", error);
      alert("Failed to save schedules");
    } finally {
      setSaving(false);
    }
  }

  const allJobs = useMemo(() => {
    // Ensure all existing schedules have all months initialized and get current status
    const updatedSchedules = schedules.map((schedule) => {
      const allocations: Record<string, number> = {};
      months.forEach((month) => {
        allocations[month] = schedule.allocations[month] ?? 0;
      });
      // Get current status from uniqueJobs (projects data) to keep it up to date
      const currentJob = uniqueJobs.find((j) => j.key === schedule.jobKey);
      return { 
        ...schedule, 
        allocations,
        status: currentJob?.status || schedule.status || "Unknown",
        totalHours: currentJob?.totalHours || schedule.totalHours || 0,
      };
    });

    const existing = new Set(updatedSchedules.map((s) => s.jobKey));
    const toAdd = uniqueJobs.filter((job) => !existing.has(job.key)).map((job) => {
      const allocations: Record<string, number> = {};
      months.forEach((month) => {
        allocations[month] = 0;
      });
      return {
        jobKey: job.key,
        customer: job.customer,
        projectName: job.projectName,
        status: job.status,
        totalHours: job.totalHours,
        allocations,
      };
    });
    return [...updatedSchedules, ...toAdd];
  }, [schedules, uniqueJobs, months]);

  const uniqueCustomers = useMemo(() => {
    return Array.from(new Set(allJobs.map((j) => j.customer))).sort();
  }, [allJobs]);

  const filteredJobs = useMemo(() => {
    const filtered = allJobs.filter((job) => {
      const customerMatch = !customerFilter || job.customer === customerFilter;
      const jobMatch = !jobFilter || job.projectName.toLowerCase().includes(jobFilter.toLowerCase());
      const hasHours = job.totalHours > 0;
      return customerMatch && jobMatch && hasHours;
    });

    const sorted = [...filtered].sort((a, b) => {
      // Check if sorting by a month column
      if (months.includes(sortColumn)) {
        const aVal = a.allocations[sortColumn] || 0;
        const bVal = b.allocations[sortColumn] || 0;
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      // Sort by regular columns
      let aVal: any = a[sortColumn as keyof JobSchedule];
      let bVal: any = b[sortColumn as keyof JobSchedule];

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal || "").toLowerCase();
      const bStr = String(bVal || "").toLowerCase();
      const comparison = aStr.localeCompare(bStr);
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [allJobs, customerFilter, jobFilter, sortColumn, sortDirection]);

  // Calculate unscheduled hours
  const unscheduledHoursCalc = useMemo(() => {
    const totalQualifyingHours = uniqueJobs.reduce((sum, job) => sum + job.totalHours, 0);
    
    const totalScheduledHours = allJobs.reduce((sum, job) => {
      const jobScheduledHours = months.reduce((jobSum, month) => {
        const allocation = job.allocations[month] || 0;
        return jobSum + (job.totalHours * (allocation / 100));
      }, 0);
      return sum + jobScheduledHours;
    }, 0);
    
    return {
      totalQualifying: totalQualifyingHours,
      totalScheduled: totalScheduledHours,
      unscheduled: totalQualifyingHours - totalScheduledHours,
    };
  }, [uniqueJobs, allJobs, months]);

  function handleSort(column: string) {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }

  function clearFilters() {
    setCustomerFilter("");
    setJobFilter("");
  }

  if (loading) {
    return (
      <main className="p-8" style={{ background: "#1a1d23", minHeight: "100vh", color: "#e5e7eb" }}>
        <div>Loading...</div>
      </main>
    );
  }

  return (
    <main className="p-8" style={{ fontFamily: "sans-serif", background: "#f5f5f5", minHeight: "100vh", color: "#222" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ color: "#003DA5", fontSize: 32, margin: 0 }}>Scheduling</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/dashboard" style={{ padding: "8px 16px", background: "#003DA5", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>
            Dashboard
          </a>
          <a href="/wip" style={{ padding: "8px 16px", background: "#0066CC", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 700 }}>
            WIP Report
          </a>
        </div>
      </div>

      <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd", marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ color: "#fff", fontSize: 20, margin: 0 }}>Scheduled Hours by Month</h2>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#666", fontSize: 12, marginBottom: 4 }}>Total Qualifying Hours</div>
              <div style={{ color: "#0066CC", fontSize: 20, fontWeight: 700 }}>{Math.round(unscheduledHoursCalc.totalQualifying)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#666", fontSize: 12, marginBottom: 4 }}>Total Scheduled</div>
              <div style={{ color: "#10b981", fontSize: 20, fontWeight: 700 }}>{Math.round(unscheduledHoursCalc.totalScheduled)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#666", fontSize: 12, marginBottom: 4 }}>Unscheduled Hours</div>
              <div style={{ color: unscheduledHoursCalc.unscheduled > 0 ? "#ef4444" : "#0066CC", fontSize: 20, fontWeight: 700 }}>
                {Math.round(unscheduledHoursCalc.unscheduled)}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${months.length}, 1fr)`, gap: 12 }}>
          {months.map((month) => {
            const totalHours = allJobs.reduce((sum, job) => {
              const allocation = job.allocations[month] || 0;
              return sum + (job.totalHours * (allocation / 100));
            }, 0);
            return (
              <div key={month} style={{ background: "#ffffff", padding: 16, borderRadius: 8, border: "1px solid #ddd", textAlign: "center" }}>
                <div style={{ color: "#666", fontSize: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {formatMonthLabel(month)}
                </div>
                <div style={{ color: "#0066CC", fontSize: 24, fontWeight: 700 }}>
                  {Math.round(totalHours)}
                </div>
                <div style={{ color: "#999", fontSize: 11, marginTop: 4 }}>hours</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "#ffffff", borderRadius: 12, padding: 24, border: "1px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ color: "#fff", fontSize: 20, margin: 0 }}>Jobs</h2>
          <button
            onClick={addMonth}
            style={{
              padding: "8px 12px",
              background: "#22c55e",
              borderRadius: 8,
              border: "none",
              color: "#0b1215",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            + Add Month
          </button>
        </div>

        <div style={{ maxHeight: "500px", overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr style={{ borderBottom: "2px solid #ddd", background: "#f9f9f9" }}>
                <th onClick={() => handleSort("customer")} style={{ textAlign: "left", padding: "12px 8px", color: sortColumn === "customer" ? "#0066CC" : "#666", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                  Customer {sortColumn === "customer" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("projectName")} style={{ textAlign: "left", padding: "12px 8px", color: sortColumn === "projectName" ? "#0066CC" : "#666", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                  Job Name {sortColumn === "projectName" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("status")} style={{ textAlign: "left", padding: "12px 8px", color: sortColumn === "status" ? "#0066CC" : "#666", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                  Status {sortColumn === "status" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("totalHours")} style={{ textAlign: "right", padding: "12px 8px", color: sortColumn === "totalHours" ? "#0066CC" : "#666", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                  Total Hours {sortColumn === "totalHours" && (sortDirection === "asc" ? "↑" : "↓")}
                </th>
                <th style={{ textAlign: "right", padding: "12px 8px", color: "#9ca3af", fontWeight: 600 }}>Scheduled Hours</th>
                {months.map((month) => (
                  <th key={month} onClick={() => handleSort(month)} style={{ textAlign: "center", padding: "12px 8px", color: sortColumn === month ? "#22c55e" : "#9ca3af", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>
                    {formatMonthLabel(month)} {sortColumn === month && (sortDirection === "asc" ? "↑" : "↓")}
                  </th>
                ))}
                <th style={{ textAlign: "center", padding: "12px 8px", color: "#9ca3af", fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map((job) => {
                const statusColor = job.status === "Accepted" ? "#10b981" : job.status === "In Progress" ? "#f59e0b" : "#ef4444";
                return (
                  <tr key={job.jobKey} style={{ borderBottom: "1px solid #eee", background: "#fafafa" }}>
                    <td style={{ padding: "12px 8px", color: "#222" }}>{job.customer}</td>
                    <td style={{ padding: "12px 8px", color: "#222" }}>{job.projectName}</td>
                    <td style={{ padding: "12px 8px", color: statusColor, fontWeight: 600 }}>{job.status}</td>
                    <td style={{ padding: "12px 8px", color: "#0066CC", fontWeight: 700, textAlign: "right" }}>
                      {job.totalHours.toLocaleString()}
                    </td>
                    <td style={{ padding: "12px 8px", color: "#10b981", fontWeight: 700, textAlign: "right" }}>
                      {Math.round(job.totalHours * (Object.values(job.allocations).reduce((sum, val) => sum + (val || 0), 0) / 100))}
                    </td>
                    {months.map((month) => {
                      const value = job.allocations[month];
                      return (
                        <td key={`${job.jobKey}-${month}`} style={{ padding: "8px", textAlign: "center" }}>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={value === 0 || value === undefined ? '' : value}
                            onChange={(e) => updatePercent(job.jobKey, month, parseInt(e.target.value || "0", 10))}
                            style={{
                              width: "60px",
                              padding: "6px 8px",
                              borderRadius: 6,
                              background: "#fff",
                              color: "#222",
                              border: "1px solid #ddd",
                              textAlign: "center",
                            }}
                          />
                        </td>
                      );
                    })}
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <button
                        onClick={() => saveSchedule(job.jobKey)}
                        disabled={savingJobKey === job.jobKey}
                        style={{
                          padding: "6px 12px",
                          background: savingJobKey === job.jobKey ? "#4b5563" : "#3b82f6",
                          borderRadius: 6,
                          border: "none",
                          color: "#fff",
                          fontWeight: 600,
                          cursor: savingJobKey === job.jobKey ? "not-allowed" : "pointer",
                          fontSize: "12px",
                          opacity: savingJobKey === job.jobKey ? 0.6 : 1,
                        }}
                      >
                        {savingJobKey === job.jobKey ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <button
        onClick={saveAllSchedules}
        disabled={saving}
        style={{
          padding: "10px 16px",
          background: "#3b82f6",
          borderRadius: 8,
          border: "none",
          color: "#fff",
          fontWeight: 700,
          cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 1,
          marginTop: "20px",
        }}
      >
        {saving ? "Saving..." : "Save All Schedules"}
      </button>

      </main>
  );
}
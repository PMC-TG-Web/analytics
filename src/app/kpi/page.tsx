"use client";
import React, { useEffect, useState, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
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
  Filler,
  ChartOptions,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

type Schedule = {
  id: string;
  jobKey: string;
  customer?: string;
  projectNumber?: string;
  projectName?: string;
  totalHours: number;
  allocations: Array<{ month: string; percent: number }>;
  status?: string;
};

type Project = {
  id: string;
  projectNumber?: string;
  projectName?: string;
  customer?: string;
  status?: string;
  sales?: number;
  cost?: number;
  hours?: number;
  ProjectUpdateDate?: any;
  projectUpdateDate?: any;
  dateCreated?: any;
  dateUpdated?: any;
  projectArchived?: boolean;
  estimator?: string;
  projectManager?: string;
};

type KPIDrilldownEntry = {
  id: string;
  projectName: string;
  projectNumber: string;
  customer: string;
  value: number;
  dateLabel: string;
};

function parseDateValue(value: any) {
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
  if (typeof value === "object" && typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  return null;
}

function isExcludedFromKPI(project: Project) {
  if (project.projectArchived) return true;

  const status = (project.status || "").toString().toLowerCase().trim();
  if (status === "invitations" || status === "to do" || status === "todo" || status === "to-do") return true;

  const customer = (project.customer ?? "").toString().toLowerCase();
  if (customer.includes("sop inc")) return true;

  const projectName = (project.projectName ?? "").toString().toLowerCase();
  const excludedNames = ["pmc operations", "pmc shop time", "pmc test project"];
  if (excludedNames.includes(projectName)) return true;
  if (projectName.includes("sandbox")) return true;
  if (projectName.includes("raymond king")) return true;

  const projectNumber = (project.projectNumber ?? "").toString().toLowerCase();
  if (projectNumber === "701 poplar church rd") return true;

  return false;
}

function isValidMonthKey(month: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function normalizeAllocations(allocations: any): Array<{ month: string; percent: number }> {
  if (!allocations) return [];
  if (Array.isArray(allocations)) return allocations;
  return Object.entries(allocations).map(([month, percent]) => ({
    month,
    percent: Number(percent) || 0,
  }));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function formatCardValue(cardName: string, kpiName: string, rawValue: string) {
  const trimmed = (rawValue ?? "").toString().trim();
  if (!trimmed) return "â€”";
  if (trimmed.endsWith("%")) return trimmed;

  const numeric = Number(trimmed.replace(/[$,]/g, ""));
  if (!Number.isFinite(numeric)) return trimmed;

  const hasDecimal = trimmed.includes(".");
  const formatted = numeric.toLocaleString(undefined, {
    maximumFractionDigits: hasDecimal ? 2 : 0,
  });

  // Format as currency for Revenue rows, Goals in Revenue By Month, and Subcontractor Allowance
  if ((cardName === "Revenue By Month") || kpiName === "Subcontractor Allowance") {
    return `$${formatted}`;
  }

  return formatted;
}

function normalizeCardName(name: string) {
  return name.replace(/^\uFEFF/, "").trim().toLowerCase();
}

const defaultCardLoadData: Record<string, { kpi: string; values: string[] }[]> = {
  [normalizeCardName("Revenue By Month")]: [
    {
      kpi: "Revenue",
      values: [
        "472,632",
        "541,918",
        "776,929",
        "872,151",
        "576,090",
        "661,910",
        "329,087",
        "83,061",
        "69,069",
        "123,833",
        "52,156",
        "39,117",
      ],
    },
    {
      kpi: "Goal",
      values: [
        "595,680",
        "794,240",
        "694,960",
        "893,520",
        "1,191,360",
        "794,240",
        "893,520",
        "794,240",
        "794,240",
        "893,520",
        "893,520",
        "694,960",
      ],
    },
  ],
  [normalizeCardName("Subs By Month")]: [
    {
      kpi: "Subcontractor Allowance",
      values: [
        "83,333",
        "83,333",
        "83,333",
        "83,333",
        "83,333",
        "83,333",
        "83,333",
        "83,333",
        "83,333",
        "83,333",
        "83,333",
        "83,333",
      ],
    },
    {
      kpi: "Sub Actual Hours",
      values: [
        "3,059",
        "3,391",
        "4,349",
        "4,178",
        "2,478",
        "2,696",
        "1,281",
        "423",
        "465",
        "706",
        "230",
        "172",
      ],
    },
  ],
  [normalizeCardName("Revenue Hours by Month")]: [
    {
      kpi: "Revenue Goal Hours",
      values: Array(12).fill("3937.5"),
    },
    {
      kpi: "Revenue Actual Hours",
      values: ["", "", "", "", "", "", "", "", "", "", "", ""],
    },
  ],
  [normalizeCardName("Gross Profit by Month")]: [
    {
      kpi: "GP Goal",
      values: Array(12).fill("31%"),
    },
    {
      kpi: "GP Actual",
      values: ["45%", "", "", "", "", "", "", "", "", "", "", ""],
    },
  ],
  [normalizeCardName("Profit by Month")]: [
    {
      kpi: "Profit Goal",
      values: ["-4%", "5%", "1%", "8%", "13%", "5%", "8%", "5%", "5%", "8%", "8%", "1%"],
    },
    {
      kpi: "Profit Actual",
      values: ["2%", "", "", "", "", "", "", "", "", "", "", ""],
    },
  ],
  [normalizeCardName("Leadtimes by Month")]: [
    {
      kpi: "Leadtime Hours",
      values: ["26,692", "", "", "", "", "", "", "", "", "", "", ""],
    },
  ],
};

function getProjectDate(project: any) {
  const projectUpdated = parseDateValue(project.ProjectUpdateDate ?? project.projectUpdateDate);
  if (projectUpdated) return projectUpdated;

  const created = parseDateValue(project.dateCreated);
  const updated = parseDateValue(project.dateUpdated);
  if (updated && updated.getFullYear() >= 2026) return updated;
  return created || updated || null;
}

function getSalesActHoursDate(project: any) {
  // Sales card Act Hrs should not be shifted by late imports/updates.
  // Prefer explicit project update date, then created date, then updated date.
  const projectUpdated = parseDateValue(project.ProjectUpdateDate ?? project.projectUpdateDate);
  if (projectUpdated) return projectUpdated;

  const created = parseDateValue(project.dateCreated);
  const updated = parseDateValue(project.dateUpdated);
  return created || updated || null;
}

function selectBestProjectEntry(projects: Project[]) {
  if (projects.length === 0) return null;

  const preferredStatuses = new Set(["Accepted", "In Progress"]);
  const preferredCandidates = projects.filter((project) => preferredStatuses.has((project.status || "").toString().trim()));
  const candidates = preferredCandidates.length > 0 ? preferredCandidates : projects;

  return candidates.reduce((best, current) => {
    const bestDate = getProjectDate(best);
    const currentDate = getProjectDate(current);

    if (currentDate && !bestDate) return current;
    if (currentDate && bestDate && currentDate.getTime() > bestDate.getTime()) return current;
    if (currentDate && bestDate && currentDate.getTime() < bestDate.getTime()) return best;

    const bestCreated = parseDateValue(best.dateCreated) || new Date(0);
    const currentCreated = parseDateValue(current.dateCreated) || new Date(0);
    if (currentCreated.getTime() > bestCreated.getTime()) return current;
    if (currentCreated.getTime() < bestCreated.getTime()) return best;

    const bestCustomer = (best.customer || "").toString();
    const currentCustomer = (current.customer || "").toString();
    return currentCustomer.localeCompare(bestCustomer) < 0 ? current : best;
  }, candidates[0]);
}

function dedupeProjectsByName(projects: Project[]) {
  const projectNameMap = new Map<string, Project[]>();

  projects.forEach((project) => {
    const projectName = (project.projectName || "").toString().trim();
    if (!projectName) return;
    if (!projectNameMap.has(projectName)) {
      projectNameMap.set(projectName, []);
    }
    projectNameMap.get(projectName)!.push(project);
  });

  return Array.from(projectNameMap.values())
    .map((items) => selectBestProjectEntry(items))
    .filter((project): project is Project => Boolean(project));
}

function aggregateProjectsByFullKey(projects: Project[]) {
  const keyGroupMap = new Map<string, Project[]>();

  projects.forEach((project) => {
    const key = `${project.customer ?? ""}~${project.projectNumber ?? ""}~${project.projectName ?? ""}`;
    if (!keyGroupMap.has(key)) {
      keyGroupMap.set(key, []);
    }
    keyGroupMap.get(key)!.push(project);
  });

  const aggregated: Project[] = [];
  keyGroupMap.forEach((items) => {
    const selected = selectBestProjectEntry(items) || items[0];
    const base = { ...selected };
    base.sales = items.reduce((sum, p) => sum + (p.sales ?? 0), 0);
    base.cost = items.reduce((sum, p) => sum + (p.cost ?? 0), 0);
    base.hours = items.reduce((sum, p) => sum + (p.hours ?? 0), 0);
    aggregated.push(base);
  });

  return aggregated;
}

export default function KPIPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [kpiData, setKpiData] = useState<any[]>([]);
  const [cardLoadData, setCardLoadData] = useState<Record<string, { kpi: string; values: string[] }[]>>(defaultCardLoadData);
  const [loading, setLoading] = useState(true);
  const [yearFilter, setYearFilter] = useState<string>("");
  const [monthFilter, setMonthFilter] = useState<number>(new Date().getMonth() + 1);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [dataSource, setDataSource] = useState<'firestore' | 'procore'>('firestore');
  const [procoreAuthError, setProcoreAuthError] = useState(false);

  // Fetch KPI data separately when yearFilter changes
  useEffect(() => {
    async function fetchKpiData() {
      const currentYear = yearFilter || new Date().getFullYear().toString();
      try {
        const kpiRes = await fetch(`/api/kpi?year=${currentYear}`);
        if (!kpiRes.ok) {
          console.warn("KPI API endpoint not available");
          setKpiData([]);
          return;
        }
        const kpiJson = await kpiRes.json();
        const data = kpiJson.data || [];
        console.log(`[KPI] Fetched ${data.length} KPI entries for year ${currentYear}:`, data);
        setKpiData(data);
      } catch (err) {
        console.warn("Error fetching KPI data (using empty defaults):", err);
        setKpiData([]);
      }
    }
    fetchKpiData();
  }, [yearFilter]);

  // Fetch Projects and Schedules
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setProcoreAuthError(false);
      try {
        let projectsData = [];
        let schedulesData = [];
        
        try {
          // Fetch ALL projects from paginated API (dashboard mode includes Bid Submitted/Lost projects)
          console.log("[KPI] Fetching projects from API...");
          let page = 1;
          let hasNextPage = true;
          const allProjects: Project[] = [];

          while (hasNextPage) {
            const projectsRes = await fetch(`/api/projects?mode=dashboard&page=${page}&pageSize=500`);
            if (!projectsRes.ok) {
              console.warn("[KPI] Projects API endpoint not available");
              break;
            }

            const projectsJson = await projectsRes.json();
            const rows = projectsJson.data || [];
            allProjects.push(...rows);
            hasNextPage = Boolean(projectsJson.hasNextPage);
            page += 1;
          }

          projectsData = allProjects;
          setProjects(projectsData);
          console.log("[KPI] Loaded projects:", projectsData.length);
        } catch (err) {
          console.warn("[KPI] Error fetching projects (using empty defaults):", err);
          setProjects([]);
        }

        try {
          // Fetch ALL schedules from paginated API
          let page = 1;
          let hasNextPage = true;
          const allSchedules: any[] = [];

          while (hasNextPage) {
            const schedulesRes = await fetch(`/api/scheduling?page=${page}&pageSize=500`);
            if (!schedulesRes.ok) {
              console.warn("[KPI] Schedules API endpoint not available");
              break;
            }

            const schedulesJson = await schedulesRes.json();
            const rows = schedulesJson.data || schedulesJson.schedules || [];
            allSchedules.push(...rows);
            hasNextPage = Boolean(schedulesJson.hasNextPage);
            page += 1;
          }

          schedulesData = allSchedules;
          console.log("[KPI] Loaded schedules:", schedulesData.length);
        } catch (err) {
          console.warn("[KPI] Error fetching schedules (using empty defaults):", err);
        }

        const schedulesWithStatus = schedulesData.map((schedule: any) => {
          const matchingProject = projectsData.find((p: any) => {
            const scheduleKey = `${schedule.customer || ""}~${schedule.projectNumber || ""}~${schedule.projectName || ""}`;
            const projectKey = `${p.customer || ""}~${p.projectNumber || ""}~${p.projectName || ""}`;
            return scheduleKey === projectKey;
          });
          return {
            ...schedule,
            status: (matchingProject as any)?.status || "Unknown",
          };
        });

        setSchedules(schedulesWithStatus);
      } catch (error) {
        console.warn("[KPI] Error loading data (using empty defaults):", error);
        setProjects([]);
        setSchedules([]);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [dataSource]);

  return (
    <KPIPageContent
      schedules={schedules}
      setSchedules={setSchedules}
      projects={projects}
      setProjects={setProjects}
      kpiData={kpiData}
      setKpiData={setKpiData}
      cardLoadData={cardLoadData}
      setCardLoadData={setCardLoadData}
      loading={loading}
      setLoading={setLoading}
      yearFilter={yearFilter}
      setYearFilter={setYearFilter}
      monthFilter={monthFilter}
      setMonthFilter={setMonthFilter}
      startDate={startDate}
      setStartDate={setStartDate}
      endDate={endDate}
      setEndDate={setEndDate}
      dataSource={dataSource}
      setDataSource={setDataSource}
      procoreAuthError={procoreAuthError}
    />
  );
}

function KPIPageContent({
  schedules,
  setSchedules,
  projects,
  setProjects,
  kpiData,
  setKpiData,
  cardLoadData,
  setCardLoadData,
  loading,
  setLoading,
  yearFilter,
  setYearFilter,
  monthFilter,
  setMonthFilter,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  dataSource,
  setDataSource,
  procoreAuthError,
}: any) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ytdMonthCutoff = Math.min(Math.max(1, new Date().getMonth() + 1), 12);
  const [cardLoadWarning, setCardLoadWarning] = useState<string>("");
  const [editingCell, setEditingCell] = useState<{year: string; month: number; field: string} | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [kpiDrilldown, setKpiDrilldown] = useState<{
    open: boolean;
    title: string;
    valueLabel: string;
    valuePrefix: string;
    month: number | null;
    entries: KPIDrilldownEntry[];
  }>({
    open: false,
    title: "",
    valueLabel: "Value",
    valuePrefix: "",
    month: null,
    entries: [],
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const renderTotalWithYtd = (totalDisplay: string, ytdDisplay: string) => {
    void ytdDisplay;
    return <span>{totalDisplay}</span>;
  };

  // Manage input focus when editing
  useEffect(() => {
    if (editingCell && inputRef.current) {
      // Use setTimeout to ensure focus happens after render
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 0);
    }
  }, [editingCell]);

  // Function to save any manual KPI field entry (non-blocking, background save)
  const saveKpiField = (year: string, month: number, fieldName: string, value: number) => {
    // Don't wait for save - just initiate it in background
    const monthName = monthNames[month - 1];
    
    console.log(`[KPI] Saving ${fieldName} for ${year}-${month}: ${value}`);
    
    const requestBody = {
      year,
      month,
      monthName,
      [fieldName]: value
    };
    
    // Fire and forget - save in background without blocking UI
    (async () => {
      try {
        console.log(`[KPI] Request body:`, requestBody);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.log(`[KPI] Request timeout - aborting after 10 seconds`);
          controller.abort();
        }, 10000);
        
        console.log(`[KPI] Fetching POST /api/kpi`);
        const response = await fetch("/api/kpi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        console.log(`[KPI] Response status: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
          console.warn(`[KPI] API endpoint not available, skipping save`);
          return; // Gracefully skip API call in static mode
        }
        
        const result = await response.json();
        console.log(`[KPI] Save successful:`, result);
        
        // Refresh kpi data in background (don't block)
        console.log(`[KPI] Refreshing data for ${year}`);
        try {
          const kpiRes = await fetch(`/api/kpi?year=${year}`);
          if (kpiRes.ok) {
            const kpiJson = await kpiRes.json();
            setKpiData(kpiJson.data || []);
          }
        } catch (err) {
          console.warn(`[KPI] Could not refresh data:`, err);
        }
        
        console.log(`[KPI] âœ“ Saved ${fieldName} for ${year}-${month}: ${value.toLocaleString()}`);
      } catch (error) {
        console.warn(`[KPI] Error saving ${fieldName} (API not available):`, error);
        // Gracefully skip in static export mode - no alerts needed
      }
    })();
    // Return immediately without waiting
  };

  // Load year filter from localStorage on mount
  useEffect(() => {
    const savedYear = localStorage.getItem("kpi-year-filter");
    if (savedYear) {
      setYearFilter(savedYear);
    }
  }, []);

  // Save year filter to localStorage when it changes
  useEffect(() => {
    localStorage.setItem("kpi-year-filter", yearFilter);
  }, [yearFilter]);

  // Project and Schedule data is now fetched in the parent KPIPage component
  // to support dynamic data source switching between Firestore and Procore Live.

  useEffect(() => {
    async function loadCardDataFromAPI() {
      // Skip API call in SSR/static environments
      if (typeof window === "undefined" || window.location?.protocol === "file:") {
        setCardLoadWarning("");
        return;
      }

      try {
        const res = await fetch("/api/kpi-cards", { credentials: "include" });
        if (!res.ok) {
          const statusSummary = `${res.status} ${res.statusText}`.trim();
          console.warn("[KPI] Failed to load KPI cards from API:", statusSummary);
          setCardLoadData(defaultCardLoadData);
          setCardLoadWarning(`KPI card API unavailable (${statusSummary}). Showing default KPI card values.`);
          return;
        }

        const json = await res.json();
        const cards = json.data || [];

        const mapped: Record<string, { kpi: string; values: string[] }[]> = {};
        cards.forEach((card: any) => {
          const cardNameNormalized = normalizeCardName(card.cardName);
          mapped[cardNameNormalized] = Array.isArray(card.rows) ? card.rows : [];
        });

        setCardLoadData(mapped);
        console.log("[KPI] Loaded", Object.keys(mapped).length, "KPI cards from API");

        if (cards.length === 0) {
          setCardLoadData(defaultCardLoadData);
          setCardLoadWarning("No KPI card data found in database. Showing default KPI card values.");
        } else {
          setCardLoadWarning("");
        }
      } catch (error) {
        console.warn("[KPI] Error loading KPI cards:", error);
        setCardLoadData(defaultCardLoadData);
        setCardLoadWarning("KPI card API request failed. Showing default KPI card values.");
      }
    }
    
    loadCardDataFromAPI();
  }, []);

  const getProjectKey = (customer?: string, projectNumber?: string, projectName?: string) => {
    return `${customer ?? ""}~${projectNumber ?? ""}~${projectName ?? ""}`;
  };

  const qualifyingStatuses = ["In Progress", "Accepted", "Complete"];

  const filteredProjects = useMemo(
    () => projects.filter((project: Project) => !isExcludedFromKPI(project)),
    [projects]
  );

  const dedupedProjects = useMemo(() => dedupeProjectsByName(filteredProjects), [filteredProjects]);

  const aggregatedProjects = useMemo(() => aggregateProjectsByFullKey(dedupedProjects), [dedupedProjects]);

  const aggregatedBidSubmittedProjects = useMemo(
    () => aggregatedProjects.filter((project) => (project.status || "").toString().trim() === "Bid Submitted"),
    [aggregatedProjects]
  );

  console.log("[KPI] Total projects:", projects.length);
  console.log("[KPI] Filtered projects:", filteredProjects.length);

  // Bid Submitted sales by month - use aggregatedProjects so we keep one
  // selected customer version per project identifier.
  const bidSubmittedSalesByMonth: Record<string, number> = {};
  
  let bidSubmittedTotal = 0;
  let bidSubmittedWithDates = 0;
  let bidSubmittedWithoutDates = 0;
  
  aggregatedBidSubmittedProjects.forEach((project) => {
    const status = (project.status || "").toString().trim();
    if (status !== "Bid Submitted") return;
    
    const sales = Number(project.sales ?? 0);
    bidSubmittedTotal += sales;
    
    const projectDate = getProjectDate(project);
    if (!projectDate) {
      bidSubmittedWithoutDates++;
      return;
    }
    bidSubmittedWithDates++;
    
    const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
    if (!Number.isFinite(sales)) return;
    bidSubmittedSalesByMonth[monthKey] = (bidSubmittedSalesByMonth[monthKey] || 0) + sales;
  });
  
  console.log("[KPI] === Bid Submitted Breakdown ===");
  console.log(`[KPI] Total Bid Submitted projects (deduplicated): ${aggregatedBidSubmittedProjects.length}`);
  console.log(`[KPI] Projects with dates: ${bidSubmittedWithDates}`);
  console.log(`[KPI] Projects without dates: ${bidSubmittedWithoutDates}`);
  console.log(`[KPI] Total Bid Submitted sales: $${bidSubmittedTotal.toLocaleString()}`);
  
  const bidSubmittedSalesMonths = Object.keys(bidSubmittedSalesByMonth).sort();
  
  console.log("[KPI] Bid submitted sales by month:", bidSubmittedSalesByMonth);
  console.log("[KPI] Year filter:", yearFilter);
  
  const bidSubmittedSalesYearMonthMap: Record<string, Record<number, number>> = {};
  bidSubmittedSalesMonths.forEach((month) => {
    const [year, m] = month.split("-");
    if (!bidSubmittedSalesYearMonthMap[year]) {
      bidSubmittedSalesYearMonthMap[year] = {};
    }
    bidSubmittedSalesYearMonthMap[year][Number(m)] = bidSubmittedSalesByMonth[month];
  });
  const bidSubmittedSalesYears = Object.keys(bidSubmittedSalesYearMonthMap).sort();

  const newBidsSalesByMonth: Record<string, number> = {};
  aggregatedBidSubmittedProjects.forEach((project) => {
    const createdDate = parseDateValue(project.dateCreated);
    if (!createdDate) return;

    const sales = Number(project.sales ?? 0);
    if (!Number.isFinite(sales)) return;

    const monthKey = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, "0")}`;
    newBidsSalesByMonth[monthKey] = (newBidsSalesByMonth[monthKey] || 0) + sales;
  });

  const newBidsSalesYearMonthMap: Record<string, Record<number, number>> = {};
  Object.keys(newBidsSalesByMonth).sort().forEach((month) => {
    const [year, m] = month.split("-");
    if (!newBidsSalesYearMonthMap[year]) {
      newBidsSalesYearMonthMap[year] = {};
    }
    newBidsSalesYearMonthMap[year][Number(m)] = newBidsSalesByMonth[month];
  });

  const newBidsProjectsByMonth = useMemo(() => {
    const result: Record<string, KPIDrilldownEntry[]> = {};

    aggregatedBidSubmittedProjects.forEach((project) => {
      const createdDate = parseDateValue(project.dateCreated);
      if (!createdDate) return;

      const sales = Number(project.sales ?? 0);
      if (!Number.isFinite(sales)) return;

      const monthKey = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, "0")}`;
      if (!result[monthKey]) {
        result[monthKey] = [];
      }

      const customer = (project.customer || "Unknown Customer").toString();
      const projectNumber = (project.projectNumber || "").toString();
      const projectName = (project.projectName || "Unnamed Project").toString();

      result[monthKey].push({
        id: `${customer}~${projectNumber}~${projectName}`,
        projectName,
        projectNumber,
        customer,
        value: sales,
        dateLabel: createdDate.toLocaleDateString(),
      });
    });

    Object.keys(result).forEach((monthKey) => {
      result[monthKey].sort((a, b) => b.value - a.value);
    });

    return result;
  }, [aggregatedBidSubmittedProjects]);

  const bidSubmittedSalesProjectsByMonth = useMemo(() => {
    const result: Record<string, KPIDrilldownEntry[]> = {};

    aggregatedBidSubmittedProjects.forEach((project) => {
      const projectDate = getProjectDate(project);
      if (!projectDate) return;

      const sales = Number(project.sales ?? 0);
      if (!Number.isFinite(sales) || sales <= 0) return;

      const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
      if (!result[monthKey]) result[monthKey] = [];

      result[monthKey].push({
        id: `${project.customer || ""}~${project.projectNumber || ""}~${project.projectName || ""}`,
        projectName: (project.projectName || "Unnamed Project").toString(),
        projectNumber: (project.projectNumber || "").toString(),
        customer: (project.customer || "Unknown Customer").toString(),
        value: sales,
        dateLabel: projectDate.toLocaleDateString(),
      });
    });

    Object.keys(result).forEach((monthKey) => result[monthKey].sort((a, b) => b.value - a.value));
    return result;
  }, [aggregatedBidSubmittedProjects]);

  const bidSubmittedHoursProjectsByMonth = useMemo(() => {
    const result: Record<string, KPIDrilldownEntry[]> = {};

    aggregatedBidSubmittedProjects.forEach((project) => {
      const projectDate = getProjectDate(project);
      if (!projectDate) return;

      const hours = Number(project.hours ?? 0);
      if (!Number.isFinite(hours) || hours <= 0) return;

      const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
      if (!result[monthKey]) result[monthKey] = [];

      result[monthKey].push({
        id: `${project.customer || ""}~${project.projectNumber || ""}~${project.projectName || ""}`,
        projectName: (project.projectName || "Unnamed Project").toString(),
        projectNumber: (project.projectNumber || "").toString(),
        customer: (project.customer || "Unknown Customer").toString(),
        value: hours,
        dateLabel: projectDate.toLocaleDateString(),
      });
    });

    Object.keys(result).forEach((monthKey) => result[monthKey].sort((a, b) => b.value - a.value));
    return result;
  }, [aggregatedBidSubmittedProjects]);

  const inProgressHoursProjectsByMonth = useMemo(() => {
    const result: Record<string, KPIDrilldownEntry[]> = {};

    aggregatedProjects.forEach((project) => {
      const status = (project.status || "").toString().trim();
      if (!qualifyingStatuses.includes(status)) return;

      const projectDate = getSalesActHoursDate(project);
      if (!projectDate) return;

      const hours = Number(project.hours ?? 0);
      if (!Number.isFinite(hours) || hours <= 0) return;

      const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
      if (!result[monthKey]) result[monthKey] = [];

      result[monthKey].push({
        id: `${project.customer || ""}~${project.projectNumber || ""}~${project.projectName || ""}`,
        projectName: (project.projectName || "Unnamed Project").toString(),
        projectNumber: (project.projectNumber || "").toString(),
        customer: (project.customer || "Unknown Customer").toString(),
        value: hours,
        dateLabel: projectDate.toLocaleDateString(),
      });
    });

    Object.keys(result).forEach((monthKey) => result[monthKey].sort((a, b) => b.value - a.value));
    return result;
  }, [aggregatedProjects]);

  const scheduledSalesProjectsByMonth = useMemo(() => {
    const result: Record<string, KPIDrilldownEntry[]> = {};
    const keyToProject = new Map<string, Project>();

    aggregatedProjects.forEach((project) => {
      const key = getProjectKey(project.customer, project.projectNumber, project.projectName);
      keyToProject.set(key, project);
    });

    schedules.forEach((schedule: Schedule) => {
      const key = schedule.jobKey || getProjectKey(schedule.customer, schedule.projectNumber, schedule.projectName);
      const project = keyToProject.get(key);
      if (!project) return;
      if (!qualifyingStatuses.includes((project.status || "").toString().trim())) return;

      const projectSales = Number(project.sales ?? 0);
      if (!Number.isFinite(projectSales) || projectSales <= 0) return;

      normalizeAllocations(schedule.allocations).forEach((alloc) => {
        const percent = Number(alloc.percent ?? 0);
        if (!Number.isFinite(percent) || percent <= 0) return;

        const monthKey = alloc.month;
        if (!isValidMonthKey(monthKey)) return;

        const monthlySales = projectSales * (percent / 100);
        if (!result[monthKey]) result[monthKey] = [];

        const scheduleProjectName = (schedule.projectName || "").toString().trim();
        const scheduleProjectNumber = (schedule.projectNumber || "").toString().trim();
        const scheduleCustomer = (schedule.customer || "").toString().trim();

        const projectName = (project.projectName || "").toString().trim();
        const projectNumber = (project.projectNumber || "").toString().trim();
        const projectCustomer = (project.customer || "").toString().trim();

        const useScheduleIdentity = Boolean(scheduleProjectName || scheduleProjectNumber || scheduleCustomer);

        const displayProjectName = useScheduleIdentity
          ? (scheduleProjectName || projectName || "Unnamed Project")
          : (projectName || "Unnamed Project");

        const displayProjectNumber = useScheduleIdentity
          ? scheduleProjectNumber
          : projectNumber;

        const displayCustomer = useScheduleIdentity
          ? (scheduleCustomer || projectCustomer || "Unknown Customer")
          : (projectCustomer || "Unknown Customer");

        result[monthKey].push({
          id: `${displayCustomer}~${displayProjectNumber}~${displayProjectName}`,
          projectName: displayProjectName,
          projectNumber: displayProjectNumber,
          customer: displayCustomer,
          value: monthlySales,
          dateLabel: monthKey,
        });
      });
    });

    Object.keys(result).forEach((monthKey) => result[monthKey].sort((a, b) => b.value - a.value));
    return result;
  }, [aggregatedProjects, schedules]);

  const getDrilldownEntriesForYearMonth = (
    sourceMap: Record<string, KPIDrilldownEntry[]>,
    year: string | null,
    month: number | null
  ) => {
    const allKeys = Object.keys(sourceMap);
    const matchingKeys = allKeys.filter((key) => {
      const [entryYear, entryMonth] = key.split("-");
      if (year && entryYear !== year) return false;
      if (month && Number(entryMonth) !== month) return false;
      return true;
    });

    const entries = matchingKeys.flatMap((key) => sourceMap[key] || []);
    entries.sort((a, b) => b.value - a.value);
    return entries;
  };

  const openNewBidsDrilldown = (year: string, month: number | null) => {
    const entries = getDrilldownEntriesForYearMonth(newBidsProjectsByMonth, year, month);

    setKpiDrilldown({
      open: true,
      title: `New Bids ${month ? `${monthNames[month - 1]} ${year}` : `${year} Total`}`,
      valueLabel: "Data Point (Sales)",
      valuePrefix: "$",
      month,
      entries,
    });
  };

  const openKpiDrilldown = (
    title: string,
    sourceMap: Record<string, KPIDrilldownEntry[]>,
    options: { year: string | null; month: number | null; valueLabel: string; valuePrefix: string }
  ) => {
    const entries = getDrilldownEntriesForYearMonth(sourceMap, options.year, options.month);

    setKpiDrilldown({
      open: false,
      title: "",
      valueLabel: "Value",
      valuePrefix: "",
      month: null,
      entries: [],
    });

    setKpiDrilldown({
      open: true,
      title,
      valueLabel: options.valueLabel,
      valuePrefix: options.valuePrefix,
      month: options.month,
      entries,
    });
  };

  const closeKpiDrilldown = () => {
    setKpiDrilldown({
      open: false,
      title: "",
      valueLabel: "Value",
      valuePrefix: "",
      month: null,
      entries: [],
    });
  };

  const bidSubmittedHoursByMonth: Record<string, number> = {};
  
  // Use the same aggregated pool as Bid Submitted sales, so hours stay consistent
  aggregatedBidSubmittedProjects.forEach((project) => {
    const status = (project.status || "").toString().trim();
    if (status !== "Bid Submitted") return;

    const projectDate = getProjectDate(project);
    if (!projectDate) return;

    if (startDate || endDate) {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (projectDate < start) return;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (projectDate > end) return;
      }
    }

    const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
    const hours = Number(project.hours ?? 0);
    if (!Number.isFinite(hours)) return;
    bidSubmittedHoursByMonth[monthKey] = (bidSubmittedHoursByMonth[monthKey] || 0) + hours;
  });
  const bidSubmittedHoursYearMonthMap: Record<string, Record<number, number>> = {};
  Object.keys(bidSubmittedHoursByMonth).forEach((month) => {
    const [year, m] = month.split("-");
    if (!bidSubmittedHoursYearMonthMap[year]) {
      bidSubmittedHoursYearMonthMap[year] = {};
    }
    bidSubmittedHoursYearMonthMap[year][Number(m)] = bidSubmittedHoursByMonth[month];
  });

  // In Progress hours calculation
  const inProgressHoursByMonth: Record<string, number> = {};
  aggregatedProjects.forEach((project) => {
    const status = (project.status || "").trim();
    if (!qualifyingStatuses.includes(status)) return;

    const projectDate = getSalesActHoursDate(project);
    if (!projectDate) return;

    if (startDate || endDate) {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        if (projectDate < start) return;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (projectDate > end) return;
      }
    }

    const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
    const hours = Number(project.hours ?? 0);
    if (!Number.isFinite(hours)) return;
    inProgressHoursByMonth[monthKey] = (inProgressHoursByMonth[monthKey] || 0) + hours;
  });
  
  const inProgressHoursYearMonthMap: Record<string, Record<number, number>> = {};
  Object.keys(inProgressHoursByMonth).forEach((month) => {
    const [year, m] = month.split("-");
    if (!inProgressHoursYearMonthMap[year]) {
      inProgressHoursYearMonthMap[year] = {};
    }
    inProgressHoursYearMonthMap[year][Number(m)] = inProgressHoursByMonth[month];
  });

  const renderCardRows = (cardName: string, color: string) => {
    const rawRows = cardLoadData[normalizeCardName(cardName)] || [];
    if (rawRows.length === 0) return null;

    // Sorting logic: prioritize Actuals first, then Goals/Allowances (Orange)
    const rows = [...rawRows].sort((a, b) => {
      const aName = (a.kpi || "").toLowerCase();
      const bName = (b.kpi || "").toLowerCase();
      const isAGoal = aName.includes("goal") || aName.includes("allowance");
      const isBGoal = bName.includes("goal") || bName.includes("allowance");

      if (isAGoal && !isBGoal) return 1; // a is Goal, move to end
      if (!isAGoal && isBGoal) return -1; // a is not Goal, move to front
      return 0; // maintain original relative order otherwise
    });

    return rows.map((row: any, rowIndex: number) => {
      const rowLabel = (row.kpi || "").toLowerCase();
      const isGoalRow = rowLabel.includes("goal") || rowLabel.includes("allowance");
      const rowColor = isGoalRow ? "#E06C00" : "#15616D";
      let rowValues = [...(row.values || [])]; // Default to template values
      
      // Check if this is a percentage column (contains % values)
      const isPercentage = rowValues.some((val: any) => String(val).includes("%"));
      
      let total: number;
      let ytdTotal: number;
      if (isPercentage && (cardName.toLowerCase().includes("gross profit") || cardName.toLowerCase().includes("profit"))) {
        // For GP/Profit percentages, calculate weighted average using Revenue as weights
        const revenueRow = cardLoadData[normalizeCardName(cardName)]?.find((r: any) => r.kpi === "Revenue" || r.kpi.includes("Revenue"));
        
        if (revenueRow) {
          let numerator = 0;
          let denominator = 0;
          
          rowValues.forEach((val: any, idx: number) => {
            const percentStr = String(val).replace("%", "").trim();
            const percent = parseFloat(percentStr);
            const revenueStr = String(revenueRow.values[idx]).replace(/[$,]/g, "").trim();
            const revenue = parseFloat(revenueStr);
            
            if (!isNaN(percent) && !isNaN(revenue) && revenue > 0) {
              numerator += (percent / 100) * revenue;
              denominator += revenue;
            }
          });
          
          total = denominator > 0 ? (numerator / denominator) * 100 : 0;

          let ytdNumerator = 0;
          let ytdDenominator = 0;
          rowValues.slice(0, ytdMonthCutoff).forEach((val: any, idx: number) => {
            const percentStr = String(val).replace("%", "").trim();
            const percent = parseFloat(percentStr);
            const revenueStr = String(revenueRow.values[idx]).replace(/[$,]/g, "").trim();
            const revenue = parseFloat(revenueStr);

            if (!isNaN(percent) && !isNaN(revenue) && revenue > 0) {
              ytdNumerator += (percent / 100) * revenue;
              ytdDenominator += revenue;
            }
          });
          ytdTotal = ytdDenominator > 0 ? (ytdNumerator / ytdDenominator) * 100 : 0;
        } else {
          // Fallback: simple average if no revenue row found
          const percentages = rowValues
            .map((val: any) => parseFloat(String(val).replace("%", "").trim()))
            .filter((n: number) => !isNaN(n));
          total = percentages.length > 0 ? percentages.reduce((a: number, b: number) => a + b, 0) / percentages.length : 0;

          const ytdPercentages = rowValues
            .slice(0, ytdMonthCutoff)
            .map((val: any) => parseFloat(String(val).replace("%", "").trim()))
            .filter((n: number) => !isNaN(n));
          ytdTotal = ytdPercentages.length > 0 ? ytdPercentages.reduce((a: number, b: number) => a + b, 0) / ytdPercentages.length : 0;
        }
      } else {
        // For non-percentage values, sum as usual
        const total_val = rowValues.reduce((sum: number, val: any) => {
          const numVal = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
          return sum + (isNaN(numVal) ? 0 : numVal);
        }, 0);
        total = total_val;

        ytdTotal = rowValues.slice(0, ytdMonthCutoff).reduce((sum: number, val: any) => {
          const numVal = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
          return sum + (isNaN(numVal) ? 0 : numVal);
        }, 0);
      }

      const totalFormatted = formatCardValue(cardName, row.kpi, isPercentage ? `${total.toFixed(2)}%` : total.toString());
      const ytdFormatted = formatCardValue(cardName, row.kpi, isPercentage ? `${ytdTotal.toFixed(2)}%` : ytdTotal.toString());
      
      return (
      <tr key={`${cardName}-${row.kpi}`} style={{ borderBottom: "1px solid #eee", backgroundColor: isGoalRow ? "#f9f9f9" : "#ffffff" }}>
        <td style={{ padding: "6px 6px", color: rowColor, fontWeight: 700, fontSize: 13 }}>{row.kpi}</td>
        {monthNames.map((_, idx) => {
          const value = rowValues[idx] ?? "";
          const formatted = formatCardValue(cardName, row.kpi, value);
          return (
            <td key={idx} style={{ padding: "6px 2px", textAlign: "center", color: formatted !== "â€”" ? rowColor : "#999", fontWeight: formatted !== "â€”" ? 700 : 400, fontSize: 12 }}>
              {formatted}
            </td>
          );
        })}
        <td style={{ padding: "6px 6px", textAlign: "center", color: rowColor, fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
          {renderTotalWithYtd(totalFormatted, ytdFormatted)}
        </td>
      </tr>
    );});
  };

  const scheduledSalesByMonth: Record<string, number> = {};
  
  const scheduleSalesMap = new Map<string, number>();
  aggregatedProjects.forEach((project: Project) => {
    if (!qualifyingStatuses.includes(project.status || "")) return;
    
    const key = getProjectKey(project.customer, project.projectNumber, project.projectName);
    const sales = Number(project.sales ?? 0);
    if (!Number.isFinite(sales)) return;
    
    const currentTotal = scheduleSalesMap.get(key) || 0;
    scheduleSalesMap.set(key, currentTotal + sales);
  });

  schedules.forEach((schedule: Schedule) => {
    const key = schedule.jobKey || getProjectKey(schedule.customer, schedule.projectNumber, schedule.projectName);
    const projectSales = scheduleSalesMap.get(key);
    
    if (!projectSales) return;

    normalizeAllocations(schedule.allocations).forEach((alloc: any) => {
      const percent = Number(alloc.percent ?? 0);
      if (!Number.isFinite(percent) || percent <= 0) return;
      const monthKey = alloc.month;
      if (!isValidMonthKey(monthKey)) return;
      const monthlySales = projectSales * (percent / 100);
      scheduledSalesByMonth[monthKey] = (scheduledSalesByMonth[monthKey] || 0) + monthlySales;
    });
  });

  const scheduledSalesMonths = Object.keys(scheduledSalesByMonth).sort();
  
  const scheduledTotal = Object.values(scheduledSalesByMonth).reduce((sum, val) => sum + val, 0);
  
  console.log("[KPI] === Scheduled Sales Breakdown ===");
  console.log(`[KPI] Projects with qualifying status (In Progress/Accepted/Complete): ${scheduleSalesMap.size}`);
  console.log(`[KPI] Schedules used for allocation: ${schedules.length}`);
  console.log(`[KPI] Total Scheduled sales: $${scheduledTotal.toLocaleString()}`);
  console.log("[KPI] Scheduled sales by month:", scheduledSalesByMonth);
  console.log("[KPI] Bid submitted sales by month:", bidSubmittedSalesByMonth);
  
  const scheduledSalesYearMonthMap: Record<string, Record<number, number>> = {};
  scheduledSalesMonths.forEach((month) => {
    const [year, m] = month.split("-");
    if (!scheduledSalesYearMonthMap[year]) {
      scheduledSalesYearMonthMap[year] = {};
    }
    scheduledSalesYearMonthMap[year][Number(m)] = scheduledSalesByMonth[month];
  });
  const scheduledSalesYears = Object.keys(scheduledSalesYearMonthMap).sort();

  const getCardActualMonthMap = (cardName: string): Record<number, number> => {
    const rows = cardLoadData[normalizeCardName(cardName)] || [];
    if (rows.length === 0) return {};

    const actualRow =
      rows.find((row: any) => {
        const label = (row?.kpi || "").toString().toLowerCase();
        return !label.includes("goal") && !label.includes("allowance");
      }) || rows[0];

    const map: Record<number, number> = {};
    monthNames.forEach((_, idx) => {
      const raw = actualRow?.values?.[idx];
      const parsed = Number(String(raw ?? "").replace(/[^0-9.-]/g, ""));
      map[idx + 1] = Number.isFinite(parsed) ? parsed : 0;
    });

    return map;
  };

  const currentYear = new Date().getFullYear().toString();
  const combinedSalesYears = Array.from(new Set([
    ...scheduledSalesYears,
    ...bidSubmittedSalesYears,
    currentYear,
  ]))
    .filter(year => year !== "2024")
    .sort();

  const bidSubmittedYearWarning = yearFilter && bidSubmittedSalesYears.length > 0 && !bidSubmittedSalesYears.includes(yearFilter)
    ? `Bid Submitted data not available for ${yearFilter}.`
    : "";

  const filteredBidSubmittedSalesByMonth: Record<string, number> = {};
  const filteredBidSubmittedSalesMonths = bidSubmittedSalesMonths.filter(month => {
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return false;
    }
    filteredBidSubmittedSalesByMonth[month] = bidSubmittedSalesByMonth[month];
    return true;
  });

  console.log("[KPI] Filtered bid submitted months:", filteredBidSubmittedSalesMonths);
  console.log("[KPI] Filtered bid submitted sales:", filteredBidSubmittedSalesByMonth);

  const filteredScheduledSalesByMonth: Record<string, number> = {};
  const filteredScheduledSalesMonths = scheduledSalesMonths.filter(month => {
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return false;
    }
    filteredScheduledSalesByMonth[month] = scheduledSalesByMonth[month];
    return true;
  });

  const filteredCombinedSalesYears = yearFilter 
    ? combinedSalesYears.filter(year => year === yearFilter) 
    : combinedSalesYears;

  if (loading) {
    return (
      <main className="p-8" style={{ background: "#f5f5f5", minHeight: "100vh", color: "#222" }}>
        <div>Loading...</div>
      </main>
    );
  }

  return (
    <main className="p-4" style={{ fontFamily: "sans-serif", background: "#f5f5f5", minHeight: "100vh", color: "#222", paddingTop: 12, paddingBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <h1 style={{ color: "#15616D", fontSize: 24, margin: 0 }}>KPI Dashboard</h1>
      </div>

      {procoreAuthError && (
        <div style={{ background: "#FEF2F2", color: "#991B1B", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13, border: "1px solid #FCA5A5" }}>
          Authentication with Procore required for live data. <a href="/api/auth/login?returnTo=/kpi" style={{ color: "#15616D", fontWeight: 'bold', textDecoration: 'underline' }}>Click here to login</a>
        </div>
      )}

      {cardLoadWarning && (
        <div style={{ background: "#fff7ed", color: "#9a3412", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13, border: "1px solid #fed7aa" }}>
          {cardLoadWarning}
        </div>
      )}

      {bidSubmittedYearWarning && (
        <div style={{ background: "#eef6ff", color: "#1e3a8a", padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13, border: "1px solid #bfdbfe" }}>
          {bidSubmittedYearWarning}
        </div>
      )}

      {/* Year and Date Range Filters */}
      <div style={{
        background: "#ffffff",
        borderRadius: 8,
        padding: "8px 12px",
        marginBottom: 16,
        border: "1px solid #ddd",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ color: "#666", fontWeight: 600, fontSize: 13 }}>Data Source:</div>
          <div style={{ display: "flex", background: "#f0f0f0", borderRadius: 4, padding: 2 }}>
            <button
              onClick={() => setDataSource('firestore')}
              style={{
                padding: "4px 10px",
                border: "none",
                borderRadius: 2,
                fontSize: 11,
                cursor: "pointer",
                background: dataSource === 'firestore' ? "#15616D" : "transparent",
                color: dataSource === 'firestore' ? "white" : "#666",
                fontWeight: 600,
              }}
            >
              Firestore (Sync)
            </button>
            <button
              onClick={() => setDataSource('procore')}
              style={{
                padding: "4px 10px",
                border: "none",
                borderRadius: 2,
                fontSize: 11,
                cursor: "pointer",
                background: dataSource === 'procore' ? "#15616D" : "transparent",
                color: dataSource === 'procore' ? "white" : "#666",
                fontWeight: 600,
              }}
            >
              Procore (Live)
            </button>
          </div>
        </div>

        <div style={{ width: "1px", height: "20px", background: "#333", opacity: 0.1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ color: "#666", fontWeight: 600, fontSize: 13 }}>Year:</div>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            style={{
              padding: "4px 8px",
              background: "#fff",
              color: "#222",
              border: "1px solid #ddd",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            <option value="">All Years</option>
            {combinedSalesYears.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>

          {yearFilter && (
            <button
              onClick={() => setYearFilter("")}
              style={{
                padding: "4px 8px",
                background: "transparent",
                border: "1px solid #ddd",
                color: "#666",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              âœ•
            </button>
          )}
        </div>

        <div style={{ width: "1px", height: "20px", background: "#333" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ color: "#666", fontWeight: 600, fontSize: 13 }}>Dates:</div>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              padding: "4px 8px",
              background: "#fff",
              color: "#222",
              border: "1px solid #ddd",
              borderRadius: 4,
              fontSize: 12,
            }}
          />
          <span style={{ color: "#999", fontSize: 12 }}>â€“</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              padding: "4px 8px",
              background: "#fff",
              color: "#222",
              border: "1px solid #ddd",
              borderRadius: 4,
              fontSize: 12,
            }}
          />

          {(startDate || endDate) && (
            <button
              onClick={() => {
                setStartDate("");
                setEndDate("");
              }}
              style={{
                padding: "4px 8px",
                background: "transparent",
                border: "1px solid #ddd",
                color: "#666",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              âœ•
            </button>
          )}
        </div>
      </div>

      {/* Combined Sales Line Chart */}
      <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4, height: 200 }}>
        <h2 style={{ color: "#15616D", marginBottom: 8, fontSize: 14 }}>Sales Trend</h2>
        <div style={{ height: 160 }}>
          {(filteredScheduledSalesMonths.length > 0 || filteredBidSubmittedSalesMonths.length > 0) ? (
            <CombinedSalesLineChart
              scheduledMonths={filteredScheduledSalesMonths}
              scheduledSalesByMonth={filteredScheduledSalesByMonth}
              bidSubmittedMonths={filteredBidSubmittedSalesMonths}
              bidSubmittedSalesByMonth={filteredBidSubmittedSalesByMonth}
            />
          ) : (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#999", fontSize: 13 }}>
              No sales data available for the selected period
            </div>
          )}
        </div>
      </div>

      {/* Combined Sales by Month Table */}
      {filteredCombinedSalesYears.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h2 style={{ color: "#15616D", marginBottom: 8, fontSize: 14 }}>Sales by Month</h2>
          <div style={{ overflowX: "auto" }}>
            {yearFilter ? (
              // SINGLE YEAR MODE: Show 12 months
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #eee" }}>
                    <th style={{ padding: "4px 6px", textAlign: "left", color: "#666", fontWeight: 600, width: "150px", fontSize: 12 }}>Type</th>
                    {monthNames.map((name, idx) => (
                      <th key={idx} style={{ padding: "4px 2px", textAlign: "center", color: "#666", fontWeight: 600, width: "90px", fontSize: 12 }}>
                        {name}
                      </th>
                    ))}
                    <th style={{ padding: "4px 6px", textAlign: "center", color: "#666", fontWeight: 600, width: "110px", fontSize: 12 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCombinedSalesYears.map((year, yearIndex) => {
                    const scheduledTotal = monthNames.reduce((sum, _, idx) => {
                      const manualValue = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.scheduledSales;
                      const calculatedValue = scheduledSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return sum + (manualValue !== undefined && manualValue !== null ? manualValue : calculatedValue);
                    }, 0);
                    const scheduledYtdTotal = monthNames.slice(0, ytdMonthCutoff).reduce((sum, _, idx) => {
                      const manualValue = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.scheduledSales;
                      const calculatedValue = scheduledSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return sum + (manualValue !== undefined && manualValue !== null ? manualValue : calculatedValue);
                    }, 0);
                    const bidSubmittedTotal = monthNames.reduce((sum, _, idx) => {
                      const calculatedValue = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return sum + calculatedValue;
                    }, 0);
                    const bidSubmittedYtdTotal = monthNames.slice(0, ytdMonthCutoff).reduce((sum, _, idx) => {
                      const calculatedValue = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return sum + calculatedValue;
                    }, 0);
                    return (
                    <React.Fragment key={year}>
                      <tr style={{ borderBottom: "1px solid #eee", backgroundColor: (yearIndex * 2) % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                        <td style={{ padding: "4px 6px", color: (yearIndex * 2) % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 13 }}>Scheduled</td>
                        {monthNames.map((_, idx) => {
                          const manualValue = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.scheduledSales;
                          const calculatedValue = scheduledSalesYearMonthMap[year]?.[idx + 1] || 0;
                          const sales = manualValue !== undefined && manualValue !== null ? manualValue : calculatedValue;
                          
                          return (
                            <td 
                              key={idx} 
                              style={{ 
                                padding: "4px 2px", 
                                textAlign: "center", 
                                color: sales > 0 ? ((yearIndex * 2) % 2 === 0 ? "#15616D" : "#E06C00") : "#999", 
                                fontWeight: sales > 0 ? 700 : 400, 
                                fontSize: 12
                              }}
                            >
                              {sales > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openKpiDrilldown(`Scheduled ${monthNames[idx]} ${year}`, scheduledSalesProjectsByMonth, { year, month: idx + 1, valueLabel: "Data Point (Sales)", valuePrefix: "$" })}
                                  style={{ background: "transparent", border: "none", color: (yearIndex * 2) % 2 === 0 ? "#15616D" : "#E06C00", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                                >
                                  ${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </button>
                              ) : "â€”"}
                            </td>
                          );
                        })}
                        <td style={{ padding: "4px 6px", textAlign: "center", color: (yearIndex * 2) % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                          {scheduledTotal > 0 ? (
                            <button
                              type="button"
                              onClick={() => openKpiDrilldown(`Scheduled ${year} Total`, scheduledSalesProjectsByMonth, { year, month: null, valueLabel: "Data Point (Sales)", valuePrefix: "$" })}
                              style={{ background: "transparent", border: "none", color: (yearIndex * 2) % 2 === 0 ? "#15616D" : "#E06C00", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                            >
                              {renderTotalWithYtd(
                                `$${scheduledTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                                `$${scheduledYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                              )}
                            </button>
                          ) : renderTotalWithYtd(
                            `$${scheduledTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                            `$${scheduledYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          )}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #eee", backgroundColor: (yearIndex * 2 + 1) % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                        <td style={{ padding: "4px 6px", color: (yearIndex * 2 + 1) % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 13 }}>Bid Subm.</td>
                        {monthNames.map((_, idx) => {
                          const calculatedValue = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                          const sales = calculatedValue;
                          
                          return (
                            <td 
                              key={idx} 
                              style={{ 
                                padding: "4px 2px", 
                                textAlign: "center", 
                                color: sales > 0 ? ((yearIndex * 2 + 1) % 2 === 0 ? "#15616D" : "#E06C00") : "#999", 
                                fontWeight: sales > 0 ? 700 : 400, 
                                fontSize: 12
                              }}
                            >
                              {sales > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openKpiDrilldown(`Bid Submitted ${monthNames[idx]} ${year}`, bidSubmittedSalesProjectsByMonth, { year, month: idx + 1, valueLabel: "Data Point (Sales)", valuePrefix: "$" })}
                                  style={{ background: "transparent", border: "none", color: (yearIndex * 2 + 1) % 2 === 0 ? "#15616D" : "#E06C00", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                                >
                                  ${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </button>
                              ) : "â€”"}
                            </td>
                          );
                        })}
                        <td style={{ padding: "4px 6px", textAlign: "center", color: (yearIndex * 2 + 1) % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                          {bidSubmittedTotal > 0 ? (
                            <button
                              type="button"
                              onClick={() => openKpiDrilldown(`Bid Submitted ${year} Total`, bidSubmittedSalesProjectsByMonth, { year, month: null, valueLabel: "Data Point (Sales)", valuePrefix: "$" })}
                              style={{ background: "transparent", border: "none", color: (yearIndex * 2 + 1) % 2 === 0 ? "#15616D" : "#E06C00", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                            >
                              {renderTotalWithYtd(
                                `$${bidSubmittedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                                `$${bidSubmittedYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                              )}
                            </button>
                          ) : renderTotalWithYtd(
                            `$${bidSubmittedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                            `$${bidSubmittedYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          )}
                        </td>
                      </tr>
                    </React.Fragment>
                  );} ) }
                </tbody>
              </table>
            ) : (
              // ALL YEARS MODE: Show all year-months as columns
              (() => {
                const allYearMonths: Array<{ year: string; month: number; label: string }> = [];
                filteredCombinedSalesYears.forEach(year => {
                  for (let month = 1; month <= 12; month++) {
                    allYearMonths.push({
                      year,
                      month,
                      label: `${monthNames[month - 1]} ${year}`
                    });
                  }
                });
                
                const scheduledTotal = allYearMonths.reduce((sum, { year, month }) => {
                  const manualValue = kpiData.find((k: any) => k.year === year && k.month === month)?.scheduledSales;
                  const calculatedValue = scheduledSalesYearMonthMap[year]?.[month] || 0;
                  const value = manualValue !== undefined && manualValue !== null ? manualValue : calculatedValue;
                  return sum + value;
                }, 0);
                const scheduledYtdTotal = allYearMonths.reduce((sum, { year, month }) => {
                  if (month > ytdMonthCutoff) return sum;
                  const manualValue = kpiData.find((k: any) => k.year === year && k.month === month)?.scheduledSales;
                  const calculatedValue = scheduledSalesYearMonthMap[year]?.[month] || 0;
                  const value = manualValue !== undefined && manualValue !== null ? manualValue : calculatedValue;
                  return sum + value;
                }, 0);
                
                const bidSubmittedTotal = allYearMonths.reduce((sum, { year, month }) => {
                  const calculatedValue = bidSubmittedSalesYearMonthMap[year]?.[month] || 0;
                  const value = calculatedValue;
                  return sum + value;
                }, 0);
                const bidSubmittedYtdTotal = allYearMonths.reduce((sum, { year, month }) => {
                  if (month > ytdMonthCutoff) return sum;
                  const calculatedValue = bidSubmittedSalesYearMonthMap[year]?.[month] || 0;
                  const value = calculatedValue;
                  return sum + value;
                }, 0);
                
                return (
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto", fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #eee" }}>
                        <th style={{ padding: "4px 6px", textAlign: "left", color: "#666", fontWeight: 600, minWidth: "100px", fontSize: 12 }}>Type</th>
                        {allYearMonths.map((ym, idx) => (
                          <th key={idx} style={{ padding: "4px 2px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "80px", fontSize: 11, whiteSpace: "nowrap" }}>
                            {ym.label}
                          </th>
                        ))}
                        <th style={{ padding: "4px 6px", textAlign: "center", color: "#666", fontWeight: 600, minWidth: "100px", fontSize: 12 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: "1px solid #eee", backgroundColor: "#ffffff" }}>
                        <td style={{ padding: "4px 6px", color: "#15616D", fontWeight: 700, fontSize: 13 }}>Scheduled</td>
                        {allYearMonths.map(({ year, month }, idx) => {
                          const manualValue = kpiData.find((k: any) => k.year === year && k.month === month)?.scheduledSales;
                          const calculatedValue = scheduledSalesYearMonthMap[year]?.[month] || 0;
                          const sales = manualValue !== undefined && manualValue !== null ? manualValue : calculatedValue;
                          return (
                            <td 
                              key={idx} 
                              style={{ 
                                padding: "4px 2px", 
                                textAlign: "center", 
                                color: sales > 0 ? "#15616D" : "#999", 
                                fontWeight: sales > 0 ? 700 : 400, 
                                fontSize: 12
                              }}
                            >
                              {sales > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openKpiDrilldown(`Scheduled ${monthNames[month - 1]} ${year}`, scheduledSalesProjectsByMonth, { year, month, valueLabel: "Data Point (Sales)", valuePrefix: "$" })}
                                  style={{ background: "transparent", border: "none", color: "#15616D", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                                >
                                  ${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </button>
                              ) : "â€”"}
                            </td>
                          );
                        })}
                        <td style={{ padding: "4px 6px", textAlign: "center", color: "#15616D", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                          {renderTotalWithYtd(
                            `$${scheduledTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                            `$${scheduledYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          )}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: "1px solid #eee", backgroundColor: "#f9f9f9" }}>
                        <td style={{ padding: "4px 6px", color: "#E06C00", fontWeight: 700, fontSize: 13 }}>Bid Subm.</td>
                        {allYearMonths.map(({ year, month }, idx) => {
                          const calculatedValue = bidSubmittedSalesYearMonthMap[year]?.[month] || 0;
                          const sales = calculatedValue;
                          return (
                            <td 
                              key={idx} 
                              style={{ 
                                padding: "4px 2px", 
                                textAlign: "center", 
                                color: sales > 0 ? "#E06C00" : "#999", 
                                fontWeight: sales > 0 ? 700 : 400, 
                                fontSize: 12
                              }}
                            >
                              {sales > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openKpiDrilldown(`Bid Submitted ${monthNames[month - 1]} ${year}`, bidSubmittedSalesProjectsByMonth, { year, month, valueLabel: "Data Point (Sales)", valuePrefix: "$" })}
                                  style={{ background: "transparent", border: "none", color: "#E06C00", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                                >
                                  ${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </button>
                              ) : "â€”"}
                            </td>
                          );
                        })}
                        <td style={{ padding: "4px 6px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                          {renderTotalWithYtd(
                            `$${bidSubmittedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                            `$${bidSubmittedYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()
            )}
          </div>
        </div>
      )}

      {/* KPI Monthly Data Tables */}
      <div style={{ display: "space-y", gap: 24 }}>
        {/* Estimates Table - using Bid Submitted data */}
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h3 style={{ color: "#15616D", marginBottom: 8, fontSize: 14, fontWeight: 700 }}>Estimates by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", color: "#666", fontWeight: 600, width: "150px", fontSize: 12 }}>Type</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "4px 2px", textAlign: "center", color: "#666", fontWeight: 600, width: "90px", fontSize: 12 }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                  <th style={{ padding: "4px 6px", textAlign: "center", color: "#666", fontWeight: 600, width: "110px", fontSize: 12 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const estimateYears = bidSubmittedSalesYears.filter(year => !yearFilter || year === yearFilter);
                  const rowColors = ["#15616D", "#E06C00"];
                  let rowIndex = 0;

                  const rows: React.ReactNode[] = [];

                  estimateYears.forEach((year) => {
                    const bidsColor = rowColors[rowIndex % 2];
                    const bidsTotal = monthNames.reduce((sum, _, idx) => {
                      const calculatedValue = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return sum + calculatedValue;
                    }, 0);
                    const bidsYtdTotal = monthNames.slice(0, ytdMonthCutoff).reduce((sum, _, idx) => {
                      const calculatedValue = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return sum + calculatedValue;
                    }, 0);

                    rows.push(
                      <tr key={year} style={{ borderBottom: "1px solid #eee", backgroundColor: rowIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                        <td style={{ padding: "4px 6px", color: bidsColor, fontWeight: 700, fontSize: 13 }}>{yearFilter ? "Bids Submitted" : `Bids Submitted ${year}`}</td>
                        {monthNames.map((_, idx) => {
                          const value = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                          return (
                            <td
                              key={idx}
                              style={{
                                padding: "4px 2px",
                                textAlign: "center",
                                color: value > 0 ? bidsColor : "#999",
                                fontWeight: value > 0 ? 700 : 400,
                                fontSize: 12
                              }}
                            >
                              {value > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openKpiDrilldown(`Bids Submitted ${monthNames[idx]} ${year}`, bidSubmittedSalesProjectsByMonth, { year, month: idx + 1, valueLabel: "Data Point (Sales)", valuePrefix: "$" })}
                                  style={{ background: "transparent", border: "none", color: bidsColor, cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                                >
                                  ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </button>
                              ) : "â€”"}
                            </td>
                          );
                        })}
                        <td style={{ padding: "4px 6px", textAlign: "center", color: bidsColor, fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                          {bidsTotal > 0 ? (
                            <button
                              type="button"
                              onClick={() => openKpiDrilldown(`Bids Submitted ${year} Total`, bidSubmittedSalesProjectsByMonth, { year, month: null, valueLabel: "Data Point (Sales)", valuePrefix: "$" })}
                              style={{ background: "transparent", border: "none", color: bidsColor, cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                            >
                              {renderTotalWithYtd(
                                `$${bidsTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                                `$${bidsYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                              )}
                            </button>
                          ) : renderTotalWithYtd(
                            `$${bidsTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                            `$${bidsYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                          )}
                        </td>
                      </tr>
                    );
                    rowIndex += 1;

                    const newBidsColor = rowColors[rowIndex % 2];
                    const newBidsTotal = monthNames.reduce((sum, _, idx) => {
                      const calculatedValue = newBidsSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return sum + calculatedValue;
                    }, 0);
                    const newBidsYtdTotal = monthNames.slice(0, ytdMonthCutoff).reduce((sum, _, idx) => {
                      const calculatedValue = newBidsSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return sum + calculatedValue;
                    }, 0);

                    rows.push(
                      <tr key={`new-bids-${year}`} style={{ borderBottom: "1px solid #eee", backgroundColor: rowIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                        <td style={{ padding: "4px 6px", color: newBidsColor, fontWeight: 700, fontSize: 13 }}>{yearFilter ? "New Bids" : `New Bids ${year}`}</td>
                        {monthNames.map((_, idx) => {
                          const value = newBidsSalesYearMonthMap[year]?.[idx + 1] || 0;
                          return (
                            <td
                              key={idx}
                              style={{
                                padding: "4px 2px",
                                textAlign: "center",
                                color: value > 0 ? newBidsColor : "#999",
                                fontWeight: value > 0 ? 700 : 400,
                                fontSize: 12
                              }}
                            >
                              {value > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openNewBidsDrilldown(year, idx + 1)}
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    color: newBidsColor,
                                    cursor: "pointer",
                                    fontWeight: 700,
                                    fontSize: 12,
                                    textDecoration: "underline",
                                    padding: 0,
                                  }}
                                  title={`Show projects for New Bids ${monthNames[idx]} ${year}`}
                                >
                                  ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </button>
                              ) : "â€”"}
                            </td>
                          );
                        })}
                        <td style={{ padding: "4px 6px", textAlign: "center", color: newBidsColor, fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                          {newBidsTotal > 0 ? (
                            <button
                              type="button"
                              onClick={() => openNewBidsDrilldown(year, null)}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: newBidsColor,
                                cursor: "pointer",
                                fontWeight: 700,
                                fontSize: 12,
                                textDecoration: "underline",
                                padding: 0,
                              }}
                              title={`Show all projects for New Bids ${year}`}
                            >
                              {renderTotalWithYtd(
                                `$${newBidsTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                                `$${newBidsYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                              )}
                            </button>
                          ) : (
                            renderTotalWithYtd(
                              `$${newBidsTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                              `$${newBidsYtdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                            )
                          )}
                        </td>
                      </tr>
                    );
                    rowIndex += 1;
                  });

                  const goalColor = rowColors[rowIndex % 2];
                  rows.push(
                    <tr key="goal" style={{ borderBottom: "1px solid #eee", backgroundColor: rowIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                      <td style={{ padding: "4px 6px", color: goalColor, fontWeight: 700, fontSize: 13 }}>Goal</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: goalColor, fontWeight: 700, fontSize: 12 }}>
                      $6,700,000
                    </td>
                  ))}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: goalColor, fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {renderTotalWithYtd(
                      `$${(6700000 * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                      `$${(6700000 * ytdMonthCutoff).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    )}
                  </td>
                </tr>
                  );
                  rowIndex += 1;

                  const actHoursColor = rowColors[rowIndex % 2];
                  rows.push(
                <tr key="actual-hours" style={{ borderBottom: "1px solid #eee", backgroundColor: rowIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                  <td style={{ padding: "4px 6px", color: actHoursColor, fontWeight: 700, fontSize: 13 }}>Act Hrs</td>
                  {monthNames.map((_, idx) => {
                    let hours = 0;
                    if (yearFilter) {
                      hours = bidSubmittedHoursYearMonthMap[yearFilter]?.[idx + 1] || 0;
                    } else {
                      hours = Object.values(bidSubmittedHoursYearMonthMap).reduce((sum, yearData) => sum + (yearData[idx + 1] || 0), 0);
                    }
                    return (
                      <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: hours > 0 ? actHoursColor : "#999", fontWeight: hours > 0 ? 700 : 400, fontSize: 12 }}>
                        {hours > 0 ? (
                          <button
                            type="button"
                            onClick={() => openKpiDrilldown(yearFilter ? `Act Hrs ${monthNames[idx]} ${yearFilter}` : `Act Hrs ${monthNames[idx]} (All Years)`, bidSubmittedHoursProjectsByMonth, { year: yearFilter || null, month: idx + 1, valueLabel: "Data Point (Hours)", valuePrefix: "" })}
                            style={{ background: "transparent", border: "none", color: actHoursColor, cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                          >
                            {hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </button>
                        ) : "â€”"}
                      </td>
                    );
                  })}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: actHoursColor, fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {(() => {
                      let total = 0;
                      let ytdTotal = 0;
                      if (yearFilter) {
                        total = Object.values(bidSubmittedHoursYearMonthMap[yearFilter] || {}).reduce((sum, val) => sum + val, 0);
                        ytdTotal = monthNames.slice(0, ytdMonthCutoff).reduce((sum, _, idx) => sum + (bidSubmittedHoursYearMonthMap[yearFilter]?.[idx + 1] || 0), 0);
                      } else {
                        total = Object.values(bidSubmittedHoursYearMonthMap).reduce((sum, yearData) => sum + Object.values(yearData).reduce((s, v) => s + v, 0), 0);
                        ytdTotal = Object.values(bidSubmittedHoursYearMonthMap).reduce(
                          (sum, yearData) => sum + monthNames.slice(0, ytdMonthCutoff).reduce((s, _, idx) => s + (yearData[idx + 1] || 0), 0),
                          0
                        );
                      }
                      return total > 0 ? (
                        <button
                          type="button"
                          onClick={() => openKpiDrilldown(yearFilter ? `Act Hrs ${yearFilter} Total` : "Act Hrs Total (All Years)", bidSubmittedHoursProjectsByMonth, { year: yearFilter || null, month: null, valueLabel: "Data Point (Hours)", valuePrefix: "" })}
                          style={{ background: "transparent", border: "none", color: actHoursColor, cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                        >
                          {renderTotalWithYtd(
                            total.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                            ytdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                          )}
                        </button>
                      ) : renderTotalWithYtd(
                        total.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                        ytdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                      );
                    })()}
                  </td>
                </tr>
                  );
                  rowIndex += 1;

                  const goalHoursColor = rowColors[rowIndex % 2];
                  rows.push(
                <tr key="goal-hours" style={{ borderBottom: "1px solid #eee", backgroundColor: rowIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                  <td style={{ padding: "4px 6px", color: goalHoursColor, fontWeight: 700, fontSize: 13 }}>Goal Hrs</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: goalHoursColor, fontWeight: 700, fontSize: 12 }}>
                      29,000
                    </td>
                  ))}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: goalHoursColor, fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {renderTotalWithYtd(
                      (29000 * 12).toLocaleString(undefined, { maximumFractionDigits: 0 }),
                      (29000 * ytdMonthCutoff).toLocaleString(undefined, { maximumFractionDigits: 0 })
                    )}
                  </td>
                </tr>
                  );

                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sales Table */}
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h3 style={{ color: "#E06C00", marginBottom: 8, fontSize: 14, fontWeight: 700 }}>Sales by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", color: "#666", fontWeight: 600, width: "150px", fontSize: 12 }}>Type</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "4px 2px", textAlign: "center", color: "#666", fontWeight: 600, width: "90px", fontSize: 12 }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                  <th style={{ padding: "4px 6px", textAlign: "center", color: "#666", fontWeight: 600, width: "110px", fontSize: 12 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr key="goal" style={{ borderBottom: "1px solid #eee", backgroundColor: "#f9f9f9" }}>
                  <td style={{ padding: "4px 6px", color: "#E06C00", fontWeight: 700, fontSize: 13 }}>Goal</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12 }}>
                      $1,000,000
                    </td>
                  ))}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {renderTotalWithYtd(
                      `$${(1000000 * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                      `$${(1000000 * ytdMonthCutoff).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    )}
                  </td>
                </tr>
                <tr key="actual-hours" style={{ borderBottom: "1px solid #eee", backgroundColor: "#ffffff" }}>
                  <td style={{ padding: "4px 6px", color: "#15616D", fontWeight: 700, fontSize: 13 }}>Act Hrs</td>
                  {monthNames.map((_, idx) => {
                    let hours = 0;
                    if (yearFilter) {
                      hours = inProgressHoursYearMonthMap[yearFilter]?.[idx + 1] || 0;
                    } else {
                      hours = Object.values(inProgressHoursYearMonthMap).reduce((sum, yearData) => sum + (yearData[idx + 1] || 0), 0);
                    }
                    return (
                      <td key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: hours > 0 ? "#15616D" : "#999", fontWeight: hours > 0 ? 700 : 400 }}>
                        {hours > 0 ? (
                          <button
                            type="button"
                            onClick={() => openKpiDrilldown(yearFilter ? `Sales Act Hrs ${monthNames[idx]} ${yearFilter}` : `Sales Act Hrs ${monthNames[idx]} (All Years)`, inProgressHoursProjectsByMonth, { year: yearFilter || null, month: idx + 1, valueLabel: "Data Point (Hours)", valuePrefix: "" })}
                            style={{ background: "transparent", border: "none", color: "#15616D", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                          >
                            {hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </button>
                        ) : "â€”"}
                      </td>
                    );
                  })}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#15616D", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {(() => {
                      let total = 0;
                      let ytdTotal = 0;
                      if (yearFilter) {
                        total = Object.values(inProgressHoursYearMonthMap[yearFilter] || {}).reduce((sum, val) => sum + val, 0);
                        ytdTotal = monthNames.slice(0, ytdMonthCutoff).reduce((sum, _, idx) => sum + (inProgressHoursYearMonthMap[yearFilter]?.[idx + 1] || 0), 0);
                      } else {
                        total = Object.values(inProgressHoursYearMonthMap).reduce((sum, yearData) => sum + Object.values(yearData).reduce((s, v) => s + v, 0), 0);
                        ytdTotal = Object.values(inProgressHoursYearMonthMap).reduce(
                          (sum, yearData) => sum + monthNames.slice(0, ytdMonthCutoff).reduce((s, _, idx) => s + (yearData[idx + 1] || 0), 0),
                          0
                        );
                      }
                      return total > 0 ? (
                        <button
                          type="button"
                          onClick={() => openKpiDrilldown(yearFilter ? `Sales Act Hrs ${yearFilter} Total` : "Sales Act Hrs Total (All Years)", inProgressHoursProjectsByMonth, { year: yearFilter || null, month: null, valueLabel: "Data Point (Hours)", valuePrefix: "" })}
                          style={{ background: "transparent", border: "none", color: "#15616D", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                        >
                          {renderTotalWithYtd(
                            total.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                            ytdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                          )}
                        </button>
                      ) : renderTotalWithYtd(
                        total.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                        ytdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                      );
                    })()}
                  </td>
                </tr>
                <tr key="goal-hours" style={{ borderBottom: "1px solid #eee", backgroundColor: "#f9f9f9" }}>
                  <td style={{ padding: "4px 6px", color: "#E06C00", fontWeight: 700 }}>Goal Hours</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: "#E06C00", fontWeight: 700 }}>
                      4,300
                    </td>
                  ))}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {renderTotalWithYtd(
                      (4300 * 12).toLocaleString(undefined, { maximumFractionDigits: 0 }),
                      (4300 * ytdMonthCutoff).toLocaleString(undefined, { maximumFractionDigits: 0 })
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Revenue Table */}
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h3 style={{ color: "#E06C00", marginBottom: 8, fontSize: 14, fontWeight: 700 }}>Revenue by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 12, color: "#666", fontWeight: 600, width: "150px" }}>Type</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "90px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                  <th style={{ padding: "4px 6px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "110px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {renderCardRows("Revenue By Month", "#15616D")}
              </tbody>
            </table>
          </div>
        </div>

        {/* Subs Table */}
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h3 style={{ color: "#15616D", marginBottom: 8, fontSize: 14, fontWeight: 700 }}>Subs by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 12, color: "#666", fontWeight: 600, width: "150px" }}>Type</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "90px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                  <th style={{ padding: "4px 6px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "110px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {renderCardRows("Subs By Month", "#15616D")}
              </tbody>
            </table>
          </div>
        </div>

        {/* Revenue Hours Table */}
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ color: "#15616D", fontSize: 14, fontWeight: 700, margin: 0 }}>Revenue Hours by Month</h3>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 12, color: "#666", fontWeight: 600, width: "150px" }}>Type</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "90px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                  <th style={{ padding: "4px 6px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "110px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {renderCardRows("Revenue Hours by Month", "#15616D")}
              </tbody>
            </table>
          </div>
        </div>

        {/* Gross Profit Table */}
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h3 style={{ color: "#15616D", marginBottom: 8, fontSize: 14, fontWeight: 700 }}>Gross Profit by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 12, color: "#666", fontWeight: 600, width: "150px" }}>Type</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "90px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                  <th style={{ padding: "4px 6px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "110px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {renderCardRows("Gross Profit by Month", "#15616D")}
              </tbody>
            </table>
          </div>
        </div>

        {/* Profit Table */}
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h3 style={{ color: "#15616D", marginBottom: 8, fontSize: 14, fontWeight: 700 }}>Profit by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 12, color: "#666", fontWeight: 600, width: "150px" }}>Type</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "90px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                  <th style={{ padding: "4px 6px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "110px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {renderCardRows("Profit by Month", "#15616D")}
              </tbody>
            </table>
          </div>
        </div>

        {/* Leadtimes Table */}
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h3 style={{ color: "#15616D", marginBottom: 8, fontSize: 14, fontWeight: 700 }}>Leadtimes by Month</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #eee" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left", fontSize: 12, color: "#666", fontWeight: 600, width: "150px" }}>Type</th>
                  {monthNames.map((name, idx) => (
                    <th key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "90px" }}>
                      {name.substring(0, 3)}
                    </th>
                  ))}
                  <th style={{ padding: "4px 6px", textAlign: "center", fontSize: 12, color: "#666", fontWeight: 600, width: "110px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: "1px solid #eee", backgroundColor: "#ffffff" }}>
                  <td style={{ padding: "6px 6px", color: "#15616D", fontWeight: 700, fontSize: 13 }}>Leadtime Hours</td>
                  {monthNames.map((_, idx) => {
                    let hours = 0;
                    if (yearFilter) {
                      hours = bidSubmittedHoursYearMonthMap[yearFilter]?.[idx + 1] || 0;
                    } else {
                      hours = Object.values(bidSubmittedHoursYearMonthMap).reduce((sum, yearData) => sum + (yearData[idx + 1] || 0), 0);
                    }
                    return (
                      <td key={idx} style={{ padding: "6px 2px", textAlign: "center", color: hours > 0 ? "#15616D" : "#999", fontWeight: hours > 0 ? 700 : 400, fontSize: 12 }}>
                        {hours > 0 ? (
                          <button
                            type="button"
                            onClick={() => openKpiDrilldown(yearFilter ? `Leadtime Hours ${monthNames[idx]} ${yearFilter}` : `Leadtime Hours ${monthNames[idx]} (All Years)`, bidSubmittedHoursProjectsByMonth, { year: yearFilter || null, month: idx + 1, valueLabel: "Data Point (Hours)", valuePrefix: "" })}
                            style={{ background: "transparent", border: "none", color: "#15616D", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                          >
                            {hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </button>
                        ) : "â€”"}
                      </td>
                    );
                  })}
                  <td style={{ padding: "6px 6px", textAlign: "center", color: "#15616D", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {(() => {
                      let total = 0;
                      let ytdTotal = 0;
                      if (yearFilter) {
                        total = Object.values(bidSubmittedHoursYearMonthMap[yearFilter] || {}).reduce((sum, val) => sum + val, 0);
                        ytdTotal = monthNames.slice(0, ytdMonthCutoff).reduce((sum, _, idx) => sum + (bidSubmittedHoursYearMonthMap[yearFilter]?.[idx + 1] || 0), 0);
                      } else {
                        total = Object.values(bidSubmittedHoursYearMonthMap).reduce((sum, yearData) => sum + Object.values(yearData).reduce((s, v) => s + v, 0), 0);
                        ytdTotal = Object.values(bidSubmittedHoursYearMonthMap).reduce(
                          (sum, yearData) => sum + monthNames.slice(0, ytdMonthCutoff).reduce((s, _, idx) => s + (yearData[idx + 1] || 0), 0),
                          0
                        );
                      }
                      return total > 0 ? (
                        <button
                          type="button"
                          onClick={() => openKpiDrilldown(yearFilter ? `Leadtime Hours ${yearFilter} Total` : "Leadtime Hours Total (All Years)", bidSubmittedHoursProjectsByMonth, { year: yearFilter || null, month: null, valueLabel: "Data Point (Hours)", valuePrefix: "" })}
                          style={{ background: "transparent", border: "none", color: "#15616D", cursor: "pointer", fontWeight: 700, fontSize: 12, textDecoration: "underline", padding: 0 }}
                        >
                          {renderTotalWithYtd(
                            total.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                            ytdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                          )}
                        </button>
                      ) : renderTotalWithYtd(
                        total.toLocaleString(undefined, { maximumFractionDigits: 0 }),
                        ytdTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                      );
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {kpiDrilldown.open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closeKpiDrilldown}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "#fff",
              width: "min(900px, 100%)",
              maxHeight: "80vh",
              borderRadius: 10,
              border: "1px solid #d4d4d4",
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #e5e5e5", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <h4 style={{ margin: 0, color: "#15616D", fontSize: 16 }}>
                  {kpiDrilldown.title}
                </h4>
                <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                  {kpiDrilldown.entries.length} project{kpiDrilldown.entries.length === 1 ? "" : "s"} contributing to this data point
                </div>
              </div>
              <button
                type="button"
                onClick={closeKpiDrilldown}
                style={{
                  border: "1px solid #d4d4d4",
                  borderRadius: 6,
                  background: "#fff",
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ overflow: "auto", padding: 12 }}>
              {kpiDrilldown.entries.length === 0 ? (
                <div style={{ color: "#666", fontSize: 13 }}>No projects found for this KPI data point.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e5e5e5" }}>
                      <th style={{ textAlign: "left", padding: "8px 6px", color: "#666", width: "32%" }}>Project</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", color: "#666", width: "28%" }}>Customer</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", color: "#666", width: "20%" }}>Created</th>
                      <th style={{ textAlign: "right", padding: "8px 6px", color: "#666", width: "20%" }}>{kpiDrilldown.valueLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kpiDrilldown.entries.map((entry) => (
                      <tr key={`${entry.id}-${entry.dateLabel}`} style={{ borderBottom: "1px solid #f0f0f0" }}>
                        <td style={{ padding: "8px 6px", color: "#222" }}>
                          <div style={{ fontWeight: 600 }}>{entry.projectName}</div>
                        </td>
                        <td style={{ padding: "8px 6px", color: "#222" }}>{entry.customer}</td>
                        <td style={{ padding: "8px 6px", color: "#444" }}>{entry.dateLabel}</td>
                        <td style={{ padding: "8px 6px", color: "#15616D", textAlign: "right", fontWeight: 700 }}>
                          {kpiDrilldown.valuePrefix}{entry.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function CombinedSalesLineChart({
  scheduledMonths,
  scheduledSalesByMonth,
  bidSubmittedMonths,
  bidSubmittedSalesByMonth,
}: {
  scheduledMonths: string[];
  scheduledSalesByMonth: Record<string, number>;
  bidSubmittedMonths: string[];
  bidSubmittedSalesByMonth: Record<string, number>;
}) {
  const monthSet = new Set<string>([...scheduledMonths, ...bidSubmittedMonths]);
  const sortedMonths = Array.from(monthSet)
    .filter(month => isValidMonthKey(month) && !month.startsWith("2024"))
    .sort();

  const scheduledSales = sortedMonths.map(month => scheduledSalesByMonth[month] || 0);
  const bidSubmittedSales = sortedMonths.map(month => bidSubmittedSalesByMonth[month] || 0);

  const labels = sortedMonths.map(month => {
    const [year, m] = month.split("-");
    const date = new Date(Number(year), Number(m) - 1, 1);
    return isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  });

  const maxScheduledSales = Math.max(...scheduledSales, 0);
  const maxBidSubmittedSales = Math.max(...bidSubmittedSales, 0);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Scheduled Sales",
        data: scheduledSales,
        borderColor: "#15616D",
        backgroundColor: "rgba(21, 97, 109, 0.25)",
        tension: 0.4,
        fill: true,
        pointBackgroundColor: "#15616D",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 5,
        borderWidth: 2.5,
        yAxisID: "y",
      },
      {
        label: "Bid Submitted Sales",
        data: bidSubmittedSales,
        borderColor: "#E06C00",
        backgroundColor: "rgba(224, 108, 0, 0.25)",
        tension: 0.4,
        fill: true,
        pointBackgroundColor: "#E06C00",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        pointRadius: 5,
        borderWidth: 2.5,
        yAxisID: "y1",
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          color: "#111827",
          boxWidth: 12,
        },
      },
      tooltip: {
        backgroundColor: "rgba(0, 0, 0, 0.8)",
        titleColor: "#fff",
        bodyColor: "#e5e7eb",
        borderColor: "#ddd",
        borderWidth: 1,
        callbacks: {
          label: (context) => {
            const value = context.parsed.y || 0;
            return `${context.dataset.label}: $${value.toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        max: maxScheduledSales ? maxScheduledSales * 1.1 : undefined,
        ticks: {
          color: "#15616D",
          callback: function(value) {
            return `$${Math.round(value as number).toLocaleString()}`;
          },
        },
        grid: {
          color: "#e5e7eb",
        },
        title: {
          display: true,
          text: "Scheduled Sales",
          color: "#15616D",
          font: { weight: "bold" },
        },
      },
      y1: {
        beginAtZero: true,
        max: maxBidSubmittedSales ? maxBidSubmittedSales * 1.1 : undefined,
        position: "right",
        grid: {
          drawOnChartArea: false,
        },
        ticks: {
          color: "#E06C00",
          callback: function(value) {
            return `$${Math.round(value as number).toLocaleString()}`;
          },
        },
        title: {
          display: true,
          text: "Bid Submitted Sales",
          color: "#E06C00",
          font: { weight: "bold" },
        },
      },
      x: {
        ticks: {
          color: "#111827",
        },
        grid: {
          color: "#f0f0f0",
        },
      },
    },
  };

  return <Line data={chartData} options={options} />;
}

function CombinedHoursLineChart({
  inProgressHoursByMonth,
  bidSubmittedHoursByMonth,
  yearFilter,
  startDate,
  endDate,
}: {
  inProgressHoursByMonth: Record<string, number>;
  bidSubmittedHoursByMonth: Record<string, number>;
  yearFilter: string;
  startDate: string;
  endDate: string;
}) {
  // Get all unique months from both datasets
  const allMonths = Array.from(new Set([...Object.keys(inProgressHoursByMonth), ...Object.keys(bidSubmittedHoursByMonth)])).sort();
  
  // Filter months based on yearFilter and startDate/endDate
  const filteredMonths = allMonths.filter((month) => {
    if (yearFilter && !month.startsWith(yearFilter)) return false;
    
    if (startDate || endDate) {
      const [year, m] = month.split("-");
      const monthDate = new Date(Number(year), Number(m) - 1, 1);
      
      if (startDate) {
        const start = new Date(startDate);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        if (monthDate < start) return false;
      }
      
      if (endDate) {
        const end = new Date(endDate);
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
        end.setHours(23, 59, 59, 999);
        if (monthDate > end) return false;
      }
    }
    
    return true;
  });

  const chartData = {
    labels: filteredMonths.map((month) => {
      const [year, m] = month.split("-");
      const date = new Date(Number(year), Number(m) - 1);
      return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }),
    datasets: [
      {
        label: "In Progress Hours",
        data: filteredMonths.map((month) => inProgressHoursByMonth[month] || 0),
        borderColor: "#E06C00",
        backgroundColor: "rgba(224, 108, 0, 0.1)",
        tension: 0.3,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
      {
        label: "Bid Submitted Hours",
        data: filteredMonths.map((month) => bidSubmittedHoursByMonth[month] || 0),
        borderColor: "#15616D",
        backgroundColor: "rgba(21, 97, 109, 0.1)",
        tension: 0.3,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "top" as const,
        labels: {
          usePointStyle: true,
          padding: 8,
          font: { size: 11, weight: "bold" },
          color: "#111827",
        },
      },
      tooltip: {
        mode: "index" as const,
        intersect: false,
        callbacks: {
          label: function (context) {
            let label = context.dataset.label || "";
            if (label) {
              label += ": ";
            }
            if (context.parsed.y !== null) {
              label += context.parsed.y.toLocaleString() + " hrs";
            }
            return label;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          color: "#111827",
          callback: function (value) {
            return value.toLocaleString() + " hrs";
          },
        },
        grid: {
          drawOnChartArea: false,
        },
        border: {
          color: "#15616D",
          width: 2,
        },
        title: {
          display: true,
          text: "In Progress Hours",
          color: "#E06C00",
          font: { weight: "bold" },
        },
      },
      x: {
        ticks: {
          color: "#111827",
        },
        grid: {
          color: "#f0f0f0",
        },
      },
    },
  };

  return <Line data={chartData} options={options} />;
}














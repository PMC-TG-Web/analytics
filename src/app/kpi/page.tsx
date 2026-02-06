"use client";
import React, { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
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
  dateCreated?: any;
  dateUpdated?: any;
  projectArchived?: boolean;
  estimator?: string;
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

function isValidMonthKey(month: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
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
  if (!trimmed) return "—";
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
      values: ["3,059", "", "", "", "", "", "", "", "", "", "", ""],
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
  const updated = parseDateValue(project.dateUpdated);
  const created = parseDateValue(project.dateCreated);
  if (updated && created) return updated > created ? updated : created;
  return updated || created || null;
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

  return (
    <ProtectedPage page="kpi">
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
      />
    </ProtectedPage>
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
}: any) {

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

  useEffect(() => {
    async function fetchData() {
      try {
        const projectsSnapshot = await getDocs(collection(db, "projects"));
        const projectsData = projectsSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as Project[];
        setProjects(projectsData);

        const schedulesRes = await fetch("/api/scheduling");
        const schedulesJson = await schedulesRes.json();
        const schedulesData = schedulesJson.data || schedulesJson.schedules || [];

        const schedulesWithStatus = schedulesData.map((schedule: any) => {
          const matchingProject = projectsData.find((p: any) => {
            const scheduleKey = `${schedule.customer || ""}|${schedule.projectNumber || ""}|${schedule.projectName || ""}`;
            const projectKey = `${p.customer || ""}|${p.projectNumber || ""}|${p.projectName || ""}`;
            return scheduleKey === projectKey;
          });
          return {
            ...schedule,
            status: matchingProject?.status || "Unknown",
          };
        });

        setSchedules(schedulesWithStatus);

        // Load KPI data for current year
        const currentYear = yearFilter || new Date().getFullYear().toString();
        const kpiRes = await fetch(`/api/kpi?year=${currentYear}`);
        const kpiJson = await kpiRes.json();
        setKpiData(kpiJson.data || []);

        setLoading(false);
      } catch (error) {
        console.error("Error loading data:", error);
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    async function loadCardDataFromFirestore() {
      try {
        const res = await fetch("/api/kpi-cards");
        if (!res.ok) return;
        const json = await res.json();
        const cards = json.data || [];
        
        if (cards.length === 0) return;
        
        const mapped: Record<string, { kpi: string; values: string[] }[]> = {};
        cards.forEach((card: any) => {
          const cardNameNormalized = normalizeCardName(card.cardName);
          mapped[cardNameNormalized] = card.rows || [];
        });
        
        if (Object.keys(mapped).length > 0) {
          setCardLoadData(mapped);
        }
      } catch (error) {
        console.error("Error loading KPI cards from Firestore:", error);
      }
    }
    loadCardDataFromFirestore();
  }, []);

  const getProjectKey = (customer?: string, projectNumber?: string, projectName?: string) => {
    return `${customer ?? ""}|${projectNumber ?? ""}|${projectName ?? ""}`;
  };

  const qualifyingStatuses = ["Accepted", "In Progress"];

  const { aggregated: aggregatedProjects, dedupedByCustomer } = useMemo(() => {
    const activeProjects = projects;
    
    const projectIdentifierMap = new Map<string, Project[]>();
    activeProjects.forEach((project: Project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      
      if (!projectIdentifierMap.has(identifier)) {
        projectIdentifierMap.set(identifier, []);
      }
      projectIdentifierMap.get(identifier)!.push(project);
    });
    
    const dedupedByCustomer: Project[] = [];
    projectIdentifierMap.forEach((projectList) => {
      const customerMap = new Map<string, Project[]>();
      projectList.forEach(p => {
        const customer = (p.customer ?? "").toString().trim();
        if (!customerMap.has(customer)) {
          customerMap.set(customer, []);
        }
        customerMap.get(customer)!.push(p);
      });
      
      if (customerMap.size > 1) {
        const priorityStatuses = ["Accepted", "In Progress", "Complete"];
        let selectedCustomer: string = "";
        let selectedProjects: Project[] = [];
        
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
        
        dedupedByCustomer.push(...selectedProjects);
      } else {
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });
    
    const keyGroupMap = new Map<string, Project[]>();
    dedupedByCustomer.forEach((project) => {
      const key = getProjectKey(project.customer, project.projectNumber, project.projectName);
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
      
      map.set(key, baseProject);
    });
    return { aggregated: Array.from(map.values()), dedupedByCustomer };
  }, [projects]);

  const bidSubmittedSalesByMonth: Record<string, number> = {};
  dedupedByCustomer.forEach((project) => {
    if ((project.status || "") !== "Bid Submitted") return;
    const projectDate = parseDateValue(project.dateCreated);
    if (!projectDate) return;
    const monthKey = `${projectDate.getFullYear()}-${String(projectDate.getMonth() + 1).padStart(2, "0")}`;
    const sales = Number(project.sales ?? 0);
    if (!Number.isFinite(sales)) return;
    bidSubmittedSalesByMonth[monthKey] = (bidSubmittedSalesByMonth[monthKey] || 0) + sales;
  });
  const bidSubmittedSalesMonths = Object.keys(bidSubmittedSalesByMonth).sort();
  const bidSubmittedSalesYearMonthMap: Record<string, Record<number, number>> = {};
  bidSubmittedSalesMonths.forEach((month) => {
    const [year, m] = month.split("-");
    if (!bidSubmittedSalesYearMonthMap[year]) {
      bidSubmittedSalesYearMonthMap[year] = {};
    }
    bidSubmittedSalesYearMonthMap[year][Number(m)] = bidSubmittedSalesByMonth[month];
  });
  const bidSubmittedSalesYears = Object.keys(bidSubmittedSalesYearMonthMap).sort();

  const bidSubmittedHoursByMonth: Record<string, number> = {};
  
  // Filter projects first (like dashboard does), then deduplicate
  const filteredProjects = projects.filter((p: Project) => {
    if (p.projectArchived) return false;
    
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
  
  // Deduplicate by project, selecting one customer per project, then sum hours
  const projectIdentifierMap = new Map<string, Project[]>();
  filteredProjects.forEach((project: Project) => {
    const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
    if (!identifier) return;
    if (!projectIdentifierMap.has(identifier)) {
      projectIdentifierMap.set(identifier, []);
    }
    projectIdentifierMap.get(identifier)!.push(project);
  });
  
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
    
    // Pick one customer
    let chosenCustomer: string = "";
    let chosenProjects: Project[] = [];
    
    if (customerMap.size > 1) {
      const priorityStatuses = ["Accepted", "In Progress", "Complete"];
      let foundPriority = false;
      
      // First try to find a customer with priority status
      customerMap.forEach((projs, customer) => {
        if (!foundPriority && projs.some(p => priorityStatuses.includes(p.status || ""))) {
          chosenCustomer = customer;
          chosenProjects = projs;
          foundPriority = true;
        }
      });
      
      // If no priority status, pick the most recent, then alphabetical
      if (!foundPriority) {
        let latestCustomer = "";
        let latestDate: Date | null = null;
        const customerDates: Array<[string, Date | null]> = [];
        
        customerMap.forEach((projs, customer) => {
          const mostRecent = projs.reduce((latest, current) => {
            const currentDate = parseDateValue(current.dateCreated);
            const latestDateVal = parseDateValue(latest.dateCreated);
            if (!currentDate) return latest;
            if (!latestDateVal) return current;
            return currentDate > latestDateVal ? current : latest;
          }, projs[0]);
          
          const projDate = parseDateValue(mostRecent.dateCreated);
          customerDates.push([customer, projDate]);
        });
        
        // Sort by date descending, then by customer name ascending (alphabetical)
        customerDates.sort((a, b) => {
          if (a[1] && b[1]) {
            if (a[1] !== b[1]) return b[1].getTime() - a[1].getTime();
          }
          return a[0].localeCompare(b[0]);
        });
        
        chosenCustomer = customerDates[0][0];
        chosenProjects = customerMap.get(chosenCustomer) || [];
      }
    } else {
      // Only one customer, take all their entries
      customerMap.forEach((projs) => {
        chosenProjects = projs;
      });
    }
    
    // Sum hours for chosen customer's entries
    chosenProjects.forEach((project) => {
      if ((project.status || "") !== "Bid Submitted") return;
      
      const projectDate = parseDateValue(project.dateCreated);
      if (!projectDate) return;
      
      // Apply date range filter
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
  projectIdentifierMap.forEach((projectList) => {
    const customerMap = new Map<string, Project[]>();
    projectList.forEach(p => {
      const customer = (p.customer ?? "").toString().trim();
      if (!customerMap.has(customer)) {
        customerMap.set(customer, []);
      }
      customerMap.get(customer)!.push(p);
    });
    
    let chosenProjects: Project[] = [];
    if (customerMap.size > 1) {
      const priorityStatuses = ["Accepted", "In Progress", "Complete"];
      let foundPriority = false;
      customerMap.forEach((projs, customer) => {
        if (!foundPriority && projs.some(p => priorityStatuses.includes(p.status || ""))) {
          chosenProjects = projs;
          foundPriority = true;
        }
      });
      if (!foundPriority) {
        const customerDates: Array<[string, Date | null]> = [];
        customerMap.forEach((projs, customer) => {
          const mostRecent = projs.reduce((latest, current) => {
            const currentDate = parseDateValue(current.dateCreated);
            const latestDateVal = parseDateValue(latest.dateCreated);
            if (!currentDate) return latest;
            if (!latestDateVal) return current;
            return currentDate > latestDateVal ? current : latest;
          }, projs[0]);
          const projDate = parseDateValue(mostRecent.dateCreated);
          customerDates.push([customer, projDate]);
        });
        customerDates.sort((a, b) => {
          if (a[1] && b[1]) {
            if (a[1] !== b[1]) return b[1].getTime() - a[1].getTime();
          }
          return a[0].localeCompare(b[0]);
        });
        chosenProjects = customerMap.get(customerDates[0][0]) || [];
      }
    } else {
      customerMap.forEach((projs) => {
        chosenProjects = projs;
      });
    }
    
    chosenProjects.forEach((project) => {
      if ((project.status || "") !== "In Progress") return;
      
      const projectDate = parseDateValue(project.dateCreated);
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
    const rows = cardLoadData[normalizeCardName(cardName)] || [];
    if (rows.length === 0) return null;
    return rows.map((row: any, rowIndex: number) => {
      // Check if this is a percentage column (contains % values)
      const isPercentage = row.values.some((val: any) => String(val).includes("%"));
      
      let total: number;
      if (isPercentage && (cardName.toLowerCase().includes("gross profit") || cardName.toLowerCase().includes("profit"))) {
        // For GP/Profit percentages, calculate weighted average using Revenue as weights
        const revenueRow = cardLoadData[normalizeCardName(cardName)]?.find((r: any) => r.kpi === "Revenue" || r.kpi.includes("Revenue"));
        
        if (revenueRow) {
          let numerator = 0;
          let denominator = 0;
          
          row.values.forEach((val: any, idx: number) => {
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
        } else {
          // Fallback: simple average if no revenue row found
          const percentages = row.values
            .map((val: any) => parseFloat(String(val).replace("%", "").trim()))
            .filter((n: number) => !isNaN(n));
          total = percentages.length > 0 ? percentages.reduce((a: number, b: number) => a + b, 0) / percentages.length : 0;
        }
      } else {
        // For non-percentage values, sum as usual
        const total_val = row.values.reduce((sum: number, val: any) => {
          const numVal = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
          return sum + (isNaN(numVal) ? 0 : numVal);
        }, 0);
        total = total_val;
      }
      
      return (
      <tr key={`${cardName}-${row.kpi}`} style={{ borderBottom: "1px solid #eee", backgroundColor: rowIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
        <td style={{ padding: "6px 6px", color: rowIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 13 }}>{row.kpi}</td>
        {monthNames.map((_, idx) => {
          const value = row.values[idx] ?? "";
          const formatted = formatCardValue(cardName, row.kpi, value);
          return (
            <td key={idx} style={{ padding: "6px 2px", textAlign: "center", color: formatted !== "—" ? (rowIndex % 2 === 0 ? "#15616D" : "#E06C00") : "#999", fontWeight: formatted !== "—" ? 700 : 400, fontSize: 12 }}>
              {formatted}
            </td>
          );
        })}
        <td style={{ padding: "6px 6px", textAlign: "center", color: rowIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
          {formatCardValue(cardName, row.kpi, isPercentage ? `${total.toFixed(2)}%` : total.toString())}
        </td>
      </tr>
    );});
  };

  const scheduledSalesByMonth: Record<string, number> = {};
  
  const scheduleSalesMap = new Map<string, number>();
  projects.forEach((project: Project) => {
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

    if (Array.isArray(schedule.allocations)) {
      schedule.allocations.forEach((alloc: any) => {
        const percent = Number(alloc.percent ?? 0);
        if (!Number.isFinite(percent) || percent <= 0) return;
        const monthKey = alloc.month;
        const monthlySales = projectSales * (percent / 100);
        scheduledSalesByMonth[monthKey] = (scheduledSalesByMonth[monthKey] || 0) + monthlySales;
      });
    }
  });

  const scheduledSalesMonths = Object.keys(scheduledSalesByMonth).sort();
  const scheduledSalesYearMonthMap: Record<string, Record<number, number>> = {};
  scheduledSalesMonths.forEach((month) => {
    const [year, m] = month.split("-");
    if (!scheduledSalesYearMonthMap[year]) {
      scheduledSalesYearMonthMap[year] = {};
    }
    scheduledSalesYearMonthMap[year][Number(m)] = scheduledSalesByMonth[month];
  });
  const scheduledSalesYears = Object.keys(scheduledSalesYearMonthMap).sort();

  const combinedSalesYears = Array.from(new Set([...scheduledSalesYears, ...bidSubmittedSalesYears]))
    .filter(year => year !== "2024")
    .sort();

  const filteredBidSubmittedSalesByMonth: Record<string, number> = {};
  const filteredBidSubmittedSalesMonths = bidSubmittedSalesMonths.filter(month => {
    if (yearFilter) {
      const [year] = month.split("-");
      if (year !== yearFilter) return false;
    }
    filteredBidSubmittedSalesByMonth[month] = bidSubmittedSalesByMonth[month];
    return true;
  });

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

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
        <Navigation currentPage="kpi" />
      </div>

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
              ✕
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
          <span style={{ color: "#999", fontSize: 12 }}>–</span>
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
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Combined Sales Line Chart */}
      {(filteredScheduledSalesMonths.length > 0 || filteredBidSubmittedSalesMonths.length > 0) && (
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4, height: 200 }}>
          <h2 style={{ color: "#15616D", marginBottom: 8, fontSize: 14 }}>Sales Trend</h2>
          <div style={{ height: 160 }}>
            <CombinedSalesLineChart
              scheduledMonths={filteredScheduledSalesMonths}
              scheduledSalesByMonth={filteredScheduledSalesByMonth}
              bidSubmittedMonths={filteredBidSubmittedSalesMonths}
              bidSubmittedSalesByMonth={filteredBidSubmittedSalesByMonth}
            />
          </div>
        </div>
      )}

      {/* Combined Sales by Month Table */}
      {filteredCombinedSalesYears.length > 0 && (
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h2 style={{ color: "#15616D", marginBottom: 8, fontSize: 14 }}>Sales by Month</h2>
          <div style={{ overflowX: "auto" }}>
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
                  const scheduledTotal = monthNames.reduce((sum, _, idx) => sum + (scheduledSalesYearMonthMap[year]?.[idx + 1] || 0), 0);
                  const bidSubmittedTotal = monthNames.reduce((sum, _, idx) => sum + (bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0), 0);
                  return (
                  <React.Fragment key={year}>
                    <tr style={{ borderBottom: "1px solid #eee", backgroundColor: (yearIndex * 2) % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                      <td style={{ padding: "4px 6px", color: (yearIndex * 2) % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 13 }}>{yearFilter ? "Scheduled" : `Scheduled ${year}`}</td>
                      {monthNames.map((_, idx) => {
                        const sales = scheduledSalesYearMonthMap[year]?.[idx + 1] || 0;
                        return (
                          <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: sales > 0 ? ((yearIndex * 2) % 2 === 0 ? "#15616D" : "#E06C00") : "#999", fontWeight: sales > 0 ? 700 : 400, fontSize: 12 }}>
                            {sales > 0 ? `$${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                          </td>
                        );
                      })}
                      <td style={{ padding: "4px 6px", textAlign: "center", color: (yearIndex * 2) % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                        ${scheduledTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                    <tr style={{ borderBottom: "1px solid #eee", backgroundColor: (yearIndex * 2 + 1) % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                      <td style={{ padding: "4px 6px", color: (yearIndex * 2 + 1) % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 13 }}>{yearFilter ? "Bid Subm." : `Bid Subm. ${year}`}</td>
                      {monthNames.map((_, idx) => {
                        const sales = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                        return (
                          <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: sales > 0 ? ((yearIndex * 2 + 1) % 2 === 0 ? "#15616D" : "#E06C00") : "#999", fontWeight: sales > 0 ? 700 : 400, fontSize: 12 }}>
                            {sales > 0 ? `$${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                          </td>
                        );
                      })}
                      <td style={{ padding: "4px 6px", textAlign: "center", color: (yearIndex * 2 + 1) % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                        ${bidSubmittedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  </React.Fragment>
                );})}
              </tbody>
            </table>
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
                {bidSubmittedSalesYears.filter(year => !yearFilter || year === yearFilter).map((year, yearIndex) => {
                  const total = monthNames.reduce((sum, _, idx) => sum + (bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0), 0);
                  return (
                  <tr key={year} style={{ borderBottom: "1px solid #eee", backgroundColor: yearIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                    <td style={{ padding: "4px 6px", color: yearIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 13 }}>{yearFilter ? "Bids Submitted" : `Bids Submitted ${year}`}</td>
                    {monthNames.map((_, idx) => {
                      const value = bidSubmittedSalesYearMonthMap[year]?.[idx + 1] || 0;
                      return (
                        <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: value > 0 ? (yearIndex % 2 === 0 ? "#15616D" : "#E06C00") : "#999", fontWeight: value > 0 ? 700 : 400, fontSize: 12 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "4px 6px", textAlign: "center", color: yearIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                      ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                );})}
                <tr key="goal" style={{ borderBottom: "1px solid #eee", backgroundColor: "#f9f9f9" }}>
                  <td style={{ padding: "4px 6px", color: "#E06C00", fontWeight: 700, fontSize: 13 }}>Goal</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12 }}>
                      $6,700,000
                    </td>
                  ))}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    ${(6700000 * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                </tr>
                <tr key="actual-hours" style={{ borderBottom: "1px solid #eee", backgroundColor: "#ffffff" }}>
                  <td style={{ padding: "4px 6px", color: "#15616D", fontWeight: 700, fontSize: 13 }}>Act Hrs</td>
                  {monthNames.map((_, idx) => {
                    let hours = 0;
                    if (yearFilter) {
                      hours = bidSubmittedHoursYearMonthMap[yearFilter]?.[idx + 1] || 0;
                    } else {
                      hours = Object.values(bidSubmittedHoursYearMonthMap).reduce((sum, yearData) => sum + (yearData[idx + 1] || 0), 0);
                    }
                    return (
                      <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: hours > 0 ? "#15616D" : "#999", fontWeight: hours > 0 ? 700 : 400, fontSize: 12 }}>
                        {hours > 0 ? hours.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                      </td>
                    );
                  })}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#15616D", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {(() => {
                      let total = 0;
                      if (yearFilter) {
                        total = Object.values(bidSubmittedHoursYearMonthMap[yearFilter] || {}).reduce((sum, val) => sum + val, 0);
                      } else {
                        total = Object.values(bidSubmittedHoursYearMonthMap).reduce((sum, yearData) => sum + Object.values(yearData).reduce((s, v) => s + v, 0), 0);
                      }
                      return total.toLocaleString(undefined, { maximumFractionDigits: 0 });
                    })()}
                  </td>
                </tr>
                <tr key="goal-hours" style={{ borderBottom: "1px solid #eee", backgroundColor: "#f9f9f9" }}>
                  <td style={{ padding: "4px 6px", color: "#E06C00", fontWeight: 700, fontSize: 13 }}>Goal Hrs</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12 }}>
                      29,000
                    </td>
                  ))}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {(29000 * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                </tr>
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
                {Array.from(new Set(kpiData.map((k: any) => k.year))).sort().filter((year: any) => !yearFilter || year === yearFilter).map((year: any, yearIndex: number) => {
                  const total = monthNames.reduce((sum: number, _: string, idx: number) => sum + (kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.scheduledSales || 0), 0);
                  return (
                  <tr key={String(year)} style={{ borderBottom: "1px solid #eee", backgroundColor: yearIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                    <td style={{ padding: "4px 6px", color: yearIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 13 }}>{String(year)}</td>
                    {monthNames.map((_: string, idx: number) => {
                      const value = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.scheduledSales || 0;
                      return (
                        <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: value > 0 ? (yearIndex % 2 === 0 ? "#15616D" : "#E06C00") : "#999", fontWeight: value > 0 ? 700 : 400, fontSize: 12 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "4px 6px", textAlign: "center", color: yearIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                      ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                );})}
                <tr key="goal" style={{ borderBottom: "1px solid #eee", backgroundColor: "#f9f9f9" }}>
                  <td style={{ padding: "4px 6px", color: "#E06C00", fontWeight: 700, fontSize: 13 }}>Goal</td>
                  {monthNames.map((_, idx) => (
                    <td key={idx} style={{ padding: "4px 2px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12 }}>
                      $1,000,000
                    </td>
                  ))}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    ${(1000000 * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
                        {hours > 0 ? hours.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                      </td>
                    );
                  })}
                  <td style={{ padding: "4px 6px", textAlign: "center", color: "#15616D", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                    {(() => {
                      let total = 0;
                      if (yearFilter) {
                        total = Object.values(inProgressHoursYearMonthMap[yearFilter] || {}).reduce((sum, val) => sum + val, 0);
                      } else {
                        total = Object.values(inProgressHoursYearMonthMap).reduce((sum, yearData) => sum + Object.values(yearData).reduce((s, v) => s + v, 0), 0);
                      }
                      return total.toLocaleString(undefined, { maximumFractionDigits: 0 });
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
                    {(4300 * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
                {Array.from(new Set(kpiData.map((k: any) => k.year))).sort().filter((year: any) => !yearFilter || year === yearFilter).map((year: any, yearIndex: number) => {
                  const total = monthNames.reduce((sum: number, _: string, idx: number) => sum + (kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.bidSubmittedSales || 0), 0);
                  return (
                  <tr key={String(year)} style={{ borderBottom: "1px solid #eee", backgroundColor: yearIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                    <td style={{ padding: "4px 6px", color: yearIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700 }}>{String(year)}</td>
                    {monthNames.map((_: string, idx: number) => {
                      const value = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.bidSubmittedSales || 0;
                      return (
                        <td key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: value > 0 ? (yearIndex % 2 === 0 ? "#15616D" : "#E06C00") : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "4px 6px", textAlign: "center", color: yearIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                      ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                );})}
                {renderCardRows("Revenue By Month", "#E06C00")}
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
                {Array.from(new Set(kpiData.map((k: any) => k.year))).sort().filter((year: any) => !yearFilter || year === yearFilter).map((year: any) => {
                  const total = monthNames.reduce((sum: number, _: string, idx: number) => sum + (kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.subs || 0), 0);
                  return (
                  <tr key={String(year)} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "4px 6px", color: "#222", fontWeight: 700 }}>{String(year)}</td>
                    {monthNames.map((_: string, idx: number) => {
                      const value = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.subs || 0;
                      return (
                        <td key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: value > 0 ? "#15616D" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? value.toLocaleString() : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "4px 6px", textAlign: "center", color: "#15616D", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                      {total.toLocaleString()}
                    </td>
                  </tr>
                );})}
                {renderCardRows("Subs By Month", "#15616D")}
              </tbody>
            </table>
          </div>
        </div>

        {/* Revenue Hours Table */}
        <div style={{ background: "#ffffff", borderRadius: 8, padding: 12, border: "1px solid #ddd", marginBottom: 4 }}>
          <h3 style={{ color: "#15616D", marginBottom: 8, fontSize: 14, fontWeight: 700 }}>Revenue Hours by Month</h3>
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
                {Array.from(new Set(kpiData.map((k: any) => k.year))).sort().filter((year: any) => !yearFilter || year === yearFilter).map((year: any, yearIndex: number) => {
                  const total = monthNames.reduce((sum: number, _: string, idx: number) => sum + (kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.scheduledHours || 0), 0);
                  return (
                  <tr key={String(year)} style={{ borderBottom: "1px solid #eee", backgroundColor: yearIndex % 2 === 0 ? "#ffffff" : "#f9f9f9" }}>
                    <td style={{ padding: "4px 6px", color: yearIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700 }}>{String(year)}</td>
                    {monthNames.map((_: string, idx: number) => {
                      const value = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.scheduledHours || 0;
                      return (
                        <td key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: value > 0 ? (yearIndex % 2 === 0 ? "#15616D" : "#E06C00") : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? value.toLocaleString() : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "4px 6px", textAlign: "center", color: yearIndex % 2 === 0 ? "#15616D" : "#E06C00", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                      {total.toLocaleString()}
                    </td>
                  </tr>
                );})}
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
                {Array.from(new Set(kpiData.map((k: any) => k.year))).sort().filter((year: any) => !yearFilter || year === yearFilter).map((year: any) => {
                  const total = monthNames.reduce((sum: number, _: string, idx: number) => sum + (kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.grossProfit || 0), 0);
                  return (
                  <tr key={String(year)} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "4px 6px", color: "#222", fontWeight: 700 }}>{String(year)}</td>
                    {monthNames.map((_: string, idx: number) => {
                      const value = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.grossProfit || 0;
                      return (
                        <td key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: value > 0 ? "#15616D" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "4px 6px", textAlign: "center", color: "#15616D", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                      ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                );})}
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
                {Array.from(new Set(kpiData.map((k: any) => k.year))).sort().filter((year: any) => !yearFilter || year === yearFilter).map((year: any) => {
                  const total = monthNames.reduce((sum: number, _: string, idx: number) => sum + (kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.cost || 0), 0);
                  return (
                  <tr key={String(year)} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "4px 6px", color: "#222", fontWeight: 700 }}>{String(year)}</td>
                    {monthNames.map((_: string, idx: number) => {
                      const value = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.cost || 0;
                      return (
                        <td key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: value > 0 ? "#15616D" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "4px 6px", textAlign: "center", color: "#15616D", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                      ${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                );})}
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
                {Array.from(new Set(kpiData.map((k: any) => k.year))).sort().filter((year: any) => !yearFilter || year === yearFilter).map((year: any) => {
                  const total = monthNames.reduce((sum: number, _: string, idx: number) => sum + (kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.leadtimes || 0), 0);
                  return (
                  <tr key={String(year)} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "4px 6px", color: "#222", fontWeight: 700 }}>{String(year)}</td>
                    {monthNames.map((_: string, idx: number) => {
                      const value = kpiData.find((k: any) => k.year === year && k.month === idx + 1)?.leadtimes || 0;
                      return (
                        <td key={idx} style={{ padding: "4px 2px", textAlign: "center", fontSize: 12, color: value > 0 ? "#15616D" : "#999", fontWeight: value > 0 ? 700 : 400 }}>
                          {value > 0 ? value.toLocaleString() : "—"}
                        </td>
                      );
                    })}
                    <td style={{ padding: "4px 6px", textAlign: "center", color: "#15616D", fontWeight: 700, fontSize: 12, borderLeft: "2px solid #ddd" }}>
                      {total.toLocaleString()}
                    </td>
                  </tr>
                );})}
                {renderCardRows("Leadtimes by Month", "#15616D")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
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














import { useState, useEffect, useMemo } from "react";
import { getAllProjectsForDashboard, Project } from "../projectQueries";
import { parseDateValue, getProjectDate, getProjectKey } from "../../../utils/projectUtils";

export function useDashboardData() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  useEffect(() => {
    async function fetchData() {
      const data = await getAllProjectsForDashboard();
      setProjects(data);
      setLoading(false);
    }
    fetchData();
  }, []);

  const filteredProjects = useMemo(() => {
    return projects.filter(p => {
      if (p.projectArchived) return false;
      
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
      const exclusions = ["pmc operations", "pmc shop time", "pmc test project", "alexander drive addition latest"];
      if (exclusions.includes(projectName)) return false;
      if (projectName.includes("sandbox") || projectName.includes("raymond king")) return false;

      const estimator = (p.estimator ?? "").toString().trim().toLowerCase();
      if (!estimator || estimator === "todd gilmore") return false;

      const projectNumber = (p.projectNumber ?? "").toString().toLowerCase();
      if (projectNumber === "701 poplar church rd") return false;

      return true;
    });
  }, [projects, startDate, endDate]);

  const { aggregated: aggregatedProjects, dedupedByCustomer } = useMemo(() => {
    const projectIdentifierMap = new Map<string, Project[]>();
    filteredProjects.forEach((project) => {
      const identifier = (project.projectNumber ?? project.projectName ?? "").toString().trim();
      if (!identifier) return;
      if (!projectIdentifierMap.has(identifier)) projectIdentifierMap.set(identifier, []);
      projectIdentifierMap.get(identifier)!.push(project);
    });
    
    const dedupedByCustomer: Project[] = [];
    projectIdentifierMap.forEach((projectList) => {
      const customerMap = new Map<string, Project[]>();
      projectList.forEach(p => {
        const customer = (p.customer ?? "").toString().trim();
        if (!customerMap.has(customer)) customerMap.set(customer, []);
        customerMap.get(customer)!.push(p);
      });
      
      if (customerMap.size > 1) {
        const priorityStatuses = ["Accepted", "In Progress", "Complete"];
        let selectedProjects: Project[] = [];
        let foundPriority = false;

        for (const projs of customerMap.values()) {
          if (projs.some(p => priorityStatuses.includes(p.status || ""))) {
            selectedProjects = projs;
            foundPriority = true;
            break;
          }
        }

        if (!foundPriority) {
          let latestDate: Date | null = null;
          customerMap.forEach((projs) => {
            const mostRecentProj = projs.reduce((latest, current) => {
              const currentDate = parseDateValue(current.dateCreated);
              const latestDateVal = parseDateValue(latest.dateCreated);
              return (currentDate && latestDateVal && currentDate > latestDateVal) ? current : (latestDateVal ? latest : current);
            }, projs[0]);
            
            const projDate = parseDateValue(mostRecentProj.dateCreated);
            if (projDate && (!latestDate || projDate > latestDate)) {
              latestDate = projDate;
              selectedProjects = projs;
            }
          });
        }
        dedupedByCustomer.push(...selectedProjects);
      } else {
        projectList.forEach(p => dedupedByCustomer.push(p));
      }
    });
    
    const keyGroupMap = new Map<string, Project[]>();
    dedupedByCustomer.forEach((project) => {
      const key = getProjectKey(project);
      if (!keyGroupMap.has(key)) keyGroupMap.set(key, []);
      keyGroupMap.get(key)!.push(project);
    });
    
    const aggregatedMap = new Map<string, Project>();
    keyGroupMap.forEach((projects, key) => {
      const sorted = projects.sort((a, b) => (a.projectName ?? "").localeCompare(b.projectName ?? ""));
      const base = { ...sorted[0] };
      base.sales = sorted.reduce((sum, p) => sum + (p.sales ?? 0), 0);
      base.cost = sorted.reduce((sum, p) => sum + (p.cost ?? 0), 0);
      base.hours = sorted.reduce((sum, p) => sum + (p.hours ?? 0), 0);
      base.laborSales = sorted.reduce((sum, p) => sum + (p.laborSales ?? 0), 0);
      base.laborCost = sorted.reduce((sum, p) => sum + (p.laborCost ?? 0), 0);
      
      const latest = sorted.reduce((l, c) => {
        const ld = getProjectDate(l), cd = getProjectDate(c);
        return (cd && ld && cd > ld) ? c : (ld ? l : c);
      }, sorted[0]);
      
      base.dateUpdated = latest.dateUpdated;
      base.dateCreated = latest.dateCreated;
      aggregatedMap.set(key, base);
    });

    return { aggregated: Array.from(aggregatedMap.values()), dedupedByCustomer };
  }, [filteredProjects]);

  return {
    loading,
    projects,
    aggregatedProjects,
    dedupedByCustomer,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
  };
}

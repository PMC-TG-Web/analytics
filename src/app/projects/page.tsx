"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs, query, where, addDoc, doc, setDoc } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { Project, Scope } from "@/types";
import { Equipment, EquipmentAssignment } from "@/types/equipment";
import { getProjectKey, parseDateValue } from "@/utils/projectUtils";
import ProjectGanttDrawer from "./components/ProjectGanttDrawer";
import ProjectShortTermDrawer from "./components/ProjectShortTermDrawer";

interface AggregatedProject {
  jobKey: string;
  projectName: string;
  projectNumber: string;
  customer: string;
  status: string;
  totalSales: number;
  totalCost: number;
  totalHours: number;
  startDate?: string;
  endDate?: string;
  scopes: Scope[];
  id: string; // From the representative project doc
  isArchived: boolean;
}

export default function ProjectsPage() {
  return (
    <ProtectedPage page="projects">
      <ProjectsContent />
    </ProtectedPage>
  );
}

function ProjectsContent() {
  const [loading, setLoading] = useState(true);
  const [projectsData, setProjectsData] = useState<Project[]>([]);
  const [scopesData, setScopesData] = useState<Scope[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [assignments, setAssignments] = useState<EquipmentAssignment[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [columnFilters, setColumnFilters] = useState({
    projectName: "",
    customer: "",
    projectNumber: "",
    status: "",
  });
  const [showArchived, setShowArchived] = useState(false);
  const [selectedGanttProject, setSelectedGanttProject] = useState<AggregatedProject | null>(null);
  const [selectedShortTermProject, setSelectedShortTermProject] = useState<AggregatedProject | null>(null);
  const [selectedProject, setSelectedProject] = useState<AggregatedProject | null>(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedScopeId, setSelectedScopeId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof AggregatedProject; direction: 'asc' | 'desc' }>({
    key: 'projectName',
    direction: 'asc'
  });

  // Assignment Modal Form
  const [assignForm, setAssignForm] = useState({
    equipmentId: "",
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    notes: ""
  });

  useEffect(() => {
    loadAllData();
  }, []);

  async function loadAllData() {
    setLoading(true);
    try {
      const [projSnap, scopeSnap, eqSnap, assignSnap] = await Promise.all([
        getDocs(collection(db, "projects")),
        getDocs(collection(db, "projectScopes")),
        getDocs(collection(db, "equipment")),
        getDocs(collection(db, "equipment_assignments"))
      ]);

      setProjectsData(projSnap.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
      setScopesData(scopeSnap.docs.map(d => ({ id: d.id, ...d.data() } as Scope)));
      setEquipment(eqSnap.docs.map(d => ({ id: d.id, ...d.data() } as Equipment)));
      setAssignments(assignSnap.docs.map(d => ({ id: d.id, ...d.data() } as EquipmentAssignment)));
    } catch (error) {
      console.error("Error loading projects data:", error);
    } finally {
      setLoading(false);
    }
  }

  // 1. Memoize the expensive aggregation logic (Group raw data by jobKey)
  const baseAggregated = useMemo(() => {
    const map = new Map<string, AggregatedProject>();
    const groupedLineItems = new Map<string, Project[]>();

    // Pass 1: Group line items by jobKey and initialize aggregation objects
    projectsData.forEach(p => {
      const key = getProjectKey(p);
      if (key === "__noKey__") return;

      if (!groupedLineItems.has(key)) {
        groupedLineItems.set(key, []);
        map.set(key, {
          jobKey: key,
          projectName: p.projectName || "Unknown",
          projectNumber: p.projectNumber || "",
          customer: p.customer || "Unknown",
          status: p.status || "Unknown",
          totalSales: 0,
          totalCost: 0,
          totalHours: 0,
          scopes: [],
          id: p.id,
          isArchived: p.projectArchived === true
        });
      }
      
      groupedLineItems.get(key)!.push(p);
      const agg = map.get(key)!;
      agg.totalSales += (p.sales || 0);
      agg.totalCost += (p.cost || 0);
      agg.totalHours += (p.hours || 0);
      
      // Update archive status if any line item is NOT archived (safety check)
      if (p.projectArchived === false) agg.isArchived = false;

      if (p.status === "In Progress") agg.status = "In Progress";
      else if (p.status === "Accepted" && agg.status !== "In Progress") agg.status = "Accepted";
    });

    // Pass 2: Attach scopes and determine dates using the pre-grouped data
    map.forEach(agg => {
      const formalScopes = scopesData.filter(s => s.jobKey === agg.jobKey);
      const lineItems = groupedLineItems.get(agg.jobKey) || [];
      const uniqueSOWs = new Set<string>();
      
      lineItems.forEach(item => {
        const sow = item.scopeOfWork || item.pmcGroup || item.costType;
        if (sow && sow !== "Unassigned") uniqueSOWs.add(sow);
      });

      const virtualScopes: Scope[] = Array.from(uniqueSOWs)
        .filter(sow => !formalScopes.some(fs => fs.title.toLowerCase() === sow.toLowerCase()))
        .map((sow, idx) => ({
          id: `virtual-${agg.jobKey}-${idx}`,
          jobKey: agg.jobKey,
          title: sow,
          startDate: "",
          endDate: "",
          tasks: []
        }));

      agg.scopes = [...formalScopes, ...virtualScopes];
      
      let minDate: any = null;
      let maxDate: any = null;

      for (const s of agg.scopes) {
        const start = s.startDate ? new Date(s.startDate) : null;
        const end = s.endDate ? new Date(s.endDate) : null;
        if (start && !isNaN(start.getTime()) && start.getTime() > 0 && (!minDate || start < minDate)) minDate = start;
        if (end && !isNaN(end.getTime()) && end.getTime() > 0 && (!maxDate || end > maxDate)) maxDate = end;
      }

      if (minDate) agg.startDate = minDate.toISOString().split('T')[0];
      if (maxDate) agg.endDate = maxDate.toISOString().split('T')[0];
    });

    return Array.from(map.values());
  }, [projectsData, scopesData]);

  // 2. Memoize sorting and filtering (much faster, decoupled from aggregation)
  const filteredProjects = useMemo(() => {
    let result = baseAggregated.filter(p => {
      const matchesSearch = 
        p.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.projectNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.customer.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === "All" || p.status === statusFilter;
      const matchesArchived = showArchived || !p.isArchived;

      const matchesColumnProject = p.projectName.toLowerCase().includes(columnFilters.projectName.toLowerCase());
      const matchesColumnCustomer = p.customer.toLowerCase().includes(columnFilters.customer.toLowerCase());
      const matchesColumnNumber = p.projectNumber.toLowerCase().includes(columnFilters.projectNumber.toLowerCase());
      const matchesColumnStatus = columnFilters.status === "" || p.status === columnFilters.status;
      
      return matchesSearch && matchesStatus && matchesArchived && 
             matchesColumnProject && matchesColumnCustomer && 
             matchesColumnNumber && matchesColumnStatus;
    });

    return result.sort((a, b) => {
      const aValue = a[sortConfig.key] ?? "";
      const bValue = b[sortConfig.key] ?? "";

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        const comp = aValue.localeCompare(bValue);
        return sortConfig.direction === 'asc' ? comp : -comp;
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      return 0;
    });
  }, [baseAggregated, searchTerm, statusFilter, sortConfig, showArchived, columnFilters]);

  async function handleAssignEquipment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProject || !assignForm.equipmentId) return;

    setSaving(true);
    try {
      const eq = equipment.find(e => e.id === assignForm.equipmentId);
      const scope = selectedProject.scopes.find(s => s.id === selectedScopeId);

      const newAssignment: Partial<EquipmentAssignment> = {
        equipmentId: assignForm.equipmentId,
        equipmentName: eq?.name || "Unknown",
        projectId: selectedProject.id,
        projectName: selectedProject.projectName,
        jobKey: selectedProject.jobKey,
        scopeId: selectedScopeId,
        scopeTitle: scope?.title,
        startDate: assignForm.startDate,
        endDate: assignForm.endDate,
        notes: assignForm.notes,
        createdAt: new Date().toISOString()
      };

      await addDoc(collection(db, "equipment_assignments"), newAssignment);
      
      // Update inventory status
      const today = new Date().toISOString().split('T')[0];
      if (assignForm.startDate <= today && assignForm.endDate >= today) {
        await setDoc(doc(db, "equipment", assignForm.equipmentId), { status: "In Use" }, { merge: true });
      }

      await loadAllData();
      setIsAssignModalOpen(false);
      setAssignForm(f => ({ ...f, notes: "" }));
    } catch (error) {
      alert("Error assigning equipment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <Navigation />

      <main className="flex-1 p-3 sm:p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl sm:text-4xl font-black text-gray-950 uppercase tracking-tighter">Projects Hub</h1>
                {!loading && (
                  <span className="bg-teal-100 text-teal-800 text-[10px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest border border-teal-200">
                    {filteredProjects.length} Projects
                  </span>
                )}
              </div>
              <p className="text-gray-700 font-black uppercase text-[10px] tracking-widest mt-1">Centralized Data & Resource Management</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="SEARCH PROJECTS, NUMBERS, CUSTOMERS..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border-2 border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-widest focus:border-teal-500 outline-none transition-all shadow-sm placeholder:text-gray-500"
                />
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 text-xs">🔍</span>
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-6 py-3 bg-white border-2 border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-widest focus:border-teal-500 outline-none transition-all shadow-sm cursor-pointer text-gray-900"
              >
                <option value="All">All Statuses</option>
                <option value="In Progress">In Progress</option>
                <option value="Accepted">Accepted</option>
                <option value="Bid Submitted">Bid Submitted</option>
                <option value="Lost">Lost</option>
              </select>

              <label className="flex items-center gap-2 px-4 py-3 bg-white border-2 border-gray-100 rounded-2xl cursor-pointer hover:border-teal-500 transition-all shadow-sm">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="w-4 h-4 accent-teal-600"
                />
                <span className="text-[10px] font-black text-gray-900 uppercase tracking-widest whitespace-nowrap">Show Archived</span>
              </label>
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-[2rem] p-20 text-center border border-gray-100 shadow-sm">
              <div className="animate-spin w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-600 font-black uppercase text-[10px] tracking-widest">Aggregating Project Data...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {/* Project Table Header */}
              <div className="hidden md:grid grid-cols-12 px-8 py-4 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest mb-1 shadow-lg">
                <div 
                  className="col-span-3 cursor-pointer hover:text-teal-400 transition-colors flex items-center gap-2"
                  onClick={() => setSortConfig({ key: 'projectName', direction: sortConfig.key === 'projectName' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                >
                  Project {sortConfig.key === 'projectName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </div>
                <div 
                  className="col-span-2 cursor-pointer hover:text-teal-400 transition-colors flex items-center gap-2"
                  onClick={() => setSortConfig({ key: 'customer', direction: sortConfig.key === 'customer' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                >
                  Customer {sortConfig.key === 'customer' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </div>
                <div 
                  className="col-span-1 text-center cursor-pointer hover:text-teal-400 transition-colors flex items-center justify-center gap-2"
                  onClick={() => setSortConfig({ key: 'status', direction: sortConfig.key === 'status' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                >
                  Status {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </div>
                <div 
                  className="col-span-2 text-right text-teal-400 cursor-pointer hover:text-white transition-colors flex items-center justify-end gap-2"
                  onClick={() => setSortConfig({ key: 'totalSales', direction: sortConfig.key === 'totalSales' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                >
                  Sales {sortConfig.key === 'totalSales' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </div>
                <div 
                  className="col-span-2 text-right text-orange-400 cursor-pointer hover:text-white transition-colors flex items-center justify-end gap-2"
                  onClick={() => setSortConfig({ key: 'totalHours', direction: sortConfig.key === 'totalHours' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                >
                  Hours {sortConfig.key === 'totalHours' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </div>
                <div 
                  className="col-span-2 text-right cursor-pointer hover:text-teal-400 transition-colors flex items-center justify-end gap-2"
                  onClick={() => setSortConfig({ key: 'startDate', direction: sortConfig.key === 'startDate' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                >
                  Dates {sortConfig.key === 'startDate' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </div>
              </div>

              {/* Column Filters Row */}
              <div className="hidden md:grid grid-cols-12 px-8 py-2 bg-gray-100 rounded-xl mb-2 gap-4">
                <div className="col-span-3">
                  <input
                    type="text"
                    placeholder="Filter Project..."
                    value={columnFilters.projectName}
                    onChange={(e) => setColumnFilters({ ...columnFilters, projectName: e.target.value })}
                    className="w-full bg-white border border-gray-300 rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-widest outline-none focus:border-teal-500 placeholder:text-gray-500 text-gray-950"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="text"
                    placeholder="Filter Customer..."
                    value={columnFilters.customer}
                    onChange={(e) => setColumnFilters({ ...columnFilters, customer: e.target.value })}
                    className="w-full bg-white border border-gray-300 rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-widest outline-none focus:border-teal-500 placeholder:text-gray-500 text-gray-950"
                  />
                </div>
                <div className="col-span-1">
                  <select
                    value={columnFilters.status}
                    onChange={(e) => setColumnFilters({ ...columnFilters, status: e.target.value })}
                    className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-tight outline-none focus:border-teal-500 text-gray-950 placeholder:text-gray-500"
                  >
                    <option value="">Status...</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Accepted">Accepted</option>
                    <option value="Bid Submitted">Bid Submitted</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
                <div className="col-span-6"></div> {/* Spacer for values/dates */}
              </div>

              {/* Project Rows */}
              {filteredProjects.map((p) => (
                <div 
                  key={p.jobKey}
                  onClick={() => setSelectedProject(p)}
                  className="grid grid-cols-1 md:grid-cols-12 items-center bg-white rounded-2xl border border-gray-100 px-8 py-5 hover:shadow-xl hover:border-teal-200 transition-all cursor-pointer group"
                >
                  <div className="col-span-3 mb-4 md:mb-0">
                    <div className="flex items-center gap-3">
                      <div 
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedProject(p);
                        }}
                        className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-black text-[10px] hover:bg-teal-700 hover:text-white transition-colors cursor-pointer"
                      >
                        {p.projectNumber.split('-')[0] || 'PJ'}
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-gray-900 uppercase leading-none mb-1">{p.projectName}</h3>
                        <p className="text-[9px] font-extrabold text-gray-600 uppercase tracking-widest truncate max-w-[150px]">{p.projectNumber}</p>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2 mb-4 md:mb-0">
                    <p className="text-[10px] font-black text-gray-950 uppercase tracking-widest">{p.customer}</p>
                  </div>
                  
                  <div className="col-span-1 text-center mb-4 md:mb-0">
                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                      p.status === 'In Progress' ? 'bg-orange-100 text-orange-700' : 
                      p.status === 'Accepted' ? 'bg-green-100 text-green-700' :
                      'bg-gray-200 text-gray-800'
                    }`}>
                      {p.status}
                    </span>
                  </div>

                  <div className="col-span-2 text-right font-black text-sm text-gray-950 mb-2 md:mb-0">
                    ${p.totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>

                  <div className="col-span-2 text-right font-black text-sm text-gray-800 mb-2 md:mb-0">
                    {p.totalHours.toLocaleString()} <span className="text-[9px] uppercase font-black text-gray-400">hrs</span>
                  </div>

                  <div className="col-span-2 text-right">
                    <div className="text-[10px] font-black text-gray-700 uppercase leading-none">
                      {p.startDate ? p.startDate : 'TBD'}
                    </div>
                    <div className="text-[10px] font-black text-gray-500 uppercase mt-1">
                      → {p.endDate ? p.endDate : 'TBD'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Project Gantt Drawer */}
      {selectedGanttProject && (
        <ProjectGanttDrawer
          project={selectedGanttProject}
          onClose={() => setSelectedGanttProject(null)}
        />
      )}

      {selectedShortTermProject && (
        <ProjectShortTermDrawer
          project={selectedShortTermProject}
          onClose={() => setSelectedShortTermProject(null)}
          onOpenGantt={() => {
            const p = selectedShortTermProject;
            setSelectedShortTermProject(null);
            setTimeout(() => setSelectedGanttProject(p), 100);
          }}
        />
      )}

      {/* Project Detail Modal */}
      {selectedProject && (
        <div className="fixed inset-0 bg-gray-950/80 backdrop-blur-md z-[100] flex items-center justify-end">
          <div className="w-full max-w-4xl h-full bg-white shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
            {/* Modal Header */}
            <div className="p-8 border-b border-gray-100 flex justify-between items-start bg-gray-50/50">
              <div>
                <span className="text-[10px] font-black text-teal-700 uppercase tracking-widest mb-2 block">{selectedProject.customer}</span>
                <h2 className="text-3xl font-black text-gray-950 uppercase tracking-tighter leading-none">{selectedProject.projectName}</h2>
                <div className="flex gap-4 mt-4">
                  <div className="bg-white px-4 py-2 rounded-xl border border-gray-200">
                    <span className="text-[9px] font-black text-gray-600 uppercase block">Total Value</span>
                    <span className="text-lg font-black text-gray-900">${selectedProject.totalSales.toLocaleString()}</span>
                  </div>
                  <div className="bg-white px-4 py-2 rounded-xl border border-gray-200">
                    <span className="text-[9px] font-black text-gray-600 uppercase block">Budget Hours</span>
                    <span className="text-lg font-black text-gray-900">{selectedProject.totalHours.toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setSelectedProject(null)}
                className="w-12 h-12 rounded-2xl bg-white border border-gray-200 flex items-center justify-center text-2xl hover:bg-gray-50 transition-colors shadow-sm text-gray-900"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10">
              {/* Stages / Scopes Section */}
              <section>
                <div className="flex justify-between items-end mb-6">
                  <div>
                    <h3 className="text-lg font-black text-gray-950 uppercase tracking-widest">Project Stages ({selectedProject.scopes.length})</h3>
                    <p className="text-[10px] text-gray-600 font-extrabold uppercase tracking-widest italic">Assign equipment per stage</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedGanttProject(selectedProject)}
                      className="px-4 py-2.5 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-800 transition-all shadow-lg flex items-center gap-2"
                    >
                      <span>📊</span>
                      Gantt
                    </button>
                    <button
                      onClick={() => setSelectedShortTermProject(selectedProject)}
                      className="px-6 py-2.5 bg-orange-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-orange-700 transition-all shadow-lg shadow-orange-900/20 flex items-center gap-2"
                    >
                      <span>📅</span>
                      Daily Schedule
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {selectedProject.scopes.length === 0 ? (
                    <div className="bg-gray-50 rounded-[2rem] p-12 text-center border-2 border-dashed border-gray-200">
                      <p className="text-gray-600 font-black uppercase text-[10px] tracking-widest">No stages defined for this project</p>
                    </div>
                  ) : (
                    selectedProject.scopes.map((scope) => (
                      <div key={scope.id} className="bg-white rounded-[2rem] border border-gray-100 p-6 hover:border-teal-400 transition-all shadow-sm group">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                          <div className="flex-1">
                            <h4 className="text-lg font-black text-gray-900 uppercase leading-none mb-2">{scope.title}</h4>
                            <div className="flex flex-wrap items-center gap-4 text-[11px] font-black text-gray-700 uppercase">
                              <span className="flex items-center gap-1.5"><span className="text-gray-400">Start:</span> {scope.startDate || '—'}</span>
                              <span className="flex items-center gap-1.5"><span className="text-gray-400">End:</span> {scope.endDate || '—'}</span>
                              {scope.hours && <span className="text-teal-700">| {scope.hours} Hours</span>}
                            </div>
                          </div>
                          
                          <button 
                            onClick={() => {
                              setSelectedScopeId(scope.id);
                              setAssignForm({
                                ...assignForm,
                                startDate: scope.startDate || new Date().toISOString().split('T')[0],
                                endDate: scope.endDate || new Date().toISOString().split('T')[0],
                              });
                              setIsAssignModalOpen(true);
                            }}
                            className="px-6 py-3 bg-gray-950 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-black transition-all shadow-lg shadow-gray-900/10 flex items-center gap-2"
                          >
                            <span>Add Equipment</span>
                          </button>
                        </div>

                        {/* Equipment assigned to this specific stage */}
                        <div className="mt-6 pt-6 border-t border-gray-50">
                          <div className="flex flex-wrap gap-2">
                            {assignments.filter(a => a.scopeId === scope.id).length === 0 ? (
                              <span className="text-[10px] font-black text-gray-500 uppercase italic">No equipment assigned to this stage</span>
                            ) : (
                                assignments.filter(a => a.scopeId === scope.id).map(a => (
                                <div key={a.id} className="flex items-center gap-2 bg-teal-50 text-teal-800 px-3 py-1.5 rounded-lg border border-teal-100">
                                  <span className="text-[10px] font-black uppercase tracking-tight">{a.equipmentName}</span>
                                  <div className="w-1 h-1 rounded-full bg-teal-400"></div>
                                  <span className="text-[9px] font-black opacity-80">{a.startDate} to {a.endDate}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* General Project Equipment (Not for a specific stage) */}
              <section className="pt-8 border-t border-gray-100">
                <div className="flex justify-between items-end mb-6">
                  <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest">Global Project Equipment</h3>
                  <button 
                    onClick={() => {
                      setSelectedScopeId(undefined);
                      setIsAssignModalOpen(true);
                    }}
                    className="text-[10px] font-black text-teal-700 uppercase tracking-widest hover:underline"
                  >
                    + Assign General
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {assignments.filter(a => a.jobKey === selectedProject.jobKey && !a.scopeId).map(a => (
                    <div key={a.id} className="bg-gray-100 text-gray-800 px-4 py-2 rounded-xl border border-gray-200 flex items-center gap-3">
                      <span className="text-[10px] font-black uppercase">{a.equipmentName}</span>
                      <span className="text-[9px] font-black opacity-70">{a.startDate} to {a.endDate}</span>
                    </div>
                  ))}
                  {assignments.filter(a => a.jobKey === selectedProject.jobKey && !a.scopeId).length === 0 && (
                    <p className="text-[11px] text-gray-400 italic font-black uppercase tracking-widest">No general equipment assignments</p>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Modal (Overlay) */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl p-10 animate-in zoom-in duration-200">
            <h3 className="text-xl font-black text-gray-900 uppercase tracking-tight mb-2 text-center">Add Equipment</h3>
            <p className="text-[10px] text-gray-600 font-black uppercase tracking-widest mb-8 text-center">
              {selectedScopeId ? `Stage: ${selectedProject?.scopes.find(s => s.id === selectedScopeId)?.title}` : 'General Assignment'}
            </p>

            <form onSubmit={handleAssignEquipment} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest block ml-1">Asset</label>
                <select
                  required
                  value={assignForm.equipmentId}
                  onChange={(e) => setAssignForm({ ...assignForm, equipmentId: e.target.value })}
                  className="w-full px-5 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-black text-gray-900 outline-none appearance-none cursor-pointer focus:border-teal-500 transition-all placeholder:text-gray-400"
                >
                  <option value="">Select Equipment...</option>
                  {equipment.filter(e => e.isActive).map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest block ml-1">Start</label>
                  <input
                    required
                    type="date"
                    value={assignForm.startDate}
                    onChange={(e) => setAssignForm({ ...assignForm, startDate: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl text-xs font-black text-gray-900 outline-none focus:border-teal-500 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest block ml-1">End</label>
                  <input
                    required
                    type="date"
                    value={assignForm.endDate}
                    onChange={(e) => setAssignForm({ ...assignForm, endDate: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl text-xs font-black text-gray-900 outline-none focus:border-teal-500 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest block ml-1">Notes</label>
                <textarea
                  value={assignForm.notes}
                  onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                  placeholder="e.g. For grading stage"
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl text-xs font-black text-gray-950 outline-none h-20 resize-none focus:border-teal-500 transition-all placeholder:text-gray-400"
                />
              </div>

              <div className="flex gap-3 pt-6">
                <button 
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  className="flex-1 py-4 bg-gray-100 text-gray-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button 
                  disabled={saving}
                  type="submit"
                  className="flex-1 py-4 bg-teal-800 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-teal-900 transition-all shadow-lg shadow-teal-900/20"
                >
                  {saving ? 'SAVING...' : 'CONFIRM'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

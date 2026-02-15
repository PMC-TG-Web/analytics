"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs, query, where, addDoc, doc, setDoc } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { Project, Scope } from "@/types";
import { Equipment, EquipmentAssignment } from "@/types/equipment";
import { getProjectKey, parseDateValue } from "@/utils/projectUtils";

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
  const [selectedProject, setSelectedProject] = useState<AggregatedProject | null>(null);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [selectedScopeId, setSelectedScopeId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

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

  const aggregatedProjects = useMemo(() => {
    const map = new Map<string, AggregatedProject>();

    projectsData.forEach(p => {
      const key = getProjectKey(p);
      if (key === "__noKey__") return;

      if (!map.has(key)) {
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
          id: p.id
        });
      }

      const agg = map.get(key)!;
      agg.totalSales += (p.sales || 0);
      agg.totalCost += (p.cost || 0);
      agg.totalHours += (p.hours || 0);
      
      // Keep most descriptive status (Accepted/In Progress takes priority)
      if (p.status === "In Progress") agg.status = "In Progress";
      else if (p.status === "Accepted" && agg.status !== "In Progress") agg.status = "Accepted";
    });

    // Attach scopes and dates
    map.forEach(agg => {
      agg.scopes = scopesData.filter(s => s.jobKey === agg.jobKey);
      
      // Determine project range from scopes
      let minDate: Date | null = null;
      let maxDate: Date | null = null;

      agg.scopes.forEach(s => {
        const start = s.startDate ? new Date(s.startDate) : null;
        const end = s.endDate ? new Date(s.endDate) : null;

        if (start && (!minDate || start < minDate)) minDate = start;
        if (end && (!maxDate || end > maxDate)) maxDate = end;
      });

      if (minDate) agg.startDate = minDate.toISOString().split('T')[0];
      if (maxDate) agg.endDate = maxDate.toISOString().split('T')[0];
    });

    return Array.from(map.values()).sort((a, b) => a.projectName.localeCompare(b.projectName));
  }, [projectsData, scopesData]);

  const filteredProjects = aggregatedProjects.filter(p => 
    p.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.projectNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.customer.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
              <h1 className="text-3xl sm:text-4xl font-black text-gray-950 uppercase tracking-tighter">Projects Hub</h1>
              <p className="text-gray-500 font-bold uppercase text-[10px] tracking-widest mt-1">Centralized Data & Resource Management</p>
            </div>
            <div className="relative w-full lg:w-96">
              <input
                type="text"
                placeholder="SEARCH PROJECTS, NUMBERS, CUSTOMERS..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white border-2 border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-widest focus:border-teal-500 outline-none transition-all shadow-sm"
              />
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-[2rem] p-20 text-center border border-gray-100 shadow-sm">
              <div className="animate-spin w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-400 font-black uppercase text-[10px] tracking-widest">Aggregating Project Data...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {/* Project Table Header */}
              <div className="hidden md:grid grid-cols-12 px-8 py-4 bg-gray-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest mb-2 shadow-lg">
                <div className="col-span-4">Project / Customer</div>
                <div className="col-span-2 text-center">Status</div>
                <div className="col-span-2 text-right text-teal-400">Total Sales</div>
                <div className="col-span-2 text-right text-orange-400">Total Hours</div>
                <div className="col-span-2 text-right">Dates</div>
              </div>

              {/* Project Rows */}
              {filteredProjects.map((p) => (
                <div 
                  key={p.jobKey}
                  onClick={() => setSelectedProject(p)}
                  className="grid grid-cols-1 md:grid-cols-12 items-center bg-white rounded-2xl border border-gray-100 px-8 py-5 hover:shadow-xl hover:border-teal-200 transition-all cursor-pointer group"
                >
                  <div className="col-span-4 mb-4 md:mb-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center font-black text-[10px] group-hover:bg-teal-700 group-hover:text-white transition-colors">
                        {p.projectNumber.split('-')[0] || 'PJ'}
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-gray-900 uppercase leading-none mb-1">{p.projectName}</h3>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{p.customer}</p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="col-span-2 text-center mb-4 md:mb-0">
                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                      p.status === 'In Progress' ? 'bg-orange-100 text-orange-700' : 
                      p.status === 'Accepted' ? 'bg-green-100 text-green-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {p.status}
                    </span>
                  </div>

                  <div className="col-span-2 text-right font-black text-sm text-gray-900 mb-2 md:mb-0">
                    ${p.totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>

                  <div className="col-span-2 text-right font-bold text-sm text-gray-500 mb-2 md:mb-0">
                    {p.totalHours.toLocaleString()} <span className="text-[9px] uppercase font-black opacity-40">hrs</span>
                  </div>

                  <div className="col-span-2 text-right">
                    <div className="text-[10px] font-black text-gray-400 uppercase leading-none">
                      {p.startDate ? p.startDate : 'TBD'}
                    </div>
                    <div className="text-[10px] font-bold text-gray-300 uppercase mt-1">
                      → {p.endDate ? p.endDate : 'TBD'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Project Detail Modal */}
      {selectedProject && (
        <div className="fixed inset-0 bg-gray-950/80 backdrop-blur-md z-[100] flex items-center justify-end">
          <div className="w-full max-w-4xl h-full bg-white shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
            {/* Modal Header */}
            <div className="p-8 border-b border-gray-100 flex justify-between items-start bg-gray-50/50">
              <div>
                <span className="text-[10px] font-black text-teal-600 uppercase tracking-widest mb-2 block">{selectedProject.customer}</span>
                <h2 className="text-3xl font-black text-gray-950 uppercase tracking-tighter leading-none">{selectedProject.projectName}</h2>
                <div className="flex gap-4 mt-4">
                  <div className="bg-white px-4 py-2 rounded-xl border border-gray-200">
                    <span className="text-[9px] font-black text-gray-400 uppercase block">Total Value</span>
                    <span className="text-lg font-black text-gray-900">${selectedProject.totalSales.toLocaleString()}</span>
                  </div>
                  <div className="bg-white px-4 py-2 rounded-xl border border-gray-200">
                    <span className="text-[9px] font-black text-gray-400 uppercase block">Budget Hours</span>
                    <span className="text-lg font-black text-gray-900">{selectedProject.totalHours.toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setSelectedProject(null)}
                className="w-12 h-12 rounded-2xl bg-white border border-gray-200 flex items-center justify-center text-2xl hover:bg-gray-50 transition-colors shadow-sm"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 space-y-10">
              {/* Stages / Scopes Section */}
              <section>
                <div className="flex justify-between items-end mb-6">
                  <h3 className="text-lg font-black text-gray-900 uppercase tracking-widest">Project Stages ({selectedProject.scopes.length})</h3>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest italic">Assign equipment per stage</p>
                </div>

                <div className="space-y-4">
                  {selectedProject.scopes.length === 0 ? (
                    <div className="bg-gray-50 rounded-[2rem] p-12 text-center border-2 border-dashed border-gray-200">
                      <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">No stages defined for this project</p>
                    </div>
                  ) : (
                    selectedProject.scopes.map((scope) => (
                      <div key={scope.id} className="bg-white rounded-[2rem] border border-gray-100 p-6 hover:border-teal-400 transition-all shadow-sm group">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                          <div className="flex-1">
                            <h4 className="text-lg font-black text-gray-900 uppercase leading-none mb-2">{scope.title}</h4>
                            <div className="flex flex-wrap items-center gap-4 text-[11px] font-bold text-gray-500 uppercase">
                              <span className="flex items-center gap-1.5"><span className="opacity-40">Start:</span> {scope.startDate || '—'}</span>
                              <span className="flex items-center gap-1.5"><span className="opacity-40">End:</span> {scope.endDate || '—'}</span>
                              {scope.hours && <span className="text-teal-600">| {scope.hours} Hours</span>}
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
                              <span className="text-[10px] font-bold text-gray-300 uppercase italic">No equipment assigned to this stage</span>
                            ) : (
                                assignments.filter(a => a.scopeId === scope.id).map(a => (
                                <div key={a.id} className="flex items-center gap-2 bg-teal-50 text-teal-700 px-3 py-1.5 rounded-lg border border-teal-100">
                                  <span className="text-[10px] font-black uppercase tracking-tight">{a.equipmentName}</span>
                                  <div className="w-1 h-1 rounded-full bg-teal-300"></div>
                                  <span className="text-[9px] font-bold opacity-70">{a.startDate} to {a.endDate}</span>
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
                  <h3 className="text-sm font-black text-gray-400 uppercase tracking-widest">Global Project Equipment</h3>
                  <button 
                    onClick={() => {
                      setSelectedScopeId(undefined);
                      setIsAssignModalOpen(true);
                    }}
                    className="text-[10px] font-black text-teal-600 uppercase tracking-widest hover:underline"
                  >
                    + Assign General
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {assignments.filter(a => a.jobKey === selectedProject.jobKey && !a.scopeId).map(a => (
                    <div key={a.id} className="bg-gray-100 text-gray-600 px-4 py-2 rounded-xl border border-gray-200 flex items-center gap-3">
                      <span className="text-[10px] font-black uppercase">{a.equipmentName}</span>
                      <span className="text-[9px] font-bold opacity-60">{a.startDate} to {a.endDate}</span>
                    </div>
                  ))}
                  {assignments.filter(a => a.jobKey === selectedProject.jobKey && !a.scopeId).length === 0 && (
                    <p className="text-[11px] text-gray-300 italic font-medium">No general equipment assignments</p>
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
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-8 text-center">
              {selectedScopeId ? `Stage: ${selectedProject?.scopes.find(s => s.id === selectedScopeId)?.title}` : 'General Assignment'}
            </p>

            <form onSubmit={handleAssignEquipment} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-1">Asset</label>
                <select
                  required
                  value={assignForm.equipmentId}
                  onChange={(e) => setAssignForm({ ...assignForm, equipmentId: e.target.value })}
                  className="w-full px-5 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl text-sm font-bold outline-none appearance-none cursor-pointer focus:border-teal-500 transition-all transition-all"
                >
                  <option value="">Select Equipment...</option>
                  {equipment.filter(e => e.isActive).map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-1">Start</label>
                  <input
                    required
                    type="date"
                    value={assignForm.startDate}
                    onChange={(e) => setAssignForm({ ...assignForm, startDate: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl text-xs font-bold outline-none focus:border-teal-500 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-1">End</label>
                  <input
                    required
                    type="date"
                    value={assignForm.endDate}
                    onChange={(e) => setAssignForm({ ...assignForm, endDate: e.target.value })}
                    className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl text-xs font-bold outline-none focus:border-teal-500 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block ml-1">Notes</label>
                <textarea
                  value={assignForm.notes}
                  onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                  placeholder="e.g. For grading stage"
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl text-xs font-bold outline-none h-20 resize-none focus:border-teal-500 transition-all"
                />
              </div>

              <div className="flex gap-3 pt-6">
                <button 
                  type="button"
                  onClick={() => setIsAssignModalOpen(false)}
                  className="flex-1 py-4 bg-gray-100 text-gray-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-gray-200 transition-all"
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

"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, doc, setDoc, deleteDoc, query, where, addDoc, orderBy } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";
import { Equipment, EquipmentAssignment } from "@/types/equipment";
import { Project, Scope } from "@/types";
import { getProjectKey } from "@/utils/projectUtils";

export default function EquipmentPage() {
  return (
    <ProtectedPage page="equipment">
      <EquipmentContent />
    </ProtectedPage>
  );
}

function EquipmentContent() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [assignments, setAssignments] = useState<EquipmentAssignment[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [scopesData, setScopesData] = useState<Scope[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(null);
  const [selectedEqForAssign, setSelectedEqForAssign] = useState<Equipment | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [saving, setSaving] = useState(false);

  // Form states
  const [formData, setFormData] = useState<Partial<Equipment>>({
    name: "",
    type: "Truck",
    model: "",
    make: "",
    serialNumber: "",
    status: "Available",
    hourlyRate: 0,
    dailyRate: 0,
    notes: "",
    isActive: true,
  });

  const [assignData, setAssignData] = useState<Partial<EquipmentAssignment>>({
    projectId: "",
    scopeId: "",
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    notes: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [eqSnap, assignSnap, projSnap, scopeSnap] = await Promise.all([
        getDocs(collection(db, "equipment")),
        getDocs(collection(db, "equipment_assignments")),
        getDocs(collection(db, "projects")),
        getDocs(collection(db, "projectScopes"))
      ]);

      setEquipment(eqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Equipment)).sort((a,b) => a.name.localeCompare(b.name)));
      setAssignments(assignSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as EquipmentAssignment)));
      
      const pData = projSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));
      setAllProjects(pData);
      
      // Filter for active/relevant projects for the dropdown
      const activeProjects = pData.filter(p => !["Lost", "Archived"].includes(p.status || ""));
      // Group by name for the dropdown to avoid clutter, though usually we want specific project docs
      // For equipment assignment, we need the specific project doc or at least the jobKey
      setProjects(activeProjects.sort((a, b) => (a.projectName || "").localeCompare(b.projectName || "")));

      setScopesData(scopeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scope)));

    } catch (error) {
      console.error("Error loading equipment data:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveEquipment(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...formData,
        updatedAt: new Date().toISOString(),
      };

      if (editingEquipment) {
        await setDoc(doc(db, "equipment", editingEquipment.id), data, { merge: true });
      } else {
        const newEq = {
          ...data,
          createdAt: new Date().toISOString(),
        };
        await addDoc(collection(db, "equipment"), newEq);
      }
      await loadData();
      setModalVisible(false);
      setEditingEquipment(null);
    } catch (error) {
      alert("Error saving equipment");
    } finally {
      setSaving(false);
    }
  }

  async function handleAssignEquipment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEqForAssign || !assignData.projectId) return;

    setSaving(true);
    try {
      const project = projects.find(p => p.id === assignData.projectId);
      const jobKey = project ? getProjectKey(project) : "";
      
      // Find scope title if selected
      const currentAvailableScopes = project ? getProjectStages(project) : [];
      const scope = currentAvailableScopes.find(s => s.id === assignData.scopeId);

      const newAssign = {
        equipmentId: selectedEqForAssign.id,
        equipmentName: selectedEqForAssign.name,
        projectId: assignData.projectId,
        projectName: project?.projectName || "Unknown Project",
        jobKey: jobKey,
        scopeId: assignData.scopeId || null,
        scopeTitle: scope?.title || null,
        startDate: assignData.startDate,
        endDate: assignData.endDate,
        notes: assignData.notes || "",
        createdAt: new Date().toISOString(),
      };

      await addDoc(collection(db, "equipment_assignments"), newAssign);
      
      // Update equipment status if it's currently assigned
      const today = new Date().toISOString().split('T')[0];
      if (assignData.startDate! <= today && assignData.endDate! >= today) {
        await setDoc(doc(db, "equipment", selectedEqForAssign.id), { status: "In Use" }, { merge: true });
      }

      await loadData();
      setAssignModalVisible(false);
      setAssignData({ ...assignData, scopeId: "", notes: "" });
    } catch (error) {
      console.error("Assignment error:", error);
      alert("Error assigning equipment");
    } finally {
      setSaving(false);
    }
  }

  function getProjectStages(project: Project): Scope[] {
    const jobKey = getProjectKey(project);
    if (jobKey === "__noKey__") return [];

    // 1. Formal scopes
    const formal = scopesData.filter(s => s.jobKey === jobKey);

    // 2. Virtual scopes from line items
    const lineItems = allProjects.filter(p => getProjectKey(p) === jobKey);
    const uniqueSOWs = new Set<string>();
    lineItems.forEach(item => {
      const sow = item.scopeOfWork || item.pmcGroup || item.costType;
      if (sow && sow !== "Unassigned") uniqueSOWs.add(sow);
    });

    const virtual: Scope[] = Array.from(uniqueSOWs)
      .filter(sow => !formal.some(fs => fs.title.toLowerCase() === sow.toLowerCase()))
      .map((sow, idx) => ({
        id: `virtual-${jobKey}-${idx}`,
        jobKey: jobKey,
        title: sow,
        startDate: "",
        endDate: "",
        tasks: []
      }));

    return [...formal, ...virtual];
  }

  async function handleDeleteAssignment(id: string) {
    if (!confirm("Are you sure you want to delete this assignment?")) return;
    try {
      await deleteDoc(doc(db, "equipment_assignments", id));
      await loadData();
    } catch (error) {
      alert("Error deleting assignment");
    }
  }

  async function handleDeleteEquipment(id: string) {
    if (!confirm("Are you sure you want to delete this equipment? This will not delete its history.")) return;
    try {
      await deleteDoc(doc(db, "equipment", id));
      await loadData();
    } catch (error) {
      alert("Error deleting equipment");
    }
  }

  const filteredEquipment = equipment.filter(eq => 
    eq.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    eq.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
    eq.model?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <Navigation />

      <main className="flex-1 p-3 sm:p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8 sm:mb-12">
            <div>
              <h1 className="text-3xl sm:text-4xl font-black text-gray-950 uppercase tracking-tighter">Equipment Management</h1>
              <p className="text-gray-700 font-black uppercase text-[10px] sm:text-xs tracking-widest mt-1">Inventory and Project Scheduling</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <input
                  type="text"
                  placeholder="SEARCH EQUIPMENT..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-white border-2 border-gray-100 rounded-2xl text-[10px] font-black uppercase tracking-widest focus:border-teal-500 outline-none transition-all shadow-sm placeholder:text-gray-500"
                />
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600 text-xs">🔍</span>
              </div>
              <button
                onClick={() => {
                  setEditingEquipment(null);
                  setFormData({ name: "", type: "Truck", status: "Available", isActive: true });
                  setModalVisible(true);
                }}
                className="px-6 py-3 bg-teal-800 text-white font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-teal-900 transition-all shadow-lg shadow-teal-900/10 flex items-center gap-2"
              >
                <span>Add Equipment</span>
              </button>
            </div>
          </div>

          {loading ? (
             <div className="bg-white rounded-[2rem] p-12 text-center border border-gray-100 shadow-sm mt-12">
                <div className="animate-spin w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-500 font-bold uppercase text-[10px] tracking-widest">Loading Inventory...</p>
             </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
              {/* Equipment List */}
              <div className="xl:col-span-2 space-y-6">
                <h2 className="text-lg font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-8 h-8 bg-teal-100 text-teal-700 rounded-lg flex items-center justify-center text-xs">🛠️</span>
                  Inventory ({filteredEquipment.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredEquipment.map((eq) => (
                    <div key={eq.id} className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6 hover:shadow-md transition-all group border-l-4 border-l-teal-600">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <span className="text-[10px] font-black text-teal-700 uppercase tracking-widest mb-1 block">{eq.type}</span>
                          <h3 className="text-xl font-black text-gray-900 uppercase tracking-tight leading-none">{eq.name}</h3>
                          {eq.model && <p className="text-xs font-black text-gray-500 uppercase mt-1 tracking-widest">{eq.make} {eq.model}</p>}
                        </div>
                        <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          eq.status === 'Available' ? 'bg-green-100 text-green-700' : 
                          eq.status === 'In Use' ? 'bg-orange-100 text-orange-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {eq.status}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-6">
                        <div className="bg-gray-50 rounded-xl p-3">
                          <span className="text-[9px] font-black text-gray-500 uppercase block mb-1">SN</span>
                          <span className="text-[11px] font-black text-gray-900">{eq.serialNumber || 'N/A'}</span>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3">
                          <span className="text-[9px] font-black text-gray-500 uppercase block mb-1">Rates</span>
                          <span className="text-[11px] font-black text-gray-900">${eq.dailyRate}/day</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-4 border-t border-gray-50">
                        <button 
                          onClick={() => {
                            setSelectedEqForAssign(eq);
                            setAssignData({ ...assignData, equipmentId: eq.id, equipmentName: eq.name });
                            setAssignModalVisible(true);
                          }}
                          className="flex-1 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest py-2.5 rounded-xl hover:bg-black transition-colors"
                        >
                          Schedule
                        </button>
                        <button 
                          onClick={() => {
                            setEditingEquipment(eq);
                            setFormData(eq);
                            setModalVisible(true);
                          }}
                          className="px-4 py-2.5 bg-gray-100 text-gray-600 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-gray-200"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Current Assignments Sidebar */}
              <div className="space-y-6">
                <h2 className="text-lg font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-8 h-8 bg-orange-100 text-orange-700 rounded-lg flex items-center justify-center text-xs">📅</span>
                  Active Schedule
                </h2>
                <div className="space-y-4">
                  {assignments.length === 0 ? (
                    <div className="bg-white rounded-[2rem] p-8 text-center border-2 border-dashed border-gray-100">
                      <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">No assignments scheduled</p>
                    </div>
                  ) : (
                    assignments
                      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                      .map((assign) => (
                        <div key={assign.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:border-orange-200 transition-colors relative group">
                          <button 
                            onClick={() => handleDeleteAssignment(assign.id)}
                            className="absolute top-4 right-4 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all font-black text-lg"
                          >
                            ×
                          </button>
                          <span className="text-[9px] font-black text-orange-700 uppercase tracking-widest block mb-1">{assign.equipmentName}</span>
                          <h4 className="text-sm font-black text-gray-950 uppercase mb-2 leading-tight">{assign.projectName}</h4>
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col">
                              <span className="text-[9px] font-black text-gray-500 uppercase">From</span>
                              <span className="text-[11px] font-black text-gray-900">{assign.startDate}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[9px] font-black text-gray-500 uppercase">To</span>
                              <span className="text-[11px] font-black text-gray-900">{assign.endDate}</span>
                            </div>
                          </div>
                          {assign.notes && (
                            <p className="mt-3 text-[10px] italic text-gray-600 font-extrabold">"{assign.notes}"</p>
                          )}
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Equipment Add/Edit Modal */}
      {modalVisible && (
        <div className="fixed inset-0 bg-gray-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 sm:p-12">
              <div className="flex justify-between items-center mb-10">
                <div>
                  <h2 className="text-2xl font-black text-gray-950 uppercase tracking-tight">{editingEquipment ? 'Edit Equipment' : 'Add New Equipment'}</h2>
                  <p className="text-xs font-black text-gray-500 uppercase tracking-widest mt-1">Configure asset details</p>
                </div>
                <button onClick={() => setModalVisible(false)} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors text-gray-950">
                  <span className="text-xl">×</span>
                </button>
              </div>

              <form onSubmit={handleSaveEquipment} className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Asset Name</label>
                    <input
                      required
                      type="text"
                      value={formData.name || ""}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. Ford F-350 #12"
                      className="w-full px-5 py-4 bg-white border-2 border-gray-200 focus:border-teal-500 text-gray-950 rounded-2xl text-sm font-black outline-none transition-all placeholder:text-gray-400"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Type</label>
                    <select
                      value={formData.type || "Truck"}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      className="w-full px-5 py-4 bg-white border-2 border-gray-200 focus:border-teal-500 text-gray-950 rounded-2xl text-sm font-black outline-none transition-all cursor-pointer appearance-none"
                    >
                      <option value="Truck">Truck</option>
                      <option value="Excavator">Excavator</option>
                      <option value="Generator">Generator</option>
                      <option value="Skidsteer">Skidsteer</option>
                      <option value="Trailer">Trailer</option>
                      <option value="Tool">Tool/Other</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Daily Rate ($)</label>
                    <input
                      type="number"
                      value={formData.dailyRate || 0}
                      onChange={(e) => setFormData({ ...formData, dailyRate: parseFloat(e.target.value) })}
                      className="w-full px-5 py-4 bg-white border-2 border-gray-200 focus:border-teal-500 text-gray-950 rounded-2xl text-sm font-black outline-none transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest ml-1">Serial Number</label>
                    <input
                      type="text"
                      value={formData.serialNumber || ""}
                      onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                      className="w-full px-5 py-4 bg-white border-2 border-gray-200 focus:border-teal-500 text-gray-950 rounded-2xl text-sm font-black outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    disabled={saving}
                    type="submit"
                    className="flex-1 py-4 bg-teal-800 text-white font-black uppercase tracking-widest text-xs rounded-2xl hover:bg-teal-900 transition-all shadow-lg"
                  >
                    {saving ? 'SAVING...' : 'SAVE EQUIPMENT'}
                  </button>
                  {editingEquipment && (
                    <button
                      type="button"
                      onClick={() => handleDeleteEquipment(editingEquipment.id)}
                      className="px-8 py-4 bg-red-50 text-red-600 font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-red-100 transition-all"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Assignment Modal */}
      {assignModalVisible && selectedEqForAssign && (
        <div className="fixed inset-0 bg-gray-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 sm:p-12 text-center">
              <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-2xl mx-auto mb-6">📅</div>
              <h2 className="text-2xl font-black text-gray-950 uppercase tracking-tight mb-2">Schedule Assignment</h2>
              <p className="text-gray-500 font-bold uppercase text-[10px] tracking-widest mb-8">Scheduling: {selectedEqForAssign.name}</p>

              <form onSubmit={handleAssignEquipment} className="text-left space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Select Project</label>
                    <select
                      required
                      value={assignData.projectId || ""}
                      onChange={(e) => setAssignData({ ...assignData, projectId: e.target.value, scopeId: "" })}
                      className="w-full px-5 py-4 bg-white border-2 border-gray-100 focus:border-teal-500 text-gray-950 rounded-2xl text-sm font-bold outline-none appearance-none cursor-pointer"
                    >
                      <option value="">Choose a Project...</option>
                      {projects.map(p => (
                        <option key={p.id} value={p.id}>{p.projectName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Select Stage (Optional)</label>
                    <select
                      value={assignData.scopeId || ""}
                      onChange={(e) => {
                        const sId = e.target.value;
                        const proj = projects.find(p => p.id === assignData.projectId);
                        const stages = proj ? getProjectStages(proj) : [];
                        const stag = stages.find(s => s.id === sId);
                        
                        setAssignData({ 
                          ...assignData, 
                          scopeId: sId,
                          startDate: (stag?.startDate && stag.startDate !== "—") ? stag.startDate : assignData.startDate,
                          endDate: (stag?.endDate && stag.endDate !== "—") ? stag.endDate : assignData.endDate
                        });
                      }}
                      className="w-full px-5 py-4 bg-white border-2 border-gray-100 focus:border-teal-500 text-gray-950 rounded-2xl text-sm font-bold outline-none appearance-none cursor-pointer"
                      disabled={!assignData.projectId}
                    >
                      <option value="">General Project Use</option>
                      {assignData.projectId && projects.find(p => p.id === assignData.projectId) && 
                        getProjectStages(projects.find(p => p.id === assignData.projectId)!).map(s => (
                          <option key={s.id} value={s.id}>{s.title}</option>
                        ))
                      }
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Start Date</label>
                    <input
                      required
                      type="date"
                      value={assignData.startDate || ""}
                      onChange={(e) => setAssignData({ ...assignData, startDate: e.target.value })}
                      className="w-full px-5 py-4 bg-white border-2 border-gray-200 focus:border-teal-500 text-gray-950 rounded-2xl text-sm font-bold outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">End Date</label>
                    <input
                      required
                      type="date"
                      value={assignData.endDate || ""}
                      onChange={(e) => setAssignData({ ...assignData, endDate: e.target.value })}
                      className="w-full px-5 py-4 bg-white border-2 border-gray-200 focus:border-teal-500 text-gray-950 rounded-2xl text-sm font-bold outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest ml-1">Assignment Notes</label>
                  <textarea
                    value={assignData.notes || ""}
                    onChange={(e) => setAssignData({ ...assignData, notes: e.target.value })}
                    className="w-full px-5 py-4 bg-white border-2 border-gray-100 focus:border-teal-500 text-gray-950 rounded-2xl text-sm font-black outline-none h-24 resize-none placeholder:text-gray-400"
                    placeholder="Add details about this assignment..."
                  />
                </div>

                <div className="flex gap-4 pt-4">
                  <button onClick={() => setAssignModalVisible(false)} type="button" className="flex-1 py-4 bg-gray-100 text-gray-600 font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-gray-200 transition-all">
                    Cancel
                  </button>
                  <button disabled={saving} type="submit" className="flex-1 py-4 bg-orange-600 text-white font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-orange-700 transition-all shadow-lg shadow-orange-900/10">
                    {saving ? 'SAVING...' : 'CONFIRM SCHEDULE'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

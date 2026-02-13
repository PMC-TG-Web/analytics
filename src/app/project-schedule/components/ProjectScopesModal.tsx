import React, { useState, useEffect } from "react";
import { addDoc, collection, doc, setDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { ProjectInfo, Scope } from "@/types";
import { syncProjectWIP } from "@/utils/scheduleSync";

interface ProjectScopesModalProps {
  project: ProjectInfo;
  scopes: Scope[];
  allScopes?: Record<string, Scope[]>; // Map of jobKey -> Scope[] for company-wide capacity
  companyCapacity?: number; // Total available hours per day
  selectedScopeId: string | null;
  onClose: () => void;
  onScopesUpdated: (jobKey: string, scopes: Scope[]) => void;
}

const calculateWorkDays = (startStr?: string, endStr?: string) => {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  
  let count = 0;
  const current = new Date(start);
  
  // Safety break for extremely long ranges (max 3 years)
  const maxDate = new Date(start);
  maxDate.setFullYear(maxDate.getFullYear() + 3);
  const actualEnd = end > maxDate ? maxDate : end;

  while (current <= actualEnd) {
    if (current.getDay() !== 0 && current.getDay() !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
};

export function ProjectScopesModal({
  project,
  scopes,
  allScopes,
  companyCapacity = 210, // Default to 210 if not provided
  selectedScopeId,
  onClose,
  onScopesUpdated,
}: ProjectScopesModalProps) {
  const [activeScopeId, setActiveScopeId] = useState<string | null>(selectedScopeId);
  const [scopeDetail, setScopeDetail] = useState<Partial<Scope>>({
    title: "",
    startDate: "",
    endDate: "",
    description: "",
    tasks: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [newTask, setNewTask] = useState("");

  useEffect(() => {
    setActiveScopeId(selectedScopeId);
  }, [selectedScopeId]);

  useEffect(() => {
    const scope = scopes.find((item) => item.id === activeScopeId);
    if (!scope) {
      setScopeDetail({
        title: "",
        startDate: "",
        endDate: "",
        manpower: undefined,
        hours: undefined,
        description: "",
        tasks: [],
      });
      return;
    }

    setScopeDetail({
      title: scope.title || "",
      startDate: scope.startDate || "",
      endDate: scope.endDate || "",
      manpower: scope.manpower,
      hours: scope.hours,
      description: scope.description || "",
      tasks: Array.isArray(scope.tasks) ? scope.tasks : [],
    });
  }, [activeScopeId, scopes]);

  const handleAddTask = () => {
    const trimmed = newTask.trim();
    if (!trimmed) return;
    setScopeDetail((prev) => ({
      ...prev,
      tasks: [...(prev.tasks || []), trimmed],
    }));
    setNewTask("");
  };

  const handleRemoveTask = (index: number) => {
    setScopeDetail((prev) => ({
      ...prev,
      tasks: prev.tasks?.filter((_, i) => i !== index) || [],
    }));
  };

  const handleSaveScope = async () => {
    setIsSaving(true);
    try {
      const payload = {
        jobKey: project.jobKey,
        title: (scopeDetail.title || "Scope").trim() || "Scope",
        startDate: scopeDetail.startDate || "",
        endDate: scopeDetail.endDate || "",
        manpower: scopeDetail.manpower,
        hours: typeof scopeDetail.hours === 'number' ? scopeDetail.hours : 0,
        description: scopeDetail.description || "",
        tasks: (scopeDetail.tasks || []).filter((task) => task.trim()),
      };

      if (activeScopeId) {
        await setDoc(doc(db, "projectScopes", activeScopeId), payload, { merge: true });
        const updatedScopes = scopes.map((scope) =>
          scope.id === activeScopeId ? { ...scope, ...payload } : scope
        );
        onScopesUpdated(project.jobKey, updatedScopes);
      } else {
        const docRef = await addDoc(collection(db, "projectScopes"), payload);
        const newScope: Scope = { id: docRef.id, ...payload };
        onScopesUpdated(project.jobKey, [...scopes, newScope]);
        setActiveScopeId(docRef.id);
      }

      await syncProjectWIP(project.jobKey);
      alert("Scope saved successfully!");
    } catch (error) {
      console.error("Failed to save scope:", error);
      alert("Failed to save scope.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto text-gray-900">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-lg font-bold">{project.projectName}</div>
            <div className="text-sm text-gray-500">{project.customer}</div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl font-bold">✕</button>
        </div>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 p-4 rounded">
            <div><span className="font-semibold">Project #:</span><p className="mt-1">{project.projectNumber || "—"}</p></div>
            <div>
              <span className="font-semibold">Total Budgeted Hours:</span>
              <p className="mt-1 text-orange-700 font-bold text-base">
                {scopes.reduce((sum, s) => sum + (s.hours || 0), 0).toFixed(1)}
              </p>
            </div>
            <div className="col-span-2"><span className="font-semibold">Job Key:</span><p className="mt-1">{project.jobKey || "—"}</p></div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Scopes</h3>
              <button type="button" onClick={() => setActiveScopeId(null)} className="text-xs font-semibold px-3 py-1.5 rounded-md border border-orange-300 text-orange-700 hover:bg-orange-50">+ Add Scope</button>
            </div>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {scopes.length === 0 ? (
                <div className="text-sm text-gray-500">No scopes yet.</div>
              ) : (
                scopes.map((scope) => (
                  <button
                    key={scope.id}
                    type="button"
                    onClick={() => setActiveScopeId(scope.id)}
                    className={`text-left border rounded-md px-3 py-2 transition-colors ${
                      activeScopeId === scope.id ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-orange-200"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="text-sm font-semibold">{scope.title || "Scope"}</div>
                      {scope.hours !== undefined && (
                        <div className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded">
                          {scope.hours.toFixed(1)} hrs
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {scope.startDate || "No start"} - {scope.endDate || "No end"}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">Scope Title</label>
              <input type="text" value={scopeDetail.title || ""} onChange={(e) => setScopeDetail(p => ({ ...p, title: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm focus:ring-2 focus:ring-orange-500" />
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Start Date</label>
                <input type="date" value={scopeDetail.startDate || ""} onChange={(e) => setScopeDetail(p => ({ ...p, startDate: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm" />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">End Date</label>
                <input type="date" value={scopeDetail.endDate || ""} onChange={(e) => setScopeDetail(p => ({ ...p, endDate: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm" />
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-100 rounded-md p-4 mb-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Manpower</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="0.5" 
                    value={scopeDetail.manpower ?? ""} 
                    onChange={(e) => {
                      const mp = e.target.value ? parseFloat(e.target.value) : 0;
                      const days = calculateWorkDays(scopeDetail.startDate, scopeDetail.endDate);
                      // Auto-calculate Budgeted Hours: Manpower * 10 hrs * Days
                      setScopeDetail(p => ({ ...p, manpower: mp, hours: mp * 10 * days }));
                    }} 
                    className="w-full px-3 py-2 border rounded-md text-sm bg-white font-bold" 
                    placeholder="e.g. 2.0" 
                  />
                  <p className="mt-1 text-[10px] text-gray-400">Heads assigned</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Budgeted Hours</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="0.5" 
                    value={scopeDetail.hours ?? ""} 
                    onChange={(e) => setScopeDetail(p => ({ ...p, hours: e.target.value ? parseFloat(e.target.value) : undefined }))} 
                    className="w-full px-3 py-2 border rounded-md text-sm bg-white font-bold text-orange-900" 
                    placeholder="Total hours" 
                  />
                  <p className="mt-1 text-[10px] text-gray-400">Total (Manpower x 10 x Days)</p>
                </div>
              </div>
              
              {scopeDetail.startDate && scopeDetail.endDate && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                  {(() => {
                    const manpowerRequested = scopeDetail.manpower || 0;
                    const dailyUsage = manpowerRequested * 10;
                    const companyLimit = companyCapacity; 
                    
                    // Sum up all OTHER scopes for the start date to give a real-time snapshot
                    let companyWideManpowerOnDay = 0;
                    if (allScopes && scopeDetail.startDate) {
                      const targetDateStr = scopeDetail.startDate;
                      Object.values(allScopes).forEach(projectScopes => {
                        projectScopes.forEach(s => {
                          // Skip the one we are currently editing to avoid double counting
                          if (activeScopeId && s.id === activeScopeId) return;
                          
                          if (s.startDate && s.endDate) {
                            if (targetDateStr >= s.startDate && targetDateStr <= s.endDate) {
                              companyWideManpowerOnDay += (s.manpower || 0);
                            }
                          }
                        });
                      });
                    }

                    const otherUsage = companyWideManpowerOnDay * 10;
                    const remaining = companyLimit - otherUsage - dailyUsage;
                    
                    return (
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-sm font-bold text-green-800">
                          <span>Total Company Availability ({scopeDetail.startDate}):</span>
                          <span>{companyLimit} hrs ({companyLimit/10} heads)</span>
                        </div>
                        <div className="flex justify-between items-center text-xs text-gray-600">
                          <span>Other Scheduled Jobs:</span>
                          <span>-{otherUsage.toFixed(1)} hrs</span>
                        </div>
                        <div className="flex justify-between items-center text-xs text-red-700 font-semibold">
                          <span>This Scope&apos;s Requirement:</span>
                          <span>-{dailyUsage.toFixed(1)} hrs</span>
                        </div>
                        <div className="border-t border-green-200 mt-2 pt-1 flex justify-between items-center text-sm font-bold text-green-900">
                          <span>Remaining Company Capacity:</span>
                          <span className={remaining < 0 ? "text-red-600" : "text-green-900"}>
                            {remaining.toFixed(1)} hrs
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">Description</label>
              <textarea value={scopeDetail.description || ""} onChange={(e) => setScopeDetail(p => ({ ...p, description: e.target.value }))} className="w-full px-3 py-2 border rounded-md text-sm" rows={4} />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-2">Tasks</label>
              <div className="flex gap-2 mb-3">
                <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyPress={(e) => e.key === "Enter" && handleAddTask()} className="flex-1 px-3 py-2 border rounded-md text-sm" />
                <button type="button" onClick={handleAddTask} className="px-4 py-2 bg-gray-200 rounded-md text-sm font-semibold hover:bg-gray-300">Add</button>
              </div>
              {scopeDetail.tasks && scopeDetail.tasks.length > 0 && (
                <div className="space-y-2 bg-gray-50 p-3 rounded">
                  {scopeDetail.tasks.map((task, index) => (
                    <div key={index} className="flex items-start justify-between gap-2 bg-white p-2 rounded border border-gray-200">
                      <div className="text-sm flex-1">{task}</div>
                      <button type="button" onClick={() => handleRemoveTask(index)} className="text-red-500 hover:text-red-700 font-bold">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <button type="button" onClick={handleSaveScope} disabled={isSaving} className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-md text-sm font-semibold hover:bg-orange-700 disabled:bg-gray-400">
              {isSaving ? "Saving..." : "Save Scope of Work"}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 rounded-md text-sm font-semibold hover:bg-gray-300">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

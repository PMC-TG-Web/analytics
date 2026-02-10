import React, { useState, useEffect } from "react";
import { addDoc, collection, doc, setDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { ProjectInfo, Scope } from "@/types";

interface ProjectScopesModalProps {
  project: ProjectInfo;
  scopes: Scope[];
  selectedScopeId: string | null;
  onClose: () => void;
  onScopesUpdated: (jobKey: string, scopes: Scope[]) => void;
}

export function ProjectScopesModal({
  project,
  scopes,
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
            <div><span className="font-semibold">Customer:</span><p className="mt-1">{project.customer || "—"}</p></div>
            <div className="col-span-2"><span className="font-semibold">Job Key:</span><p className="mt-1">{project.jobKey || "—"}</p></div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Scopes</h3>
              <button type="button" onClick={() => setActiveScopeId(null)} className="text-xs font-semibold px-3 py-1.5 rounded-md border border-orange-300 text-orange-700 hover:bg-orange-50">+ Add Scope</button>
            </div>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {scopes.length === 0 ? <div className="text-sm text-gray-500">No scopes yet.</div> : scopes.map((scope) => (
                <button key={scope.id} type="button" onClick={() => setActiveScopeId(scope.id)} className={`text-left border rounded-md px-3 py-2 transition-colors ${activeScopeId === scope.id ? "border-orange-400 bg-orange-50" : "border-gray-200 hover:border-orange-200"}`}>
                  <div className="text-sm font-semibold">{scope.title || "Scope"}</div>
                  <div className="text-xs text-gray-500">{scope.startDate || "No start"} - {scope.endDate || "No end"}</div>
                </button>
              ))}
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
            <div className="mb-4">
              <label className="block text-sm font-semibold mb-1">Manpower</label>
              <input type="number" min="0" step="0.5" value={scopeDetail.manpower ?? ""} onChange={(e) => setScopeDetail(p => ({ ...p, manpower: e.target.value ? parseFloat(e.target.value) : undefined }))} className="w-full px-3 py-2 border rounded-md text-sm" />
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

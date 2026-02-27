"use client";
import React, { useState, useEffect } from "react";
import { db, query, collection, where, getDocs, addDoc } from "@/firebase";

import ProtectedPage from "@/components/ProtectedPage";
import { Project, Scope } from "@/types";
import Navigation from "@/components/Navigation";
import { getProjectKey } from "@/utils/projectUtils";

// Optimized matching logic for auto-populating labor/materials based on scope selection
function findMatchingItems(scope: Scope, fullProjectList: any[], jobKey: string, allScopes: Scope[]) {
  const scopeTitleLower = (scope.title || "").trim().toLowerCase();
  const cleanScope = scopeTitleLower
    .replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf|ea)?\s*([-–]\s*)?/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const scopeWords = cleanScope.split(/\s+/).filter(w => w.length >= 2 && w !== "and" && w !== "with" && w !== "for" && w !== "psi");
  const measurements = scopeTitleLower.match(/\d+(\s*(?:\"|\'|in|mil|ga|psi))/g) || [];

  return fullProjectList.filter(p => {
    const pJobKey = p.jobKey || getProjectKey(p);
    if (pJobKey !== jobKey) return false;
    
    const costItemName = (p.costitems || "").toLowerCase();
    const pmcGroupName = (p.pmcGroup || "").toString().toLowerCase();
    const status = (p.status || "").toString();

    // If we have an "In Progress" item, ignore "Lost" or "Bid Submitted" ones for this specific list
    const hasInProgress = fullProjectList.some(item => 
      (item.jobKey || getProjectKey(item)) === jobKey && 
      item.status === "In Progress" && 
      item.costitems === p.costitems
    );
    if (hasInProgress && status !== "In Progress") return false;
    
    // Check for measurement mismatches (e.g. 4" vs 8", or 3000 PSI vs 4000 PSI)
    for (const m of measurements) {
      const value = m.match(/\d+/)?.[0];
      const unit = m.replace(/\d+/g, "").trim();
      if (value) {
        const itemMeasurements = costItemName.match(/\d+(\s*(?:\"|\'|in|mil|ga|psi))/g) || [];
        for (const im of itemMeasurements) {
          if (im.replace(/\d+/g, "").trim() === unit && im.match(/\d+/)?.[0] !== value) return false;
        }
      }
    }

    // Global overhead matches - only if scope is generic or specifically for overhead
    if (pmcGroupName.includes("travel") || pmcGroupName === "pm" || pmcGroupName.includes("management")) {
      return scopeTitleLower.includes("overhead") || scopeTitleLower.includes("travel") || scopeWords.length < 2;
    }

    // Avoid pulling in other scope titles as materials
    if (allScopes.some(s => s.id !== scope.id && (s.title || "").toLowerCase() === costItemName)) return false;

    // Keyword matching - Strictness increases with scope complexity
    const matchCount = scopeWords.filter(word => costItemName.includes(word) || pmcGroupName.includes(word)).length;
    const requiredMatches = scopeWords.length >= 3 ? 2 : 1;
    if (matchCount < requiredMatches) return false;
    if (matchCount >= Math.min(requiredMatches + 1, scopeWords.length)) return true;
    if (matchCount >= 1 && scopeWords.length === 1) return true;

    // Labor/Material heuristics
    if (scopeTitleLower.includes("slab") && !costItemName.includes("footing")) {
      const slabMaterials = ["concrete", "wire mesh", "vapor barrier", "viper tape", "curing compound", "foam", "rebar", "chair", "hardener", "forms"];
      if (slabMaterials.some(m => costItemName.includes(m))) return true;
    }
    if ((scopeTitleLower.includes("footing") || scopeTitleLower.includes("foundation")) && !costItemName.includes("slab")) {
      const foundationMaterials = ["concrete", "rebar", "forms", "anchor bolt", "ties"];
      if (foundationMaterials.some(m => costItemName.includes(m))) return true;
    }

    return false;
  });
}

export default function FieldTrackingPage() {
  return (
    <ProtectedPage page="field">
      <FieldTrackingContent />
    </ProtectedPage>
  );
}

function FieldTrackingContent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [fullProjectList, setFullProjectList] = useState<Project[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [selectedScope, setSelectedScope] = useState<string>("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [laborEntries, setLaborEntries] = useState<{ category: string; hours: string }[]>([{ category: "General Labor", hours: "" }]);
  const [materials, setMaterials] = useState<{ item: string; quantity: string }[]>([{ item: "", quantity: "" }]);
  const [notes, setNotes] = useState("");

  // Memoized derived properties
  const activeProject = React.useMemo(() => projects.find(p => p.id === selectedProject), [projects, selectedProject]);
  const activeJobKey = React.useMemo(() => activeProject ? (activeProject.jobKey || getProjectKey(activeProject)) : "", [activeProject]);
  
  const projectCostItems = React.useMemo(() => {
    if (!activeJobKey) return [];
    
    // Filter out items that are from "Lost" or "Bid Submitted" versions if "In Progress" exists for same jobKey+costitem
    const jobItems = fullProjectList.filter(p => (p.jobKey || getProjectKey(p)) === activeJobKey);
    
    return Array.from(new Set(jobItems
      .filter(p => {
        const hasInProgress = jobItems.some(item => 
          item.status === "In Progress" && 
          item.costitems === p.costitems
        );
        return hasInProgress ? p.status === "In Progress" : true;
      })
      .map(p => p.costitems || "")
      .filter(Boolean)
    )).sort();
  }, [activeJobKey, fullProjectList]);

  // Initial Data Load
  useEffect(() => {
    async function fetchData() {
      try {
        const q = query(collection(db, "projects"), where("projectArchived", "==", false));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) as Project[];
        setFullProjectList(data);

        // Deduplicate for project selection - Prefer "In Progress" status
        const dedupedMap = new Map();
        data.forEach((p: any) => {
          const key = p.jobKey || getProjectKey(p);
          const existing = dedupedMap.get(key);
          if (!existing || (existing.status !== "In Progress" && p.status === "In Progress")) {
            dedupedMap.set(key, { ...p, jobKey: key });
          }
        });

        setProjects(Array.from(dedupedMap.values()).sort((a, b) => (a.projectName || "").localeCompare(b.projectName || "")));
        setLoading(false);
      } catch (error) {
        console.error("Error fetching projects:", error);
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Fetch Scopes when Project changes
  useEffect(() => {
    setSelectedScope(""); 
    setLaborEntries([{ category: "General Labor", hours: "" }]);
    setMaterials([{ item: "", quantity: "" }]);

    if (!activeJobKey) {
      setScopes([]);
      return;
    }
    
    async function fetchScopes() {
      try {
        const q = query(collection(db, "projectScopes"), where("jobKey", "==", activeJobKey));
        const snapshot = await getDocs(q);
        const scopesData = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() })) as Scope[];
        
        setScopes(Array.from(new Map(scopesData.map((s: any) => [s.title, s])).values())
          .sort((a, b) => (a.title || "").localeCompare(b.title || "")));
      } catch (error) {
        console.error("Error fetching scopes:", error);
      }
    }
    fetchScopes();
  }, [activeJobKey]);

  // Handle Scope Selection and Auto-population
  useEffect(() => {
    if (!selectedScope) return;
    const scope = scopes.find(s => s.id === selectedScope);
    if (!scope || !activeJobKey) return;

    const matchedProjectItems = findMatchingItems(scope, fullProjectList, activeJobKey, scopes);

    if (matchedProjectItems.length > 0) {
      const laborMap = new Map<string, { name: string; hours: number }>();
      const materialMap = new Map<string, { name: string; quantity: string }>();

      matchedProjectItems.forEach((item: any) => {
        const pmcGroup = (item.pmcGroup || "").toString();
        const costItem = (item.costitems || "").toString();
        
        const isLabor = pmcGroup.toLowerCase().includes("labor") || 
                        costItem.toLowerCase().includes("labor") || 
                        ["pm", "management", "mobilization", "travel"].some(word => pmcGroup.toLowerCase().includes(word));

        if (isLabor) {
          const groupName = pmcGroup || costItem || "General Labor";
          const current = laborMap.get(groupName) || { name: groupName, hours: 0 };
          current.hours += Number(item.hours) || 0;
          laborMap.set(groupName, current);
        } else {
          const itemName = costItem || pmcGroup || "Unknown Item";
          if (!materialMap.has(itemName)) materialMap.set(itemName, { name: itemName, quantity: "1" });
        }
      });

      const laborEntriesList = Array.from(laborMap.values());
      const materialEntriesList = Array.from(materialMap.values());

      setLaborEntries(laborEntriesList.length > 0 
        ? laborEntriesList.map((l: any) => ({ category: l.name, hours: l.hours.toString() })) 
        : [{ category: "General Labor", hours: scope.hours?.toString() || "" }]);

      setMaterials(materialEntriesList.length > 0 
        ? materialEntriesList.map((m: any) => ({ item: m.name, quantity: m.quantity })) 
        : [{ item: "", quantity: "" }]);
    } else {
      setLaborEntries([{ category: "General Labor", hours: scope.hours?.toString() || "" }]);
      setMaterials([{ item: "", quantity: "" }]);
    }
  }, [selectedScope, scopes, fullProjectList, activeJobKey]);

  const addLaborRow = () => {
    setLaborEntries([...laborEntries, { category: "", hours: "" }]);
  };

  const updateLabor = (index: number, field: "category" | "hours", value: string) => {
    const newLabor = [...laborEntries];
    newLabor[index][field] = value;
    setLaborEntries(newLabor);
  };

  const removeLabor = (index: number) => {
    setLaborEntries(laborEntries.filter((_, i) => i !== index));
  };

  const addMaterialRow = () => {
    setMaterials([...materials, { item: "", quantity: "" }]);
  };

  const updateMaterial = (index: number, field: "item" | "quantity", value: string) => {
    const newMaterials = [...materials];
    newMaterials[index][field] = value;
    setMaterials(newMaterials);
  };

  const removeMaterial = (index: number) => {
    setMaterials(materials.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasHours = laborEntries.some(l => l.hours && parseFloat(l.hours) > 0);
    if (!selectedProject || !selectedScope || !hasHours) {
      alert("Please fill in Project, Scope, and at least some Labor hours.");
      return;
    }

    setSubmitting(true);
    try {
      const project = projects.find(p => p.id === selectedProject);
      const scope = scopes.find(s => s.id === selectedScope);
      const jobKey = project?.jobKey || getProjectKey(project as Project);

      await addDoc(collection(db, "fieldLogs"), {
        projectId: selectedProject,
        projectName: project?.projectName,
        jobKey: jobKey,
        scopeId: selectedScope,
        scopeTitle: scope?.title,
        date,
        labor: laborEntries.filter(l => l.hours && l.category),
        totalHours: laborEntries.reduce((sum, l) => sum + (parseFloat(l.hours) || 0), 0),
        materials: materials.filter(m => m.item && m.quantity),
        notes,
        submittedAt: serverTimestamp(),
      });

      alert("Log submitted successfully!");
      // Reset form
      setSelectedScope("");
      setLaborEntries([{ category: "General Labor", hours: "" }]);
      setMaterials([{ item: "", quantity: "" }]);
      setNotes("");
    } catch (error) {
      console.error("Error submitting log:", error);
      alert("Failed to submit log.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: 20 }}>Loading Projects...</div>;

  const inputStyle = {
    width: "100%",
    padding: "16px",
    fontSize: "16px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    marginBottom: "16px",
    background: "#fff",
    color: "#222"
  };

  const labelStyle = {
    display: "block",
    marginBottom: "8px",
    fontWeight: 600,
    color: "#15616D",
    fontSize: "14px"
  };

  return (
    <main style={{ background: "#f5f5f5", minHeight: "100vh", paddingBottom: "40px" }}>
      <div style={{ background: "#15616D", padding: "16px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "20px", margin: 0 }}>Daily Field Log</h1>
        <Navigation currentPage="field" />
      </div>

      <form onSubmit={handleSubmit} style={{ padding: "16px", maxWidth: "600px", margin: "0 auto" }}>
        {/* Project Selection */}
        <div style={{ background: "#fff", padding: "16px", borderRadius: "12px", marginBottom: "16px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
          <label style={labelStyle}>Project</label>
          <select 
            value={selectedProject} 
            onChange={(e) => setSelectedProject(e.target.value)}
            style={inputStyle}
            required
          >
            <option value="">Select a Project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.projectName} ({p.projectNumber})</option>
            ))}
          </select>

          {selectedProject && (
            <>
              <label style={labelStyle}>Scope of Work</label>
              <select 
                value={selectedScope} 
                onChange={(e) => setSelectedScope(e.target.value)}
                style={inputStyle}
                required
              >
                <option value="">Select a Scope...</option>
                {scopes.map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </>
          )}

          <label style={labelStyle}>Date</label>
          <input 
            type="date" 
            value={date} 
            onChange={(e) => setDate(e.target.value)}
            style={inputStyle}
            required
          />
        </div>

        {/* Labor Entry */}
        <div style={{ background: "#fff", padding: "16px", borderRadius: "12px", marginBottom: "16px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
          <label style={{ ...labelStyle, fontSize: "18px", borderBottom: "1px solid #eee", paddingBottom: "8px", marginBottom: "16px" }}>Labor</label>
          
          {laborEntries.map((l, index) => (
            <div key={index} style={{ marginBottom: "20px", background: "#f9fafb", padding: "12px", borderRadius: "8px", border: "1px solid #f3f4f6" }}>
              <label style={labelStyle}>Category</label>
              <input 
                placeholder="e.g. Slab On Grade Labor" 
                value={l.category} 
                onChange={(e) => updateLabor(index, "category", e.target.value)}
                style={inputStyle}
              />
              <label style={labelStyle}>Hours Tracked</label>
              <input 
                type="number" 
                step="0.5"
                placeholder="e.g. 8.0" 
                value={l.hours} 
                onChange={(e) => updateLabor(index, "hours", e.target.value)}
                style={{ ...inputStyle, marginBottom: 0 }}
                required={index === 0}
              />
              {laborEntries.length > 1 && (
                <button 
                  type="button" 
                  onClick={() => removeLabor(index)}
                  style={{ marginTop: "8px", padding: "8px", background: "none", border: "none", color: "#ef4444", fontSize: "12px", textDecoration: "underline" }}
                >
                  Remove Category
                </button>
              )}
            </div>
          ))}

          <button 
            type="button" 
            onClick={addLaborRow}
            style={{ width: "100%", padding: "12px", background: "#f3f4f6", border: "1px dashed #ccc", borderRadius: "8px", color: "#666", fontWeight: 600 }}
          >
            + Add Another Labor Category
          </button>
        </div>

        {/* Materials Entry */}
        <div style={{ background: "#fff", padding: "16px", borderRadius: "12px", marginBottom: "16px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
          <label style={{ ...labelStyle, fontSize: "18px", borderBottom: "1px solid #eee", paddingBottom: "8px", marginBottom: "16px" }}>Materials / Items used</label>
          <datalist id="project-items">
            {projectCostItems.map(name => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {materials.map((m, index) => (
            <div key={index} style={{ display: "flex", gap: "8px", marginBottom: "12px", alignItems: "flex-start" }}>
              <div style={{ flex: 2 }}>
                <input 
                  placeholder="Item name" 
                  list="project-items"
                  value={m.item} 
                  onChange={(e) => updateMaterial(index, "item", e.target.value)}
                  style={{ ...inputStyle, marginBottom: 0 }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <input 
                  placeholder="Qty" 
                  value={m.quantity} 
                  onChange={(e) => updateMaterial(index, "quantity", e.target.value)}
                  style={{ ...inputStyle, marginBottom: 0 }}
                />
              </div>
              {materials.length > 1 && (
                <button 
                  type="button" 
                  onClick={() => removeMaterial(index)}
                  style={{ padding: "12px", background: "#fee2e2", border: "none", borderRadius: "8px", color: "#ef4444" }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button 
            type="button" 
            onClick={addMaterialRow}
            style={{ width: "100%", padding: "12px", background: "#f3f4f6", border: "1px dashed #ccc", borderRadius: "8px", color: "#666", fontWeight: 600 }}
          >
            + Add Another Item
          </button>
        </div>

        {/* Notes */}
        <div style={{ background: "#fff", padding: "16px", borderRadius: "12px", marginBottom: "24px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
          <label style={labelStyle}>Daily Notes / Progress</label>
          <textarea 
            placeholder="What was accomplished today?" 
            value={notes} 
            onChange={(e) => setNotes(e.target.value)}
            style={{ ...inputStyle, height: "100px", resize: "none" }}
          />
        </div>

        <button 
          type="submit" 
          disabled={submitting}
          style={{ 
            width: "100%", 
            padding: "20px", 
            background: "#15616D", 
            color: "#fff", 
            border: "none", 
            borderRadius: "12px", 
            fontSize: "18px", 
            fontWeight: 700,
            boxShadow: "0 4px 6px rgba(21, 97, 109, 0.3)",
            cursor: submitting ? "not-allowed" : "pointer",
            opacity: submitting ? 0.7 : 1
          }}
        >
          {submitting ? "Submitting..." : "Submit Daily Log"}
        </button>
      </form>
    </main>
  );
}

"use client";
import React, { useState, useEffect } from "react";
import { db } from "@/firebase";
import { collection, getDocs, addDoc, query, where, serverTimestamp } from "firebase/firestore";
import ProtectedPage from "@/components/ProtectedPage";
import { Project, Scope } from "@/types";
import Navigation from "@/components/Navigation";

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
  const [projectCostItems, setProjectCostItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [selectedScope, setSelectedScope] = useState<string>("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [laborEntries, setLaborEntries] = useState<{ category: string; hours: string }[]>([{ category: "General Labor", hours: "" }]);
  const [materials, setMaterials] = useState<{ item: string; quantity: string }[]>([{ item: "", quantity: "" }]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        const q = query(collection(db, "projects"), where("status", "==", "In Progress"));
        const snapshot = await getDocs(q);
        const projectsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Project[];
        setFullProjectList(projectsData);
        
        // Deduplicate projects by their natural key (customer~projectNumber~projectName)
        const dedupedMap = new Map<string, Project>();
        projectsData.forEach(p => {
          const key = `${p.customer || ""}~${p.projectNumber || ""}~${p.projectName || ""}`;
          // Key check to avoid repeats, prioritizing entries that might already have a jobKey
          if (!dedupedMap.has(key) || (!dedupedMap.get(key)?.jobKey && p.jobKey)) {
            dedupedMap.set(key, {
              ...p,
              // Ensure jobKey is consistently populated
              jobKey: p.jobKey || key
            });
          }
        });

        const dedupedList = Array.from(dedupedMap.values())
          .sort((a, b) => (a.projectName || "").localeCompare(b.projectName || ""));
          
        setProjects(dedupedList);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching projects:", error);
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    async function fetchScopes() {
      setSelectedScope(""); // Reset selected scope when project changes
      setLaborEntries([{ category: "General Labor", hours: "" }]);
      setMaterials([{ item: "", quantity: "" }]);

      if (!selectedProject) {
        setScopes([]);
        return;
      }
      const project = projects.find(p => p.id === selectedProject);
      // Construct jobKey if it's not present (matching the format used in projectScopes)
      const jobKey = project?.jobKey || `${project?.customer || ""}~${project?.projectNumber || ""}~${project?.projectName || ""}`;
      
      try {
        const q = query(collection(db, "projectScopes"), where("jobKey", "==", jobKey));
        const snapshot = await getDocs(q);
        const scopesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Scope[];
        
        // Filter out any duplicates if they exist and sort alphabetically
        const uniqueScopes = Array.from(new Map(scopesData.map(s => [s.title, s])).values())
          .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
          
        const projectItems = fullProjectList.filter(p => {
          const pJobKey = p.jobKey || `${p.customer || ""}~${p.projectNumber || ""}~${p.projectName || ""}`;
          return pJobKey === jobKey;
        });
        const allItemNames = Array.from(new Set(projectItems.map(p => p.costitems || "").filter(Boolean))).sort();
        setProjectCostItems(allItemNames);
          
        setScopes(uniqueScopes);
      } catch (error) {
        console.error("Error fetching scopes:", error);
      }
    }
    fetchScopes();
  }, [selectedProject, projects, fullProjectList]);

  // Handle Scope Selection and Auto-population
  useEffect(() => {
    if (!selectedScope) return;

    const scope = scopes.find(s => s.id === selectedScope);
    if (!scope) return;

    const project = projects.find(p => p.id === selectedProject);
    const jobKey = project?.jobKey || `${project?.customer || ""}~${project?.projectNumber || ""}~${project?.projectName || ""}`;

    // Precise matching logic
    const scopeTitleLower = (scope.title || "").trim().toLowerCase();
    
    // Extract significant words including measurements like 4", 6", etc.
    const cleanScope = scopeTitleLower
      .replace(/^[\d,]+\s*(sq\s*ft\.?|ln\s*ft\.?|each|lf|ea)?\s*([-–]\s*)?/i, "")
      .trim();
    
    // Split into words, keeping things like 4" or 6"
    const scopeWords = cleanScope.split(/\s+/).filter(w => w.length >= 2 && w !== "and" && w !== "with" && w !== "for");

    const matchedProjectItems = fullProjectList.filter(p => {
      const pJobKey = p.jobKey || `${p.customer || ""}~${p.projectNumber || ""}~${p.projectName || ""}`;
      if (pJobKey !== jobKey) return false;
      
      const costItemName = (p.costitems || "").toLowerCase();
      const pmcGroupName = (p.pmcGroup || "").toString().toLowerCase();
      
      // Global labor/management categories
      const isGlobalCategory = pmcGroupName.includes("travel") || 
                               pmcGroupName === "pm" || 
                               pmcGroupName.includes("management") ||
                               pmcGroupName.includes("mobilization") ||
                               costItemName.includes("travel") ||
                               costItemName.includes("management") ||
                               costItemName.includes("mobilization");

      if (isGlobalCategory) return true;

      // For specific items (like Concrete, Rebar, or specific Scope line items), 
      // we want a tighter match to avoid pulling in other slabs.
      // We check how many words from the scope title appear in the cost item or its group.
      const matchCount = scopeWords.filter(word => 
        costItemName.includes(word) || pmcGroupName.includes(word)
      ).length;

      // If the scope has multiple words (e.g., "Interior Slab on Grade"), 
      // we require at least 2 words to match to avoid category bleed (like "Slab" matching all slabs).
      // If the scope only has 1 word, we allow 1.
      const threshold = scopeWords.length >= 2 ? 2 : 1;
      
      return matchCount >= threshold;
    });

    if (matchedProjectItems.length > 0) {
      // Separate maps for Labor categories and Material items
      const laborMap = new Map<string, { name: string; hours: number }>();
      const materialMap = new Map<string, { name: string; quantity: string }>();

      matchedProjectItems.forEach(item => {
        const pmcGroup = (item.pmcGroup || "").toString();
        const costItem = (item.costitems || "").toString();
        const pmcLower = pmcGroup.toLowerCase();
        const costLower = costItem.toLowerCase();

        // Categorize as labor if it's PM, Travel, or contains "labor"
        const isLabor = pmcLower.includes("labor") || 
                        costLower.includes("labor") || 
                        pmcLower === "pm" || 
                        pmcLower.includes("management") ||
                        pmcLower.includes("mobilization");

        if (isLabor) {
          // Reverting Labor to use PMC Group for grouping as requested
          const groupName = pmcGroup || costItem || "General Labor";
          const current = laborMap.get(groupName) || { name: groupName, hours: 0 };
          current.hours += Number(item.hours) || 0;
          laborMap.set(groupName, current);
        } else {
          // Keep Materials using the specific costitems field names
          const itemName = costItem || pmcGroup || "Unknown Item";
          if (!materialMap.has(itemName)) {
            materialMap.set(itemName, { name: itemName, quantity: "1" });
          }
        }
      });

      const laborEntriesList = Array.from(laborMap.values());
      const materialEntriesList = Array.from(materialMap.values());

      // Set labor entries
      if (laborEntriesList.length > 0) {
        setLaborEntries(laborEntriesList.map(l => ({ category: l.name, hours: l.hours.toString() })));
      } else {
        setLaborEntries([{ category: "General Labor", hours: scope.hours ? scope.hours.toString() : "" }]);
      }

      // Set materials using actual cost items
      setMaterials(materialEntriesList.length > 0 
        ? materialEntriesList.map(m => ({ item: m.name, quantity: m.quantity })) 
        : [{ item: "", quantity: "" }]
      );
    } else {
      // Fallback to scope's own hours if no cost items matched
      setLaborEntries([{ category: "General Labor", hours: scope.hours ? scope.hours.toString() : "" }]);
      setMaterials([{ item: "", quantity: "" }]);
    }
  }, [selectedScope, scopes, fullProjectList, selectedProject, projects]);

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
      const jobKey = project?.jobKey || `${project?.customer || ""}~${project?.projectNumber || ""}~${project?.projectName || ""}`;

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

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
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [selectedScope, setSelectedScope] = useState<string>("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [hours, setHours] = useState<string>("");
  const [materials, setMaterials] = useState<{ item: string; quantity: string }[]>([{ item: "", quantity: "" }]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        const q = query(collection(db, "projects"), where("status", "==", "In Progress"));
        const snapshot = await getDocs(q);
        const projectsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Project[];
        setProjects(projectsData.sort((a, b) => (a.projectName || "").localeCompare(b.projectName || "")));
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
      if (!selectedProject) {
        setScopes([]);
        return;
      }
      const project = projects.find(p => p.id === selectedProject);
      if (!project?.jobKey) return;

      try {
        const q = query(collection(db, "projectScopes"), where("jobKey", "==", project.jobKey));
        const snapshot = await getDocs(q);
        const scopesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Scope[];
        setScopes(scopesData);
      } catch (error) {
        console.error("Error fetching scopes:", error);
      }
    }
    fetchScopes();
  }, [selectedProject, projects]);

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
    if (!selectedProject || !selectedScope || !hours) {
      alert("Please fill in Project, Scope, and Hours.");
      return;
    }

    setSubmitting(true);
    try {
      const project = projects.find(p => p.id === selectedProject);
      const scope = scopes.find(s => s.id === selectedScope);

      await addDoc(collection(db, "fieldLogs"), {
        projectId: selectedProject,
        projectName: project?.projectName,
        jobKey: project?.jobKey,
        scopeId: selectedScope,
        scopeTitle: scope?.title,
        date,
        hours: parseFloat(hours),
        materials: materials.filter(m => m.item && m.quantity),
        notes,
        submittedAt: serverTimestamp(),
      });

      alert("Log submitted successfully!");
      // Reset form
      setSelectedScope("");
      setHours("");
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
          <label style={labelStyle}>Hours Tracked</label>
          <input 
            type="number" 
            step="0.5"
            placeholder="e.g. 8.0" 
            value={hours} 
            onChange={(e) => setHours(e.target.value)}
            style={inputStyle}
            required
          />
        </div>

        {/* Materials Entry */}
        <div style={{ background: "#fff", padding: "16px", borderRadius: "12px", marginBottom: "16px", boxShadow: "0 2px 4px rgba(0,0,0,0.05)" }}>
          <label style={{ ...labelStyle, fontSize: "18px", borderBottom: "1px solid #eee", paddingBottom: "8px", marginBottom: "16px" }}>Materials / Items used</label>
          {materials.map((m, index) => (
            <div key={index} style={{ display: "flex", gap: "8px", marginBottom: "12px", alignItems: "flex-start" }}>
              <div style={{ flex: 2 }}>
                <input 
                  placeholder="Item name" 
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

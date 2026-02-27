"use client";
import React, { useState, useEffect } from "react";
import Navigation from "@/components/Navigation";

export default function ConstantsPage() {
  return <ConstantsContent />;
}

function ConstantsContent() {
  const [constants, setConstants] = useState<any[]>([]);
  const [rebarConstants, setRebarConstants] = useState<any[]>([]);
  const [newConstant, setNewConstant] = useState({ name: "", value: "", category: "General" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "rebar">("general");

  async function fetchAllData() {
    setLoading(true);
    try {
      const response = await fetch('/api/estimating-constants');
      const result = await response.json();
      if (result.success) {
        setConstants(result.data || []);
      }
      setLoading(false);
    } catch (error) {
      console.error("Error fetching data:", error);
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAllData();
  }, []);

  async function saveConstant() {
    if (!newConstant.name || !newConstant.value) return;
    setSaving(true);
    try {
      const response = await fetch('/api/estimating-constants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newConstant.name,
          value: Number(newConstant.value),
          category: newConstant.category
        })
      });
      const result = await response.json();
      if (result.success) {
        setNewConstant({ name: "", value: "", category: "General" });
        await fetchAllData();
      }
    } catch (error) {
      console.error("Error saving constant:", error);
    } finally {
      setSaving(false);
    }
  }

  async function removeConstant(id: string) {
    if (!confirm("Are you sure you want to delete this constant?")) return;
    try {
      const response = await fetch(`/api/estimating-constants?id=${id}`, {
        method: 'DELETE'
      });
      const result = await response.json();
      if (result.success) {
        await fetchAllData();
      }
    } catch (error) {
      console.error("Error deleting constant:", error);
    }
  }

  const downloadBackup = () => {
    if (constants.length === 0) return;
    const headers = ["Name", "Value", "Category"];
    const rows = constants.map((c: any) => [c.name, c.value, c.category].join(","));
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `estimating_constants_backup_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main style={{ padding: "32px", background: "#f5f5f5", minHeight: "100vh", color: "#222", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <h1 style={{ color: "#15616D", fontSize: "32px", margin: 0 }}>Estimating Constants</h1>
          <button 
            onClick={downloadBackup}
            style={{ padding: "8px 16px", background: "#eee", border: "1px solid #ccc", borderRadius: "6px", cursor: "pointer", fontSize: "14px" }}
          >
            Backup to CSV
          </button>
        </div>
        <Navigation currentPage="constants" />
      </div>

      <div style={{ display: "flex", gap: "10px", marginBottom: "24px" }}>
        <button 
          onClick={() => setActiveTab("general")}
          style={{
            padding: "10px 20px",
            background: activeTab === "general" ? "#15616D" : "#fff",
            color: activeTab === "general" ? "#fff" : "#666",
            border: activeTab === "general" ? "none" : "1px solid #ddd",
            borderRadius: "8px",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          General Constants
        </button>
        <button 
          onClick={() => setActiveTab("rebar")}
          style={{
            padding: "10px 20px",
            background: activeTab === "rebar" ? "#15616D" : "#fff",
            color: activeTab === "rebar" ? "#fff" : "#666",
            border: activeTab === "rebar" ? "none" : "1px solid #ddd",
            borderRadius: "8px",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Rebar Specifications
        </button>
      </div>

      {activeTab === "general" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "24px", alignItems: "start" }}>
          {/* Add Form Card */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Add New Constant</h2>
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Constant Name</label>
            <input 
              placeholder="e.g. Concrete Cost per Yd" 
              value={newConstant.name}
              onChange={e => setNewConstant({...newConstant, name: e.target.value})}
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Value</label>
            <input 
              type="number"
              placeholder="0.00" 
              value={newConstant.value}
              onChange={e => setNewConstant({...newConstant, value: e.target.value})}
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: "20px" }}>
            <label style={labelStyle}>Category</label>
            <select 
              value={newConstant.category}
              onChange={e => setNewConstant({...newConstant, category: e.target.value})}
              style={inputStyle}
            >
              <option value="General">General</option>
              <option value="Labor">Labor</option>
              <option value="Material">Material</option>
              <option value="Overhead">Overhead</option>
            </select>
          </div>
          <button 
            onClick={saveConstant}
            disabled={saving}
            style={{ 
              width: "100%", 
              padding: "12px", 
              background: "#15616D", 
              color: "#fff", 
              border: "none", 
              borderRadius: "8px", 
              fontWeight: 700,
              fontSize: "14px",
              cursor: "pointer",
              boxShadow: "0 2px 4px rgba(21, 97, 109, 0.2)"
            }}
          >
            {saving ? "Saving..." : "Save Constant"}
          </button>
        </div>

        {/* List Card */}
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Existing Constants</h2>
          {loading ? <p>Loading...</p> : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "2px solid #f3f4f6" }}>
                    <th style={tableHeaderStyle}>Name</th>
                    <th style={tableHeaderStyle}>Value</th>
                    <th style={tableHeaderStyle}>Category</th>
                    <th style={tableHeaderStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {constants.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: "#333" }}>{c.name}</div>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: "#E06C00", fontWeight: 700 }}>{c.value}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: "12px", background: "#f3f4f6", padding: "4px 8px", borderRadius: "12px", color: "#666" }}>
                          {c.category}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <button 
                          onClick={() => removeConstant(c.id)}
                          style={{ color: "#ef4444", background: "none", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: 700 }}
                        >
                          DELETE
                        </button>
                      </td>
                    </tr>
                  ))}
                  {constants.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: "40px", textAlign: "center", color: "#999" }}>No constants defined yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      ) : (
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>Rebar Reference Table</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #f3f4f6" }}>
                  <th style={tableHeaderStyle}>Size</th>
                  <th style={tableHeaderStyle}>Soft Metric</th>
                  <th style={tableHeaderStyle}>Nominal Dia (in)</th>
                  <th style={tableHeaderStyle}>Weight (lb/ft)</th>
                  <th style={tableHeaderStyle}>Overlap (ft)</th>
                </tr>
              </thead>
              <tbody>
                {rebarConstants.map((r) => (
                  <tr key={r.size} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: "#15616D" }}>{r.size}</td>
                    <td style={tdStyle}>{r.softMetric}</td>
                    <td style={tdStyle}>{r.nominalDiameter.toFixed(3)}</td>
                    <td style={tdStyle}>{r.weightPerFoot.toFixed(3)}</td>
                    <td style={tdStyle}>{r.overlap}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#ffffff",
  borderRadius: "12px",
  padding: "24px",
  border: "1px solid #ddd",
  boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  color: "#333",
  margin: "0 0 20px 0",
};

const labelStyle = { display: "block", marginBottom: "8px", fontSize: "13px", fontWeight: 600, color: "#666", textTransform: "uppercase" as const, letterSpacing: "0.05em" };
const inputStyle = { width: "100%", padding: "10px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "14px", background: "#fff" };
const tableHeaderStyle = { padding: "12px 8px", fontSize: "11px", color: "#999", textTransform: "uppercase" as const, letterSpacing: "0.05em" };
const tdStyle = { padding: "16px 8px", fontSize: "14px" };

"use client";
import React, { useState } from "react";

export default function SeedKPICardsPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const seedDatabase = async () => {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch("/api/kpi-cards/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seedFromDefaults: true }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(`Error: ${json.error}`);
        if (json.hint) {
          setError(prev => prev + "\n\n" + json.hint);
        }
        return;
      }

      setMessage(json.message || "Successfully seeded KPI cards!");
    } catch (err) {
      setError(`Failed to seed data: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: "600px", margin: "40px auto", padding: "20px" }}>
      <h1>Seed KPI Cards Database</h1>

      <div
        style={{
          backgroundColor: "#f0f4f8",
          border: "1px solid #cbd5e0",
          borderRadius: "8px",
          padding: "20px",
          marginBottom: "20px",
        }}
      >
        <p style={{ margin: "0 0 10px 0" }}>
          This will populate the Firestore database with the default KPI card data including:
        </p>
        <ul style={{ margin: "10px 0", paddingLeft: "20px" }}>
          <li>Estimates By Month (2 rows)</li>
          <li>Sales By Month (2 rows)</li>
          <li>Revenue By Month (2 rows)</li>
          <li>Subs By Month (2 rows)</li>
          <li>Revenue Hours by Month (2 rows)</li>
          <li>Gross Profit by Month (2 rows)</li>
          <li>Profit by Month (2 rows)</li>
          <li>Leadtimes by Month (1 row)</li>
        </ul>
        <p style={{ margin: "10px 0" }}>
          <strong>Note:</strong> Firestore security rules must allow authenticated writes to the{" "}
          <code>kpiCards</code> collection for this to work.
        </p>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: "#fee",
            border: "1px solid #fcc",
            borderRadius: "8px",
            padding: "15px",
            marginBottom: "20px",
            color: "#c33",
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
            fontSize: "12px",
          }}
        >
          {error}
        </div>
      )}

      {message && (
        <div
          style={{
            backgroundColor: "#efe",
            border: "1px solid #cfc",
            borderRadius: "8px",
            padding: "15px",
            marginBottom: "20px",
            color: "#3c3",
          }}
        >
          ✓ {message}
        </div>
      )}

      <button
        onClick={seedDatabase}
        disabled={loading}
        style={{
          width: "100%",
          padding: "12px",
          backgroundColor: loading ? "#ccc" : "#0066cc",
          color: "white",
          border: "none",
          borderRadius: "4px",
          fontSize: "16px",
          fontWeight: 600,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Seeding Database..." : "Seed Database"}
      </button>

      <div style={{ marginTop: "20px", fontSize: "12px", color: "#999" }}>
        <p>After seeding, you can:</p>
        <ul>
          <li>Visit <code>/kpi</code> to view KPI cards loaded from Firestore</li>
          <li>Visit <code>/kpi-cards-management</code> to edit cards</li>
          <li>Delete the CSV file once confirmed working</li>
        </ul>
      </div>
    </div>
  );
}

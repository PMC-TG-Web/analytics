"use client";
import React, { useState } from "react";

export default function SeedKPICardsPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);

  const seedDatabase = async () => {
    setLoading(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch("/api/kpi-cards/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seedFromDefaults: true,
          confirmSeed: true,
          confirmPhrase: "SEED KPI CARDS",
        }),
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
      setShowConfirm(false);
    } catch (err) {
      setError(`Failed to seed data: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", padding: "32px 20px" }}>
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", marginBottom: "32px" }}>
          <h1 style={{ margin: 0, color: "#333", fontSize: "24px" }}>Seed KPI Cards Database</h1>
        </div>

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
          This will populate the database with the default KPI card data including:
        </p>
        <ul style={{ margin: "10px 0", paddingLeft: "20px" }}>
          <li>Estimates By Month (3 rows: Goal, Goal Hours, and Actual Hours)</li>
          <li>Sales By Month (2 rows)</li>
          <li>Revenue By Month (2 rows)</li>
          <li>Subs By Month (2 rows)</li>
          <li>Revenue Hours by Month (2 rows)</li>
          <li>Gross Profit by Month (2 rows)</li>
          <li>Profit by Month (2 rows)</li>
          <li>Leadtimes by Month (1 row)</li>
        </ul>
        <p style={{ margin: "10px 0" }}>
          <strong>Note:</strong> This seeds the database-backed KPI card store (category <code>KPI_CARDS</code>) via the API.
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
          OK {message}
        </div>
      )}

      {showConfirm ? (
        <div
          style={{
            backgroundColor: "#fff3cd",
            border: "2px solid #ff9800",
            borderRadius: "8px",
            padding: "20px",
            marginBottom: "20px",
          }}
        >
          <p style={{ margin: "0 0 15px 0", fontWeight: 600, color: "#333" }}>
            ⚠️ Are you sure you want to seed the KPI database?
          </p>
          <p style={{ margin: "0 0 15px 0", color: "#555", fontSize: "14px" }}>
            This will populate default KPI card templates. <strong>Existing manually-entered data will be preserved.</strong>
          </p>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={seedDatabase}
              disabled={loading}
              style={{
                flex: 1,
                padding: "10px",
                backgroundColor: "#ff9800",
                color: "white",
                border: "none",
                borderRadius: "4px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Seeding..." : "Yes, Seed Database"}
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              disabled={loading}
              style={{
                flex: 1,
                padding: "10px",
                backgroundColor: "#ccc",
                color: "#333",
                border: "none",
                borderRadius: "4px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowConfirm(true)}
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
      )}

      <div style={{ marginTop: "20px", fontSize: "12px", color: "#999" }}>
        <p>After seeding, you can:</p>
        <ul>
          <li>Visit <code>/kpi</code> to view KPI cards loaded from the database</li>
          <li>Visit <code>/kpi-cards-management</code> to edit cards</li>
          <li>Delete the CSV file once confirmed working</li>
        </ul>
      </div>
    </div>
    </div>
  );
}

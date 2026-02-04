"use client";
import React, { useEffect, useState } from "react";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

type KPICardRow = {
  kpi: string;
  values: string[];
};

type KPICard = {
  id: string;
  cardName: string;
  rows: KPICardRow[];
  updatedAt: string;
  updatedBy?: string;
};

const monthNames = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export default function KPICardsManagementPage() {
  return (
    <ProtectedPage page="kpi-cards-management">
      <KPICardsManagementContent />
    </ProtectedPage>
  );
}

function KPICardsManagementContent() {
  const [cards, setCards] = useState<KPICard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [editingCard, setEditingCard] = useState<KPICard | null>(null);
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [newRowKpi, setNewRowKpi] = useState("");
  const [lastUpdate, setLastUpdate] = useState<string>("");

  useEffect(() => {
    fetchCards();
  }, []);

  const fetchCards = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/kpi-cards");
      if (!res.ok) throw new Error("Failed to fetch cards");
      const json = await res.json();
      const fetchedCards = json.data || [];
      
      if (fetchedCards.length === 0) {
        setError("No KPI cards found in database. Please seed the database first.");
      }
      
      setCards(fetchedCards);
      setLastUpdate(new Date().toLocaleString());
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("Error fetching cards:", error);
      setError(`Error loading cards: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const saveCard = async () => {
    if (!editingCard) return;

    try {
      const res = await fetch("/api/kpi-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardName: editingCard.cardName,
          rows: editingCard.rows,
          updatedBy: "admin",
        }),
      });

      if (!res.ok) throw new Error("Failed to save card");
      
      setEditingCard(null);
      setEditingRowIndex(null);
      await fetchCards();
    } catch (error) {
      console.error("Error saving card:", error);
    }
  };

  const updateRowValue = (rowIndex: number, monthIndex: number, value: string) => {
    if (!editingCard) return;

    const updatedCard = { ...editingCard };
    if (!updatedCard.rows[rowIndex].values) {
      updatedCard.rows[rowIndex].values = Array(12).fill("");
    }
    updatedCard.rows[rowIndex].values[monthIndex] = value;
    setEditingCard(updatedCard);
  };

  const updateRowKpi = (rowIndex: number, value: string) => {
    if (!editingCard) return;

    const updatedCard = { ...editingCard };
    updatedCard.rows[rowIndex].kpi = value;
    setEditingCard(updatedCard);
  };

  const deleteRow = (rowIndex: number) => {
    if (!editingCard) return;

    const updatedCard = { ...editingCard };
    updatedCard.rows.splice(rowIndex, 1);
    setEditingCard(updatedCard);
  };

  const addNewRow = () => {
    if (!editingCard || !newRowKpi.trim()) return;

    const updatedCard = { ...editingCard };
    updatedCard.rows.push({
      kpi: newRowKpi,
      values: Array(12).fill(""),
    });
    setEditingCard(updatedCard);
    setNewRowKpi("");
  };

  if (loading) {
    return <div style={{ padding: "20px" }}>Loading KPI cards...</div>;
  }

  if (editingCard) {
    return (
      <div style={{ padding: "20px", maxWidth: "1200px", margin: "0 auto" }}>
        <h1>{editingCard.cardName}</h1>
        <div style={{ marginBottom: "20px", fontSize: "14px", color: "#666" }}>
          Last updated: {editingCard.updatedAt && new Date(editingCard.updatedAt).toLocaleString()}
          {editingCard.updatedBy && ` by ${editingCard.updatedBy}`}
        </div>

        <div style={{ overflowX: "auto", marginBottom: "20px" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", border: "1px solid #ddd" }}>
            <thead>
              <tr style={{ backgroundColor: "#f5f5f5" }}>
                <th style={{ padding: "12px", border: "1px solid #ddd", textAlign: "left" }}>KPI Name</th>
                {monthNames.map((month) => (
                  <th key={month} style={{ padding: "12px", border: "1px solid #ddd", textAlign: "center" }}>
                    {month}
                  </th>
                ))}
                <th style={{ padding: "12px", border: "1px solid #ddd", textAlign: "center" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {editingCard.rows.map((row, rowIdx) => (
                <tr key={rowIdx} style={{ backgroundColor: rowIdx % 2 === 0 ? "#fff" : "#f9f9f9" }}>
                  <td style={{ padding: "12px", border: "1px solid #ddd" }}>
                    <input
                      type="text"
                      value={row.kpi}
                      onChange={(e) => updateRowKpi(rowIdx, e.target.value)}
                      style={{
                        width: "100%",
                        padding: "6px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                      }}
                    />
                  </td>
                  {monthNames.map((_, monthIdx) => (
                    <td key={monthIdx} style={{ padding: "12px", border: "1px solid #ddd", textAlign: "center" }}>
                      <input
                        type="text"
                        value={row.values?.[monthIdx] || ""}
                        onChange={(e) => updateRowValue(rowIdx, monthIdx, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px",
                          border: "1px solid #ccc",
                          borderRadius: "4px",
                          textAlign: "center",
                        }}
                      />
                    </td>
                  ))}
                  <td style={{ padding: "12px", border: "1px solid #ddd", textAlign: "center" }}>
                    <button
                      onClick={() => deleteRow(rowIdx)}
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "#ef4444",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              <tr style={{ backgroundColor: "#f5f5f5" }}>
                <td colSpan={14} style={{ padding: "12px", border: "1px solid #ddd" }}>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input
                      type="text"
                      placeholder="New KPI name"
                      value={newRowKpi}
                      onChange={(e) => setNewRowKpi(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && addNewRow()}
                      style={{
                        flex: 1,
                        padding: "6px",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                      }}
                    />
                    <button
                      onClick={addNewRow}
                      style={{
                        padding: "6px 12px",
                        backgroundColor: "#10b981",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Add Row
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={saveCard}
            style={{
              padding: "10px 20px",
              backgroundColor: "#0066cc",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "16px",
              fontWeight: 600,
            }}
          >
            Save Changes
          </button>
          <button
            onClick={() => {
              setEditingCard(null);
              setNewRowKpi("");
            }}
            style={{
              padding: "10px 20px",
              backgroundColor: "#999",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "16px",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", maxWidth: "1000px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <h1 style={{ margin: 0 }}>KPI Cards Management</h1>
        <Navigation currentPage="kpi-cards-management" />
      </div>
      
      <div style={{ marginBottom: "20px", fontSize: "14px", color: "#666" }}>
        Last fetched: {lastUpdate || "Not fetched yet"}
      </div>

      {loading && (
        <div style={{ padding: "20px", textAlign: "center", color: "#666" }}>
          Loading KPI cards...
        </div>
      )}

      {error && (
        <div
          style={{
            backgroundColor: "#fee",
            border: "1px solid #fcc",
            borderRadius: "8px",
            padding: "15px",
            marginBottom: "20px",
            color: "#c33",
          }}
        >
          <strong>⚠️ {error}</strong>
          <div style={{ marginTop: "10px", fontSize: "14px" }}>
            <p>To get started, visit <code style={{ backgroundColor: "#f0f0f0", padding: "2px 6px", borderRadius: "3px" }}>/seed-kpi-cards</code> to seed the database with default data.</p>
          </div>
        </div>
      )}

      <div style={{ marginBottom: "20px" }}>
        <button
          onClick={fetchCards}
          disabled={loading}
          style={{
            padding: "10px 20px",
            backgroundColor: loading ? "#ccc" : "#10b981",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: "16px",
          }}
        >
          {loading ? "Refreshing..." : "Refresh Cards"}
        </button>
      </div>

      {!loading && cards.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "20px" }}>
          {cards.map((card) => (
            <div
              key={card.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "20px",
                backgroundColor: "#fff",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              }}
            >
              <h3 style={{ margin: "0 0 10px 0", fontSize: "18px", fontWeight: 600 }}>
                {card.cardName}
              </h3>
              <div style={{ marginBottom: "15px", fontSize: "12px", color: "#999" }}>
                {card.rows.length} row{card.rows.length !== 1 ? "s" : ""}
              </div>
              <div style={{ marginBottom: "15px", fontSize: "11px", color: "#999" }}>
                Updated: {new Date(card.updatedAt).toLocaleString()}
              </div>
              <button
                onClick={() => setEditingCard(card)}
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: "#0066cc",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: 600,
                }}
              >
                Edit Card
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

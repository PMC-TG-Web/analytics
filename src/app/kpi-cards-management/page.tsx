"use client";
import React, { useEffect, useState } from "react";

import Navigation from "@/components/Navigation";
import { loadPayPeriods, distributeHours, formatPayPeriod, type PayPeriod } from "@/utils/payPeriodUtils";

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
  return <KPICardsManagementContent />;
}

function KPICardsManagementContent() {
  const [cards, setCards] = useState<KPICard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [warning, setWarning] = useState<string>("");
  const [editingCard, setEditingCard] = useState<KPICard | null>(null);
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [newRowKpi, setNewRowKpi] = useState("");
  const [lastUpdate, setLastUpdate] = useState<string>("");
  
  // Pay period state
  const [payPeriods, setPayPeriods] = useState<PayPeriod[]>([]);
  const [showPayPeriodModal, setShowPayPeriodModal] = useState(false);
  const [selectedPayPeriod, setSelectedPayPeriod] = useState<string>("");
  const [payPeriodHours, setPayPeriodHours] = useState<string>("");
  const [calculatedDistribution, setCalculatedDistribution] = useState<Record<string, number>>({});
  const [targetRowIndex, setTargetRowIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchCards();
  }, []);
  
  // Load pay periods
  useEffect(() => {
    async function loadPP() {
      const periods = await loadPayPeriods();
      setPayPeriods(periods);
    }
    loadPP();
  }, []);

  const fetchCards = async () => {
    try {
      setLoading(true);
      setError("");
      setWarning("");
      const res = await fetch("/api/kpi-cards");
      if (!res.ok) {
        console.warn("KPI cards endpoint not available");
        setCards([]);
        return;
      }
      try {
        const json = await res.json();
        const fetchedCards = json.data || [];

        if (json.fallback) {
          setWarning(json.message || "Using local default KPI cards. Changes may not be saved to the database.");
        }
        
        if (fetchedCards.length === 0 && !json.fallback) {
          setError("No KPI cards found in database. Please seed the database first.");
        }
        
        setCards(fetchedCards);
        setLastUpdate(new Date().toLocaleString());
      } catch (parseError) {
        console.warn("Failed to parse KPI cards response:", parseError);
        setCards([]);
      }
    } catch (error) {
      console.warn("Error fetching cards:", error);
      setCards([]);
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

      if (!res.ok) {
        console.warn("KPI cards save endpoint not available");
        setEditingCard(null);
        setEditingRowIndex(null);
        return;
      }
      
      try {
        await res.json();
        setEditingCard(null);
        setEditingRowIndex(null);
        await fetchCards();
      } catch (parseError) {
        console.warn("Failed to parse save response:", parseError);
        setEditingCard(null);
        setEditingRowIndex(null);
      }
    } catch (error) {
      console.warn("Error saving card:", error);
      setEditingCard(null);
      setEditingRowIndex(null);
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
  
  const handleCalculateDistribution = () => {
    if (!selectedPayPeriod || !payPeriodHours) {
      alert("Please select a pay period and enter hours");
      return;
    }
    
    const period = payPeriods[parseInt(selectedPayPeriod)];
    const hours = parseFloat(payPeriodHours);
    
    if (isNaN(hours) || hours <= 0) {
      alert("Please enter a valid number of hours");
      return;
    }
    
    const distribution = distributeHours(period, hours);
    setCalculatedDistribution(distribution);
  };
  
  const handleSaveDistribution = () => {
    if (!editingCard || targetRowIndex === null || Object.keys(calculatedDistribution).length === 0) {
      alert("No distribution calculated");
      return;
    }
    
    const updatedCard = { ...editingCard };
    
    // Update values for each month in the distribution
    // Note: The card stores 12 months (0-11 for Jan-Dec), so we apply ALL months
    // from the distribution regardless of year. User should edit the appropriate year's card.
    Object.entries(calculatedDistribution).forEach(([yearMonth, hours]) => {
      const [year, month] = yearMonth.split("-");
      const monthIndex = parseInt(month) - 1; // 0-based index (0=Jan, 11=Dec)
      
      if (monthIndex >= 0 && monthIndex < 12) {
        if (!updatedCard.rows[targetRowIndex].values) {
          updatedCard.rows[targetRowIndex].values = Array(12).fill("");
        }
        const currentValue = parseFloat(updatedCard.rows[targetRowIndex].values[monthIndex] || "0");
        const newValue = currentValue + hours;
        updatedCard.rows[targetRowIndex].values[monthIndex] = newValue.toFixed(2);
        
        console.log(`Updated ${yearMonth} (month index ${monthIndex}): ${currentValue} + ${hours} = ${newValue}`);
      }
    });
    
    setEditingCard(updatedCard);
    setShowPayPeriodModal(false);
    setSelectedPayPeriod("");
    setPayPeriodHours("");
    setCalculatedDistribution({});
    setTargetRowIndex(null);
  };
  
  const openPayPeriodModal = (rowIdx: number) => {
    setTargetRowIndex(rowIdx);
    setShowPayPeriodModal(true);
  };

  if (loading) {
    return <div style={{ padding: "20px" }}>Loading KPI cards...</div>;
  }

  if (editingCard) {
    return (
      <div style={{ padding: "20px" }}>
        <h1>{editingCard.cardName}</h1>
        <div style={{ marginBottom: "20px", fontSize: "14px", color: "#666" }}>
          Last updated: {editingCard.updatedAt && new Date(editingCard.updatedAt).toLocaleString()}
          {editingCard.updatedBy && ` by ${editingCard.updatedBy}`}
        </div>

        <div style={{ overflowX: "auto", marginBottom: "20px" }}>
          <table style={{ borderCollapse: "collapse", border: "1px solid #ddd", minWidth: "100%" }}>
            <thead>
              <tr style={{ backgroundColor: "#f5f5f5" }}>
                <th style={{ padding: "12px", border: "1px solid #ddd", textAlign: "left", minWidth: "200px" }}>KPI Name</th>
                {monthNames.map((month) => (
                  <th key={month} style={{ padding: "12px", border: "1px solid #ddd", textAlign: "center", minWidth: "100px" }}>
                    {month}
                  </th>
                ))}
                <th style={{ padding: "12px", border: "1px solid #ddd", textAlign: "center", minWidth: "100px" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {editingCard.rows.map((row, rowIdx) => (
                <tr key={rowIdx} style={{ backgroundColor: rowIdx % 2 === 0 ? "#fff" : "#f9f9f9" }}>
                  <td style={{ padding: "12px", border: "1px solid #ddd", minWidth: "200px" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        type="text"
                        value={row.kpi}
                        onChange={(e) => updateRowKpi(rowIdx, e.target.value)}
                        style={{
                          flex: 1,
                          padding: "6px",
                          border: "1px solid #ccc",
                          borderRadius: "4px",
                          minWidth: "120px",
                        }}
                      />
                      <button
                        onClick={() => openPayPeriodModal(rowIdx)}
                        title="Enter hours by pay period"
                        style={{
                          padding: "6px 10px",
                          backgroundColor: "#15616D",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "12px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        + Pay Period
                      </button>
                    </div>
                  </td>
                  {monthNames.map((_, monthIdx) => (
                    <td key={monthIdx} style={{ padding: "8px", border: "1px solid #ddd", textAlign: "center", minWidth: "100px" }}>
                      <input
                        type="text"
                        value={row.values?.[monthIdx] || ""}
                        onChange={(e) => updateRowValue(rowIdx, monthIdx, e.target.value)}
                        style={{
                          width: "90px",
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
        
        {/* Pay Period Entry Modal */}
        {showPayPeriodModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}>
            <div style={{
              background: 'white',
              borderRadius: 8,
              padding: 24,
              maxWidth: 600,
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
            }}>
              <h2 style={{ color: '#15616D', marginBottom: 8, fontSize: 18, fontWeight: 700 }}>
                Enter Hours by Pay Period
              </h2>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 16, lineHeight: 1.4 }}>
                Hours will be distributed across months based on weekdays (Mon-Fri) in the pay period, excluding holidays. 
                For pay periods spanning multiple years, all months will be updated in the current card.
              </p>
              
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#333' }}>
                  Select Pay Period:
                </label>
                <select
                  value={selectedPayPeriod}
                  onChange={(e) => setSelectedPayPeriod(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: 14,
                    border: '1px solid #ddd',
                    borderRadius: 4,
                  }}
                >
                  <option value="">-- Choose Pay Period --</option>
                  {payPeriods.map((period, idx) => (
                    <option key={idx} value={idx}>
                      {formatPayPeriod(period)}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: '#333' }}>
                  Total Hours for Period:
                </label>
                <input
                  type="number"
                  value={payPeriodHours}
                  onChange={(e) => setPayPeriodHours(e.target.value)}
                  placeholder="e.g., 840"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    fontSize: 14,
                    border: '1px solid #ddd',
                    borderRadius: 4,
                  }}
                />
              </div>

              <button
                onClick={handleCalculateDistribution}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#15616D',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginBottom: 16,
                }}
              >
                Calculate Distribution
              </button>

              {Object.keys(calculatedDistribution).length > 0 && (
                <div style={{
                  background: '#f9f9f9',
                  padding: 16,
                  borderRadius: 4,
                  marginBottom: 16,
                }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: '#15616D' }}>
                    Calculated Distribution:
                  </h3>
                  {Object.entries(calculatedDistribution).map(([yearMonth, hours]) => {
                    const [year, month] = yearMonth.split('-');
                    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const monthName = monthNames[parseInt(month) - 1];
                    return (
                      <div key={yearMonth} style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '4px 0',
                        fontSize: 13,
                      }}>
                        <span>{monthName} {year}</span>
                        <span style={{ fontWeight: 700 }}>{hours.toFixed(2)} hours</span>
                      </div>
                    );
                  })}
                  {Object.keys(calculatedDistribution).length > 1 && (
                    <div style={{
                      marginTop: 12,
                      padding: '8px',
                      background: '#fff3cd',
                      border: '1px solid #ffc107',
                      borderRadius: 4,
                      fontSize: 12,
                      color: '#856404',
                    }}>
                      ⚠️ This pay period spans multiple months. All months shown will be updated in row #{targetRowIndex !== null ? targetRowIndex + 1 : '?'}.
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  onClick={() => {
                    setShowPayPeriodModal(false);
                    setSelectedPayPeriod('');
                    setPayPeriodHours('');
                    setCalculatedDistribution({});
                    setTargetRowIndex(null);
                  }}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: '#999',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDistribution}
                  disabled={Object.keys(calculatedDistribution).length === 0}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: Object.keys(calculatedDistribution).length > 0 ? '#15616D' : '#ddd',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: Object.keys(calculatedDistribution).length > 0 ? 'pointer' : 'not-allowed',
                  }}
                >
                  Save Hours
                </button>
              </div>
            </div>
          </div>
        )}
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

      {warning && (
        <div
          style={{
            backgroundColor: "#fff7ed",
            border: "1px solid #fed7aa",
            borderRadius: "8px",
            padding: "15px",
            marginBottom: "20px",
            color: "#9a3412",
          }}
        >
          <strong>⚠️ {warning}</strong>
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
          {error.includes("No KPI cards found") && (
            <div style={{ marginTop: "10px", fontSize: "14px" }}>
              <p>To get started, visit <code style={{ backgroundColor: "#f0f0f0", padding: "2px 6px", borderRadius: "3px" }}>/seed-kpi-cards</code> to seed the database with default data.</p>
            </div>
          )}
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

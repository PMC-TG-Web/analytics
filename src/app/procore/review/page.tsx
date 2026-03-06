"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";

type ProductivityLog = {
  id: string;
  date: string;
  procoreId: string | number | null;
  status: string | null;
  company: string | null;
  contract: string | null;
  lineItemDescription: string | null;
  quantityUsed: string | null;
  quantityDelivered: string | null;
  previouslyUsed: string | null;
  previouslyDelivered: string | null;
  notes: string | null;
  createdByName: string | null;
  createdByLogin: string | null;
};

type ApiResponse = {
  success: boolean;
  projectId: string;
  startDate: string;
  endDate: string;
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  count: number;
  logs: ProductivityLog[];
  error?: string;
  details?: string;
};

export default function ProcoreReviewPage() {
  const [projectId, setProjectId] = useState("598134326278124");
  const [startDate, setStartDate] = useState("2025-08-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const loadLogs = async (nextPage = page) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        projectId,
        startDate,
        endDate,
        page: String(nextPage),
        perPage: String(perPage),
      });

      const response = await fetch(`/api/procore/review/productivity-logs?${params.toString()}`);
      const json = (await response.json()) as ApiResponse;

      if (!response.ok || !json.success) {
        setError(json.error || "Failed to load data");
        setData(null);
        return;
      }

      setData(json);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <Navigation />

      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "1rem" }}>
          Procore Productivity Logs Review
        </h1>

        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1rem",
            display: "grid",
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
            gap: "0.75rem",
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Project ID
            </label>
            <input
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "0.375rem" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "0.375rem" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "0.375rem" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.25rem" }}>
              Rows / Page
            </label>
            <input
              type="number"
              min={1}
              max={200}
              value={perPage}
              onChange={(e) => setPerPage(Number(e.target.value || "50"))}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "0.375rem" }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              onClick={() => loadLogs(1)}
              disabled={loading}
              style={{
                width: "100%",
                padding: "0.6rem",
                backgroundColor: loading ? "#9ca3af" : "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: "0.375rem",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: "#fef2f2",
              border: "1px solid #ef4444",
              borderRadius: "0.5rem",
              padding: "1rem",
              marginBottom: "1rem",
              color: "#b91c1c",
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "1100px" }}>
              <thead style={{ backgroundColor: "#f9fafb" }}>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Procore Log ID</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Company</th>
                  <th style={thStyle}>Contract</th>
                  <th style={thStyle}>Line Item</th>
                  <th style={thStyle}>Qty Used</th>
                  <th style={thStyle}>Qty Delivered</th>
                  <th style={thStyle}>Created By</th>
                  <th style={thStyle}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {data?.logs?.length ? (
                  data.logs.map((log) => (
                    <tr key={log.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td style={tdStyle}>{new Date(log.date).toLocaleDateString()}</td>
                      <td style={tdStyle}>{log.procoreId || "-"}</td>
                      <td style={tdStyle}>{log.status || "-"}</td>
                      <td style={tdStyle}>{log.company || "-"}</td>
                      <td style={tdStyle}>{log.contract || "-"}</td>
                      <td style={tdStyle}>{log.lineItemDescription || "-"}</td>
                      <td style={tdStyle}>{log.quantityUsed || "-"}</td>
                      <td style={tdStyle}>{log.quantityDelivered || "-"}</td>
                      <td style={tdStyle}>{log.createdByName || log.createdByLogin || "-"}</td>
                      <td style={tdStyle}>{log.notes || "-"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={10} style={{ padding: "1rem", textAlign: "center", color: "#6b7280" }}>
                      {loading ? "Loading rows..." : "No rows found for the selected filters."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.75rem 1rem",
              borderTop: "1px solid #e5e7eb",
              backgroundColor: "#f9fafb",
            }}
          >
            <span style={{ fontSize: "0.875rem", color: "#374151" }}>
              {data ? `Showing ${data.count} of ${data.total} total rows` : "No data loaded"}
            </span>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => loadLogs(page - 1)}
                disabled={loading || page <= 1}
                style={pagerButtonStyle(loading || page <= 1)}
              >
                Previous
              </button>
              <button
                onClick={() => loadLogs(page + 1)}
                disabled={loading || !data || page >= data.totalPages}
                style={pagerButtonStyle(loading || !data || page >= data.totalPages)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem",
  fontSize: "0.75rem",
  fontWeight: 700,
  color: "#374151",
  letterSpacing: "0.02em",
};

const tdStyle: React.CSSProperties = {
  padding: "0.75rem",
  fontSize: "0.875rem",
  verticalAlign: "top",
};

const pagerButtonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "0.5rem 0.75rem",
  borderRadius: "0.375rem",
  border: "1px solid #d1d5db",
  backgroundColor: disabled ? "#e5e7eb" : "#fff",
  color: disabled ? "#9ca3af" : "#111827",
  cursor: disabled ? "not-allowed" : "pointer",
});

"use client";

import { Fragment, useState } from "react";
import Navigation from "@/components/Navigation";

type BidBoardRow = {
  id?: string | number;
  name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

type BidBoardResponse = {
  success: boolean;
  companyId: string;
  source: string;
  count: number;
  projects: BidBoardRow[];
  error?: string;
};

export default function BidBoardReviewPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BidBoardResponse | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadBidBoard = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/procore/estimating/bid-board-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: 1,
          perPage: 100,
          fetchAll: true,
        }),
      });

      const json = (await response.json()) as BidBoardResponse;
      if (!response.ok || !json.success) {
        setError(json.error || "Failed to load bid board projects");
        setData(null);
        return;
      }

      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <Navigation />
      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "1rem" }}>
          Procore Estimating Bid Board Review
        </h1>

        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1rem",
            display: "flex",
            gap: "0.75rem",
            alignItems: "center",
          }}
        >
          <button
            onClick={loadBidBoard}
            disabled={loading}
            style={{
              padding: "0.6rem 1rem",
              backgroundColor: loading ? "#9ca3af" : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : "Load Bid Board Projects"}
          </button>

          <a
            href="/procore/review/projects"
            style={{ color: "#0f766e", textDecoration: "underline", fontSize: "0.875rem" }}
          >
            Open Project Review
          </a>
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

        {data && (
          <div style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#374151" }}>
            Source: {data.source} | Company: {data.companyId} | Rows: {data.count}
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
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Updated</th>
                  <th style={thStyle}>Raw</th>
                </tr>
              </thead>
              <tbody>
                {data?.projects?.length ? (
                  data.projects.map((row, index) => {
                    const rowId = String(row.id ?? index);
                    const isExpanded = expandedId === rowId;

                    return (
                      <Fragment key={rowId}>
                        <tr style={{ borderTop: "1px solid #e5e7eb" }}>
                          <td style={tdStyle}>{String(row.id ?? "-")}</td>
                          <td style={tdStyle}>{String((row.name as string | undefined) || (row.title as string | undefined) || "-")}</td>
                          <td style={tdStyle}>{renderStatus(row.status)}</td>
                          <td style={tdStyle}>{formatMaybeDate(row.created_at)}</td>
                          <td style={tdStyle}>{formatMaybeDate(row.updated_at)}</td>
                          <td style={tdStyle}>
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : rowId)}
                              style={{
                                padding: "0.35rem 0.6rem",
                                borderRadius: "0.375rem",
                                border: "1px solid #d1d5db",
                                backgroundColor: "#fff",
                                fontSize: "0.75rem",
                                cursor: "pointer",
                              }}
                            >
                              {isExpanded ? "Hide" : "Show"}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} style={{ padding: "0.75rem", backgroundColor: "#f8fafc" }}>
                              <pre
                                style={{
                                  margin: 0,
                                  fontSize: "0.75rem",
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                }}
                              >
                                {JSON.stringify(row, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: "1rem", textAlign: "center", color: "#6b7280" }}>
                      {loading ? "Loading rows..." : "No rows loaded yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderStatus(status: unknown) {
  const value = String(status || "-");
  const normalized = value.toLowerCase();

  let backgroundColor = "#f3f4f6";
  let color = "#111827";

  if (normalized.includes("progress") || normalized.includes("active")) {
    backgroundColor = "#dcfce7";
    color = "#166534";
  } else if (normalized.includes("complete") || normalized.includes("closed")) {
    backgroundColor = "#dbeafe";
    color = "#1e40af";
  } else if (normalized.includes("hold") || normalized.includes("pause")) {
    backgroundColor = "#fef3c7";
    color = "#92400e";
  } else if (normalized.includes("cancel")) {
    backgroundColor = "#fee2e2";
    color = "#991b1b";
  }

  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.2rem 0.45rem",
        borderRadius: "0.375rem",
        backgroundColor,
        color,
        fontWeight: 600,
        fontSize: "0.75rem",
      }}
    >
      {value}
    </span>
  );
}

function formatMaybeDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.75rem",
  fontSize: "0.75rem",
  fontWeight: 700,
  color: "#374151",
};

const tdStyle: React.CSSProperties = {
  padding: "0.75rem",
  fontSize: "0.875rem",
  verticalAlign: "top",
};

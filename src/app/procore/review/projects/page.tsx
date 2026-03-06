"use client";

import { Fragment, useState } from "react";
import Navigation from "@/components/Navigation";

type ProjectRow = {
  id?: string | number;
  name?: string;
  project_number?: string;
  display_name?: string;
  status?: string;
  address?: string;
  city?: string;
  state_code?: string;
  zip?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
};

type ApiResult = {
  success: boolean;
  companyId: string;
  totalProjectsFound: number;
  totalRequested: number;
  totalDetailsFetched: number;
  totalFailed: number;
  failed: Array<{ id: string; error: string }>;
  projects: ProjectRow[];
  error?: string;
};

export default function ProjectReviewPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/procore/projects/all-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: "normal" }),
      });

      const data = (await response.json()) as ApiResult;
      if (!response.ok || !data.success) {
        setError(data.error || "Failed to fetch project details");
        setResult(null);
        return;
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <Navigation />
      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "1rem" }}>
          Procore Project Review
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
            onClick={loadProjects}
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
            {loading ? "Loading..." : "Load All Project Details"}
          </button>

          <a
            href="/procore/review"
            style={{
              color: "#0f766e",
              textDecoration: "underline",
              fontSize: "0.875rem",
            }}
          >
            Open Productivity Review
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

        {result && (
          <div style={{ marginBottom: "1rem", fontSize: "0.9rem", color: "#374151" }}>
            Found: {result.totalProjectsFound} | Fetched: {result.totalDetailsFetched} | Failed: {result.totalFailed}
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
                  <th style={thStyle}>Project #</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Address</th>
                  <th style={thStyle}>City</th>
                  <th style={thStyle}>State</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Updated</th>
                  <th style={thStyle}>Raw</th>
                </tr>
              </thead>
              <tbody>
                {result?.projects?.length ? (
                  result.projects.map((project, index) => {
                    const rowId = String(project.id ?? index);
                    const isExpanded = expandedProjectId === rowId;

                    return (
                      <Fragment key={rowId}>
                        <tr key={`row-${rowId}`} style={{ borderTop: "1px solid #e5e7eb" }}>
                          <td style={tdStyle}>{String(project.id ?? "-")}</td>
                          <td style={tdStyle}>{String(project.project_number ?? "-")}</td>
                          <td style={tdStyle}>{String(project.name ?? "-")}</td>
                          <td style={tdStyle}>
                            {renderStatusBadge(project)}
                          </td>
                          <td style={tdStyle}>{String(project.address ?? "-")}</td>
                          <td style={tdStyle}>{String(project.city ?? "-")}</td>
                          <td style={tdStyle}>{String(project.state_code ?? "-")}</td>
                          <td style={tdStyle}>
                            {project.created_at
                              ? new Date(String(project.created_at)).toLocaleString()
                              : "-"}
                          </td>
                          <td style={tdStyle}>
                            {project.updated_at
                              ? new Date(String(project.updated_at)).toLocaleString()
                              : "-"}
                          </td>
                          <td style={tdStyle}>
                            <button
                              onClick={() => setExpandedProjectId(isExpanded ? null : rowId)}
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
                          <tr key={`raw-${rowId}`}>
                            <td colSpan={10} style={{ padding: "0.75rem", backgroundColor: "#f8fafc" }}>
                              <pre
                                style={{
                                  margin: 0,
                                  fontSize: "0.75rem",
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                }}
                              >
                                {JSON.stringify(project, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={10} style={{ padding: "1rem", textAlign: "center", color: "#6b7280" }}>
                      {loading ? "Loading project rows..." : "No project rows loaded yet."}
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

function getStatusValue(project: ProjectRow): string {
  const projectStatus = project.project_status as
    | { name?: string; display_name?: string }
    | undefined;
  const projectStage = project.project_stage as
    | { name?: string; display_name?: string }
    | undefined;

  const direct =
    (project.status as string | undefined) ||
    (project.stage as string | undefined) ||
    (project.project_status_name as string | undefined) ||
    (project.project_stage_name as string | undefined) ||
    projectStatus?.name ||
    projectStatus?.display_name ||
    projectStage?.name ||
    projectStage?.display_name;

  return (direct || "-").trim();
}

function renderStatusBadge(project: ProjectRow) {
  const status = getStatusValue(project);
  const normalized = status.toLowerCase();

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
      {status || "-"}
    </span>
  );
}

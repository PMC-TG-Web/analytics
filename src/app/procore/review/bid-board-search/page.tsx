"use client";
import React, { useState, useEffect } from "react";
import Navigation from "@/components/Navigation";

interface BidBoardProject {
  id: number | string;
  project_id: number | string;
  name: string;
  project_number: string;
  status: string;
  created_at: string;
  v1ProjectStatus?: string; // New field for comparison
  raw?: any;
}

export default function BidBoardReviewPage() {
  const [projects, setProjects] = useState<BidBoardProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | number | null>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      // Step 1: Fetch Bid Board Projects
      const response = await fetch("/api/procore/estimating/bid-board-project-by-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          projectId: "0", 
          accessToken: "" 
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch bid board projects");
      }
      
      const bidBoardData: BidBoardProject[] = data.allProjectInfo || [];

      // Step 2: Fetch standard V1 projects to get statuses
      const v1Response = await fetch("/api/procore/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          accessToken: "", 
          fetchAll: true 
        }),
      });

      if (!v1Response.ok) {
        // Log error but don't fail the whole page if just status matching fails
        console.error("Failed to fetch V1 projects for status mapping");
      }
      
      const v1DataRaw = await v1Response.json().catch(() => ({}));
      const v1Data = v1DataRaw.projects || [];
      
      const v1Map = new Map();
      if (Array.isArray(v1Data)) {
        v1Data.forEach((p: any) => {
          const s = p.status || p.project_status?.name || p.project_stage?.name || "Unknown";
          const name = p.name || p.projectName || p.display_name || "";
          const customer = p.customer_name || p.customer || (p.company && p.company.name) || "";
          v1Map.set(String(p.id), { status: s, name, customer });
          
          // Also map by name for faster fuzzy lookup
          if (name) v1Map.set(`name_${name.toLowerCase().trim()}`, { status: s, name, customer });
        });
      }

      // Step 4: Merge status into Bid Board items
      const enriched = bidBoardData.map(bb => {
        const procoreProjectId = String(bb.project_id || "");
        const bidName = (bb.name || "").toLowerCase().trim();
        
        // 1. Precise ID match
        let statusObj = v1Map.get(procoreProjectId);
        let statusText = statusObj ? statusObj.status : "No mapping Project";
        
        // 2. Exact name match
        if (statusText === "No mapping Project" && bidName) {
          const nameMatch = v1Map.get(`name_${bidName}`);
          if (nameMatch) statusText = `${nameMatch.status} (Exact Name Match)`;
        }

        // 3. Fuzzy name match
        if (statusText === "No mapping Project") {
          for (const [key, v1Val] of v1Map.entries()) {
            if (key.startsWith("name_")) continue; // Skip the name-prefixed keys
            const v1Name = (v1Val.name || "").toLowerCase().trim();
            if (v1Name && bidName && (v1Name.includes(bidName) || bidName.includes(v1Name))) {
              statusText = `${v1Val.status} (Fuzzy Match)`;
              break;
            }
          }
        }

        return {
          ...bb,
          v1ProjectStatus: statusText
        };
      });

      setProjects(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (id: string | number) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  const renderStatus = (status: string) => {
    const s = status?.toLowerCase() || "";
    let color = "#6b7280"; // Gray
    let bg = "#f3f4f6";

    if (s.includes("won") || s.includes("active") || s.includes("progress")) {
      color = "#047857"; // Green
      bg = "#d1fae5";
    } else if (s.includes("lost") || s.includes("abandoned")) {
      color = "#b91c1c"; // Red
      bg = "#fee2e2";
    } else if (s.includes("bidding") || s.includes("pending")) {
      color = "#b45309"; // Amber
      bg = "#fef3c7";
    }

    return (
      <span style={{
        padding: "0.25rem 0.75rem",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: "600",
        color,
        backgroundColor: bg,
        textTransform: "capitalize"
      }}>
        {status || "Unknown"}
      </span>
    );
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <Navigation />
      
      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.875rem", fontWeight: "bold" }}>
             Estimating Bid Board Results ({projects.length})
          </h1>
          <button 
            onClick={fetchProjects}
            disabled={loading}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "#2563eb",
              color: "white",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer"
            }}
          >
            {loading ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>

        {error && (
          <div style={{ backgroundColor: "#fef2f2", border: "1px solid #ef4444", padding: "1rem", borderRadius: "0.5rem", marginBottom: "1.5rem", color: "#b91c1c" }}>
            <strong>Error:</strong> {error}
          </div>
        )}

        <div style={{ backgroundColor: "white", borderRadius: "0.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
              <tr>
                <th style={{ padding: "1rem", fontWeight: "600", color: "#374151" }}>Name</th>
                <th style={{ padding: "1rem", fontWeight: "600", color: "#374151" }}>Customer</th>
                <th style={{ padding: "1rem", fontWeight: "600", color: "#374151" }}>Bid ID</th>
                <th style={{ padding: "1rem", fontWeight: "600", color: "#374151" }}>Project ID</th>
                <th style={{ padding: "1rem", fontWeight: "600", color: "#374151" }}>Project #</th>
                <th style={{ padding: "1rem", fontWeight: "600", color: "#374151" }}>Bid Status</th>
                <th style={{ padding: "1rem", fontWeight: "600", color: "#374151" }}>Project Status</th>
                <th style={{ padding: "1rem", fontWeight: "600", color: "#374151" }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && projects.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>
                    Loading projects...
                  </td>
                </tr>
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "3rem", textAlign: "center", color: "#6b7280" }}>
                    No projects found in the Bid Board.
                  </td>
                </tr>
              ) : (
                projects.map((project) => (
                  <React.Fragment key={project.id}>
                    <tr 
                      onClick={() => toggleRow(project.id)}
                      style={{ 
                        borderBottom: "1px solid #e5e7eb", 
                        cursor: "pointer", 
                        transition: "background-color 0.2s",
                        backgroundColor: String(project.id) === "598134326376806" ? "#fffbeb" : "transparent"
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = String(project.id) === "598134326376806" ? "#fffbeb" : "transparent")}
                    >
                      <td style={{ padding: "1rem", fontWeight: "500" }}>{project.name}</td>
                      <td style={{ padding: "1rem" }}>
                        {project.raw?.client?.name || project.raw?.company?.name || "---"}
                        {String(project.id) === "598134326376806" && !project.raw?.client?.name && (
                          <div style={{ fontSize: "0.65rem", color: "#6b7280" }}> (Checking ID...) </div>
                        )}
                      </td>
                      <td style={{ padding: "1rem", fontFamily: "monospace", fontSize: "0.875rem" }}>{project.id}</td>
                      <td style={{ padding: "1rem", fontFamily: "monospace", fontSize: "0.875rem" }}>{project.project_id || "N/A"}</td>
                      <td style={{ padding: "1rem" }}>{project.project_number || "---"}</td>
                      <td style={{ padding: "1rem" }}>{renderStatus(project.status)}</td>
                      <td style={{ padding: "1rem" }}>{renderStatus(project.v1ProjectStatus || "None")}</td>
                      <td style={{ padding: "1rem", color: "#6b7280", fontSize: "0.875rem" }}>
                        {project.created_at ? new Date(project.created_at).toLocaleDateString() : "---"}
                      </td>
                    </tr>
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

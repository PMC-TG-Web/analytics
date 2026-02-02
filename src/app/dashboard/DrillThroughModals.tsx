import React, { useState, useEffect } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";

type Project = {
  id: string;
  projectNumber?: string;
  projectName?: string;
  customer?: string;
  status?: string;
  sales?: number;
  cost?: number;
  hours?: number;
  laborSales?: number;
  laborCost?: number;
  dateUpdated?: string;
  dateCreated?: string;
  estimator?: string;
  pmcGroup?: string;
  costitems?: string;
  costType?: string;
  quantity?: number;
  [key: string]: any;
};

interface JobsListModalProps {
  isOpen: boolean;
  projects: Project[];
  title: string;
  onClose: () => void;
  onSelectProject: (project: Project) => void;
}

export function JobsListModal({
  isOpen,
  projects,
  title,
  onClose,
  onSelectProject,
}: JobsListModalProps) {
  const [searchTerm, setSearchTerm] = useState("");

  if (!isOpen) return null;

  const filteredProjects = projects.filter(
    (p) =>
      (p.projectNumber ?? "").toString().toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.projectName ?? "").toString().toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.customer ?? "").toString().toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 20px 25px rgba(0, 0, 0, 0.3)",
          maxWidth: 700,
          width: "90%",
          maxHeight: "80vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "24px 32px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, color: "#003DA5", fontSize: 20 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 24,
              cursor: "pointer",
              color: "#666",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "16px 32px" }}>
          <input
            type="text"
            placeholder="Search by project number, name, or customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 32px",
          }}
        >
          {filteredProjects.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "#999" }}>
              {projects.length === 0 ? "No projects" : "No matching projects"}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8, paddingBottom: 16 }}>
              {filteredProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    onSelectProject(project);
                  }}
                  style={{
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: "12px 16px",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "#f0f4f8";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#0066CC";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "#f9fafb";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#e5e7eb";
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 16,
                      marginBottom: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, color: "#666" }}>Project Number</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#003DA5" }}>
                        {project.projectNumber || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "#666" }}>Customer</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#222" }}>
                        {project.customer || "N/A"}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 16,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, color: "#666" }}>Project Name</div>
                      <div style={{ fontSize: 13, color: "#222" }}>
                        {project.projectName || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "#666" }}>Status</div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "#fff",
                          display: "inline-block",
                          background: getStatusColor(project.status),
                          padding: "2px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {project.status || "Unknown"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "#666" }}>Sales</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#0066CC" }}>
                        ${(project.sales ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface JobDetailsModalProps {
  isOpen: boolean;
  project: Project | null;
  onClose: () => void;
}

export function JobDetailsModal({ isOpen, project, onClose }: JobDetailsModalProps) {
  const [lineItems, setLineItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "cost" | "sales">("name");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen && project?.projectNumber) {
      fetchLineItems();
    }
  }, [isOpen, project?.projectNumber]);

  const fetchLineItems = async () => {
    if (!project?.projectNumber) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, "projects"),
        where("projectNumber", "==", project.projectNumber)
      );
      const snapshot = await getDocs(q);
      const projectDocs = snapshot.docs;
      
      if (projectDocs.length > 0) {
        const projectData = projectDocs[0].data();
        // Use the items array from the project document if it exists
        if (projectData.items && Array.isArray(projectData.items)) {
          setLineItems(projectData.items as Project[]);
        } else {
          // Fallback to treating the document itself as a line item
          setLineItems([
            {
              id: projectDocs[0].id,
              ...projectData,
            } as Project,
          ]);
        }
      }
    } catch (error) {
      console.error("Error fetching line items:", error);
    } finally {
      setLoading(false);
    }
  };

  const groupByType = (items: Project[]) => {
    return items.reduce(
      (acc, item) => {
        const type = (item.costType || "Unassigned") as string;
        if (!acc[type]) acc[type] = [];
        acc[type].push(item);
        return acc;
      },
      {} as Record<string, Project[]>
    );
  };

  const sortItems = (items: Project[]) => {
    return [...items].sort((a, b) => {
      switch (sortBy) {
        case "name":
          return ((a.costitems || "") as string).localeCompare(
            (b.costitems || "") as string
          );
        case "cost":
          return (b.cost ?? 0) - (a.cost ?? 0);
        case "sales":
          return (b.sales ?? 0) - (a.sales ?? 0);
        default:
          return 0;
      }
    });
  };

  const toggleGroup = (type: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [type]: !prev[type],
    }));
  };

  if (!isOpen || !project) return null;

  const formatDate = (dateValue: any) => {
    if (!dateValue) return "N/A";
    const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const details = [
    { label: "Project Number", value: project.projectNumber },
    { label: "Project Name", value: project.projectName },
    { label: "Customer", value: project.customer },
    { label: "Estimator", value: project.estimator },
    { label: "Status", value: project.status, isBadge: true },
    { label: "Project Stage", value: project.projectStage },
    { label: "Cost Item", value: project.costitems },
    { label: "Cost Type", value: project.costType },
    { label: "Date Created", value: formatDate(project.dateCreated) },
    { label: "Date Updated", value: formatDate(project.dateUpdated) },
  ];

  const metrics = [
    { label: "Sales", value: project.sales, prefix: "$", decimals: 0 },
    { label: "Cost", value: project.cost, prefix: "$", decimals: 0 },
    { label: "Hours", value: project.hours, decimals: 0 },
    { label: "Labor Sales", value: project.laborSales, prefix: "$", decimals: 0 },
    { label: "Labor Cost", value: project.laborCost, prefix: "$", decimals: 0 },
    { label: "Quantity", value: project.quantity, decimals: 2 },
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1001,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: 12,
          boxShadow: "0 20px 25px rgba(0, 0, 0, 0.3)",
          maxWidth: 900,
          width: "90%",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "24px 32px",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h2 style={{ margin: "0 0 8px 0", color: "#003DA5", fontSize: 20 }}>
              {project.projectNumber}
            </h2>
            <p style={{ margin: 0, color: "#666", fontSize: 14 }}>
              {project.projectName}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 24,
              cursor: "pointer",
              color: "#666",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "32px",
          }}
        >
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ color: "#003DA5", fontSize: 16, marginBottom: 16 }}>
              Key Metrics
            </h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 16,
              }}
            >
              {metrics
                .filter((m) => m.value !== null && m.value !== undefined)
                .map((metric) => {
                  const val = typeof metric.value === "number" ? metric.value : 0;
                  const formatted = val.toLocaleString(undefined, {
                    minimumFractionDigits: metric.decimals || 0,
                    maximumFractionDigits: metric.decimals || 0,
                  });

                  return (
                    <div
                      key={metric.label}
                      style={{
                        background: "#f9fafb",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        padding: "12px 16px",
                      }}
                    >
                      <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                        {metric.label}
                      </div>
                      <div
                        style={{
                          fontSize: 16,
                          fontWeight: 600,
                          color:
                            metric.label === "Sales" || metric.label === "Labor Sales"
                              ? "#0066CC"
                              : "#222",
                        }}
                      >
                        {metric.prefix && metric.prefix}
                        {formatted}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Line Items Section */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ color: "#003DA5", fontSize: 16, margin: 0 }}>
                Line Items {loading && <span style={{ fontSize: 12, color: "#999" }}>(Loading...)</span>}
              </h3>
              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ fontSize: 12, color: "#666" }}>
                  Sort by:
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "name" | "cost" | "sales")}
                    style={{
                      marginLeft: 8,
                      padding: "4px 8px",
                      border: "1px solid #e5e7eb",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <option value="name">Cost Item Name</option>
                    <option value="cost">Cost (High to Low)</option>
                    <option value="sales">Sales (High to Low)</option>
                  </select>
                </label>
              </div>
            </div>

            {lineItems.length === 0 ? (
              <div style={{ color: "#999", padding: "20px", textAlign: "center" }}>
                No line items found
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {Object.entries(groupByType(lineItems)).map(([costType, items]) => {
                  const sortedItems = sortItems(items);
                  const isExpanded = expandedGroups[costType] !== false;
                  const totalSales = sortedItems.reduce((sum, item) => sum + (item.sales ?? 0), 0);
                  const totalCost = sortedItems.reduce((sum, item) => sum + (item.cost ?? 0), 0);

                  return (
                    <div
                      key={costType}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        overflow: "hidden",
                      }}
                    >
                      {/* Group Header */}
                      <div
                        onClick={() => toggleGroup(costType)}
                        style={{
                          background: "#003DA5",
                          color: "#fff",
                          padding: "12px 16px",
                          cursor: "pointer",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600 }}>{costType}</span>
                          <span style={{ fontSize: 12, marginLeft: 12, opacity: 0.8 }}>
                            {sortedItems.length} items
                          </span>
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                          Sales: ${totalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })} | Cost: $
                          {totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                        <span style={{ fontSize: 16 }}>{isExpanded ? "▼" : "▶"}</span>
                      </div>

                      {/* Group Content */}
                      {isExpanded && (
                        <div style={{ overflowX: "auto" }}>
                          <table
                            style={{
                              width: "100%",
                              borderCollapse: "collapse",
                              background: "#fff",
                            }}
                          >
                            <thead>
                              <tr style={{ borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
                                <th
                                  style={{
                                    padding: "10px 16px",
                                    textAlign: "left",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#666",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Cost Item
                                </th>
                                <th
                                  style={{
                                    padding: "10px 16px",
                                    textAlign: "right",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#666",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Quantity
                                </th>
                                <th
                                  style={{
                                    padding: "10px 16px",
                                    textAlign: "right",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#666",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Sales
                                </th>
                                <th
                                  style={{
                                    padding: "10px 16px",
                                    textAlign: "right",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#666",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Cost
                                </th>
                                <th
                                  style={{
                                    padding: "10px 16px",
                                    textAlign: "right",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#666",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Margin
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortedItems.map((item, index) => {
                                const margin = (item.sales ?? 0) - (item.cost ?? 0);
                                return (
                                  <tr
                                    key={item.id || index}
                                    style={{
                                      borderBottom: "1px solid #e5e7eb",
                                      background: index % 2 === 0 ? "#fff" : "#f9fafb",
                                    }}
                                  >
                                    <td style={{ padding: "10px 16px", fontSize: 13, color: "#222" }}>
                                      {item.costitems || "—"}
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 16px",
                                        fontSize: 13,
                                        color: "#222",
                                        textAlign: "right",
                                      }}
                                    >
                                      {item.quantity
                                        ? (Number(item.quantity) || 0).toLocaleString(undefined, {
                                            maximumFractionDigits: 2,
                                          })
                                        : "—"}
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 16px",
                                        fontSize: 13,
                                        color: "#0066CC",
                                        fontWeight: 600,
                                        textAlign: "right",
                                      }}
                                    >
                                      ${(item.sales ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 16px",
                                        fontSize: 13,
                                        color: "#f59e0b",
                                        fontWeight: 600,
                                        textAlign: "right",
                                      }}
                                    >
                                      ${(item.cost ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </td>
                                    <td
                                      style={{
                                        padding: "10px 16px",
                                        fontSize: 13,
                                        color: margin >= 0 ? "#10b981" : "#ef4444",
                                        fontWeight: 600,
                                        textAlign: "right",
                                      }}
                                    >
                                      ${margin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h3 style={{ color: "#003DA5", fontSize: 16, marginBottom: 16 }}>
              Project Details
            </h3>
            <div style={{ display: "grid", gap: 12 }}>
              {details
                .filter((d) => d.value !== null && d.value !== undefined)
                .map((detail) => (
                  <div
                    key={detail.label}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "200px 1fr",
                      gap: 16,
                      padding: "12px 0",
                      borderBottom: "1px solid #f0f0f0",
                    }}
                  >
                    <div style={{ fontSize: 13, color: "#666", fontWeight: 500 }}>
                      {detail.label}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "#222",
                        wordBreak: "break-word",
                      }}
                    >
                      {detail.isBadge ? (
                        <span
                          style={{
                            display: "inline-block",
                            background: getStatusColor(detail.value),
                            color: "#fff",
                            padding: "4px 8px",
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          {detail.value}
                        </span>
                      ) : (
                        detail.value || "N/A"
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getStatusColor(status?: string): string {
  const statusMap: Record<string, string> = {
    Estimating: "#6366f1",
    "Bid Submitted": "#0066CC",
    Accepted: "#10b981",
    "In Progress": "#f59e0b",
    Complete: "#059669",
    Lost: "#ef4444",
  };
  return statusMap[status || ""] || "#6b7280";
}

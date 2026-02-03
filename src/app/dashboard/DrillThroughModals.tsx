import React, { useState, useEffect } from "react";
import { getProjectLineItems, type Project } from "./projectQueries";

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
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: "#666" }}>Project Name</div>
                    <div style={{ fontSize: 13, color: "#222" }}>
                      {project.projectName || "N/A"}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr 1fr",
                      gap: 16,
                    }}
                  >
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
                    <div>
                      <div style={{ fontSize: 12, color: "#666" }}>Cost</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#f59e0b" }}>
                        ${(project.cost ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "#666" }}>Markup %</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#10b981" }}>
                        {project.cost && project.cost > 0
                          ? (((project.sales ?? 0) - project.cost) / project.cost * 100).toFixed(1)
                          : "0.0"}%
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
    if (isOpen && project?.projectNumber && project?.projectName && project?.customer) {
      fetchLineItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, project?.projectNumber, project?.projectName, project?.customer]);

  const fetchLineItems = async () => {
    if (!project?.projectNumber || !project?.projectName || !project?.customer) return;
    setLoading(true);
    try {
      const items = await getProjectLineItems(
        project.projectNumber,
        project.projectName,
        project.customer
      );
      setLineItems(items);
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

  // Aggregate line items by cost type
  const aggregateByType = (items: Project[], type: string) => {
    return items
      .filter(item => item.costType === type)
      .reduce(
        (acc, item) => ({
          sales: (acc.sales || 0) + (item.sales || 0),
          cost: (acc.cost || 0) + (item.cost || 0),
        }),
        { sales: 0, cost: 0 }
      );
  };

  // Aggregate all items except Management/Supervisor
  const aggregateWithoutManagement = (items: Project[]) => {
    return items
      .filter(item => item.costType !== "Management" && item.costType !== "Supervisor")
      .reduce(
        (acc, item) => ({
          sales: (acc.sales || 0) + (item.sales || 0),
          cost: (acc.cost || 0) + (item.cost || 0),
        }),
        { sales: 0, cost: 0 }
      );
  };

  // Sum hours without PM
  const hoursWithoutPM = React.useMemo(() => 
    lineItems
      .filter(item => item.costType !== "PM")
      .reduce((sum, item) => sum + (item.hours || 0), 0),
    [lineItems]
  );

  const laborAgg = React.useMemo(() => aggregateByType(lineItems, "Labor"), [lineItems]);
  const subsAgg = React.useMemo(() => aggregateByType(lineItems, "Subcontractor"), [lineItems]);
  const withoutMgmtAgg = React.useMemo(() => aggregateWithoutManagement(lineItems), [lineItems]);
  const partsAgg = React.useMemo(() => aggregateByType(lineItems, "Part"), [lineItems]);
  const equipmentAgg = React.useMemo(() => aggregateByType(lineItems, "Equipment"), [lineItems]);

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
    { label: "Date Created", value: formatDate(project.dateCreated) },
    { label: "Date Updated", value: formatDate(project.dateUpdated) },
  ];

  const metrics = [
    { label: "Sales", value: project.sales, prefix: "$", decimals: 0 },
    { label: "Cost", value: project.cost, prefix: "$", decimals: 0 },
    { label: "Profit", value: (project.sales ?? 0) - (project.cost ?? 0), prefix: "$", decimals: 0 },
    { label: "Cost Markup %", value: project.cost && project.cost > 0 ? (((project.sales ?? 0) - project.cost) / project.cost * 100) : 0, suffix: "%", decimals: 1 },
    { label: "Profit/Hour (w/o Mgmt)", value: hoursWithoutPM > 0 ? (withoutMgmtAgg.sales - withoutMgmtAgg.cost) / hoursWithoutPM : 0, prefix: "$", decimals: 2 },
    { label: "Hours", value: project.hours, decimals: 0 },
    { label: "Labor Profit", value: laborAgg.sales - laborAgg.cost, prefix: "$", decimals: 0 },
    { label: "Labor Markup %", value: laborAgg.cost && laborAgg.cost > 0 ? (((laborAgg.sales ?? 0) - laborAgg.cost) / laborAgg.cost * 100) : 0, suffix: "%", decimals: 1 },
    { label: "Subs Markup %", value: subsAgg.cost && subsAgg.cost > 0 ? (((subsAgg.sales ?? 0) - subsAgg.cost) / subsAgg.cost * 100) : 0, suffix: "%", decimals: 1 },
    { label: "Parts Markup %", value: partsAgg.cost && partsAgg.cost > 0 ? (((partsAgg.sales ?? 0) - partsAgg.cost) / partsAgg.cost * 100) : 0, suffix: "%", decimals: 1 },
    { label: "Equipment Markup %", value: equipmentAgg.cost && equipmentAgg.cost > 0 ? (((equipmentAgg.sales ?? 0) - equipmentAgg.cost) / equipmentAgg.cost * 100) : 0, suffix: "%", decimals: 1 },
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
                              : metric.label === "Markup %"
                              ? "#10b981"
                              : "#222",
                        }}
                      >
                        {metric.prefix && metric.prefix}
                        {formatted}
                        {metric.suffix && metric.suffix}
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
                                  Markup %
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
                                    <td
                                      style={{
                                        padding: "10px 16px",
                                        fontSize: 13,
                                        color: "#10b981",
                                        fontWeight: 600,
                                        textAlign: "right",
                                      }}
                                    >
                                      {item.cost && item.cost > 0
                                        ? (((item.sales ?? 0) - item.cost) / item.cost * 100).toFixed(1)
                                        : "0.0"}%
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

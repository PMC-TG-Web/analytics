"use client";

import React, { useState, useEffect, useMemo } from "react";
import { getProjectLineItems } from "../projectQueries";
import { Project } from "@/types";

interface JobDetailsModalProps {
  isOpen: boolean;
  project: Project | null;
  onClose: () => void;
  onBack?: () => void;
  onStatusUpdate?: () => void;
}

export function JobDetailsModal({ isOpen, project, onClose, onBack, onStatusUpdate }: JobDetailsModalProps) {
  const [lineItems, setLineItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "cost" | "sales">("name");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [newStatus, setNewStatus] = useState(project?.status || "");
  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{type: "success" | "error"; text: string} | null>(null);

  const statusOptions = [
    "Estimating",
    "Bid Submitted",
    "Accepted",
    "In Progress",
    "Complete",
    "Delayed",
    "Lost",
  ];

  useEffect(() => {
    // FIX Issue #1 & #2: Ensure all required fields exist before fetching
    if (isOpen && project?.projectNumber && project?.projectName && project?.customer) {
      const fetchLineItems = async () => {
        setLoading(true);
        try {
          const items = await getProjectLineItems(
            project.projectNumber!,
            project.projectName!,
            project.customer!
          );
          setLineItems(items);
          setNewStatus(project.status || "");
          setUpdateMessage(null);
        } catch (error) {
          console.error("Error fetching line items:", error);
        } finally {
          setLoading(false);
        }
      };
      fetchLineItems();
    }
  }, [isOpen, project?.projectNumber, project?.projectName, project?.customer, project?.status]);

  // FIX Issue #3: Use useMemo for all aggregations
  const groupedItems = useMemo(() => {
    return lineItems.reduce((acc, item) => {
      const type = (item.costType || "Unassigned") as string;
      if (!acc[type]) acc[type] = [];
      acc[type].push(item);
      return acc;
    }, {} as Record<string, Project[]>);
  }, [lineItems]);

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

  const laborAgg = useMemo(() => aggregateByType(lineItems, "Labor"), [lineItems]);
  const subsAgg = useMemo(() => aggregateByType(lineItems, "Subcontractor"), [lineItems]);
  const partsAgg = useMemo(() => aggregateByType(lineItems, "Part"), [lineItems]);
  const equipmentAgg = useMemo(() => aggregateByType(lineItems, "Equipment"), [lineItems]);
  
  const withoutMgmtAgg = useMemo(() => {
    return lineItems
      .filter(item => item.costType !== "Management" && item.costType !== "Supervisor")
      .reduce(
        (acc, item) => ({
          sales: (acc.sales || 0) + (item.sales || 0),
          cost: (acc.cost || 0) + (item.cost || 0),
        }),
        { sales: 0, cost: 0 }
      );
  }, [lineItems]);

  const hoursWithoutPM = useMemo(() => 
    lineItems
      .filter(item => item.costType !== "PM" && item.costType !== "Management")
      .reduce((sum, item) => sum + (item.hours || 0), 0),
    [lineItems]
  );

  const toggleGroup = (type: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [type]: !prev[type],
    }));
  };

  const handleStatusUpdate = async () => {
    if (!project?.id || newStatus === project.status) {
      setUpdateMessage({ type: "error", text: "No changes to update" });
      return;
    }

    setUpdating(true);
    try {
      const response = await fetch("/api/updateProjectStatus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          newStatus: newStatus,
          projectNumber: project.projectNumber,
          projectName: project.projectName,
          customer: project.customer,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update status");
      }

      setUpdateMessage({ type: "success", text: `Status updated to "${newStatus}"` });
      setTimeout(() => setUpdateMessage(null), 3000);
      
      // Trigger parent refresh
      if (onStatusUpdate) {
        onStatusUpdate();
      }
    } catch (error) {
      console.error("Error updating status:", error);
      setUpdateMessage({ type: "error", text: "Failed to update status. Try again." });
    } finally {
      setUpdating(false);
    }
  };

  if (!isOpen || !project) return null;

  const formatDate = (dateValue: unknown) => {
    if (!dateValue) return "—";
    
    let d: Date;
    if (typeof dateValue === "object" && dateValue !== null && "toDate" in dateValue && typeof (dateValue as any).toDate === "function") {
      d = (dateValue as any).toDate();
    } else if (dateValue instanceof Date) {
      d = dateValue;
    } else {
      d = new Date(dateValue as string | number);
    }
    
    if (!(d instanceof Date) || isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const metrics = [
    { label: "Sales", value: project.sales, prefix: "$", decimals: 0 },
    { label: "Cost", value: project.cost, prefix: "$", decimals: 0 },
    { label: "Profit", value: (project.sales ?? 0) - (project.cost ?? 0), prefix: "$", decimals: 0 },
    { label: "Markup %", value: project.cost && project.cost > 0 ? (((project.sales ?? 0) - project.cost) / project.cost * 100) : 0, suffix: "%", decimals: 1 },
    { label: "Profit/Hr (net)", value: hoursWithoutPM > 0 ? (withoutMgmtAgg.sales - withoutMgmtAgg.cost) / hoursWithoutPM : 0, prefix: "$", decimals: 2 },
    { label: "Total Labor Hrs", value: project.hours, decimals: 0 },
    { label: "Labor Markup %", value: laborAgg.cost && laborAgg.cost > 0 ? (((laborAgg.sales ?? 0) - laborAgg.cost) / laborAgg.cost * 100) : 0, suffix: "%", decimals: 1 },
    { label: "Subs Markup %", value: subsAgg.cost && subsAgg.cost > 0 ? (((subsAgg.sales ?? 0) - subsAgg.cost) / subsAgg.cost * 100) : 0, suffix: "%", decimals: 1 },
    { label: "Parts Markup %", value: partsAgg.cost && partsAgg.cost > 0 ? (((partsAgg.sales ?? 0) - partsAgg.cost) / partsAgg.cost * 100) : 0, suffix: "%", decimals: 1 },
    { label: "Equip Markup %", value: equipmentAgg.cost && equipmentAgg.cost > 0 ? (((equipmentAgg.sales ?? 0) - equipmentAgg.cost) / equipmentAgg.cost * 100) : 0, suffix: "%", decimals: 1 },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1001]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-[95%] max-h-[95vh] overflow-hidden flex flex-col">
        <div className="px-8 py-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <div className="flex items-center gap-6">
            {onBack && (
              <button
                onClick={onBack}
                className="bg-white border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
              >
                ← Back
              </button>
            )}
            <div>
              <h2 className="m-0 text-[#15616D] text-2xl font-bold">
                {project.projectNumber} - {project.projectName}
              </h2>
              <p className="m-0 text-gray-500 font-medium">
                {project.customer} • {project.status}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-3xl text-gray-400 hover:text-gray-600 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
            {metrics.map((m) => (
              <div key={m.label} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-1 whitespace-nowrap overflow-hidden text-ellipsis">{m.label}</div>
                <div className="text-lg font-bold text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis">
                  {m.prefix}{(m.value ?? 0).toLocaleString(undefined, { 
                    minimumFractionDigits: m.decimals, 
                    maximumFractionDigits: m.decimals 
                  })}{m.suffix}
                </div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-8 mb-10">
            <div className="lg:col-span-1 bg-gray-50 rounded-xl p-6 border border-gray-200">
              <h3 className="text-[#15616D] font-bold mb-4 uppercase text-xs tracking-widest">Project Metadata</h3>
              <div className="space-y-4">
                {[
                  { l: "Estimator", v: project.estimator },
                  { l: "Project Manager", v: project.projectManager },
                  { l: "Project Stage", v: project.projectStage },
                  { l: "Created", v: formatDate(project.dateCreated) },
                  { l: "Updated", v: formatDate(project.dateUpdated) },
                ].map(item => (
                  <div key={item.l} className="flex justify-between border-b border-gray-100 pb-2">
                    <span className="text-sm text-gray-500">{item.l}</span>
                    <span className="text-sm font-semibold text-gray-900">{item.v || "—"}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-[#15616D] font-bold mb-4 uppercase text-xs tracking-widest">Update Status</h3>
                <div className="space-y-3">
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-[#15616D]"
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleStatusUpdate}
                    disabled={updating || newStatus === project.status}
                    className="w-full px-4 py-2 bg-[#15616D] text-white font-semibold rounded-lg hover:bg-[#0d3d4a] disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    {updating ? "Updating..." : "Update Status"}
                  </button>
                  {updateMessage && (
                    <div className={`text-xs p-2 rounded-lg text-center font-medium ${
                      updateMessage.type === "success" 
                        ? "bg-green-50 text-green-700 border border-green-200" 
                        : "bg-red-50 text-red-700 border border-red-200"
                    }`}>
                      {updateMessage.text}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-[#15616D] font-bold uppercase text-xs tracking-widest">Line Item Detail</h3>
                <div className="flex gap-2">
                  <span className="text-xs text-gray-500">Sort by:</span>
                  {(["name", "cost", "sales"] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setSortBy(s)}
                      className={`text-xs px-2 py-1 rounded transition-colors ${sortBy === s ? 'bg-[#15616D] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="py-20 text-center text-gray-400 font-medium italic">Loading line items...</div>
              ) : Object.keys(groupedItems).length === 0 ? (
                <div className="py-20 text-center text-gray-400 font-medium italic">No line items found.</div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(groupedItems).sort().map(([type, items]) => {
                    const sortedItems = [...items].sort((a, b) => {
                      if (sortBy === "name") return (a.costitems || "").toString().localeCompare((b.costitems || "").toString());
                      if (sortBy === "cost") return (b.cost || 0) - (a.cost || 0);
                      return (b.sales || 0) - (a.sales || 0);
                    });
                    const isExpanded = expandedGroups[type];
                    const typeSales = items.reduce((sum, i) => sum + (i.sales || 0), 0);
                    const typeCost = items.reduce((sum, i) => sum + (i.cost || 0), 0);

                    return (
                      <div key={type} className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                        <button
                          onClick={() => toggleGroup(type)}
                          className="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className={`transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                            <span className="font-bold text-gray-800">{type} ({items.length})</span>
                          </div>
                          <div className="flex gap-6 text-sm">
                            <span className="text-blue-600 font-semibold">${typeSales.toLocaleString()} sales</span>
                            <span className="text-orange-600 font-semibold">${typeCost.toLocaleString()} cost</span>
                            <span className="text-emerald-600 font-bold">
                              {typeCost > 0 ? (((typeSales - typeCost) / typeCost) * 100).toFixed(1) : "0.0"}%
                            </span>
                          </div>
                        </button>
                        
                        {isExpanded && (
                          <div className="bg-gray-50 border-t border-gray-100 p-2">
                            <table className="w-full text-left text-xs">
                              <thead>
                                <tr className="text-gray-500 uppercase tracking-tighter border-b border-gray-200">
                                  <th className="p-2">Description</th>
                                  <th className="p-2 text-right">Qty</th>
                                  <th className="p-2 text-right">Hours</th>
                                  <th className="p-2 text-right">Cost</th>
                                  <th className="p-2 text-right">Sales</th>
                                  <th className="p-2 text-right">Markup %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sortedItems.map((item, idx) => {
                                  const m = item.cost && item.cost > 0 ? ((item.sales || 0) - item.cost) / item.cost * 100 : 0;
                                  return (
                                    <tr key={`${type}-${idx}`} className="hover:bg-white transition-colors">
                                      <td className="p-2 font-medium text-gray-700">{item.costitems || "Unknown"}</td>
                                      <td className="p-2 text-right">{(item.quantity || 0).toLocaleString()}</td>
                                      <td className="p-2 text-right">{(item.hours || 0).toLocaleString()}</td>
                                      <td className="p-2 text-right text-orange-600">${(item.cost || 0).toLocaleString()}</td>
                                      <td className="p-2 text-right text-blue-600">${(item.sales || 0).toLocaleString()}</td>
                                      <td className="p-2 text-right text-emerald-600 font-semibold">{m.toFixed(1)}%</td>
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
          </div>
        </div>
      </div>
    </div>
  );
}

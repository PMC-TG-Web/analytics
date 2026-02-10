"use client";

import React, { useState } from "react";
import { Project } from "@/types";

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

  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case "Accepted":
        return "#10B981";
      case "In Progress":
        return "#3B82F6";
      case "Complete":
        return "#6B7280";
      case "Bid Submitted":
        return "#F59E0B";
      case "Lost":
        return "#EF4444";
      default:
        return "#9CA3AF";
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-[90%] max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-8 py-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="m-0 text-[#15616D] text-xl font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-2xl cursor-pointer text-gray-500 hover:text-gray-700"
          >
            ×
          </button>
        </div>

        <div className="px-8 py-4">
          <input
            type="text"
            placeholder="Search by project number, name, or customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#15616D] focus:border-transparent"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-8 pb-4">
          {filteredProjects.length === 0 ? (
            <div className="py-8 text-center text-gray-400">
              {projects.length === 0 ? "No projects" : "No matching projects"}
            </div>
          ) : (
            <div className="grid gap-2">
              {filteredProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => onSelectProject(project)}
                  className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-left cursor-pointer transition-all hover:bg-gray-100 hover:border-[#15616D] group"
                >
                  <div className="grid grid-cols-2 gap-4 mb-2">
                    <div>
                      <div className="text-xs text-gray-500">Project Number</div>
                      <div className="text-sm font-semibold text-[#15616D]">
                        {project.projectNumber || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Customer</div>
                      <div className="text-sm font-semibold text-gray-900 line-clamp-1">
                        {project.customer || "N/A"}
                      </div>
                    </div>
                  </div>
                  <div className="mb-2">
                    <div className="text-xs text-gray-500">Project Name</div>
                    <div className="text-sm text-gray-900 line-clamp-1 italic">
                      {project.projectName || "N/A"}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Status</div>
                      <div
                        className="text-[11px] text-white px-2 py-0.5 rounded font-medium inline-block"
                        style={{ backgroundColor: getStatusColor(project.status) }}
                      >
                        {project.status || "Unknown"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Sales</div>
                      <div className="text-sm font-semibold text-blue-600">
                        ${(project.sales ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Cost</div>
                      <div className="text-sm font-semibold text-orange-600">
                        ${(project.cost ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Markup %</div>
                      <div className="text-sm font-semibold text-emerald-600">
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

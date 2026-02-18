"use client";
import React, { useEffect, useState } from "react";
import { db } from "@/firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

interface ProductivityLog {
  projectId: string;
  projectName: string;
  date?: string;
  employeeName?: string;
  employeeId?: string | null;
  hours?: number;
  costCode?: string;
  description?: string;
  // Legacy fields for backward compatibility
  vendor?: string;
  workers?: number;
  notes?: string;
}

interface ProductivitySummary {
  projectId: string;
  projectName: string;
  month: string;
  totalHours?: number;
  uniqueEmployees?: number;
  totalWorkers?: number; // Legacy field for backward compatibility
  workingDays?: number;
  byEmployee?: Record<string, { hours: number; days: number }>;
  byVendor?: Record<string, { hours: number; workers: number }>; // Legacy field
}

export default function ProductivityPage() {
  return (
    <ProtectedPage page="productivity" requireAuth={true}>
      <ProductivityContent />
    </ProtectedPage>
  );
}

function ProductivityContent() {
  const [summaries, setSummaries] = useState<ProductivitySummary[]>([]);
  const [logs, setLogs] = useState<ProductivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [view, setView] = useState<"summary" | "detail">("summary");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load summaries
      const summaryRef = collection(db, "productivity_summary");
      const summaryQuery = query(summaryRef, orderBy("month", "desc"));
      const summarySnap = await getDocs(summaryQuery);
      const summaryData = summarySnap.docs.map(doc => doc.data() as ProductivitySummary);
      setSummaries(summaryData);

      // Load first 500 raw logs for detail view
      const logsRef = collection(db, "productivity_logs");
      const logsQuery = query(logsRef, orderBy("date", "desc"));
      const logsSnap = await getDocs(logsQuery);
      const logsData = logsSnap.docs.slice(0, 500).map(doc => doc.data() as ProductivityLog);
      setLogs(logsData);

    } catch (error) {
      console.error("Error loading productivity data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Filter data - handle both string and number projectIds
  const filteredSummaries = summaries.filter(s => {
    if (selectedProject !== "all") {
      const summaryProjectId = String(s.projectId);
      const selectedProjectId = String(selectedProject);
      if (summaryProjectId !== selectedProjectId) return false;
    }
    if (selectedMonth !== "all" && s.month !== selectedMonth) return false;
    return true;
  });

  const filteredLogs = logs.filter(l => {
    if (selectedProject !== "all") {
      const logProjectId = String(l.projectId);
      const selectedProjectId = String(selectedProject);
      if (logProjectId !== selectedProjectId) return false;
    }
    if (selectedMonth !== "all" && l.date?.substring(0, 7) !== selectedMonth) return false;
    return true;
  });

  // Get unique projects and months
  const projects = Array.from(new Set(summaries.map(s => s.projectId)))
    .map(id => ({ id, name: summaries.find(s => s.projectId === id)?.projectName || id }));
  
  const months = Array.from(new Set(summaries.map(s => s.month))).sort().reverse();

  // Calculate totals (handle both old and new data structures)
  const totalHours = filteredSummaries.reduce((sum, s) => sum + (s.totalHours || 0), 0);
  const uniqueEmployees = filteredSummaries.reduce((sum, s) => sum + (s.uniqueEmployees || s.totalWorkers || 0), 0);
  const avgHoursPerDay = filteredSummaries.length > 0 
    ? totalHours / filteredSummaries.reduce((sum, s) => sum + (s.workingDays || 0), 0)
    : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading productivity data...</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Productivity Dashboard</h1>
            <p className="text-gray-600">
              6-month productivity analysis across all projects
            </p>
          </div>
          <Navigation currentPage="productivity" />
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-600 mb-1">Total Hours</div>
            <div className="text-3xl font-bold text-blue-900">{totalHours.toLocaleString()}</div>
            <div className="text-xs text-gray-500 mt-1">Last 6 months</div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-600 mb-1">Unique Employees</div>
            <div className="text-3xl font-bold text-green-900">{uniqueEmployees.toLocaleString()}</div>
            <div className="text-xs text-gray-500 mt-1">Across all projects</div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-sm text-gray-600 mb-1">Avg Hours/Day</div>
            <div className="text-3xl font-bold text-purple-900">{avgHoursPerDay.toFixed(1)}</div>
            <div className="text-xs text-gray-500 mt-1">Across working days</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex flex-wrap gap-4 items-center">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">View</label>
              <select
                value={view}
                onChange={(e) => setView(e.target.value as "summary" | "detail")}
                className="px-4 py-2 border border-gray-300 rounded-md"
              >
                <option value="summary">Monthly Summary</option>
                <option value="detail">Daily Logs</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Project</label>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md"
              >
                <option value="all">All Projects ({projects.length})</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Month</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-md"
              >
                <option value="all">All Months ({months.length})</option>
                {months.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <button
              onClick={() => { setSelectedProject("all"); setSelectedMonth("all"); }}
              className="mt-6 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md"
            >
              Reset Filters
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            {view === "summary" ? (
              <table className="w-full">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Project
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Month
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Total Hours
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Unique Employees
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Working Days
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Avg Hours/Day
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredSummaries.map((summary, idx) => {
                    const rowKey = `${summary.projectId}_${summary.month}`;
                    const isExpanded = expandedRow === rowKey;
                    
                    return (
                      <React.Fragment key={idx}>
                        <tr 
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setExpandedRow(isExpanded ? null : rowKey)}
                        >
                          <td className="px-6 py-4 text-sm text-gray-900">
                            <span className="mr-2">{isExpanded ? '▼' : '▶'}</span>
                            {summary.projectName}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900">{summary.month}</td>
                          <td className="px-6 py-4 text-sm text-gray-900 text-right font-semibold">
                            {(summary.totalHours || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 text-right">
                            {(summary.uniqueEmployees || summary.totalWorkers || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 text-right">
                            {summary.workingDays || 0}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 text-right">
                            {summary.workingDays ? ((summary.totalHours || 0) / summary.workingDays).toFixed(1) : '0.0'}
                          </td>
                        </tr>
                        
                        {isExpanded && summary.byEmployee && (
                          <tr className="bg-blue-50">
                            <td colSpan={6} className="px-6 py-4">
                              <div className="ml-8">
                                <h4 className="font-semibold text-gray-900 mb-3">Employee Breakdown</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                  {Object.entries(summary.byEmployee).map(([empName, empData]: [string, any]) => (
                                    <div key={empName} className="bg-white rounded p-3 border border-gray-200">
                                      <div className="font-medium text-gray-900">{empName}</div>
                                      <div className="text-sm text-gray-600 mt-2">
                                        <div>Hours: <span className="font-semibold">{empData.hours.toFixed(2)}</span></div>
                                        <div>Days: <span className="font-semibold">{empData.days}</span></div>
                                        <div className="text-xs text-gray-500 mt-1">
                                          Avg: {(empData.hours / (empData.days || 1)).toFixed(2)} hrs/day
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Project
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Employee
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Hours
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Cost Code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredLogs.map((log, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">{log.date || 'N/A'}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{log.projectName || 'Unknown'}</td>
                      <td className="px-6 py-4 text-sm text-gray-900">{log.employeeName || log.vendor || 'Unknown'}</td>
                      <td className="px-6 py-4 text-sm text-gray-900 text-right font-semibold">
                        {(log.hours || 0).toFixed(1)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{log.costCode || ''}</td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">{log.description || log.notes || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {filteredSummaries.length === 0 && filteredLogs.length === 0 && (
            <div className="text-center py-12">
              <div className="text-gray-500 mb-4">
                No productivity data found.
              </div>
              <div className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded p-4 max-w-2xl mx-auto">
                <p className="font-semibold mb-2">⚠️ Possible reasons:</p>
                <ul className="text-left list-disc list-inside space-y-1">
                  <li>Projects may not be using Procore Daily Logs / Manpower tracking</li>
                  <li>Most projects in your list are &quot;Bids&quot; (not active construction)</li>
                  <li>No work was logged in the selected date range</li>
                </ul>
                <div className="mt-4 pt-3 border-t border-yellow-300">
                  <p className="font-semibold mb-1">Next steps:</p>
                  <p>Go to the <a href="/procore" className="text-blue-600 underline font-bold">Procore page</a> and click <strong>&quot;Check Data Sources&quot;</strong> to see which endpoint has your data.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

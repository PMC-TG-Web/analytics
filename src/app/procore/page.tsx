"use client";
import React, { useState, useEffect } from "react";

import Navigation from "@/components/Navigation";

interface ProcoreData {
  user?: any;
  companies?: any;
  projects?: any;
  projectTemplates?: any;
  vendors?: any;
  users?: any;
  bidBoardProjects?: any;
  estimatingProjects?: any;
  bidBoardV2?: any;
  unifiedProjects?: any;
  productivityLogs?: any;
  giantProductivity?: any;
  error?: string;
}

export default function ProcorePage() {
  return <ProcoreContent />;
}

function ProcoreContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [data, setData] = useState<ProcoreData | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingProductivity, setSyncingProductivity] = useState(false);
  const [debugging, setDebugging] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [checkingFirebase, setCheckingFirebase] = useState(false);
  const [syncResult, setSyncResult] = useState<{ count: number; message: string } | null>(null);
  const [productivityResult, setProductivityResult] = useState<{ count: number; message: string } | null>(null);
  const [debugResult, setDebugResult] = useState<any>(null);
  const [productivityDebugResult, setProductivityDebugResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  useEffect(() => {
    const checkProcoreAuth = async () => {
      try {
        console.log("ProcorePage: Checking auth...");
        const response = await fetch("/api/procore/me");
        if (response.ok) {
          try {
            const data = await response.json();
            console.log("ProcorePage: Auth OK");
            setIsAuthenticated(true);
          } catch (e) {
            console.warn("Failed to parse auth response");
            setIsAuthenticated(false);
          }
        } else {
          console.warn("ProcorePage: Auth endpoint not available");
          // Don't set error state here to avoid showing it on initial load
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.warn("Error checking Procore auth:", err);
        setIsAuthenticated(false);
      }
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "authenticated") {
      setIsAuthenticated(true);
      window.history.replaceState({}, "", "/procore");
    } else {
      checkProcoreAuth();
    }
    
    if (params.get("error")) {
      setError(params.get("error"));
    }
  }, []);

  const handleLogin = () => {
    // Standard OAuth flow: redirect to the registered login route
    window.location.href = "/api/auth/procore/login?returnTo=/procore";
  };

  const handleExplore = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/procore/explore", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore explore endpoint not available");
        setData(null);
        return;
      }

      try {
        const result = await response.json();
        setData(result);
      } catch (e) {
        console.warn("Failed to parse explore response");
        setData(null);
      }
    } catch (err) {
      console.warn("Error exploring Procore:", err);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const response = await fetch("/api/procore/sync", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore sync endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setSyncResult({ count: result.count, message: result.message });
      } catch (e) {
        console.warn("Failed to parse sync response");
      }
    } catch (err) {
      console.warn("Error syncing Procore:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncProductivity = async () => {
    setSyncingProductivity(true);
    setError(null);
    setProductivityResult(null);
    setProductivityDebugResult(null);
    try {
      const response = await fetch("/api/procore/sync-productivity", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore sync-productivity endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setProductivityResult({ 
          count: result.totalLogs, 
          message: result.message 
        });
        
        // Store debug info if available
        if (result.debug) {
          setProductivityDebugResult(result.debug);
        }
      } catch (e) {
        console.warn("Failed to parse sync-productivity response");
      }
    } catch (err) {
      console.warn("Error syncing productivity:", err);
    } finally {
      setSyncingProductivity(false);
    }
  };

  const handleDebugProductivity = async () => {
    setDebugging(true);
    setError(null);
    setDebugResult(null);
    try {
      const response = await fetch("/api/procore/debug-productivity", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore debug-productivity endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setDebugResult(result);
      } catch (e) {
        console.warn("Failed to parse debug-productivity response");
      }
    } catch (err) {
      console.warn("Error debugging productivity:", err);
    } finally {
      setDebugging(false);
    }
  };

  const handleClearProductivity = async () => {
    if (!window.confirm('This will delete all old productivity data. Are you ready to sync fresh data after this?')) {
      return;
    }
    
    setClearing(true);
    setError(null);
    try {
      const response = await fetch("/api/procore/clear-productivity", {
        method: "POST",
      });

      if (!response.ok) {
        console.warn("Procore clear-productivity endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setError(`✅ ${result.message}`);
      } catch (e) {
        console.warn("Failed to parse clear-productivity response");
      }
    } catch (err) {
      console.warn("Error clearing productivity:", err);
    } finally {
      setClearing(false);
    }
  };

  const handleCheckFirebase = async () => {
    setCheckingFirebase(true);
    setError(null);
    setDebugResult(null);
    try {
      const response = await fetch("/api/procore/check-firebase");

      if (!response.ok) {
        console.warn("Procore check-firebase endpoint not available");
        return;
      }

      try {
        const result = await response.json();
        setDebugResult(result);
      } catch (e) {
        console.warn("Failed to parse check-firebase response");
      }
    } catch (err) {
      console.warn('Error checking Firebase:', err);
    } finally {
      setCheckingFirebase(false);
    }
  };

  const getCount = (items: any) => {
    if (!items) return 0;
    if (Array.isArray(items)) return items.length;
    if (items.data && Array.isArray(items.data)) return items.data.length;
    if (items.entities && Array.isArray(items.entities)) return items.entities.length;
    if (items.projects && Array.isArray(items.projects)) return items.projects.length;
    return 0;
  };

  const renderData = (section: string, sectionData: any) => {
    if (!sectionData) return <p>No data</p>;
    if (sectionData.error) return <p className="text-red-500">{sectionData.error}</p>;

    // Unpack common wrapper objects from Procore v2.0
    let displayData = sectionData;
    if (!Array.isArray(sectionData) && sectionData && typeof sectionData === 'object') {
      if (Array.isArray(sectionData.data)) displayData = sectionData.data;
      else if (Array.isArray(sectionData.entities)) displayData = sectionData.entities;
      else if (Array.isArray(sectionData.projects)) displayData = sectionData.projects;
    }

    if (Array.isArray(displayData)) {
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-gray-300">
            <thead className="bg-gray-200">
              <tr>
                {displayData[0] &&
                  Object.keys(displayData[0]).map((key) => (
                    <th key={key} className="border border-gray-300 p-2 text-left">
                      {key}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {displayData.slice(0, 10).map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  {Object.values(item).map((val, colIdx) => (
                    <td key={colIdx} className="border border-gray-300 p-2 text-sm">
                      {typeof val === "object" ? (
                        <span className="text-xs text-gray-400">Object</span>
                      ) : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {displayData.length > 10 && (
            <p className="text-sm text-gray-600 mt-2">
              Showing 10 of {displayData.length} items
            </p>
          )}
        </div>
      );
    }

    return (
      <pre className="bg-gray-100 p-4 rounded overflow-auto text-sm">
        {JSON.stringify(sectionData, null, 2)}
      </pre>
    );
  };

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Procore Integration Explorer</h1>
            <p className="text-gray-600">
              Connect to your Procore account and explore available data
            </p>
          </div>
          <Navigation currentPage="procore" />
        </div>

        {error && (
        <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
          {error.includes("expired") && (
            <button 
              onClick={() => window.location.href = '/api/auth/procore/logout'}
              className="ml-4 underline font-bold"
            >
              Click here to Re-login
            </button>
          )}
        </div>
      )}

      {!isAuthenticated ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <h2 className="text-xl font-semibold mb-4">Authenticate with Procore</h2>
            <p className="text-gray-600 mb-6">
              Click below to log in with your Procore account
            </p>
            <button
              onClick={handleLogin}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded mb-4"
            >
              Login with Procore
            </button>
            <div className="mt-4 pt-4 border-t border-gray-100 italic text-xs text-gray-400">
               Note: This will redirect to your configured Procore Auth URL.
            </div>
          </div>
        ) : (
          <div>
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-6">
              ✓ Authenticated with Procore
            </div>

            {syncResult && (
              <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded mb-6">
                <strong>Sync Result:</strong> {syncResult.message}
              </div>
            )}

            {productivityResult && (
              <div className="bg-purple-100 border border-purple-400 text-purple-700 px-4 py-3 rounded mb-6">
                <strong>Productivity Sync:</strong> {productivityResult.message}
                <br/>
                <a href="/productivity" className="underline font-bold mt-2 inline-block">View Productivity Dashboard →</a>
              </div>
            )}

            {productivityDebugResult && (
              <div className="bg-white rounded-lg shadow p-6 border-2 border-purple-500 mb-6">
                <h2 className="text-xl font-bold text-purple-900 mb-4">
                  🔍 Procore API Field Mapping
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-4 bg-purple-50 rounded border border-purple-200">
                    <h3 className="font-bold text-purple-900 mb-2">Employee Object Fields</h3>
                    <div className="text-sm font-mono">
                      {productivityDebugResult.employeeObjectKeys?.length > 0 ? (
                        <>
                          <div className="mb-3">
                            <strong>Keys:</strong> {productivityDebugResult.employeeObjectKeys.join(', ')}
                          </div>
                          <details>
                            <summary className="cursor-pointer font-semibold">View Full Sample</summary>
                            <pre className="mt-2 bg-white p-2 rounded text-xs border border-purple-200 overflow-auto max-h-64">
                              {JSON.stringify(productivityDebugResult.employeeObjectSample, null, 2)}
                            </pre>
                          </details>
                        </>
                      ) : (
                        <div className="text-gray-500 italic">No employee data found</div>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-purple-50 rounded border border-purple-200">
                    <h3 className="font-bold text-purple-900 mb-2">Timecard Entry Object Fields</h3>
                    <div className="text-sm font-mono">
                      {productivityDebugResult.timecardObjectKeys?.length > 0 ? (
                        <>
                          <div className="mb-3">
                            <strong>Keys:</strong> {productivityDebugResult.timecardObjectKeys.join(', ')}
                          </div>
                          <details>
                            <summary className="cursor-pointer font-semibold">View Full Sample</summary>
                            <pre className="mt-2 bg-white p-2 rounded text-xs border border-purple-200 overflow-auto max-h-64">
                              {JSON.stringify(productivityDebugResult.timecardObjectSample, null, 2)}
                            </pre>
                          </details>
                        </>
                      ) : (
                        <div className="text-gray-500 italic">No timecard data found</div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
                  <strong>Next Step:</strong> Use these field names to extract employee information from timecard entries.
                </div>
              </div>
            )}

            {error && (
              <div className={`px-4 py-3 rounded mb-6 border ${
                error.startsWith('✅') 
                  ? 'bg-green-100 border-green-400 text-green-700' 
                  : 'bg-red-100 border-red-400 text-red-700'
              }`}>
                {error.startsWith('✅') ? error : `Error: ${error}`}
              </div>
            )}

            {debugResult && debugResult.results && (
              <div className="bg-white rounded-lg shadow p-6 border-2 border-orange-500 mb-6">
                <h2 className="text-xl font-bold text-orange-900 mb-4">
                  🔍 Data Source Diagnostic Results
                </h2>
                <div className="mb-4 p-3 bg-orange-50 rounded">
                  <strong>Recommendation:</strong> {debugResult.recommendation}
                </div>
                <div className="text-sm overflow-x-auto">
                  <pre className="bg-gray-100 p-4 rounded text-xs">
                    {JSON.stringify(debugResult, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {debugResult && debugResult.logsCount !== undefined && (
              <div className="bg-white rounded-lg shadow p-6 border-2 border-indigo-500 mb-6">
                <h2 className="text-xl font-bold text-indigo-900 mb-4">
                  📊 Firebase Data Status
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="bg-indigo-50 p-4 rounded">
                    <div className="text-sm text-indigo-700 font-semibold">Logs in Firebase</div>
                    <div className="text-2xl font-bold text-indigo-900">{debugResult.logsCount}</div>
                  </div>
                  <div className="bg-indigo-50 p-4 rounded">
                    <div className="text-sm text-indigo-700 font-semibold">Monthly Summaries</div>
                    <div className="text-2xl font-bold text-indigo-900">{debugResult.summariesCount}</div>
                  </div>
                  <div className="bg-indigo-50 p-4 rounded">
                    <div className="text-sm text-indigo-700 font-semibold">Total Hours</div>
                    <div className="text-2xl font-bold text-indigo-900">{debugResult.totalHours.toFixed(1)}</div>
                  </div>
                </div>
                <div className="text-sm overflow-x-auto">
                  <pre className="bg-gray-100 p-4 rounded text-xs">
                    {JSON.stringify({
                      message: debugResult.message,
                      byProject: debugResult.byProject,
                      sampleLogs: debugResult.sampleLogs,
                      firstSummary: debugResult.firstSummary
                    }, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
              <button
                onClick={handleExplore}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingFirebase}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {loading ? "Exploring..." : "Explore Available Data"}
              </button>
              
              <button
                onClick={handleSync}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingFirebase}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {syncing ? "Syncing..." : "Sync Bid Board"}
              </button>

              <button
                onClick={handleClearProductivity}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingFirebase}
                className="bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {clearing ? "Clearing..." : "🗑️ Clear Old Data"}
              </button>

              <button
                onClick={handleSyncProductivity}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingFirebase}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {syncingProductivity ? "Syncing..." : "Sync Productivity"}
              </button>

              <button
                onClick={handleDebugProductivity}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingFirebase}
                className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {debugging ? "Checking..." : "Check Data Sources"}
              </button>

              <button
                onClick={handleCheckFirebase}
                disabled={loading || syncing || syncingProductivity || debugging || clearing || checkingFirebase}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-bold py-2 px-4 rounded text-sm"
              >
                {checkingFirebase ? "Checking..." : "📊 Check Firebase"}
              </button>
            </div>

            {debugResult && (
              <div className="bg-white rounded-lg shadow p-6 border-2 border-orange-500 mb-6">
                <h2 className="text-xl font-bold text-orange-900 mb-4">
                  🔍 Data Source Diagnostic Results
                </h2>
                <div className="mb-4 p-3 bg-orange-50 rounded">
                  <strong>Recommendation:</strong> {debugResult.recommendation}
                </div>
                <div className="text-sm overflow-x-auto">
                  <pre className="bg-gray-100 p-4 rounded text-xs">
                    {JSON.stringify(debugResult, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {data && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() => setSelectedSection(selectedSection === "user" ? null : "user")}
                  >
                    👤 User Info
                  </h2>
                  {selectedSection === "user" && (
                    <div className="text-sm">
                      {renderData("user", data.user)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "companies" ? null : "companies"
                      )
                    }
                  >
                    🏢 Companies ({getCount(data.companies)})
                  </h2>
                  {selectedSection === "companies" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("companies", data.companies)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "projects" ? null : "projects"
                      )
                    }
                  >
                    📋 All Projects (Merged: {getCount(data.unifiedProjects)})
                  </h2>
                  {selectedSection === "projects" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      <p className="text-xs text-gray-500 mb-2 italic">Combining Core Construction Projects and Bid Board Projects</p>
                      {renderData("projects", data.unifiedProjects)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "vendors" ? null : "vendors"
                      )
                    }
                  >
                    🏭 Vendors ({getCount(data.vendors)})
                  </h2>
                  {selectedSection === "vendors" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("vendors", data.vendors)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() => setSelectedSection(selectedSection === "users" ? null : "users")
                    }
                  >
                    👥 Users ({getCount(data.users)})
                  </h2>
                  {selectedSection === "users" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("users", data.users)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "bidboard" ? null : "bidboard"
                      )
                    }
                  >
                    💰 Bid Board ({getCount(data.bidBoardProjects)}) / Est ({getCount(data.estimatingProjects)})
                  </h2>
                  {selectedSection === "bidboard" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      <h3 className="font-bold mb-2">Bid Board Projects:</h3>
                      {renderData("bidboard", data.bidBoardProjects)}
                      <h3 className="font-bold mt-4 mb-2">Estimating Projects:</h3>
                      {renderData("estimating", data.estimatingProjects)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "bids" ? null : "bids"
                      )
                    }
                  >
                    💸 Bid Board v2.0 ({getCount(data.bidBoardV2)})
                  </h2>
                  {selectedSection === "bids" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      <h3 className="font-bold mb-2">Bid Board Projects (v2):</h3>
                      {renderData("bidboardv2", data.bidBoardV2)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "templates" ? null : "templates"
                      )
                    }
                  >
                    📑 Project Templates ({getCount(data.projectTemplates)})
                  </h2>
                  {selectedSection === "templates" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("templates", data.projectTemplates)}
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-6 md:col-span-2">
                  <h2
                    className="text-lg font-semibold mb-4 cursor-pointer hover:text-blue-600"
                    onClick={() =>
                      setSelectedSection(
                        selectedSection === "productivity" ? null : "productivity"
                      )
                    }
                  >
                    📈 Productivity Logs (Sample from {data.productivityLogs?.length || 0} Projects)
                  </h2>
                  {selectedSection === "productivity" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      <p className="text-xs text-gray-500 mb-4 italic">
                        Productivity logs are project-specific. Showing data for a few sample projects from the list.
                      </p>
                      {data.productivityLogs?.map((item: any, idx: number) => (
                        <div key={idx} className="mb-6 border-b pb-4 last:border-0">
                          <h3 className="font-bold text-blue-800 mb-2">{item.projectName} (ID: {item.projectId})</h3>
                          {renderData(`prod_${item.projectId}`, item.logs)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {data.giantProductivity && (
                  <div className="bg-white rounded-lg shadow p-6 border-2 border-blue-500 md:col-span-2">
                    <h2 className="text-xl font-bold text-blue-900 mb-4">
                      🏗️ Giant #6582: Specific Productivity Data (Last 90 Days)
                    </h2>
                    <div className="text-sm overflow-x-auto">
                      {data.giantProductivity.data?.length > 0 ? (
                        renderData("giant", data.giantProductivity.data)
                      ) : (
                        <div className="p-4 bg-yellow-50 text-yellow-800 rounded">
                           Found project "{data.giantProductivity.name}" (ID: {data.giantProductivity.id}), but no specific <strong>Productivity Logs</strong> entries were found for this date range. 
                           <br/><br/>
                           Check the <strong>Manpower Logs</strong> above for this project to see general daily labor hours.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {data && (
              <div className="bg-white rounded-lg shadow p-6 mt-6">
                <h2 className="text-lg font-semibold mb-4">Raw JSON Response</h2>
                <details>
                  <summary className="cursor-pointer font-semibold hover:text-blue-600">
                    Click to expand
                  </summary>
                  <pre className="bg-gray-100 p-4 rounded overflow-auto text-xs mt-4">
                    {JSON.stringify(data, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

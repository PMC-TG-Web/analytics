"use client";
import React, { useState, useEffect } from "react";
import ProtectedPage from "@/components/ProtectedPage";
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
  error?: string;
}

export default function ProcorePage() {
  return (
    <ProtectedPage page="procore" requireAuth={false}>
      <ProcoreContent />
    </ProtectedPage>
  );
}

function ProcoreContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [data, setData] = useState<ProcoreData | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ count: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  useEffect(() => {
    const checkProcoreAuth = async () => {
      try {
        console.log("ProcorePage: Checking auth...");
        const response = await fetch("/api/procore/me");
        if (response.ok) {
          console.log("ProcorePage: Auth OK");
          setIsAuthenticated(true);
        } else {
          const data = await response.json();
          console.log("ProcorePage: Auth Failed", data.error);
          // Don't set error state here to avoid showing it on initial load
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error("Error checking Procore auth:", err);
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
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
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
        throw new Error(`Sync failed: ${response.status}`);
      }

      const result = await response.json();
      setSyncResult({ count: result.count, message: result.message });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync data");
    } finally {
      setSyncing(false);
    }
  };

  const renderData = (section: string, sectionData: any) => {
    if (!sectionData) return <p>No data</p>;
    if (sectionData.error) return <p className="text-red-500">{sectionData.error}</p>;

    if (Array.isArray(sectionData)) {
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse border border-gray-300">
            <thead className="bg-gray-200">
              <tr>
                {sectionData[0] &&
                  Object.keys(sectionData[0]).map((key) => (
                    <th key={key} className="border border-gray-300 p-2 text-left">
                      {key}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {sectionData.slice(0, 10).map((item, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  {Object.values(item).map((val, colIdx) => (
                    <td key={colIdx} className="border border-gray-300 p-2 text-sm">
                      {typeof val === "object" ? JSON.stringify(val) : String(val)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sectionData.length > 10 && (
            <p className="text-sm text-gray-600 mt-2">
              Showing 10 of {sectionData.length} items
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

            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
                Error: {error}
              </div>
            )}

            <div className="flex gap-4 mb-6">
              <button
                onClick={handleExplore}
                disabled={loading || syncing}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-6 rounded flex-1"
              >
                {loading ? "Exploring..." : "Explore Available Data"}
              </button>
              
              <button
                onClick={handleSync}
                disabled={loading || syncing}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold py-2 px-6 rounded flex-1"
              >
                {syncing ? "Syncing..." : "Sync Bid Board to Firestore"}
              </button>
            </div>

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
                    🏢 Companies ({data.companies?.length || 0})
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
                    📋 Projects ({data.projects?.length || 0})
                  </h2>
                  {selectedSection === "projects" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("projects", data.projects)}
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
                    🏭 Vendors ({data.vendors?.length || 0})
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
                    👥 Users ({data.users?.length || 0})
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
                    💰 Bid Board ({data.bidBoardProjects?.length || 0}) / Est ({data.estimatingProjects?.length || 0})
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
                    💸 Bid Board v2.0 ({data.bidBoardV2?.length || 0})
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
                    📑 Project Templates ({data.projectTemplates?.length || 0})
                  </h2>
                  {selectedSection === "templates" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("templates", data.projectTemplates)}
                    </div>
                  )}
                </div>
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

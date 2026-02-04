"use client";
import React, { useState, useEffect } from "react";

interface ProcoreData {
  user?: any;
  companies?: any;
  projects?: any;
  projectTemplates?: any;
  vendors?: any;
  users?: any;
  bidBoardProjects?: any;
  error?: string;
}

export default function ProcorePage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [data, setData] = useState<ProcoreData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "authenticated") {
      setIsAuthenticated(true);
      window.history.replaceState({}, "", "/procore");
    }
    if (params.get("error")) {
      setError(params.get("error"));
    }
  }, []);

  const handleLogin = async () => {
    try {
      const response = await fetch("/api/procore/auth-url");
      const { authUrl } = await response.json();
      console.log('Authorization URL:', authUrl);
      window.location.href = authUrl;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to get auth URL");
    }
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
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Procore Integration Explorer</h1>
        <p className="text-gray-600 mb-8">
          Connect to your Procore account and explore available data
        </p>

        {!isAuthenticated ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <h2 className="text-xl font-semibold mb-4">Authenticate with Procore</h2>
            <p className="text-gray-600 mb-6">
              Click below to log in with your Procore account
            </p>
            <button
              onClick={handleLogin}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded"
            >
              Login with Procore
            </button>
          </div>
        ) : (
          <div>
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-6">
              ✓ Authenticated with Procore
            </div>

            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
                Error: {error}
              </div>
            )}

            <button
              onClick={handleExplore}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2 px-6 rounded mb-6"
            >
              {loading ? "Loading..." : "Explore Available Data"}
            </button>

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
                    💰 Bid Board Projects ({data.bidBoardProjects?.length || 0})
                  </h2>
                  {selectedSection === "bidboard" && (
                    <div className="text-sm max-h-96 overflow-y-auto">
                      {renderData("bidboard", data.bidBoardProjects)}
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

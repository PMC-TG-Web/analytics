"use client";
import React, { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import ProtectedPage from "@/components/ProtectedPage";

interface Endpoint {
  method: string;
  path: string;
  name?: string;
  description?: string;
  fullName?: string;
}

interface TestResult {
  success: boolean;
  statusCode: number;
  duration: number;
  responseSize: number;
  error?: string;
  preview?: {
    isArray: boolean;
    itemCount?: number;
    keys?: string[];
    sample?: any;
  };
}

interface EndpointGroup {
  [category: string]: Endpoint[];
}

export default function EndpointsPage() {
  return (
    <ProtectedPage page="endpoints" requireAuth={true}>
      <EndpointExplorerContent />
    </ProtectedPage>
  );
}

function EndpointExplorerContent() {
  const [data, setData] = useState<{
    totalEndpoints: number;
    uniqueResources: number;
    resources: EndpointGroup;
    sampleEndpoints: Endpoint[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMethod, setSelectedMethod] = useState<string>("all");
  const [expandedResources, setExpandedResources] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [testingEndpoint, setTestingEndpoint] = useState<string | null>(null);
  const [showOnlyWorking, setShowOnlyWorking] = useState(false);

  useEffect(() => {
    loadEndpoints();
  }, []);

  const loadEndpoints = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/explore/parse-endpoints");
      if (!response.ok) throw new Error("Failed to fetch endpoints");
      
      const json = await response.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const toggleResource = (resource: string) => {
    const newExpanded = new Set(expandedResources);
    if (newExpanded.has(resource)) {
      newExpanded.delete(resource);
    } else {
      newExpanded.add(resource);
    }
    setExpandedResources(newExpanded);
  };

  const testEndpoint = async (endpoint: Endpoint) => {
    const key = `${endpoint.method}:${endpoint.path}`;
    setTestingEndpoint(key);

    try {
      const response = await fetch("/api/explore/test-endpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: endpoint.path,
          method: endpoint.method,
        }),
      });

      const result = await response.json();
      setTestResults((prev) => ({
        ...prev,
        [key]: result,
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [key]: {
          success: false,
          statusCode: 0,
          duration: 0,
          responseSize: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        },
      }));
    } finally {
      setTestingEndpoint(null);
    }
  };

  const getMethodColor = (method: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      GET: { bg: "bg-blue-100", text: "text-blue-800" },
      POST: { bg: "bg-green-100", text: "text-green-800" },
      PUT: { bg: "bg-yellow-100", text: "text-yellow-800" },
      PATCH: { bg: "bg-purple-100", text: "text-purple-800" },
      DELETE: { bg: "bg-red-100", text: "text-red-800" },
      HEAD: { bg: "bg-gray-100", text: "text-gray-800" },
      OPTIONS: { bg: "bg-gray-100", text: "text-gray-800" },
    };
    return colors[method] || { bg: "bg-gray-100", text: "text-gray-800" };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-xl text-gray-600">Parsing Postman collection...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <strong>Error:</strong> {error}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-xl text-gray-600">No data available</div>
      </div>
    );
  }

  // Filter endpoints
  const filteredResources: EndpointGroup = {};
  Object.entries(data.resources).forEach(([resource, endpoints]) => {
    const filtered = endpoints.filter((ep) => {
      // Check method filter
      if (selectedMethod !== "all" && ep.method !== selectedMethod) return false;
      
      // Check search term
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        if (
          !ep.path.toLowerCase().includes(searchLower) &&
          !ep.name?.toLowerCase().includes(searchLower) &&
          !ep.fullName?.toLowerCase().includes(searchLower)
        ) {
          return false;
        }
      }
      
      // Check if working (if filter enabled)
      if (showOnlyWorking) {
        const key = `${ep.method}:${ep.path}`;
        const result = testResults[key];
        if (!result || !result.success) return false;
      }
      
      return true;
    });

    if (filtered.length > 0) {
      filteredResources[resource] = filtered;
    }
  });

  const totalVisible = Object.values(filteredResources).reduce(
    (sum, eps) => sum + eps.length,
    0
  );

  const methodCounts: Record<string, number> = {};
  Object.values(data.resources).forEach((endpoints) => {
    endpoints.forEach((ep) => {
      methodCounts[ep.method] = (methodCounts[ep.method] || 0) + 1;
    });
  });

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              🔍 Endpoint Explorer
            </h1>
            <p className="text-gray-600">
              Discover all {data.totalEndpoints} Procore API endpoints
            </p>
          </div>
          <Navigation currentPage="endpoints" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600">Total Endpoints</div>
            <div className="text-2xl font-bold text-blue-900">
              {data.totalEndpoints}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600">Resources</div>
            <div className="text-2xl font-bold text-green-900">
              {data.uniqueResources}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600">Visible</div>
            <div className="text-2xl font-bold text-purple-900">{totalVisible}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600">Methods</div>
            <div className="text-2xl font-bold text-orange-900">
              {Object.keys(methodCounts).length}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Search Endpoint
              </label>
              <input
                type="text"
                placeholder="Search by path, name, or resource..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Method Filter
              </label>
              <select
                value={selectedMethod}
                onChange={(e) => setSelectedMethod(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="all">All Methods</option>
                {Object.entries(methodCounts)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([method, count]) => (
                    <option key={method} value={method}>
                      {method} ({count})
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOnlyWorking}
                  onChange={(e) => setShowOnlyWorking(e.target.checked)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm font-medium text-gray-700">
                  ✅ Only Working ({Object.values(testResults).filter(r => r.success).length})
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Endpoints by Resource */}
        <div className="space-y-4">
          {Object.entries(filteredResources)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([resource, endpoints]) => (
              <div key={resource} className="bg-white rounded-lg shadow overflow-hidden">
                <button
                  onClick={() => toggleResource(resource)}
                  className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 border-b border-gray-200"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">
                      {expandedResources.has(resource) ? "▼" : "▶"}
                    </span>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {resource}
                    </h3>
                    <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded">
                      {endpoints.length}
                    </span>
                  </div>
                </button>

                {expandedResources.has(resource) && (
                  <div className="divide-y divide-gray-200">
                    {endpoints.map((endpoint, idx) => {
                      const testKey = `${endpoint.method}:${endpoint.path}`;
                      const testResult = testResults[testKey];
                      const isTesting = testingEndpoint === testKey;

                      return (
                        <div key={idx} className="px-6 py-4 hover:bg-gray-50">
                          <div className="flex items-start gap-3 mb-3">
                            <span
                              className={`px-2 py-1 rounded text-xs font-bold whitespace-nowrap ${
                                getMethodColor(endpoint.method).bg
                              } ${getMethodColor(endpoint.method).text}`}
                            >
                              {endpoint.method}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-sm text-gray-700 break-all">
                                {typeof endpoint.path === 'string' ? endpoint.path : String(endpoint.path)}
                              </div>
                              {endpoint.fullName && typeof endpoint.fullName === 'string' && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {endpoint.fullName}
                                </div>
                              )}
                              {endpoint.name && typeof endpoint.name === 'string' && (
                                <div className="text-xs text-gray-600 mt-1">
                                  <strong>Name:</strong> {endpoint.name}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => testEndpoint(endpoint)}
                              disabled={isTesting}
                              className="px-3 py-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white text-sm rounded whitespace-nowrap"
                            >
                              {isTesting ? "Testing..." : "Test"}
                            </button>
                          </div>

                          {testResult && (
                            <div
                              className={`ml-0 p-3 rounded text-sm ${
                                testResult.success
                                  ? "bg-green-50 border border-green-200"
                                  : "bg-red-50 border border-red-200"
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <span className={testResult.success ? "text-green-700" : "text-red-700"}>
                                  {testResult.success ? "✅ Success" : "❌ Error"}
                                </span>
                                <span className="text-xs text-gray-600">
                                  {testResult.statusCode} • {testResult.duration}ms • {(testResult.responseSize / 1024).toFixed(1)}KB
                                </span>
                              </div>

                              {testResult.error && (
                                <div className="text-xs text-red-700 mb-2">
                                  <strong>Error:</strong> {testResult.error}
                                </div>
                              )}

                              {testResult.success && testResult.preview && (
                                <div className="text-xs text-gray-700">
                                  {testResult.preview.isArray ? (
                                    <>
                                      <strong>Array</strong> - {testResult.preview.itemCount} items
                                      {testResult.preview.keys && testResult.preview.keys.length > 0 && (
                                        <div className="mt-1 font-mono text-xs">
                                          Fields: {testResult.preview.keys.slice(0, 5).join(", ")}
                                          {testResult.preview.keys.length > 5 ? "..." : ""}
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <strong>Object</strong> - {testResult.preview.keys?.length || 0} fields
                                      {testResult.preview.keys && testResult.preview.keys.length > 0 && (
                                        <div className="mt-1 font-mono text-xs">
                                          Fields: {testResult.preview.keys.slice(0, 5).join(", ")}
                                          {testResult.preview.keys.length > 5 ? "..." : ""}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
        </div>

        {totalVisible === 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <p className="text-yellow-800">
              No endpoints match your filters. Try adjusting your search or method filter.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

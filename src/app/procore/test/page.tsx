"use client";
import React, { useState, useEffect } from "react";
import Navigation from "@/components/Navigation";

export default function ProcoreTestPage() {
  const [accessToken, setAccessToken] = useState("");
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [bidBoardProjectId, setBidBoardProjectId] = useState("598134326278124");
  const [lookupEmail, setLookupEmail] = useState("levi@pmc-tg-web.com"); // Adjust based on common domain

  useEffect(() => {
    // Check configuration on load
    fetch("/api/procore/test")
      .then((res) => res.json())
      .then((data) => setConfig(data))
      .catch((err) => console.error("Failed to load config:", err));

    // Check if already authenticated via OAuth
    fetch("/api/procore/me")
      .then((res) => {
        if (res.ok) {
          return res.json();
        }
        return null;
      })
      .then((data) => {
        if (data?.user) {
          setIsAuthenticated(true);
          setUser(data.user);
        }
      })
      .catch((err) => console.log("Not authenticated yet"));

    // Check for OAuth callback status
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "authenticated") {
      setIsAuthenticated(true);
      window.history.replaceState({}, "", "/procore/test");
      // Reload user info
      fetch("/api/procore/me")
        .then((res) => res.json())
        .then((data) => setUser(data.user));
    }
    if (params.get("error")) {
      setError(params.get("error"));
    }
  }, []);

  const testConnection = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/procore/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
      } else {
        setError(data.details ? `${data.error}: ${data.details}` : data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const fetchProjects = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/procore/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, page: 1, perPage: 10 }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const fetchAllProjectDetails = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/procore/projects/all-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          view: "normal",
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const fetchVendors = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/procore/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, page: 1, perPage: 10 }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const fetchEstimatingBidBoardProjects = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/procore/estimating/bid-board-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          page: 1,
          perPage: 100,
          fetchAll: true,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const compareProjectCoverage = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/procore/diagnostics/project-coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          perPage: 100,
          maxMissingRows: 200,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.details ? `${data.error}: ${data.details}` : data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const lookupUserAccess = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    if (!lookupEmail.trim()) {
      setError("Please enter a user email");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/procore/diagnostics/user-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: lookupEmail,
          accessToken,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Lookup failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const syncAllProjects = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/procore/sync/all-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const syncProductivityLogs = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/procore/sync/productivity-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          projectId: "598134326278124", 
          startDate: "2025-08-01",
          endDate: new Date().toISOString().split('T')[0],
          page: 1, 
          perPage: 100 
        }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const fetchProductivityLogs = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/procore/productivity-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          projectId: "598134326278124", 
          startDate: "2025-08-01",
          endDate: new Date().toISOString().split('T')[0],
          page: 1, 
          perPage: 100 
        }),
      });

      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
      } else {
        setError(data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const fetchBidBoardProjectById = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    if (!bidBoardProjectId.trim()) {
      setError("Please enter a project ID");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/procore/estimating/bid-board-project-by-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: bidBoardProjectId,
          accessToken,
          companyId: config?.config?.companyId,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setResult(data);
      } else {
        setError(data.details ? `${data.error}: ${data.details}` : data.error || "Request failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f5f5f5" }}>
      <Navigation />
      
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "1rem" }}>
          Procore API Test
        </h1>

        {/* Authentication Status */}
        {isAuthenticated && user && (
          <div
            style={{
              backgroundColor: "#d1fae5",
              border: "1px solid #10b981",
              borderRadius: "0.5rem",
              padding: "1rem",
              marginBottom: "1.5rem",
            }}
          >
            <h2 style={{ fontWeight: "600", marginBottom: "0.5rem", color: "#047857" }}>
              OK Authenticated with Procore
            </h2>
            <div style={{ fontSize: "0.875rem" }}>
              <p><strong>User:</strong> {user.name || user.login}</p>
              <p><strong>Email:</strong> {user.login}</p>
              <p><strong>ID:</strong> {user.id}</p>
            </div>
          </div>
        )}

        {/* Configuration Status */}
        {config && (
          <div
            style={{
              backgroundColor: config.status === "configured" ? "#d1fae5" : "#fed7d7",
              border: `1px solid ${config.status === "configured" ? "#10b981" : "#ef4444"}`,
              borderRadius: "0.5rem",
              padding: "1rem",
              marginBottom: "1.5rem",
            }}
          >
            <h2 style={{ fontWeight: "600", marginBottom: "0.5rem" }}>
              Configuration Status: {config.status}
            </h2>
            <div style={{ fontSize: "0.875rem" }}>
              <p><strong>Client ID:</strong> {config.config.clientId}</p>
              <p><strong>Client Secret:</strong> {config.config.clientSecret}</p>
              <p><strong>Company ID:</strong> {config.config.companyId}</p>
              <p><strong>API URL:</strong> {config.config.apiUrl}</p>
            </div>
            {config.message && (
              <p style={{ marginTop: "0.5rem", fontStyle: "italic" }}>
                {config.message}
              </p>
            )}
          </div>
        )}

        {/* OAuth Login */}
        {!isAuthenticated && (
          <div
            style={{
              backgroundColor: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              padding: "1.5rem",
              marginBottom: "1.5rem",
            }}
          >
            <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginBottom: "1rem" }}>
              Easy Authentication (Recommended)
            </h2>
            <p style={{ marginBottom: "1rem", color: "#6b7280" }}>
              Click the button below to authenticate with Procore using OAuth. This will handle
              all token management automatically.
            </p>
            <a
              href="/api/auth/procore/login"
              style={{
                display: "inline-block",
                padding: "0.75rem 1.5rem",
                backgroundColor: "#f97316",
                color: "#fff",
                borderRadius: "0.375rem",
                fontWeight: "600",
                textDecoration: "none",
              }}
            >
              🔐 Login with Procore OAuth
            </a>
          </div>
        )}

        {/* Manual Token Testing */}
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", fontWeight: "600", marginBottom: "1rem" }}>
            Manual Token Testing (Advanced)
          </h2>
          <p style={{ marginBottom: "1rem", fontSize: "0.875rem", color: "#6b7280" }}>
            Note: Procore typically requires OAuth flow. Direct token generation may not work.
            Use the OAuth login button above instead.
          </p>
        </div>

        {/* Access Token Input */}
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <label style={{ display: "block", fontWeight: "600", marginBottom: "0.5rem" }}>
            Access Token
          </label>
          <input
            type="text"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="Paste your Procore access token here"
            style={{
              width: "100%",
              padding: "0.5rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontFamily: "monospace",
            }}
          />
        </div>

        {/* Bid Board Project ID Lookup */}
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <label style={{ display: "block", fontWeight: "600", marginBottom: "0.5rem" }}>
            Bid Board Project ID Lookup
          </label>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <input
              type="text"
              value={bidBoardProjectId}
              onChange={(e) => setBidBoardProjectId(e.target.value)}
              placeholder="Enter project ID (e.g., 598134326278124)"
              style={{
                flex: 1,
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontFamily: "monospace",
              }}
            />
            <button
              onClick={fetchBidBoardProjectById}
              disabled={loading || (!accessToken && !isAuthenticated) || !bidBoardProjectId.trim()}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: loading || (!accessToken && !isAuthenticated) || !bidBoardProjectId.trim() ? "#9ca3af" : "#d97706",
                color: "#fff",
                border: "none",
                borderRadius: "0.375rem",
                fontWeight: "600",
                cursor: loading || (!accessToken && !isAuthenticated) || !bidBoardProjectId.trim() ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
        </div>

        {/* User Access Lookup */}
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <label style={{ display: "block", fontWeight: "600", marginBottom: "0.5rem" }}>
            User Access Diagnostic (Levi)
          </label>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <input
              type="email"
              value={lookupEmail}
              onChange={(e) => setLookupEmail(e.target.value)}
              placeholder="Enter user email (e.g., levi@...)"
              style={{
                flex: 1,
                padding: "0.5rem",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontFamily: "monospace",
              }}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={testConnection}
            disabled={loading}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading ? "#9ca3af" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Testing..." : "Test Connection (/me)"}
          </button>

          <button
            onClick={fetchProjects}
            disabled={loading}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading ? "#9ca3af" : "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : "Fetch Projects"}
          </button>

          <button
            onClick={fetchAllProjectDetails}
            disabled={loading}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading ? "#9ca3af" : "#0ea5e9",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : "Fetch All Project Details"}
          </button>

          <button
            onClick={fetchVendors}
            disabled={loading}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading ? "#9ca3af" : "#8b5cf6",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : "Fetch Vendors"}
          </button>

          <button
            onClick={fetchEstimatingBidBoardProjects}
            disabled={loading || (!accessToken && !isAuthenticated)}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading || (!accessToken && !isAuthenticated) ? "#9ca3af" : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading || (!accessToken && !isAuthenticated) ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : "Fetch Bid Board Projects (V2)"}
          </button>

          <button
            onClick={compareProjectCoverage}
            disabled={loading || (!accessToken && !isAuthenticated)}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading || (!accessToken && !isAuthenticated) ? "#9ca3af" : "#7c3aed",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading || (!accessToken && !isAuthenticated) ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : "Compare Project Coverage"}
          </button>

          <button
            onClick={lookupUserAccess}
            disabled={loading || (!accessToken && !isAuthenticated) || !lookupEmail.trim()}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading || (!accessToken && !isAuthenticated) || !lookupEmail.trim() ? "#9ca3af" : "#06b6d4",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading || (!accessToken && !isAuthenticated) || !lookupEmail.trim() ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Checking..." : "Verify User Access (Levi)"}
          </button>

          <button
            onClick={fetchProductivityLogs}
            disabled={loading || (!accessToken && !isAuthenticated)}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading || (!accessToken && !isAuthenticated) ? "#9ca3af" : "#f59e0b",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading || (!accessToken && !isAuthenticated) ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Loading..." : "Fetch Productivity Logs"}
          </button>

          <button
            onClick={syncAllProjects}
            disabled={loading}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading ? "#9ca3af" : "#ef4444",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "800",
              cursor: loading ? "not-allowed" : "pointer",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
            }}
          >
            {loading ? "Syncing..." : "🔄 SYNC ALL LIVE PROJECTS & BIDS"}
          </button>

          <button
            onClick={syncProductivityLogs}
            disabled={loading || (!accessToken && !isAuthenticated)}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: loading || (!accessToken && !isAuthenticated) ? "#9ca3af" : "#6366f1",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              cursor: loading || (!accessToken && !isAuthenticated) ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Syncing..." : "💾 Sync to Database"}
          </button>

          <a
            href="/procore/review/projects"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.75rem 1.5rem",
              backgroundColor: "#0f766e",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              textDecoration: "none",
            }}
          >
            📊 Open Project Review Table
          </a>

          <a
            href="/procore/review/bid-board-search"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.75rem 1.5rem",
              backgroundColor: "#d97706",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              textDecoration: "none",
            }}
          >
            📋 Open Detailed Bid Board Search Table
          </a>

          <a
            href="/procore/review/bid-board"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.75rem 1.5rem",
              backgroundColor: "#1d4ed8",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              textDecoration: "none",
            }}
          >
            🧮 Open Bid Board Review Table
          </a>

          <a
            href="/procore/review"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.75rem 1.5rem",
              backgroundColor: "#0f766e",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontWeight: "600",
              textDecoration: "none",
            }}
          >
            🧱 Open Productivity Review Table
          </a>
        </div>

        {/* Error Display */}
        {error && (
          <div
            style={{
              backgroundColor: "#fef2f2",
              border: "1px solid #ef4444",
              borderRadius: "0.5rem",
              padding: "1rem",
              marginBottom: "1.5rem",
            }}
          >
            <h3 style={{ fontWeight: "600", color: "#dc2626", marginBottom: "0.5rem" }}>
              Error
            </h3>
            <pre style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>
              {error}
            </pre>
          </div>
        )}

        {/* Result Display */}
        {result && (
          <div
            style={{
              backgroundColor: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: "0.5rem",
              padding: "1.5rem",
            }}
          >
            <h3 style={{ fontWeight: "600", marginBottom: "1rem" }}>
              Result
            </h3>
            <pre
              style={{
                backgroundColor: "#f9fafb",
                padding: "1rem",
                borderRadius: "0.375rem",
                overflow: "auto",
                maxHeight: "500px",
                fontSize: "0.875rem",
              }}
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

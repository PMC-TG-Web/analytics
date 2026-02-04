"use client";
import { useAuth } from "@/hooks/useAuth";
import { ReactNode } from "react";

interface ProtectedPageProps {
  children: ReactNode;
  page: string;
  requireAuth?: boolean;
}

export default function ProtectedPage({ children, page, requireAuth = true }: ProtectedPageProps) {
  const { user, loading, error, checkAccess } = useAuth();

  if (loading) {
    return (
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "#f5f5f5",
        color: "#222"
      }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (requireAuth && (!user || error)) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "#f5f5f5",
        color: "#222",
        padding: "20px"
      }}>
        <h1 style={{ fontSize: 24, marginBottom: 16, color: "#15616D" }}>Authentication Required</h1>
        <p style={{ marginBottom: 20, textAlign: "center" }}>
          Please sign in to access this page.
        </p>
        <a 
          href="/login" 
          style={{
            padding: "10px 20px",
            background: "#15616D",
            color: "#fff",
            textDecoration: "none",
            borderRadius: "6px",
            fontWeight: 600,
            fontSize: "14px"
          }}
        >
          Sign In
        </a>
      </div>
    );
  }

  if (requireAuth && !checkAccess(page)) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "#f5f5f5",
        color: "#222",
        padding: "20px"
      }}>
        <h1 style={{ fontSize: 24, marginBottom: 16, color: "#E06C00" }}>Access Denied</h1>
        <p style={{ marginBottom: 10, textAlign: "center" }}>
          You don't have permission to access this page.
        </p>
        {user && (
          <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
            Logged in as: {user.email}
          </p>
        )}
        <a 
          href="/dashboard" 
          style={{
            padding: "10px 20px",
            background: "#15616D",
            color: "#fff",
            textDecoration: "none",
            borderRadius: "6px",
            fontWeight: 600,
            fontSize: "14px"
          }}
        >
          Go to Dashboard
        </a>
      </div>
    );
  }

  return <>{children}</>;
}

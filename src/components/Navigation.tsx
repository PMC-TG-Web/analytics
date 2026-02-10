"use client";
import { useAuth } from "@/hooks/useAuth";
import { hasPageAccess } from "@/lib/permissions";

interface NavLink {
  href: string;
  label: string;
  page: string;
  color?: string;
}

const navLinks: NavLink[] = [
  { href: "/dashboard", label: "Dashboard", page: "dashboard" },
  { href: "/kpi", label: "KPI", page: "kpi" },
  { href: "/wip", label: "WIP", page: "wip", color: "#E06C00" },
  { href: "/scheduling", label: "Scheduling", page: "scheduling" },
  { href: "/daily-crew-dispatch-board", label: "Crew Dispatch", page: "short-term-schedule", color: "#E06C00" },
  { href: "/short-term-schedule", label: "Short-Term", page: "short-term-schedule", color: "#E06C00" },
  { href: "/long-term-schedule", label: "Long-Term", page: "long-term-schedule" },
  { href: "/project-schedule", label: "Project Gantt", page: "project-schedule", color: "#E06C00" },
  { href: "/field", label: "Field Log", page: "field", color: "#15616D" },
  { href: "/employees", label: "Employees", page: "employees" },
  { href: "/kpi-cards-management", label: "Manage", page: "kpi-cards-management" },
];

export default function Navigation({ currentPage }: { currentPage?: string }) {
  const { user, loading } = useAuth();

  if (loading || !user) {
    return null; // Don't show navigation while loading or not authenticated
  }

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
      {navLinks.map((link) => {
        // Only show links the user has access to
        if (!hasPageAccess(user.email, link.page)) {
          return null;
        }

        const isActive = currentPage === link.page;
        const bgColor = link.color || "#15616D";

        return (
          <a
            key={link.href}
            href={link.href}
            style={{
              padding: "6px 10px",
              background: isActive ? bgColor : bgColor,
              color: "#fff",
              borderRadius: 4,
              textDecoration: "none",
              fontWeight: 700,
              fontSize: 12,
              opacity: isActive ? 1 : 0.9,
              border: isActive ? "2px solid #fff" : "2px solid transparent",
            }}
          >
            {link.label}
          </a>
        );
      })}
      
      {/* Logout Button */}
      <a
        href="/api/auth/logout"
        style={{
          padding: "6px 10px",
          background: "#666",
          color: "#fff",
          borderRadius: 4,
          textDecoration: "none",
          fontWeight: 700,
          fontSize: 12,
          opacity: 0.8,
          marginLeft: "10px"
        }}
      >
        Sign Out
      </a>
    </div>
  );
}

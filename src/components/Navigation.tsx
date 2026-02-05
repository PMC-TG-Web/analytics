"use client";

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
  { href: "/long-term-schedule", label: "Long-Term", page: "long-term-schedule" },
  { href: "/kpi-cards-management", label: "Manage", page: "kpi-cards-management" },
];

export default function Navigation({ currentPage }: { currentPage?: string }) {
  // Authentication is temporarily disabled - show all navigation links
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {navLinks.map((link) => {
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
    </div>
  );
}

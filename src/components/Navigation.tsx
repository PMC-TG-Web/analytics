"use client";
import Link from "next/link";
import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { hasPageAccess } from "@/lib/permissions";

interface NavLink {
  href: string;
  label: string;
  page: string;
}

const navLinks: NavLink[] = [
  { href: "/", label: "Home", page: "home" },
  { href: "/dashboard", label: "Dashboard", page: "dashboard" },
  { href: "/projects", label: "Projects", page: "projects" },
  { href: "/kpi", label: "KPI", page: "kpi" },
  { href: "/wip", label: "WIP", page: "wip" },
  { href: "/scheduling", label: "Scheduling", page: "scheduling" },
  { href: "/daily-crew-dispatch-board", label: "Crew Dispatch", page: "crew-dispatch" },
  { href: "/crew-management", label: "Crew Management", page: "crew-management" },
  { href: "/short-term-schedule", label: "Short-Term", page: "short-term-schedule" },
  { href: "/long-term-schedule", label: "Long-Term", page: "long-term-schedule" },
  { href: "/project-schedule", label: "Project Gantt", page: "project-schedule" },
  { href: "/estimating-tools", label: "Estimating", page: "estimating-tools" },
  { href: "/constants", label: "Constants", page: "constants" },
  { href: "/employees", label: "Employees", page: "employees" },
  { href: "/certifications", label: "Certifications", page: "employees" },
  { href: "/equipment", label: "Equipment", page: "equipment" },
  { href: "/holidays", label: "Holidays", page: "holidays" },
  { href: "/procore", label: "Procore", page: "procore" },
  { href: "/onboarding/submissions", label: "Onboarding", page: "employees" },
  { href: "/employees/handbook", label: "Handbook", page: "handbook" },
  { href: "/kpi-cards-management", label: "Manage", page: "kpi-cards-management" },
];

export const GlobalNavigationContext = createContext(false);

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Navigation({
  currentPage,
  forceRender = false,
}: {
  currentPage?: string;
  forceRender?: boolean;
}) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const isGlobalNavigationManaged = useContext(GlobalNavigationContext);

  if (isGlobalNavigationManaged && !forceRender) {
    return null;
  }
  
  // Show navigation even without authentication for static export
  if (loading) {
    return null;
  }

  return (
    <nav className="flex flex-wrap items-center justify-end gap-1.5">
      {navLinks.map((link) => {
        // Skip permission check in static mode, or check only if user exists
        if (user && !hasPageAccess(user.email, link.page)) {
          return null;
        }

        const isActive =
          currentPage === link.page ||
          isActivePath(pathname || "", link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`
              px-2.5 py-1.5 rounded text-[11px] font-black no-underline transition-colors
              ${
                isActive
                  ? "bg-teal-700 text-white border border-teal-800"
                  : "bg-gray-200 text-gray-700 border border-gray-300 hover:bg-gray-300"
              }
            `}
          >
            {link.label}
          </Link>
        );
      })}
      
      <a
      href="/api/auth/logout"
      target="_top"
      className="ml-2 px-2.5 py-1.5 rounded text-[11px] font-black text-white bg-red-700 border border-red-800 hover:bg-red-800 no-underline transition-colors"
    >
      Sign Out
    </a>
    </nav>
  );
}

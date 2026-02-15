"use client";
import Link from "next/link";
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
  { href: "/wip", label: "WIP", page: "wip", color: "bg-orange-600" },
  { href: "/scheduling", label: "Scheduling", page: "scheduling" },
  { href: "/daily-crew-dispatch-board", label: "Crew Dispatch", page: "short-term-schedule", color: "bg-orange-600" },
  { href: "/short-term-schedule", label: "Short-Term", page: "short-term-schedule", color: "bg-orange-600" },
  { href: "/long-term-schedule", label: "Long-Term", page: "long-term-schedule" },
  { href: "/project-schedule", label: "Project Gantt", page: "project-schedule", color: "bg-orange-600" },
  { href: "/field", label: "Field Log", page: "field", color: "bg-teal-700" },
  { href: "/estimating-tools", label: "Estimating", page: "estimating-tools", color: "bg-red-800" },
  { href: "/constants", label: "Constants", page: "constants", color: "bg-gray-700" },
  { href: "/employees", label: "Employees", page: "employees" },
  { href: "/certifications", label: "Certifications", page: "employees" },
  { href: "/onboarding/submissions", label: "Onboarding", page: "employees", color: "bg-teal-700" },
  { href: "/kpi-cards-management", label: "Manage", page: "kpi-cards-management" },
];

export default function Navigation({ currentPage }: { currentPage?: string }) {
  const { user, loading } = useAuth();
  // We can use window.location.pathname if we want, but sticking to existing pattern
  
  if (loading || !user) {
    return null;
  }

  return (
    <nav className="flex flex-wrap items-center justify-end gap-1.5">
      {navLinks.map((link) => {
        if (!hasPageAccess(user.email, link.page)) {
          return null;
        }

        // Improved active check
        const isActive = currentPage === link.page || (typeof window !== 'undefined' && window.location.pathname === link.href);
        const bgColor = link.color || "bg-teal-800";

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`
              px-2.5 py-1.5 rounded text-[11px] font-bold text-white no-underline transition-all
              ${bgColor} 
              ${isActive ? "ring-2 ring-white ring-inset opacity-100" : "opacity-85 hover:opacity-100"}
            `}
          >
            {link.label}
          </Link>
        );
      })}
      
      <a
        href="/api/auth/logout"
        className="ml-2 px-2.5 py-1.5 rounded text-[11px] font-bold text-white bg-gray-500 hover:bg-gray-600 no-underline opacity-80 transition-all"
      >
        Sign Out
      </a>
    </nav>
  );
}

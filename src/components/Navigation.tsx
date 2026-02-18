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
  { href: "/", label: "Home", page: "home", color: "bg-red-900" },
  { href: "/dashboard", label: "Dashboard", page: "dashboard", color: "bg-stone-800" },
  { href: "/projects", label: "Projects", page: "projects", color: "bg-stone-700" },
  { href: "/kpi", label: "KPI", page: "kpi", color: "bg-stone-800" },
  { href: "/wip", label: "WIP", page: "wip", color: "bg-red-800" },
  { href: "/productivity", label: "Productivity", page: "productivity", color: "bg-purple-800" },
  { href: "/scheduling", label: "Scheduling", page: "scheduling", color: "bg-stone-800" },
  { href: "/daily-crew-dispatch-board", label: "Crew Dispatch", page: "crew-dispatch", color: "bg-red-900" },
  { href: "/short-term-schedule", label: "Short-Term", page: "short-term-schedule", color: "bg-red-800" },
  { href: "/long-term-schedule", label: "Long-Term", page: "long-term-schedule", color: "bg-stone-700" },
  { href: "/project-schedule", label: "Project Gantt", page: "project-schedule", color: "bg-red-900" },
  { href: "/field", label: "Field Log", page: "field", color: "bg-stone-800" },
  { href: "/estimating-tools", label: "Estimating", page: "estimating-tools", color: "bg-red-950" },
  { href: "/constants", label: "Constants", page: "constants", color: "bg-stone-600" },
  { href: "/employees", label: "Employees", page: "employees", color: "bg-stone-800" },
  { href: "/certifications", label: "Certifications", page: "employees", color: "bg-stone-700" },
  { href: "/equipment", label: "Equipment", page: "equipment", color: "bg-stone-800" },
  { href: "/holidays", label: "Holidays", page: "holidays", color: "bg-stone-700" },
  { href: "/procore", label: "Procore", page: "procore", color: "bg-orange-700" },
  { href: "/onboarding/submissions", label: "Onboarding", page: "employees", color: "bg-stone-700" },
  { href: "/employees/handbook", label: "Handbook", page: "handbook", color: "bg-stone-600" },
  { href: "/kpi-cards-management", label: "Manage", page: "kpi-cards-management", color: "bg-stone-900" },
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
              px-2.5 py-1.5 rounded text-[11px] font-black text-white no-underline transition-all
              ${bgColor} 
              ${isActive ? "ring-2 ring-white ring-inset opacity-100 scale-105" : "opacity-95 hover:opacity-100"}
            `}
          >
            {link.label}
          </Link>
        );
      })}
      
      <a
      href="/api/auth/logout"
      target="_top"
      className="ml-2 px-2.5 py-1.5 rounded text-[11px] font-black text-white bg-gray-800 hover:bg-black no-underline transition-all shadow-sm"
    >
      Sign Out
    </a>
    </nav>
  );
}

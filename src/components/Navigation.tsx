"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { hasPageAccess, USER_PERMISSIONS } from "@/lib/permissions";

const AUTH_LOGOUT_SIGNAL_KEY = "analytics-auth-logout";
const AUTH_LOGOUT_SIGNAL_CHANNEL = "analytics-auth-logout";
const AUTH_LOGOUT_CONTEXT_KEY = "analytics-auth-logout-context";
const NAV_PERMISSIONS_CACHE_PREFIX = "analytics-nav-permissions:";
const NAV_PERMISSIONS_CACHE_TTL_MS = 5 * 60 * 1000;

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
  { href: "/crew-management", label: "Crew Management", page: "crew-management" },
  { href: "/estimating-tools", label: "Estimating", page: "estimating-tools" },
  { href: "/constants", label: "Constants", page: "constants" },
  { href: "/employees", label: "Employees", page: "employees" },
  { href: "/certifications", label: "Certifications", page: "employees" },
  { href: "/equipment", label: "Equipment", page: "equipment" },
  { href: "/holidays", label: "Holidays", page: "holidays" },
  { href: "/procore/projects-feed-tools", label: "Procore Feed", page: "procore" },
  { href: "/procore/productivity-feed", label: "Prod Feed", page: "procore" },
  { href: "/procore/timecard-entries", label: "Timecards", page: "procore" },
  { href: "/procore/proposal-line-items-live", label: "Line Items", page: "procore" },
  { href: "/procore/commitments-live", label: "Commitments", page: "procore" },
  { href: "/procore/scope-mapping-review", label: "Scope Map", page: "procore" },
  { href: "/analytics", label: "Analytics", page: "analytics" },
  { href: "/reporting", label: "Reporting", page: "reporting" },
  { href: "/onboarding/submissions", label: "Onboarding", page: "employees" },
  { href: "/employees/handbook", label: "Handbook", page: "handbook" },
  { href: "/kpi-cards-management", label: "Manage", page: "kpi-cards-management" },
];

const scheduleLinks: NavLink[] = [
  { href: "/scheduling", label: "Wip Schedule", page: "scheduling" },
  { href: "/project-schedule", label: "Project Gantt", page: "project-schedule" },
  { href: "/long-term-schedule", label: "Long-Term", page: "long-term-schedule" },
  { href: "/concrete-orders-schedule", label: "Concrete Orders", page: "concrete-orders-schedule" },
  { href: "/short-term-schedule", label: "Short-Term", page: "short-term-schedule" },
  { href: "/daily-crew-dispatch-board", label: "Crew Dispatch", page: "crew-dispatch" },
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
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionsFailed, setPermissionsFailed] = useState(false);

  // Load permissions from database when user logs in
  useEffect(() => {
    if (!user?.email) return;

    const normalizedEmail = user.email.toLowerCase();
    const cacheKey = `${NAV_PERMISSIONS_CACHE_PREFIX}${normalizedEmail}`;

    const applyPermissions = (email: string, permissions: string[]) => {
      Object.keys(USER_PERMISSIONS).forEach(key => delete USER_PERMISSIONS[key]);
      USER_PERMISSIONS[email] = permissions;
    };

    // Use cached permissions immediately for responsive nav, then revalidate.
    try {
      const rawCached = sessionStorage.getItem(cacheKey);
      if (rawCached) {
        const parsed = JSON.parse(rawCached) as {
          email?: string;
          permissions?: unknown;
          cachedAt?: number;
        };
        const isFresh =
          typeof parsed.cachedAt === "number" &&
          Date.now() - parsed.cachedAt < NAV_PERMISSIONS_CACHE_TTL_MS;
        const cachedPermissions = Array.isArray(parsed.permissions)
          ? parsed.permissions.filter((perm): perm is string => typeof perm === "string")
          : [];

        if (isFresh && parsed.email === normalizedEmail && cachedPermissions.length > 0) {
          applyPermissions(normalizedEmail, cachedPermissions);
          setPermissionsLoaded(true);
          setPermissionsFailed(false);
        }
      }
    } catch {
      // Ignore cache parse/storage issues and continue with network fetch.
    }

    const loadPermissions = async () => {
      try {
        console.log('Loading permissions for:', user.email);
        const res = await fetch('/api/permissions/me', { 
          method: 'GET',
          credentials: 'include'
        });
        
        if (!res.ok) {
          console.error('Permissions fetch failed:', res.status, res.statusText);
          setPermissionsFailed(true);
          setPermissionsLoaded(true);
          return;
        }

        const data = await res.json();
        console.log('Permissions fetched:', data);
        
        // Populate USER_PERMISSIONS with the current user's assigned permissions.
        const responsePermissions = Array.isArray(data.data?.expandedPermissions)
          ? data.data.expandedPermissions
          : data.data?.permissions;

        if (data.data?.email && Array.isArray(responsePermissions)) {
          const nextEmail = data.data.email.toLowerCase();
          const nextPermissions = responsePermissions.filter((perm: unknown): perm is string => typeof perm === "string");
          applyPermissions(nextEmail, nextPermissions);
          try {
            sessionStorage.setItem(
              `${NAV_PERMISSIONS_CACHE_PREFIX}${nextEmail}`,
              JSON.stringify({
                email: nextEmail,
                permissions: nextPermissions,
                cachedAt: Date.now(),
              })
            );
          } catch {
            // Ignore storage failures; runtime permissions are still applied.
          }
          console.log('USER_PERMISSIONS updated:', USER_PERMISSIONS);
        }
        setPermissionsFailed(false);
        setPermissionsLoaded(true);
      } catch (error) {
        console.error('Failed to load permissions:', error);
        setPermissionsFailed(true);
        setPermissionsLoaded(true);
      }
    };

    loadPermissions();
  }, [user?.email]);

  useEffect(() => {
    const redirectToSignedOutPage = () => {
      window.location.replace('/auth/logout-complete');
    };

    let channel: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      channel = new BroadcastChannel(AUTH_LOGOUT_SIGNAL_CHANNEL);
      channel.onmessage = (event) => {
        if (event.data === AUTH_LOGOUT_SIGNAL_KEY) {
          redirectToSignedOutPage();
        }
      };
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_LOGOUT_SIGNAL_KEY && event.newValue) {
        redirectToSignedOutPage();
      }
    };

    window.addEventListener("storage", onStorage);

    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  if (isGlobalNavigationManaged && !forceRender) {
    return null;
  }
  
  // Show loading state only while authentication is loading
  if (loading) {
    return null;
  }

  const hasResolvedPermissionsForUser = Boolean(
    user?.email && USER_PERMISSIONS[user.email.toLowerCase()]?.length
  );

  const canAccessLink = (link: NavLink) => {
    if (!user?.email) return false;

    // Keep navigation functional while permission hydration is in flight
    // or temporarily unavailable; backend route guards still enforce access.
    if (!permissionsLoaded && !hasResolvedPermissionsForUser) return true;
    if (permissionsFailed && !hasResolvedPermissionsForUser) return true;

    return hasPageAccess(user.email, link.page);
  };

  const visibleNavLinks = navLinks.filter(canAccessLink);
  const visibleScheduleLinks = scheduleLinks.filter(canAccessLink);

  const renderNavLink = (link: NavLink) => {
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
  };

  return (
    <nav className="flex flex-wrap items-center justify-end gap-2">
      {visibleNavLinks.map(renderNavLink)}

      {visibleScheduleLinks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded border border-gray-300 bg-gray-50 px-2 py-1">
          <span className="px-1 text-[10px] font-black uppercase tracking-widest text-gray-500">Schedules</span>
          {visibleScheduleLinks.map(renderNavLink)}
        </div>
      )}
      
      <button
        type="button"
        onClick={async () => {
          if (window.confirm('Are you sure you want to sign out?')) {
            const currentPath = `${window.location.pathname}${window.location.search}`;
            const isEmbedded = (() => {
              try {
                return window.self !== window.top;
              } catch {
                return true;
              }
            })();

            try {
              localStorage.setItem(
                AUTH_LOGOUT_CONTEXT_KEY,
                JSON.stringify({
                  source: isEmbedded ? "embedded" : "app",
                  returnTo: currentPath || "/",
                  at: Date.now(),
                })
              );
            } catch {
              // Ignore storage failures and continue with logout.
            }

            const logoutReturnTo = `${window.location.origin}/auth/logout-complete`;
            const logoutUrl = `/api/auth/logout?returnTo=${encodeURIComponent(logoutReturnTo)}`;

            try {
              await fetch('/api/auth/logout/local', {
                method: 'POST',
                credentials: 'include',
              });
            } catch {
              // Ignore local logout failures and continue with Auth0 logout.
            }

            try {
              if (isEmbedded) {
                window.open(logoutUrl, "analytics_logout_tab");
                window.location.replace("/auth/logout-complete");
                return;
              }
            } catch {
              window.open(logoutUrl, "analytics_logout_tab");
              window.location.replace("/auth/logout-complete");
              return;
            }

            window.location.assign(logoutUrl);
          }
        }}
        className="ml-2 px-2.5 py-1.5 rounded text-[11px] font-black text-white bg-red-700 border border-red-800 hover:bg-red-800 transition-colors cursor-pointer"
      >
        Sign Out
      </button>
    </nav>
  );
}

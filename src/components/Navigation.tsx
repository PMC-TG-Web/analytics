"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { expandAssignedPermissions, USER_PERMISSIONS } from "@/lib/permissions";
import { canAccessNavigationLink, createNavigationPermissionRefresh } from "@/lib/navigationPermissions";

const AUTH_LOGOUT_SIGNAL_KEY = "analytics-auth-logout";
const AUTH_LOGOUT_SIGNAL_CHANNEL = "analytics-auth-logout";
const AUTH_LOGOUT_CONTEXT_KEY = "analytics-auth-logout-context";
const NAV_KEEPALIVE_INTERVAL_MS = 45 * 1000;
const NAV_KEEPALIVE_MIN_GAP_MS = 15 * 1000;

interface NavLink {
  href: string;
  label: string;
  page: string;
  fallbackPage?: string;
}

const navLinks: NavLink[] = [
  { href: "/", label: "Home", page: "home" },
  { href: "/pm-dashboard", label: "My Work", page: "pm-dashboard" },
  { href: "/dashboard", label: "Dashboard", page: "dashboard" },
  { href: "/projects", label: "Projects", page: "projects" },
  { href: "/procore", label: "Procore", page: "procore" },
  { href: "/kpi", label: "KPI", page: "kpi" },
  { href: "/wip", label: "WIP", page: "wip" },
  { href: "/crew-management", label: "Crew Management", page: "crew-management" },
  { href: "/estimating-tools", label: "Estimating", page: "estimating-tools" },
  { href: "/constants", label: "Constants", page: "constants" },
  { href: "/employees", label: "Employees", page: "employees" },
  { href: "/certifications", label: "Certifications", page: "certifications" },
  { href: "/equipment", label: "Equipment", page: "equipment" },
  { href: "/holidays", label: "Holidays", page: "holidays" },
  { href: "/procore/timecard-entries", label: "Timecards", page: "procore-timecards", fallbackPage: "procore" },
  { href: "/procore/proposal-line-items-live", label: "Line Items", page: "procore-line-items", fallbackPage: "procore" },
  { href: "/procore/commitments-live", label: "Commitments", page: "procore-commitments", fallbackPage: "procore" },
  { href: "/procore/scope-mapping-review", label: "Scope Map", page: "procore-scope-map", fallbackPage: "procore" },
  { href: "/analytics", label: "Analytics", page: "analytics" },
  { href: "/market-outlook", label: "Market Outlook", page: "market-outlook", fallbackPage: "analytics" },
  { href: "/analytics/monthly-hours", label: "Financial WIP", page: "analytics-monthly-hours", fallbackPage: "analytics" },
  { href: "/analytics/cost-code-sales", label: "Cost Code P&L", page: "analytics-cost-code-sales", fallbackPage: "analytics" },
  { href: "/accounting/project-profitability", label: "QBO P&L", page: "accounting-project-profitability", fallbackPage: "admin" },
  { href: "/accounting/direct-cost-bills", label: "QBO Direct Costs", page: "accounting-direct-cost-bills", fallbackPage: "admin" },
  { href: "/reporting", label: "Reporting", page: "reporting" },
  { href: "/onboarding/submissions", label: "Onboarding", page: "onboarding" },
  { href: "/employees/handbook", label: "Handbook", page: "handbook" },
  { href: "/kpi-cards-management", label: "Manage", page: "kpi-cards-management" },
  { href: "/help", label: "Help", page: "help" },
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

  const [permissionSnapshot, setPermissionSnapshot] = useState<{
    email: string;
    permissions: string[];
  } | null>(null);

  // Always read current assignments on mount and apply subsequent background reads.
  // Session storage and module memory must not suppress permission refreshes.
  useEffect(() => {
    if (!user?.email || (isGlobalNavigationManaged && !forceRender)) return;
    const email = user.email.trim().toLowerCase();
    let lastRefreshAt = 0;
    const refresh = createNavigationPermissionRefresh({
      email,
      fetchPermissions: (signal) => fetch('/api/permissions/me', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal,
      }),
      onPermissions: (permissions) => {
        USER_PERMISSIONS[email] = permissions;
        setPermissionSnapshot({ email, permissions: expandAssignedPermissions(permissions) });
        setPermissionsLoaded(true);
        setPermissionsFailed(false);
      },
      onError: () => {
        setPermissionsLoaded(true);
        setPermissionsFailed(true);
      },
    });
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshAt < NAV_KEEPALIVE_MIN_GAP_MS) return;
      lastRefreshAt = Date.now();
      void refresh.refresh();
    };
    refreshIfVisible();
    const timer = setInterval(refreshIfVisible, NAV_KEEPALIVE_INTERVAL_MS);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      refresh.dispose();
      clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [user?.email, isGlobalNavigationManaged, forceRender]);

  useEffect(() => {
    const redirectToSignedOutPage = () => {
      try { sessionStorage.removeItem('analytics-auth-user'); } catch { /* Storage may be unavailable. */ }
      window.location.replace('/auth/logout-complete');
    };

    let channel: BroadcastChannel | null = null;
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        channel = new BroadcastChannel(AUTH_LOGOUT_SIGNAL_CHANNEL);
        channel.onmessage = (event) => {
          if (event.data === AUTH_LOGOUT_SIGNAL_KEY) redirectToSignedOutPage();
        };
      }
    } catch { /* Browser privacy settings may disable cross-tab storage. */ }

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

  const currentPermissions = permissionSnapshot?.email === user?.email?.trim().toLowerCase()
    ? permissionSnapshot?.permissions
    : null;

  const canAccessLink = (link: NavLink) => canAccessNavigationLink(link, {
    email: user?.email,
    permissions: currentPermissions,
    loaded: permissionsLoaded,
    failed: permissionsFailed,
  });

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
          px-2.5 py-1.5 rounded text-[11px] font-black no-underline transition-colors active:scale-95
          ${
            isActive
              ? "bg-teal-700 text-white border border-teal-800"
              : "bg-gray-200 text-gray-700 border border-gray-300 hover:bg-gray-300 active:bg-gray-400"
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
              const localLogout = await fetch('/api/auth/logout/local', {
                method: 'POST',
                credentials: 'include',
                signal: AbortSignal.timeout(15_000),
              });
              if (!localLogout.ok) throw new Error('Sign-out was not confirmed.');
              const result = await localLogout.json();
              if (result?.success !== true) throw new Error('Sign-out was not confirmed.');
              try { sessionStorage.removeItem('analytics-auth-user'); } catch { /* Continue signing out. */ }
              if (result?.developerSession === true) {
                // Developer accounts have no Auth0 session to sign out of.
                try { localStorage.setItem(AUTH_LOGOUT_SIGNAL_KEY, String(Date.now())); } catch { /* Continue. */ }
                window.location.replace('/dev-login');
                return;
              }
              if (result?.procoreSession === true) {
                window.location.replace('/auth/logout-complete');
                return;
              }
            } catch {
              window.alert('We could not confirm sign-out. Please try Sign Out again.');
              return;
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

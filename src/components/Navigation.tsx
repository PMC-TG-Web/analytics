"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { hasPageAccess, USER_PERMISSIONS } from "@/lib/permissions";

const AUTH_LOGOUT_SIGNAL_KEY = "analytics-auth-logout";
const AUTH_LOGOUT_SIGNAL_CHANNEL = "analytics-auth-logout";
const AUTH_LOGOUT_CONTEXT_KEY = "analytics-auth-logout-context";
const NAV_PERMISSIONS_CACHE_PREFIX = "analytics-nav-permissions:v2:";
const NAV_PERMISSIONS_CACHE_TTL_MS = 60 * 60 * 1000;
const PERMISSIONS_FETCH_TIMEOUT_MS = 8000;
const PERMISSIONS_FETCH_MAX_ATTEMPTS = 2;
const NAV_KEEPALIVE_INTERVAL_MS = 45 * 1000;
const NAV_KEEPALIVE_MIN_GAP_MS = 15 * 1000;
const NAV_KEEPALIVE_TIMEOUT_MS = 4000;

interface NavLink {
  href: string;
  label: string;
  page: string;
}

const navLinks: NavLink[] = [
  { href: "/", label: "Home", page: "home" },
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
  { href: "/procore/timecard-entries", label: "Timecards", page: "procore" },
  { href: "/procore/proposal-line-items-live", label: "Line Items", page: "procore" },
  { href: "/procore/commitments-live", label: "Commitments", page: "procore" },
  { href: "/procore/scope-mapping-review", label: "Scope Map", page: "procore" },
  { href: "/analytics", label: "Analytics", page: "analytics" },
  { href: "/analytics/cost-code-sales", label: "Cost Code P&L", page: "analytics" },
  { href: "/accounting/project-profitability", label: "QBO P&L", page: "admin" },
  { href: "/reporting", label: "Reporting", page: "reporting" },
  { href: "/onboarding/submissions", label: "Onboarding", page: "onboarding" },
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

    // If permissions are already resolved in-memory, avoid a redundant network call.
    if (Array.isArray(USER_PERMISSIONS[normalizedEmail]) && USER_PERMISSIONS[normalizedEmail].length > 0) {
      setPermissionsLoaded(true);
      setPermissionsFailed(false);
      return;
    }

    const applyPermissions = (email: string, permissions: string[]) => {
      USER_PERMISSIONS[email] = permissions;
    };

    const checkCacheAndLoad = () => {
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
            return;
          }
        }
      } catch {
        // Ignore cache parse/storage issues
      }

      void loadPermissions();
    };

    const loadPermissions = async () => {
      try {
        console.log('Loading permissions for:', user.email);

        let res: Response | null = null;
        let lastError: unknown = null;

        for (let attempt = 1; attempt <= PERMISSIONS_FETCH_MAX_ATTEMPTS; attempt += 1) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), PERMISSIONS_FETCH_TIMEOUT_MS);

          try {
            res = await fetch('/api/permissions/me', {
              method: 'GET',
              credentials: 'include',
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            break;
          } catch (error) {
            clearTimeout(timeoutId);
            lastError = error;

            const isAbort = error instanceof Error && error.name === 'AbortError';
            if (!isAbort || attempt >= PERMISSIONS_FETCH_MAX_ATTEMPTS) {
              throw error;
            }

            // Brief backoff before retrying a timed-out request.
            await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
          }
        }

        if (!res) {
          throw lastError instanceof Error ? lastError : new Error('Permissions request failed');
        }
        
        if (!res.ok) {
          console.error('Permissions fetch failed:', res.status, res.statusText);
          setPermissionsFailed(true);
          setPermissionsLoaded(true);
          return;
        }

        const data = await res.json();
        console.log('Permissions fetched:', data);
        
        // Populate USER_PERMISSIONS with the current user's assigned permissions.
        // Store the assigned permissions and expand them locally. This keeps group
        // definitions authoritative and prevents stale expanded lists from hiding
        // newly added administrative pages.
        const responsePermissions = Array.isArray(data.data?.permissions)
          ? data.data.permissions
          : data.data?.expandedPermissions;

        if (data.data?.email && Array.isArray(responsePermissions)) {
          const nextEmail = data.data.email.toLowerCase();
          const nextPermissions = responsePermissions.filter((perm: unknown): perm is string => typeof perm === "string");

          // Do not overwrite known permissions with an empty payload.
          // Empty arrays can occur during transient auth/session propagation.
          if (nextPermissions.length === 0) {
            setPermissionsFailed(true);
            setPermissionsLoaded(true);
            return;
          }

          applyPermissions(nextEmail, nextPermissions);
          // Defer sessionStorage write to avoid blocking main thread
          if ("requestIdleCallback" in window) {
            requestIdleCallback(() => {
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
                // Ignore storage failures
              }
            });
          } else {
            setTimeout(() => {
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
                // Ignore storage failures
              }
            }, 0);
          }
          console.log('USER_PERMISSIONS updated:', USER_PERMISSIONS);
        }
        setPermissionsFailed(false);
        setPermissionsLoaded(true);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.warn(`Permission fetch timed out after ${PERMISSIONS_FETCH_TIMEOUT_MS / 1000}s`);
        } else {
          console.error('Failed to load permissions:', error);
        }
        setPermissionsFailed(true);
        setPermissionsLoaded(true);
      }
    };

    checkCacheAndLoad();
  }, [user?.email]);

  // Keep auth/permission path warm so first navigation after idle is faster.
  useEffect(() => {
    if (!user?.email) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let lastPingAt = 0;

    const ping = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      const now = Date.now();
      if (now - lastPingAt < NAV_KEEPALIVE_MIN_GAP_MS) return;
      lastPingAt = now;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), NAV_KEEPALIVE_TIMEOUT_MS);

      try {
        await fetch('/api/permissions/me', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch {
        // Silent on purpose: this is only a best-effort warm ping.
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const onVisibleOrFocus = () => {
      void ping();
    };

    // Warm once immediately so first navigation click is less likely to hit a cold path.
    void ping();

    timer = setInterval(() => {
      void ping();
    }, NAV_KEEPALIVE_INTERVAL_MS);

    window.addEventListener("focus", onVisibleOrFocus);
    document.addEventListener("visibilitychange", onVisibleOrFocus);

    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("focus", onVisibleOrFocus);
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
    };
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

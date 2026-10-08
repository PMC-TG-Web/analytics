"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Navigation, { GlobalNavigationContext } from "@/components/Navigation";
import Link from "next/link";
import { getHelpGuideSummaryForPath, helpGuidePath } from "@/lib/helpGuides/catalog";

const NAV_HIDDEN_PREFIXES = [
  "/login",
  "/auth",
  "/forbidden",
  "/dev-login",
  "/daily-crew-dispatch-board",
  "/pm-dashboard",
];

function shouldShowGlobalNav(pathname: string): boolean {
  return !NAV_HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const guide = getHelpGuideSummaryForPath(pathname);
  const showGlobalNav = shouldShowGlobalNav(pathname);
  const hideNavOnMobile = pathname === "/analytics" || pathname.startsWith("/analytics/");
  const contentClassName = !showGlobalNav
    ? "app-content"
    : hideNavOnMobile
      ? "app-content-with-nav-analytics"
      : "app-content-with-nav";

  return (
    <GlobalNavigationContext.Provider value={showGlobalNav}>
      {showGlobalNav && (
        <header
          className={`sticky top-0 z-50 border-b border-gray-300 bg-gray-100/95 px-6 py-3 backdrop-blur ${
            hideNavOnMobile ? "hidden lg:block" : ""
          }`}
        >
          <Navigation forceRender />
        </header>
      )}
      <div className={contentClassName}>
        {guide && <nav aria-label="Page help" className="flex justify-end border-b border-slate-200 bg-white px-4 py-2 text-sm print:hidden">
          <Link href={helpGuidePath(guide)} className="rounded px-2 py-1 font-semibold text-teal-800 hover:bg-teal-50 hover:underline">Help with this page<span className="sr-only">: {guide.pageLabel}</span> →</Link>
        </nav>}
        {children}
      </div>
    </GlobalNavigationContext.Provider>
  );
}

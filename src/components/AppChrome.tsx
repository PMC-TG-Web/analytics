"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Navigation, { GlobalNavigationContext } from "@/components/Navigation";

const NAV_HIDDEN_PREFIXES = ["/login", "/auth", "/forbidden", "/dev-login", "/daily-crew-dispatch-board"];

function shouldShowGlobalNav(pathname: string): boolean {
  return !NAV_HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
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
      <div className={contentClassName}>{children}</div>
    </GlobalNavigationContext.Provider>
  );
}

import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

const frameAncestors = [
  "'self'",
  "https://*.procore.com",
  "https://procore.com",
  ...(process.env.FRAME_ANCESTORS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
].join(" ");

const isProduction = process.env.NODE_ENV === "production";
const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  ...(isProduction ? [] : ["'unsafe-eval'"]),
  "https://cdn.jsdelivr.net",
].join(" ");

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {
    root: configDir,
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    // Retire the old scheduling surfaces; shared APIs and historical data remain
    // available to existing non-scheduling consumers until separately migrated.
    return [
      '/scheduling', '/project-schedule', '/long-term-schedule',
      '/short-term-schedule', '/concrete-orders-schedule', '/daily-crew-dispatch-board',
      '/help/wip-schedule', '/help/project-gantt', '/help/long-term',
      '/help/short-term', '/help/crew-dispatch', '/help/concrete-orders',
    ].map(source => ({ source, destination: source.startsWith('/help/') ? '/help/wip' : '/wip', permanent: false }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; base-uri 'self'; object-src 'none'; script-src ${scriptSources}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors ${frameAncestors};`,
          },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

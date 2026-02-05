import { ReactNode } from "react";

interface ProtectedPageProps {
  children: ReactNode;
  page: string;
  requireAuth?: boolean;
}

/**
 * ProtectedPage component - temporarily disabling Auth0 integration
 * Will re-enable once Auth0 SDK is properly configured with Next.js 16
 */
export default function ProtectedPage({ children, page, requireAuth = true }: ProtectedPageProps) {
  // Temporarily bypass authentication to allow app to load
  // TODO: Re-enable Auth0 authentication once SDK is working
  return <>{children}</>;
}

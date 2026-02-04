"use client";
import { useEffect, useState } from "react";
import { hasPageAccess } from "@/lib/permissions";

interface User {
  email: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for email in cookie by making a simple fetch to see if user is logged in
    async function checkAuth() {
      try {
        const response = await fetch('/api/check-auth');
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          setError('Not authenticated');
        }
      } catch (err) {
        setError('Failed to check auth');
      } finally {
        setLoading(false);
      }
    }

    checkAuth();
  }, []);

  const checkAccess = (page: string) => {
    return hasPageAccess(user?.email || null, page);
  };

  return { user, loading, error, checkAccess };
}

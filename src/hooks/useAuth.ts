"use client";
import { useEffect, useState } from "react";
import { hasPageAccess } from "@/lib/permissions";

interface User {
  email: string;
  name?: string | null;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        console.log('Checking auth status...');
        const response = await fetch('/api/auth/me');
        if (response.ok) {
          const userData = await response.json();
          console.log('User is authenticated:', userData.email);
          setUser(userData);
        } else {
          console.log('User is not authenticated (401)');
          setError('Not authenticated');
        }
      } catch (err) {
        console.error('Auth check fetch error:', err);
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

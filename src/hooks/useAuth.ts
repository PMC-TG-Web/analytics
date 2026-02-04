"use client";
import { useEffect, useState } from "react";
import { hasPageAccess } from "@/lib/permissions";

interface ProcoreUser {
  id: number;
  email: string;
  name: string;
  company?: any;
}

export function useAuth() {
  const [user, setUser] = useState<ProcoreUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const response = await fetch('/api/procore/me');
        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
        } else {
          setError('Not authenticated');
        }
      } catch (err) {
        setError('Failed to fetch user');
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, []);

  const checkAccess = (page: string) => {
    return hasPageAccess(user?.email || null, page);
  };

  return { user, loading, error, checkAccess };
}

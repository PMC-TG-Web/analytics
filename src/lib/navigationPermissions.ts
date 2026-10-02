type PermissionRefreshOptions = {
  email: string;
  fetchPermissions: (signal: AbortSignal) => Promise<Response>;
  onPermissions: (permissions: string[]) => void;
  onError: () => void;
};

// One active read per navigation instance; late responses after logout are ignored.
export function createNavigationPermissionRefresh(options: PermissionRefreshOptions) {
  let disposed = false;
  let pending = false;
  let controller: AbortController | null = null;

  return {
    async refresh() {
      if (disposed || pending) return;
      pending = true;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          controller = new AbortController();
          const timeout = setTimeout(() => controller?.abort(), 8000);
          try {
            const response = await options.fetchPermissions(controller.signal);
            if (!response.ok) throw new Error('Permission request failed');
            const payload = await response.json();
            const data = payload?.data;
            if (typeof data?.email !== 'string'
              || data.email.trim().toLowerCase() !== options.email.trim().toLowerCase()
              || !Array.isArray(data.permissions)
              || !data.permissions.every((permission: unknown) => typeof permission === 'string')) {
              throw new Error('Invalid permission response');
            }
            // An empty list is a valid revocation and must replace older grants.
            if (!disposed) options.onPermissions(data.permissions);
            return;
          } catch (error) {
            if (disposed) return;
            if (!(error instanceof Error && error.name === 'AbortError') || attempt === 1) throw error;
          } finally {
            clearTimeout(timeout);
          }
        }
      } catch {
        if (!disposed) options.onError();
      } finally {
        pending = false;
      }
    },
    dispose() {
      disposed = true;
      controller?.abort();
    },
  };
}

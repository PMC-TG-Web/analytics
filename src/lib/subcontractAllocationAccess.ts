/** Temporary private rollout. Role membership cannot expand this allowlist. */
export function canAccessSubcontractAllocation(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase() === 'todd@pmcdecor.com';
}

export function isSubcontractAllocationPath(pathname: string): boolean {
  return ['/procore/commitments-live/allocation', '/api/procore/commitments-live/allocation']
    .some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

import { notFound } from 'next/navigation';
import { getAllocationUserEmail } from '@/lib/subcontractAllocationSession';
import { canAccessSubcontractAllocation } from '@/lib/subcontractAllocationAccess';

export const dynamic = 'force-dynamic';

export default async function AllocationLayout({ children }: { children: React.ReactNode }) {
  if (!canAccessSubcontractAllocation(await getAllocationUserEmail())) notFound();
  return children;
}

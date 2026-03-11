/**
 * deleteCustomersAndProjects.cjs
 * Hard-delete projects for specific customers and rely on relational cascades.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TARGETS = [
  'SOP Inc',
  'Paradise Masonry, LLC',
  'Raymond King',
];

function matchesTarget(customer) {
  const c = (customer || '').toLowerCase().trim();
  if (!c) return false;
  if (c === 'paradise masonry, llc') return true;
  if (c === 'raymond king') return true;
  if (c === 'sop inc' || c === 'sop, inc' || c.includes('sop inc')) return true;
  return false;
}

async function main() {
  const all = await prisma.project.findMany({
    select: { id: true, customer: true, projectName: true, status: true, hours: true },
  });

  const toDelete = all.filter(p => matchesTarget(p.customer));

  console.log(`Target customer labels: ${TARGETS.join(', ')}`);
  console.log(`Projects matched for deletion: ${toDelete.length}`);

  if (toDelete.length === 0) {
    console.log('No matching projects found.');
    return;
  }

  const byCustomer = {};
  for (const p of toDelete) {
    const k = p.customer || 'UNKNOWN';
    byCustomer[k] = (byCustomer[k] || 0) + 1;
  }
  console.log('Matched by customer:', byCustomer);

  const ids = toDelete.map(p => p.id);

  await prisma.$transaction(async (tx) => {
    // Delete dependent rows with onDelete:SetNull to avoid orphan analytics noise
    await tx.productivityLog.deleteMany({ where: { projectId: { in: ids } } });
    await tx.productivitySummary.deleteMany({ where: { projectId: { in: ids } } });

    // Main delete (cascades to scopes/schedules/active schedules/scope tracking/pmc cache)
    await tx.project.deleteMany({ where: { id: { in: ids } } });
  });

  const remaining = await prisma.project.findMany({
    where: {
      OR: [
        { customer: { equals: 'SOP Inc', mode: 'insensitive' } },
        { customer: { equals: 'Paradise Masonry, LLC', mode: 'insensitive' } },
        { customer: { equals: 'Raymond King', mode: 'insensitive' } },
      ]
    },
    select: { id: true, customer: true, projectName: true }
  });

  console.log(`Remaining exact-name matches: ${remaining.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

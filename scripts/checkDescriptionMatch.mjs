import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

// Check rows where costItem has trailing space (stored pre-trim from old inserts)
const trailing = await p.pmcGroupMapping.findMany({
  where: { costItem: { endsWith: " " } },
  take: 5,
  select: { costItem: true, costItemNorm: true, pmcGroup: true },
});
console.log("Rows with trailing-space costItem:", JSON.stringify(trailing, null, 2));

// Also check costItemNorm has any spaces
const normSpaces = await p.$queryRawUnsafe(
  `SELECT "costItem", "costItemNorm" FROM "PmcGroupMapping" WHERE "costItemNorm" != trim(lower("costItemNorm")) LIMIT 5`
);
console.log("CostItemNorm with inconsistent normalization:", JSON.stringify(normSpaces, null, 2));

// Sample a few description values from PO details to see what we're matching against
const details = await p.purchaseOrderLineItemContractDetail.findMany({
  where: { description: { not: null } },
  take: 10,
  select: { description: true },
});
console.log("Sample PO descriptions:", details.map(d => JSON.stringify(d.description)));

await p.$disconnect();

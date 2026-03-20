import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const count = await p.pmcGroupMapping.count();
console.log("Row count:", count);
if (count > 0) {
  const rows = await p.pmcGroupMapping.findMany({ take: 5 });
  console.log("Sample rows:", JSON.stringify(rows, null, 2));
} else {
  console.log("Table is empty — no mappings have been saved yet.");
}
await p.$disconnect();

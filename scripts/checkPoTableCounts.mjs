import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const contracts = await prisma.purchaseOrderContract.count();
  const details = await prisma.purchaseOrderLineItemContractDetail.count();
  const unpacked = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM purchase_order_line_item_contract_detail_unpacked_fields"
  );
  console.log(`PurchaseOrderContract count: ${contracts}`);
  console.log(`PurchaseOrderLineItemContractDetail count: ${details}`);

  const unpackedCount = Array.isArray(unpacked) && unpacked.length ? Number(unpacked[0].count || 0) : 0;
  console.log(`purchase_order_line_item_contract_detail_unpacked_fields count: ${unpackedCount}`);

  const recentDetails = await prisma.purchaseOrderLineItemContractDetail.findMany({
    take: 5,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      procoreProjectId: true,
      procorePurchaseOrderContractId: true,
      description: true,
      totalAmount: true,
      updatedAt: true,
    },
  });

  console.log("Recent detail rows:");
  for (const row of recentDetails) {
    console.log(
      `${row.updatedAt.toISOString()} | project=${row.procoreProjectId || "-"} | contract=${row.procorePurchaseOrderContractId || "-"} | amount=${row.totalAmount ?? "-"} | ${row.description || "(no description)"}`
    );
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

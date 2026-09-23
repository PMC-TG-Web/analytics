import { Prisma, type PrismaClient, type ProcoreEstimateLineItem } from "@prisma/client";

export const COST_CODE_SALES_PAGE_SIZE = 1_000;

type CostCodeSalesLine = Pick<ProcoreEstimateLineItem,
  "bidBoardProjectId" | "proposalId" | "lineItemId" | "costItemId" | "name" |
  "groupId" | "costCode" | "itemSales" | "laborSales" | "itemCost" | "laborCost"
> & {
  payloadName?: string | null;
  payloadDescription?: string | null;
  costItemName?: string | null;
  costItemDescription?: string | null;
};

// Bound both reads to one ID page to stay below the database gateway response limit.
export async function loadCostCodeSalesLines(
  client: Pick<PrismaClient, "procoreEstimateLineItem" | "$queryRaw">,
  companyId: string,
  selectedProposalIds: string[],
): Promise<CostCodeSalesLine[]> {
  if (!selectedProposalIds.length) return [];
  let lastId: bigint | null = null;
  const lines: CostCodeSalesLine[] = [];
  while (true) {
    const page = await client.procoreEstimateLineItem.findMany({
        where: {
          companyId,
          proposalId: { in: selectedProposalIds },
          ...(lastId === null ? {} : { id: { gt: lastId } }),
        },
        orderBy: { id: "asc" },
        take: COST_CODE_SALES_PAGE_SIZE,
        select: {
          id: true,
          bidBoardProjectId: true,
          proposalId: true,
          lineItemId: true,
          costItemId: true,
          name: true,
          groupId: true,
          costCode: true,
          itemSales: true,
          laborSales: true,
          itemCost: true,
          laborCost: true,
        },
      });
    if (!page.length) break;
    const aliases = await client.$queryRaw<Array<{
        bidBoardProjectId: string;
        proposalId: string;
        lineItemId: string;
        payloadName: string | null;
        payloadDescription: string | null;
        costItemName: string | null;
        costItemDescription: string | null;
      }>>(Prisma.sql`
        SELECT
          bid_board_project_id AS "bidBoardProjectId",
          proposal_id AS "proposalId",
          line_item_id AS "lineItemId",
          payload ->> 'name' AS "payloadName",
          payload ->> 'description' AS "payloadDescription",
          payload -> 'cost_item' ->> 'name' AS "costItemName",
          payload -> 'cost_item' ->> 'description' AS "costItemDescription"
        FROM procore_estimate_line_items
        WHERE company_id = ${companyId}
          AND id IN (${Prisma.join(page.map((line) => line.id))})
      `);
    const aliasesByLine = new Map(aliases.map((row) => [
      `${row.bidBoardProjectId}|${row.proposalId}|${row.lineItemId}`, row,
    ]));
    for (const line of page) {
      lines.push({ ...line, ...aliasesByLine.get(
        `${line.bidBoardProjectId}|${line.proposalId}|${line.lineItemId}`,
      ) });
    }
    if (page.length < COST_CODE_SALES_PAGE_SIZE) break;
    lastId = page[page.length - 1].id;
  }
  return lines;
}

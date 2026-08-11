import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadEstimatingDashboardProjects } from "@/lib/estimatingDashboard";
import {
  aggregateCostCodeSales,
  analyticsPeriod,
  normalizeAnalyticsCostCode,
} from "@/lib/costCodeSalesAnalytics";
import {
  EstimatingCostCodeCatalogMatch,
  loadEstimatingCostCodeAliasCatalog,
  loadEstimatingCostCodeCatalog,
  resolveEstimatingCostCodeAliases,
} from "@/lib/estimatingCostCodeCrosswalk";

export const dynamic = "force-dynamic";

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function lineAliases(line: {
  name: string | null;
  payloadName?: string | null;
  payloadDescription?: string | null;
  costItemName?: string | null;
  costItemDescription?: string | null;
}): unknown[] {
  return [line.name, line.payloadName, line.payloadDescription, line.costItemName, line.costItemDescription];
}

function catalogScope(entry: EstimatingCostCodeCatalogMatch): string {
  const hierarchy = `${entry.topLevelGroup} ${entry.reportingGroup}`.toLowerCase();
  if (/\bfoundation/.test(hierarchy)) return "foundation";
  if (/\bwall/.test(hierarchy)) return "wall";
  if (/\bsog\b|slab on grade/.test(hierarchy)) return "sog";
  if (/\bsite\b/.test(hierarchy)) return "site";
  if (/\bbollard/.test(hierarchy)) return "bollard";
  return "";
}

function canonicalTopLevelGroup(value: string): string {
  return value.trim().toLowerCase() === "job cost" ? "Job Cost" : value.trim();
}

export async function GET() {
  try {
    const companyId = String(process.env.PROCORE_COMPANY_ID || "").trim();
    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing Procore company configuration." }, { status: 500 });
    }

    const projects = await loadEstimatingDashboardProjects();
    const selectedProjects = projects.filter((project) => project.selectedProposalId && project.dateCreated);
    const selectedProposalByBoard = new Map(
      selectedProjects.map((project) => [project.bidBoardId, project.selectedProposalId as string]),
    );
    const projectByBoard = new Map(selectedProjects.map((project) => [project.bidBoardId, project]));
    const catalogByItemId = loadEstimatingCostCodeCatalog();
    const catalogAliases = loadEstimatingCostCodeAliasCatalog();
    const topLevelGroups = [...new Set(
      [...catalogByItemId.values()].map((entry) => canonicalTopLevelGroup(entry.topLevelGroup)),
    )].sort((left, right) => left.localeCompare(right));

    const selectedProposalIds = [...new Set(selectedProjects.map((project) => project.selectedProposalId as string))];
    const [baseLines, costCodes, payloadAliases] = await Promise.all([
      prisma.procoreEstimateLineItem.findMany({
        where: {
          companyId,
          proposalId: { in: selectedProposalIds },
        },
        select: {
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
      }),
      prisma.procoreCostCodeStaging.findMany({
        where: { companyId },
        orderBy: { syncedAt: "desc" },
        select: { code: true, fullCode: true, name: true },
      }),
      selectedProposalIds.length === 0 ? Promise.resolve([]) : prisma.$queryRaw<Array<{
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
          AND proposal_id IN (${Prisma.join(selectedProposalIds)})
      `),
    ]);
    const aliasesByLine = new Map(payloadAliases.map((row) => [
      `${row.bidBoardProjectId}|${row.proposalId}|${row.lineItemId}`,
      row,
    ]));
    const lines = baseLines.map((line) => ({
      ...line,
      ...aliasesByLine.get(`${line.bidBoardProjectId}|${line.proposalId}|${line.lineItemId}`),
    }));
    const costCodeNameByCode = new Map<string, string>();
    for (const row of costCodes) {
      const code = normalizeAnalyticsCostCode(row.fullCode || row.code);
      const name = String(row.name || "").trim();
      if (code !== "UNASSIGNED" && name && !costCodeNameByCode.has(code)) {
        costCodeNameByCode.set(code, name);
      }
    }

    const eligibleLines = lines.filter((line) => {
      const project = projectByBoard.get(line.bidBoardProjectId);
      const hasFinancialValue = [line.itemSales, line.laborSales, line.itemCost, line.laborCost]
        .some((value) => Math.abs(numeric(value)) > 0.000001);
      return project
        && selectedProposalByBoard.get(line.bidBoardProjectId) === line.proposalId
        && hasFinancialValue;
    });
    const lineKey = (line: (typeof eligibleLines)[number]) =>
      `${line.bidBoardProjectId}|${line.proposalId}|${line.lineItemId}`;
    const groupKey = (line: (typeof eligibleLines)[number]) =>
      `${line.bidBoardProjectId}|${line.proposalId}|${line.groupId || "NO_GROUP"}`;
    const preliminaryEntries = new Map<string, EstimatingCostCodeCatalogMatch>();
    const groupEntryCounts = new Map<string, Map<string, { entry: EstimatingCostCodeCatalogMatch; count: number }>>();

    for (const line of eligibleLines) {
      const costItemId = String(line.costItemId || "").trim();
      const itemIdEntry = catalogByItemId.get(costItemId);
      const catalogEntry = itemIdEntry
        ? { itemId: costItemId, ...itemIdEntry }
        : resolveEstimatingCostCodeAliases(lineAliases(line), catalogAliases);
      if (!catalogEntry) continue;
      preliminaryEntries.set(lineKey(line), catalogEntry);
      const counts = groupEntryCounts.get(groupKey(line)) ?? new Map();
      const identity = `${catalogEntry.topLevelGroup}|${catalogEntry.reportingGroup}|${catalogEntry.costCode}`;
      const current = counts.get(identity) ?? { entry: catalogEntry, count: 0 };
      current.count += 1;
      counts.set(identity, current);
      groupEntryCounts.set(groupKey(line), counts);
    }

    const dominantEntries = new Map<string, EstimatingCostCodeCatalogMatch>();
    const categoryHints = new Map<string, string>();
    for (const [key, counts] of groupEntryCounts) {
      const ranked = [...counts.values()].sort((left, right) => right.count - left.count);
      const scopeCounts = new Map<string, number>();
      for (const candidate of ranked) {
        const scope = catalogScope(candidate.entry);
        if (scope) scopeCounts.set(scope, (scopeCounts.get(scope) || 0) + candidate.count);
      }
      const scopes = [...scopeCounts].sort((left, right) => right[1] - left[1]);
      const scope = scopes[0] && scopes[0][1] > (scopes[1]?.[1] ?? 0) ? scopes[0][0] : "";
      if (scope) categoryHints.set(key, scope);
      const scoped = scope ? ranked.filter((candidate) => catalogScope(candidate.entry) === scope) : ranked;
      if (scoped[0]) dominantEntries.set(key, scoped[0].entry);
    }

    const selectedLines = eligibleLines.map((line) => {
      const project = projectByBoard.get(line.bidBoardProjectId)!;
      const costItemId = String(line.costItemId || "").trim();
      const itemIdEntry = catalogByItemId.get(costItemId);
      const preliminaryEntry = preliminaryEntries.get(lineKey(line));
      const dominantEntry = dominantEntries.get(groupKey(line));
      const categoryHint = categoryHints.get(groupKey(line)) || "";
      const contextualEntry = preliminaryEntry || resolveEstimatingCostCodeAliases(
        lineAliases(line),
        catalogAliases,
        categoryHint,
      );
      const catalogEntry = contextualEntry || dominantEntry;
      const directCostCode = String(line.costCode || "").trim();
      const costCode = normalizeAnalyticsCostCode(catalogEntry?.costCode || directCostCode || null);
      const fallbackCostName = costCodeNameByCode.get(costCode) || null;
      return {
        ...line,
        costCode,
        mappingMethod: itemIdEntry
          ? "catalog_item_id"
          : contextualEntry
            ? "catalog_name_or_description"
            : dominantEntry
              ? "catalog_group_context"
              : directCostCode
                ? "procore_cost_code"
                : "unassigned",
        costCodeName: costCode === "UNASSIGNED"
          ? "Unmapped cost items"
          : catalogEntry?.costName || fallbackCostName,
        reportingGroup: catalogEntry?.reportingGroup
          || fallbackCostName
          || (costCode === "UNASSIGNED" ? "Unmapped cost items" : "Name unavailable"),
        topLevelGroup: catalogEntry?.topLevelGroup
          || (costCode === "UNASSIGNED" ? "Unassigned" : "Uncategorized"),
        periodDate: project.dateCreated || null,
        projectId: project.id,
        projectName: project.projectName || "Unnamed Project",
        projectNumber: project.projectNumber || null,
        customer: project.customer || null,
        proposalName: project.proposalName || null,
      };
    });

    const monthly = aggregateCostCodeSales(selectedLines);
    const unassignedGroups = new Map<string, {
      period: string;
      costItemId: string;
      itemName: string;
      sales: number;
      cost: number;
      lineCount: number;
      projectIds: Set<string>;
    }>();
    for (const line of selectedLines) {
      if (line.costCode !== "UNASSIGNED") continue;
      const period = analyticsPeriod(line.periodDate);
      if (!period) continue;
      const costItemId = String(line.costItemId || "").trim() || "NO_ITEM_ID";
      const itemName = String(line.name || "").trim() || "Unnamed item";
      const key = `${period}:${costItemId}:${itemName}`;
      const group = unassignedGroups.get(key) ?? {
        period,
        costItemId,
        itemName,
        sales: 0,
        cost: 0,
        lineCount: 0,
        projectIds: new Set<string>(),
      };
      group.sales += numeric(line.itemSales) + numeric(line.laborSales);
      group.cost += numeric(line.itemCost) + numeric(line.laborCost);
      group.lineCount += 1;
      group.projectIds.add(line.projectId);
      unassignedGroups.set(key, group);
    }
    const unassignedItems = [...unassignedGroups.values()]
      .map((group) => ({
        period: group.period,
        costItemId: group.costItemId,
        itemName: group.itemName,
        sales: group.sales,
        cost: group.cost,
        profit: group.sales - group.cost,
        projectIds: [...group.projectIds],
        projectCount: group.projectIds.size,
        lineCount: group.lineCount,
      }))
      .sort((left, right) => right.sales - left.sales || left.itemName.localeCompare(right.itemName));
    const projectGroups = new Map<string, {
      period: string;
      costCode: string;
      costCodeName: string | null;
      reportingGroup: string;
      topLevelGroup: string;
      projectId: string;
      projectName: string;
      projectNumber: string | null;
      customer: string | null;
      proposalName: string | null;
      sales: number;
      cost: number;
      lineCount: number;
    }>();

    for (const line of selectedLines) {
      const period = analyticsPeriod(line.periodDate);
      if (!period) continue;
      const costCode = normalizeAnalyticsCostCode(line.costCode);
      const key = `${period}:${line.topLevelGroup}:${line.reportingGroup}:${costCode}:${line.projectId}`;
      const group = projectGroups.get(key) ?? {
        period,
        costCode,
        costCodeName: line.costCodeName,
        reportingGroup: line.reportingGroup,
        topLevelGroup: line.topLevelGroup,
        projectId: line.projectId,
        projectName: line.projectName,
        projectNumber: line.projectNumber,
        customer: line.customer,
        proposalName: line.proposalName,
        sales: 0,
        cost: 0,
        lineCount: 0,
      };
      group.sales += numeric(line.itemSales) + numeric(line.laborSales);
      group.cost += numeric(line.itemCost) + numeric(line.laborCost);
      group.lineCount += 1;
      projectGroups.set(key, group);
    }

    const projectBreakdown = [...projectGroups.values()]
      .map((group) => ({
        ...group,
        profit: group.sales - group.cost,
        marginPercent: group.sales ? ((group.sales - group.cost) / group.sales) * 100 : null,
      }))
      .sort((left, right) => right.sales - left.sales || left.projectName.localeCompare(right.projectName));

    return NextResponse.json({
      success: true,
      generatedAt: new Date().toISOString(),
      source: "procore_selected_primary_estimates",
      periodBasis: "bid_board_created_month",
      summary: {
        sales: monthly.reduce((sum, row) => sum + row.sales, 0),
        cost: monthly.reduce((sum, row) => sum + row.cost, 0),
        profit: monthly.reduce((sum, row) => sum + row.profit, 0),
        projectCount: selectedProjects.length,
        lineCount: selectedLines.length,
        mappingMethods: selectedLines.reduce<Record<string, number>>((counts, line) => {
          counts[line.mappingMethod] = (counts[line.mappingMethod] || 0) + 1;
          return counts;
        }, {}),
      },
      years: [...new Set(monthly.map((row) => row.year))].sort((left, right) => right - left),
      topLevelGroups,
      monthly,
      projectBreakdown,
      unassignedItems,
    });
  } catch (error) {
    console.error("Failed to load cost-code sales analytics:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load cost-code sales analytics." },
      { status: 500 },
    );
  }
}
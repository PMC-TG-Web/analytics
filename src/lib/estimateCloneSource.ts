export type EstimateCloneSourceIds = {
  companyId: string;
  proposalId: string;
  projectId?: string;
  bidBoardProjectId?: string;
  bidBoardFallbackId?: string;
};

export type EstimateCloneSourcePaths = {
  proposals: string[];
  proposalCollections: string[];
  lineItems: string[];
  lineItemGroups: string[];
};

export function hasEstimateCloneSource(ids: Pick<EstimateCloneSourceIds, "projectId" | "bidBoardProjectId">): boolean {
  return Boolean(ids.projectId?.trim() || ids.bidBoardProjectId?.trim());
}

export function buildEstimateCloneSourcePaths(ids: EstimateCloneSourceIds): EstimateCloneSourcePaths {
  const companyId = encodeURIComponent(ids.companyId.trim());
  const proposalId = encodeURIComponent(ids.proposalId.trim());
  const projectId = ids.projectId?.trim();
  const bidBoardProjectId = ids.bidBoardProjectId?.trim();
  const bidBoardFallbackId = ids.bidBoardFallbackId?.trim();
  const proposals: string[] = [];
  const proposalCollections: string[] = [];

  if (bidBoardProjectId) {
    const collectionPath = `/rest/v2.0/companies/${companyId}/estimating/bid_board_projects/${encodeURIComponent(
      bidBoardProjectId
    )}/proposals`;
    proposalCollections.push(collectionPath);
    proposals.push(`${collectionPath}/${proposalId}`);
  }

  if (projectId) {
    proposals.push(
      `/rest/v2.0/companies/${companyId}/projects/${encodeURIComponent(
        projectId
      )}/estimating/proposals/${proposalId}`
    );
  }

  if (!bidBoardProjectId && bidBoardFallbackId) {
    const collectionPath = `/rest/v2.0/companies/${companyId}/estimating/bid_board_projects/${encodeURIComponent(
      bidBoardFallbackId
    )}/proposals`;
    proposalCollections.push(collectionPath);
    proposals.push(`${collectionPath}/${proposalId}`);
  }

  return {
    proposals,
    proposalCollections,
    lineItems: proposals.map((proposalPath) => `${proposalPath}/line_items`),
    lineItemGroups: proposals.map((proposalPath) => `${proposalPath}/line_item_groups`),
  };
}

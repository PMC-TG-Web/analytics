import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEstimateCloneSourcePaths,
  hasEstimateCloneSource,
} from '../src/lib/estimateCloneSource.ts';

test('an estimate clone source may be identified by bid board ID without a project ID', () => {
  assert.equal(hasEstimateCloneSource({ bidBoardProjectId: 'bb-123' }), true);

  const paths = buildEstimateCloneSourcePaths({
    companyId: 'company 1',
    bidBoardProjectId: 'bb/123',
    proposalId: 'proposal 9',
  });

  assert.deepEqual(paths, {
    proposals: [
      '/rest/v2.0/companies/company%201/estimating/bid_board_projects/bb%2F123/proposals/proposal%209',
    ],
    proposalCollections: [
      '/rest/v2.0/companies/company%201/estimating/bid_board_projects/bb%2F123/proposals',
    ],
    lineItems: [
      '/rest/v2.0/companies/company%201/estimating/bid_board_projects/bb%2F123/proposals/proposal%209/line_items',
    ],
    lineItemGroups: [
      '/rest/v2.0/companies/company%201/estimating/bid_board_projects/bb%2F123/proposals/proposal%209/line_item_groups',
    ],
  });
});

test('project source remains supported and is used as a fallback when both IDs are supplied', () => {
  const paths = buildEstimateCloneSourcePaths({
    companyId: 'company',
    projectId: 'project',
    bidBoardProjectId: 'bid-board',
    proposalId: 'proposal',
  });

  assert.equal(paths.proposals.length, 2);
  assert.match(paths.proposals[0], /bid_board_projects\/bid-board/);
  assert.match(paths.proposals[1], /projects\/project\/estimating/);
});

test('a value supplied in the project slot can retry as a bid board ID', () => {
  const paths = buildEstimateCloneSourcePaths({
    companyId: 'company',
    projectId: 'project-or-board',
    bidBoardFallbackId: 'project-or-board',
    proposalId: 'proposal',
  });

  assert.match(paths.proposals[0], /projects\/project-or-board\/estimating/);
  assert.match(paths.proposals[1], /bid_board_projects\/project-or-board/);
  assert.match(paths.proposalCollections[0], /bid_board_projects\/project-or-board\/proposals$/);
});

test('blank project and bid board IDs are not a valid clone source', () => {
  assert.equal(hasEstimateCloneSource({ projectId: ' ', bidBoardProjectId: '' }), false);
});

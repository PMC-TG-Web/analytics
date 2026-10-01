import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCostCodeSalesLines, COST_CODE_SALES_PAGE_SIZE } from '../src/lib/loadCostCodeSalesLines.ts';

function fixture(count) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: BigInt(i * 2 + 1), bidBoardProjectId: `board-${i}`, proposalId: 'proposal',
    lineItemId: 'shared-line-id', itemSales: 10, laborSales: 5,
  }));
  const pages = [];
  const aliasPages = [];
  const client = {
    procoreEstimateLineItem: {
      async findMany(query) {
        pages.push(query);
        assert.equal(query.where.companyId, 'company');
        assert.deepEqual(query.where.proposalId, { in: ['proposal'] });
        assert.deepEqual(query.orderBy, { id: 'asc' });
        assert.equal(query.take, COST_CODE_SALES_PAGE_SIZE);
        return rows.filter(row => row.id > (query.where.id?.gt ?? 0n)).slice(0, query.take);
      },
    },
    async $queryRaw(query) {
      assert.equal(query.values[0], 'company');
      const ids = query.values.slice(1);
      assert.ok(ids.length <= COST_CODE_SALES_PAGE_SIZE);
      aliasPages.push(ids);
      return rows.filter(row => ids.includes(row.id)).reverse().map(row => ({
        bidBoardProjectId: row.bidBoardProjectId, proposalId: row.proposalId,
        lineItemId: row.lineItemId, payloadName: `alias-${row.id}`,
      }));
    },
  };
  return { client, rows, pages, aliasPages };
}

test('loads every line across pages and joins aliases by full identity', async () => {
  const { client, rows, pages, aliasPages } = fixture(COST_CODE_SALES_PAGE_SIZE + 3);
  const result = await loadCostCodeSalesLines(client, 'company', ['proposal']);
  assert.equal(result.length, rows.length);
  assert.equal(pages.length, 2);
  assert.equal(aliasPages.length, 2);
  assert.equal(pages[1].where.id.gt, rows[COST_CODE_SALES_PAGE_SIZE - 1].id);
  assert.equal(new Set(result.map(row => row.bidBoardProjectId)).size, rows.length);
  result.forEach((row, i) => assert.equal(row.payloadName, `alias-${rows[i].id}`));
  assert.equal(result.reduce((sum, row) => sum + row.itemSales + row.laborSales, 0), rows.length * 15);
});

test('stops on an empty page after an exact full page', async () => {
  const { client, pages, aliasPages } = fixture(COST_CODE_SALES_PAGE_SIZE);
  const result = await loadCostCodeSalesLines(client, 'company', ['proposal']);
  assert.equal(result.length, COST_CODE_SALES_PAGE_SIZE);
  assert.equal(pages.length, 2);
  assert.equal(aliasPages.length, 1);
});

test('does not query when no proposals are selected', async () => {
  assert.deepEqual(await loadCostCodeSalesLines({}, 'company', []), []);
});

test('propagates read failures instead of returning incomplete analytics', async () => {
  const { client } = fixture(1);
  client.$queryRaw = async () => { throw new Error('read failed'); };
  await assert.rejects(loadCostCodeSalesLines(client, 'company', ['proposal']), /read failed/);
});

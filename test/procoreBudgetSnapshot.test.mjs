import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchBudgetSnapshot, normalizeBudgetLineItem } from '../src/lib/procoreBudgetSnapshot.ts';

const companyId = '123';
const projectId = '456';
const item = (id, values = {}) => ({ id, company_id: companyId, project_id: projectId, ...values });
const sourceUrl = endpoint => new URL(endpoint, 'https://example.test');
const options = request => ({ companyId, projectId, request });
const failure = status => Object.assign(new Error(`Source status ${status}`), { status });

test('malformed financial values cannot become plausible numbers or zero-valued snapshots', async () => {
  for (const value of ['12 hours', '1,234.50', '0x10', 'Infinity', '1e999', true, {}, Infinity, NaN]) {
    for (const field of ['quantity', 'unit_cost', 'original_budget_amount', 'amount']) {
      await assert.rejects(fetchBudgetSnapshot(options(async () => [item('7', { [field]: value })])), /invalid numeric/);
    }
  }
  const result = normalizeBudgetLineItem(item('7', { quantity: ' 12.5 ', unit_cost: '-1.25', amount: '1e2', original_budget_amount: ' ' }), companyId, projectId);
  assert.equal(result.quantity, 12.5);
  assert.equal(result.unitCost, -1.25);
  assert.equal(result.amount, 100);
  assert.equal(result.originalBudgetAmount, null);
});

test('a short budget page is followed to the empty terminal page before granting absence authority', async () => {
  const calls = [];
  const result = await fetchBudgetSnapshot(options(async endpoint => {
    const url = sourceUrl(endpoint);
    calls.push(url);
    assert.equal(url.searchParams.get('project_id'), projectId);
    assert.equal(url.searchParams.get('per_page'), '100');
    const page = Number(url.searchParams.get('page'));
    return page < 3 ? [item(page, { quantity: page })] : [];
  }));
  assert.equal(result.complete, true);
  assert.equal(result.pages, 3);
  assert.deepEqual(result.items.map(row => row.budgetLineItemId), ['1', '2']);
  assert.deepEqual(calls.map(url => url.searchParams.get('page')), ['1', '2', '3']);
  assert.equal(new Set(calls.map(url => url.pathname)).size, 1);
  assert.equal(sourceUrl(result.endpoint).pathname, calls[0].pathname);
});

for (const [name, wrap] of [
  ['array', rows => rows],
  ['data', rows => ({ data: rows })],
  ['results', rows => ({ results: rows })],
]) {
  test(`recognizes the ${name} collection envelope without dropping source rows`, async () => {
    let calls = 0;
    const result = await fetchBudgetSnapshot(options(async () => wrap(++calls === 1 ? [item('7')] : [])));
    assert.equal(result.complete, true);
    assert.equal(result.pages, 2);
    assert.equal(result.items[0].budgetLineItemId, '7');
  });
}

for (const [name, payload] of [
  ['null', null], ['undefined', undefined], ['object without a collection', {}],
  ['non-array data', { data: {} }], ['non-array results', { results: 'unavailable' }],
  ['string response', 'not a collection'], ['null row', [null]],
  ['primitive row', ['not a record']], ['array row', [[]]],
]) {
  test(`rejects ${name} instead of interpreting it as an empty authoritative budget`, async () => {
    await assert.rejects(fetchBudgetSnapshot(options(async () => payload)));
  });
}

test('a malformed later page cannot complete an otherwise valid budget snapshot', async () => {
  let calls = 0;
  await assert.rejects(fetchBudgetSnapshot(options(async () => ++calls === 1 ? [item('7')] : {})));
  assert.equal(calls, 2);
});

test('a requested partial fetch does not grant absence authority even for a short page', async () => {
  let calls = 0;
  const result = await fetchBudgetSnapshot({ ...options(async () => { calls++; return [item('7')]; }), fetchAll: false });
  assert.equal(calls, 1);
  assert.equal(result.complete, false);
  assert.equal(result.pages, 1);
  assert.equal(result.items.length, 1);
});

for (const fetchAll of [true, false]) {
  test(`a valid initially empty collection is complete with fetchAll=${fetchAll}`, async () => {
    let calls = 0;
    const result = await fetchBudgetSnapshot({ ...options(async () => { calls++; return []; }), fetchAll });
    assert.equal(calls, 1);
    assert.equal(result.complete, true);
    assert.equal(result.pages, 1);
    assert.deepEqual(result.items, []);
  });
}

test('reaching the page cap with a nonempty page fails instead of certifying partial data', async () => {
  let calls = 0;
  await assert.rejects(fetchBudgetSnapshot({
    ...options(async () => [item(String(++calls))]), maxPages: 3,
  }));
  assert.equal(calls, 3);
});

test('an empty page at the cap still proves collection completion', async () => {
  let calls = 0;
  const result = await fetchBudgetSnapshot({
    ...options(async () => ++calls < 3 ? [item(String(calls))] : []), maxPages: 3,
  });
  assert.equal(result.complete, true);
  assert.equal(result.pages, 3);
});

for (const status of [400, 404, 405, 500]) {
  test(`first-page status ${status} may choose an alternative, which stays pinned on later pages`, async () => {
    const calls = [];
    const result = await fetchBudgetSnapshot(options(async endpoint => {
      const url = sourceUrl(endpoint);
      calls.push(url);
      if (calls.length === 1) throw failure(status);
      return Number(url.searchParams.get('page')) === 1 ? [item('7')] : [];
    }));
    assert.equal(result.complete, true);
    assert.equal(calls.length, 3);
    assert.notEqual(calls[0].pathname, calls[1].pathname);
    assert.equal(calls[1].pathname, calls[2].pathname);
    assert.deepEqual(calls.map(url => url.searchParams.get('page')), ['1', '1', '2']);
    assert.equal(sourceUrl(result.endpoint).pathname, calls[1].pathname);
  });
}

for (const status of [401, 403, 429, 502, 503, 504]) {
  test(`first-page status ${status} remains the original failure without endpoint fallback`, async () => {
    let calls = 0;
    const error = failure(status);
    if (status === 429) error.rateLimitUntil = new Date('2026-10-26T18:00:00Z');
    await assert.rejects(fetchBudgetSnapshot(options(async () => { calls++; throw error; })), actual => actual === error);
    assert.equal(calls, 1);
    if (status === 429) assert.equal(error.rateLimitUntil.toISOString(), '2026-10-26T18:00:00.000Z');
  });
}

test('network failures remain the original error without probing other endpoints', async () => {
  let calls = 0;
  const error = new Error('Network unavailable');
  await assert.rejects(fetchBudgetSnapshot(options(async () => { calls++; throw error; })), actual => actual === error);
  assert.equal(calls, 1);
});

for (const status of [400, 403, 404, 405, 429, 500]) {
  test(`status ${status} after the first page fails the pinned snapshot without switching endpoints`, async () => {
    const calls = [];
    const error = failure(status);
    error.rateLimitUntil = status === 429 ? new Date('2026-10-26T18:00:00Z') : undefined;
    await assert.rejects(fetchBudgetSnapshot(options(async endpoint => {
      calls.push(sourceUrl(endpoint));
      if (calls.length === 1) return [item('7')];
      throw error;
    })), actual => actual === error);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].pathname, calls[1].pathname);
  });
}

for (const [name, rows] of [
  ['missing source ID', [item(null)]],
  ['another company', [item('7', { company_id: '999' })]],
  ['another project', [item('7', { project_id: '999' })]],
  ['duplicate ID in the same page', [item('7'), item('7', { quantity: 99 })]],
]) {
  test(`rejects ${name} before allowing snapshot reconciliation`, async () => {
    let calls = 0;
    await assert.rejects(fetchBudgetSnapshot(options(async () => { calls++; return rows; })));
    assert.equal(calls, 1);
  });
}

test('an ID repeated across pages invalidates the snapshot even when another new row is present', async () => {
  let calls = 0;
  await assert.rejects(fetchBudgetSnapshot(options(async () => ++calls === 1
    ? [item('7')]
    : [item('7', { quantity: 99 }), item('8')])));
  assert.equal(calls, 2);
});

test('normalization preserves numeric zero and the existing authoritative field precedence', () => {
  const source = item(7, {
    name: 'Budget item', title: 'Fallback title',
    cost_code_string: 'FIRST.L', cost_code: { code: 'THIRD.L', name: 'Cost code name', description: 'Code description' },
    wbs_code: { id: 101, flat_code: 'SECOND.L', description: 'WBS description' },
    wbs_code_id: 102, line_item_type: { name: 'Labor', id: 103 },
    quantity: '0', unit_cost: 0, original_budget_amount: '0', amount: 0, budget_amount: 999,
    uom: 'hours', calculation_strategy: 'unit',
    currency_configuration: { currency_iso_code: 'USD' }, currency_iso_code: 'EUR',
    created_at: '2026-01-01T12:00:00Z', updated_at: '2026-10-26T12:00:00Z',
  });
  const normalized = normalizeBudgetLineItem(source, companyId, projectId);
  assert.equal(normalized.projectId, projectId);
  assert.equal(normalized.budgetLineItemId, '7');
  assert.equal(normalized.name, 'Budget item');
  assert.equal(normalized.costCode, 'FIRST.L');
  assert.equal(normalized.costCodeDescription, 'WBS description');
  assert.equal(normalized.wbsCodeId, '101');
  assert.equal(normalized.lineItemType, 'Labor');
  assert.equal(normalized.uom, 'hours');
  assert.equal(normalized.quantity, 0);
  assert.equal(normalized.unitCost, 0);
  assert.equal(normalized.originalBudgetAmount, 0);
  assert.equal(normalized.amount, 0);
  assert.equal(normalized.currencyIsoCode, 'USD');
  assert.equal(normalized.sourceCreatedAt, source.created_at);
  assert.equal(normalized.sourceUpdatedAt, source.updated_at);
  assert.deepEqual(normalized.payload, source);
});

test('normalization retains legacy cost-code and budget-value fallback shapes', () => {
  const cases = [
    [{ wbs_code: { flat_code: 'WBS.L' }, cost_code: { code: 'CODE.L' }, budget_amount: 42 }, 'WBS.L', 42],
    [{ cost_code: { code: 'CODE.L', name: 'Named code' }, original_budget_amount: 12 }, 'CODE.L', 12],
    [{ cost_code: { name: 'Named code' }, amount: '3.5' }, 'Named code', 3.5],
    [{ cost_code: 'SCALAR.L', amount: null, budget_amount: 0, original_budget_amount: 99 }, 'SCALAR.L', 0],
  ];
  for (const [values, code, amount] of cases) {
    const row = normalizeBudgetLineItem(item('7', values), companyId, projectId);
    assert.equal(row.costCode, code);
    assert.equal(row.amount, amount);
  }
});

test('normalization supports the explicit alternate source ID without inventing an identity', () => {
  const row = normalizeBudgetLineItem({ company_id: 123, project_id: 456, budget_line_item_id: 789 }, companyId, projectId);
  assert.equal(row.budgetLineItemId, '789');
  for (const invalid of [null, [], {}, item(''), item('7', { company_id: '999' }), item('7', { project_id: '999' })]) {
    assert.throws(() => normalizeBudgetLineItem(invalid, companyId, projectId));
  }
});

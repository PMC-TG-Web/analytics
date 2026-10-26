import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(path, dependencies = {}, exposed = []) {
  const source = readFileSync(path, 'utf8') + (exposed.length ? `\nexport { ${exposed.join(', ')} };` : '');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', code)(
    id => dependencies[id] || {}, module, module.exports, { warn() {}, log() {}, error() {} },
  );
  return module.exports;
}

const base = {
  companyId: 'company-a', projectName: 'Renamed source project', projectNumber: 'same-number',
  customer: 'Source customer', status: 'In Progress', statusRaw: 'active', source: 'procore_webhook',
};
const local = {
  id: 'scheduled-local-project', projectName: 'Existing scheduled project', projectNumber: 'local-number',
  procoreId: 'project-a', bidBoardId: 'bid-a', customer: 'Existing customer', status: 'Accepted',
  customFields: { procoreId: 'project-a', bidBoardId: 'bid-a', companyId: 'company-a', retained: 'schedule metadata' },
};

for (const kind of ['Procore', 'BidBoard']) {
  test(`${kind} headers update the verified local record inside the resolver transaction`, async () => {
    const writes = [];
    const resolver = async params => {
      assert.equal(params.companyId, 'company-a');
      assert.equal(params.createProjectIfMissing, true);
      assert.equal(kind === 'Procore' ? params.projectId : params.bidBoardId, kind === 'Procore' ? 'project-a' : 'bid-a');
      const project = await params.updateProject({ project: { update: async mutation => {
        writes.push(mutation);
        return { ...local, ...mutation.data };
      } } }, local, { created: false, status: 'linked' });
      return { project, status: 'linked', created: false };
    };
    const headers = load('src/lib/procoreProjectHeaders.ts', {
      './procoreLegacyProjectIdentity': { resolveProcoreLegacyProject: resolver, resolveBidBoardLegacyProject: resolver },
    });
    const result = await headers[`syncLegacy${kind}ProjectHeader`]({ ...base, procoreProjectId: 'project-a', bidBoardId: 'bid-a' });
    assert.equal(result.project.id, local.id);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].where, { id: local.id });
    assert.equal(writes[0].data.procoreId, undefined);
    assert.equal(writes[0].data.bidBoardId, undefined);
    assert.equal(writes[0].data.projectArchived, undefined);
    assert.equal(writes[0].data.customFields.companyId, 'company-a');
    assert.equal(writes[0].data.customFields.retained, 'schedule metadata');
    assert.equal(writes[0].data.status, 'In Progress');
  });

  test(`${kind} ambiguous headers return the conflict without modifying or archiving projects`, async () => {
    const conflict = { project: null, created: false, status: 'conflict', reason: 'multiple_exact_id_matches' };
    const headers = load('src/lib/procoreProjectHeaders.ts', {
      './procoreLegacyProjectIdentity': {
        resolveProcoreLegacyProject: async () => conflict,
        resolveBidBoardLegacyProject: async () => conflict,
      },
    });
    assert.equal(await headers[`syncLegacy${kind}ProjectHeader`]({ ...base, procoreProjectId: 'project-a', bidBoardId: 'bid-a' }), conflict);
  });
}

test('canonical Bid Board links accept only a missing or identical established project ID', async () => {
  let current = null;
  const updates = [];
  const links = load('src/lib/procoreProjectHeaderLinks.ts', {
    './prisma': { prisma: { pmcBidBoardProject: { findUnique: async () => ({ procoreProjectId: current }), updateMany: async mutation => {
      updates.push(mutation);
      assert.deepEqual(mutation.where.OR, [{ procoreProjectId: null }, { procoreProjectId: mutation.data.procoreProjectId }]);
      if (current && current !== mutation.data.procoreProjectId) return { count: 0 };
      current = mutation.data.procoreProjectId;
      return { count: 1 };
    } } } },
  });
  const params = { companyId: 'company-a', bidBoardId: 'bid-a', procoreProjectId: 'project-a' };
  assert.deepEqual(await links.preserveBidBoardProjectLink(params), { procoreProjectId: 'project-a', conflict: false });
  assert.deepEqual(await links.preserveBidBoardProjectLink(params), { procoreProjectId: 'project-a', conflict: false });
  assert.deepEqual(await links.preserveBidBoardProjectLink({ ...params, procoreProjectId: 'project-b' }), { procoreProjectId: null, conflict: true });
  assert.deepEqual(await links.preserveBidBoardProjectLink({ ...params, procoreProjectId: null }), { procoreProjectId: 'project-a', conflict: false });
  assert.equal(current, 'project-a');
  assert.equal(updates.length, 3);
  assert.equal(updates[0].where.companyId, 'company-a');
});

test('a second bid cannot change its shared canonical project status', async () => {
  const writes = [];
  const links = load('src/lib/procoreProjectHeaderLinks.ts', {
    './prisma': { prisma: { pmcProject: {
      updateMany: async mutation => { writes.push(mutation); return { count: 0 }; },
      findUnique: async query => {
        assert.deepEqual(query.where, { companyId_procoreProjectId: { companyId: 'company-a', procoreProjectId: 'project-a' } });
        return { bidBoardId: 'existing-bid' };
      },
    } } },
  });
  assert.equal(await links.updateProjectBidBoardStatus({ companyId: 'company-a', procoreProjectId: 'project-a', bidBoardId: 'new-bid', status: 'Complete' }), true);
  assert.equal(writes.length, 0);
});

test('multiple known bids cannot select an empty project link, while its established selected bid can refresh', async () => {
  for (const selected of [null, 'bid-a', 'bid-b']) {
    const links = load('src/lib/procoreProjectHeaderLinks.ts', {
      './prisma': { prisma: {
        pmcProject: { findUnique: async () => ({ bidBoardId: selected }) },
        pmcBidBoardProject: { findMany: async query => {
          assert.deepEqual(query.where, { companyId: 'company-a', procoreProjectId: 'project-a' });
          assert.equal(query.take, 2);
          return [{ bidBoardId: 'bid-a' }, { bidBoardId: 'bid-b' }];
        } },
      } },
    });
    assert.equal(await links.canUpdateProjectFromBidBoard({ companyId: 'company-a', procoreProjectId: 'project-a', bidBoardId: 'bid-a' }), selected === 'bid-a');
  }
});

const routes = [
  'src/app/api/procore/sync/all-projects/route.ts',
  'src/app/api/webhooks/procore/process/route.ts',
];
for (const path of routes) {
  test(`${path}: staging never falls back to name or customer after a missing exact ID`, async () => {
    const queries = [];
    const route = load(path, {
      '@/lib/procoreProjectHeaderLinks': { canUpdateProjectFromBidBoard: async () => true },
      '@/lib/prisma': { prisma: { $executeRawUnsafe: async (...args) => { queries.push(args); return 0; } } },
    }, ['applyBidBoardStatusToV1Staging']);
    assert.equal(await route.applyBidBoardStatusToV1Staging({ ...base, bidBoardName: 'same name', bidBoardId: 'bid-a' }), 0);
    assert.equal(queries.length, 0);
    assert.equal(await route.applyBidBoardStatusToV1Staging({ ...base, bidBoardName: 'same name', procoreProjectId: 'missing-project', bidBoardId: 'bid-a' }), 0);
    assert.equal(queries.length, 1);
    assert.match(queries[0][0], /company_id = \$3/);
    assert.match(queries[0][0], /procore_project_id = \$4/);
    assert.match(queries[0][0], /bidBoardExternalId' IS NULL/);
    assert.doesNotMatch(queries[0][0], /LOWER|BTRIM|ORDER BY/);
  });

  test(`${path}: ambiguous bid selection cannot update staging`, async () => {
    const route = load(path, {
      '@/lib/procoreProjectHeaderLinks': { canUpdateProjectFromBidBoard: async () => false },
      '@/lib/prisma': { prisma: { $executeRawUnsafe: async () => assert.fail('Rejected bid must not update a project') } },
    }, ['applyBidBoardStatusToV1Staging']);
    assert.equal(await route.applyBidBoardStatusToV1Staging({ ...base, procoreProjectId: 'project-a', bidBoardId: 'bid-a' }), 0);
  });

  test(`${path}: live Bid Board mirror retains existing links and prevents company reassignment`, async () => {
    const queries = [];
    const route = load(path, { '@/lib/prisma': { prisma: { $executeRawUnsafe: async (...args) => queries.push(args) } } }, ['upsertBidBoardLive']);
    await route.upsertBidBoardLive({ companyId: 'company-a', bidBoardId: 'bid-a', procoreProjectId: 'project-b', payload: { project_id: 'project-b' } });
    assert.match(queries[0][0], /COALESCE\(procore_bid_board_live.procore_project_id, EXCLUDED.procore_project_id\)/);
    assert.match(queries[0][0], /WHERE procore_bid_board_live.company_id = EXCLUDED.company_id/);
    assert.deepEqual(JSON.parse(queries[0][8]), { project_id: 'project-b' });
  });
}

test('full V1 header refresh preserves its canonical Bid Board link', async () => {
  const writes = [];
  const route = load(routes[0], { '@/lib/prisma': { prisma: { pmcProject: { upsert: async mutation => writes.push(mutation) } } } }, ['upsertPmcProject']);
  await route.upsertPmcProject({ ...base, procoreProjectId: 'project-a', bidBoardId: null });
  assert.equal('bidBoardId' in writes[0].update, false);
  assert.equal(writes[0].update.projectName, base.projectName);
});

test('webhook refuses conflicting canonical Bid Board metadata without clearing the existing link', async () => {
  const writes = [];
  const route = load(routes[1], {
    '@/lib/prisma': { prisma: { pmcProject: {
      upsert: async mutation => { writes.push(mutation); return {}; },
      updateMany: async mutation => { writes.push(mutation); return { count: 0 }; },
    } } },
    '@/lib/procoreProjectFeed': { isMeaningfulCustomer: value => Boolean(value) },
    '@/lib/procoreProjectHeaderLinks': { canUpdateProjectFromBidBoard: async () => true },
  }, ['upsertPmcProjectFromWebhook']);
  assert.equal(await route.upsertPmcProjectFromWebhook({ ...base, procoreProjectId: 'project-a', bidBoardId: 'different-bid' }), false);
  assert.deepEqual(writes[0].update, {});
  assert.deepEqual(writes[1].where.OR, [{ bidBoardId: null }, { bidBoardId: 'different-bid' }]);
});

test('webhook project creation leaves ambiguous Bid Board selection empty', async () => {
  const writes = [];
  const route = load(routes[1], {
    '@/lib/prisma': { prisma: { pmcProject: {
      upsert: async mutation => { writes.push(mutation); return {}; },
      updateMany: async () => assert.fail('An ambiguous new project cannot select a bid'),
    } } },
    '@/lib/procoreProjectFeed': { isMeaningfulCustomer: value => Boolean(value) },
    '@/lib/procoreProjectHeaderLinks': { canUpdateProjectFromBidBoard: async () => false },
  }, ['upsertPmcProjectFromWebhook']);
  assert.equal(await route.upsertPmcProjectFromWebhook({ ...base, procoreProjectId: 'project-a', bidBoardId: 'bid-a' }), false);
  assert.equal(writes[0].create.bidBoardId, null);
  assert.deepEqual(writes[0].update, {});
});

test('prime contract headers use scoped verified identity and never create a fallback project', async () => {
  const writes = [];
  const route = load('src/app/api/procore/sync/prime-contracts/route.ts', {
    '@/lib/procoreLegacyProjectIdentity': { resolveProcoreLegacyProject: async params => {
      assert.equal(params.companyId, 'company-a');
      assert.equal(params.projectId, 'project-a');
      assert.equal(params.createProjectIfMissing, false);
      await params.updateProject({ project: { update: async mutation => { writes.push(mutation); return local; } } }, local);
      return { project: local, status: 'linked' };
    } },
  }, ['updateProjectContractDate']);
  await route.updateProjectContractDate({ companyId: 'company-a', projectId: 'project-a', records: [{ id: 'contract-a', contract_date: '2026-10-01' }] });
  assert.equal(writes[0].where.id, local.id);
  assert.equal(writes[0].data.customFields.contractDate, '2026-10-01T00:00:00.000Z');
  assert.equal(writes[0].data.customFields.retained, 'schedule metadata');
});

test('Bid Board sync retains the source payload while refusing number matching and conflicting project propagation', async () => {
  for (const explicitId of [null, 'conflicting-project']) {
    const upserts = [], raw = [], links = [];
    const route = load('src/app/api/procore/sync/bid-board-projects/route.ts', {
      '@/lib/prisma': { prisma: {
        pmcBidBoardProject: { upsert: async mutation => upserts.push(mutation) },
        $executeRawUnsafe: async (...args) => raw.push(args),
        $queryRawUnsafe: async () => assert.fail('Must not infer identity by project number'),
      } },
      '@/lib/procoreProjectHeaderLinks': {
        preserveBidBoardProjectLink: async () => ({ procoreProjectId: null, conflict: Boolean(explicitId) }),
        updateProjectBidBoardStatus: async mutation => links.push(mutation),
      },
      '@/lib/procoreProjectFeed': { extractCustomerFromCustomFields: () => '', isMeaningfulCustomer: value => Boolean(value) },
      '@/lib/procoreBidBoardChange': { bidBoardPayloadChanged: () => true, bidBoardPayloadNeedsPersistence: () => true },
    }, ['upsertProject']);
    const result = await route.upsertProject({ companyId: 'company-a', project: { id: 'bid-a', project_id: explicitId, project_number: 'same-number', name: 'Same name', status: 'Complete' }, hasEstimateQueueRecord: true });
    assert.equal(result.written, true);
    assert.equal(result.identityConflict, Boolean(explicitId));
    assert.equal(upserts.length, 1);
    assert.equal('procoreProjectId' in upserts[0].update, false);
    assert.equal(upserts[0].update.payload.project_id, explicitId);
    assert.equal(raw.length, 1);
    assert.equal(raw[0][3], null);
    assert.equal(links.length, 0);
  }
});

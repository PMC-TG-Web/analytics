import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import test from 'node:test';
import ts from 'typescript';
import { runCommitmentMakerRequest } from '../src/lib/commitmentMakerRequest.ts';

const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const clientModule = { exports: {} };
new Function('require', 'module', 'exports', compile(readFileSync('src/lib/procoreCommitmentMakerClient.ts', 'utf8')))(
  id => {
    if (id === 'node:async_hooks') return { AsyncLocalStorage };
    if (id === '@/lib/procoreRateLimit') return {};
    throw new Error(`Unexpected dependency ${id}`);
  }, clientModule, clientModule.exports,
);
const { CommitmentMakerRateLimitError } = clientModule.exports;
const route = readFileSync('src/app/api/procore/commitments-live/maker/route.ts', 'utf8');
const wbsSource = route.slice(route.indexOf('async function fetchProjectWbsRecords('), route.indexOf('function nestedRecord('));
const responseSource = route.slice(route.indexOf('function rateLimitResponse('), route.indexOf('function rejectedMutation('));
const rateLimitResponse = new Function('NextResponse', compile(responseSource) + '\nreturn rateLimitResponse;')({ json: Response.json });

function setup(responses) {
  const calls = [];
  const fetchPaged = async params => {
    calls.push(params.pathForPage(1));
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, 'Unexpected lookup');
    return response;
  };
  const read = new Function('fetchPaged', 'CommitmentMakerRateLimitError', compile(wbsSource) + '\nreturn fetchProjectWbsRecords;')(
    fetchPaged, CommitmentMakerRateLimitError,
  );
  return { calls, read: () => read('test-token', 'company', '598134326714493') };
}

test('a successful WBS lookup skips the redundant budget request', async () => {
  const rows = [{ id: 'wbs', flat_code: '03-300-40-30.C' }];
  const f = setup([rows]);
  assert.deepEqual(await f.read(), rows);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /projects\/598134326714493\/work_breakdown_structure/);
});

test('empty or unavailable WBS falls back to project budget codes', async () => {
  for (const first of [[], new Error('Procore API 403 while reading WBS.')]) {
    const rows = [{ wbs_code: { id: 'budget-wbs' } }];
    const f = setup([first, rows]);
    assert.deepEqual(await f.read(), rows);
    assert.equal(f.calls.length, 2);
    assert.match(f.calls[1], /budget_line_items\?project_id=598134326714493/);
  }
});

test('rate limits from either lookup reach silent browser continuation unchanged', async () => {
  for (const fallback of [false, true]) {
    const until = Date.now() + 60_000;
    const pause = new CommitmentMakerRateLimitError(until);
    const rows = [{ id: 'wbs', flat_code: '03-300-40-30.C' }];
    const f = setup(fallback ? [[], pause, rows] : [pause, rows]);
    const waits = [];
    const result = await runCommitmentMakerRequest({
      signal: new AbortController().signal,
      onResponse: () => {},
      now: () => until - 60_000,
      wait: async ms => { waits.push(ms); },
      request: async () => {
        try { return Response.json({ success: true, records: await f.read() }); }
        catch (error) {
          assert.equal(error, pause);
          return rateLimitResponse(error);
        }
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.success, true);
    assert.deepEqual(result.payload.records, rows);
    assert.deepEqual(waits, [60_000]);
    assert.equal(f.calls.length, fallback ? 3 : 2);
  }
});

test('failed reads retain their actual cause instead of claiming codes are missing', async () => {
  const f = setup([new Error('Procore API 403 while reading WBS.'), new Error('Procore API 504 while reading budget.')]);
  await assert.rejects(f.read(), error => {
    assert.match(error.message, /598134326714493/);
    assert.match(error.message, /403/);
    assert.match(error.message, /504/);
    assert.doesNotMatch(error.message, /returned no WBS/);
    return true;
  });
  await assert.rejects(setup([[], new Error('Procore API 502')]).read(), /502/);
  await assert.rejects(setup([new Error('Procore API 403'), []]).read(), /403/);
});

test('only two successful empty reads are reported as missing project codes', async () => {
  await assert.rejects(setup([[], []]).read(), /Procore returned no WBS or budget codes for project 598134326714493/);
});

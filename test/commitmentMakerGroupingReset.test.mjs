import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
test('reset remains available after every proposed PO is combined into one', () => {
 const page = readFileSync('src/app/procore/commitments-live/maker/page.tsx', 'utf8');
 assert.ok(page.indexOf('Reset to Original Groups') < page.indexOf('{combinableGroupCount >= 2'));
 assert.match(page, /await callMaker\("preview", originalParsedWorkbook, \[\], false, true\)/);
 assert.match(page, /resetEstimateGrouping: sourceType === "primary_estimate" && resetEstimateGrouping/);
 const route = readFileSync('src/app/api/procore/commitments-live/maker/route.ts', 'utf8');
 assert.match(route, /mode !== "preview"/);
 assert.match(route, /await resetPrimaryEstimateGrouping\(\{ companyId, projectId \}, userEmail\)/);
});

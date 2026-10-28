import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrewScorecard, calculateInstalledRebarTons, crewToday, crewWeekRange, crewWeekStart, selectCrewEstimate } from '../src/lib/crewScorecard.ts';

const person = (overrides = {}) => ({
  id: 'employee-1', firstName: 'Alex', lastName: 'Foreman', email: 'alex@example.test', jobTitle: 'Foreman', isActive: true, ...overrides,
});
const project = (overrides = {}) => ({ procoreProjectId: 'p1', bidBoardId: 'b1', projectName: 'Same job name', projectNumber: '100', ...overrides });
const estimate = (overrides = {}) => ({
  procoreProjectId: 'p1', bidBoardId: 'b1', selectedProposalId: 'e1', proposalName: 'Selected estimate',
  pmcGroup: { 'Slab On Grade Labor': 400 }, concreteGroup: { 'Slab On Grade': 600 }, ...overrides,
});
const source = (overrides = {}) => ({
  id: 'local-1', procoreId: 'remote-1', companyId: 'company', projectId: 'p1', date: '2026-10-19',
  creatorId: 'actor-1', creatorName: 'Alex Foreman', creatorLogin: 'alex@example.test',
  syncedAt: '2026-10-20T12:00:00Z', sourceUpdatedAt: '2026-10-20T10:00:00Z',
  deletedAt: null, status: 'approved', ...overrides,
});
const timecard = (overrides = {}) => ({
  ...source(), hours: 50, workerId: 'worker-1', workerName: 'Pat Worker', party: null,
  costCode: '03-300-20-10', costCodeName: 'SOG labor', ...overrides,
});
const log = (overrides = {}) => ({
  ...source(), quantity: 100, lineItemId: 'line-1', holderTitle: 'Concrete materials',
  description: 'SOG concrete', costCode: '03-300-20-20', costType: 'M', uom: 'cy', metadataMatches: 1, ...overrides,
});
const report = (overrides = {}) => buildCrewScorecard({
  companyId: 'company', week: '2026-10-19', now: new Date('2026-10-21T11:00:00Z'),
  employees: [person()], projects: [project()], estimates: [estimate()], timecards: [timecard()], logs: [log()], ...overrides,
});
const alex = result => result.crews.find(crew => crew.id === 'foreman:employee-1');

test('Monday-Sunday work weeks use UTC date boundaries and Eastern today, including DST and year changes', () => {
  assert.equal(crewWeekStart('2026-10-21'), '2026-10-19');
  assert.equal(crewWeekStart('2026-10-25'), '2026-10-19');
  assert.equal(crewWeekStart('2027-01-01'), '2026-12-28');
  assert.equal(crewWeekStart('2024-02-29'), '2024-02-26');
  const range = crewWeekRange('2026-10-26');
  assert.equal(range.start.toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-11-02T00:00:00.000Z');
  assert.equal(range.through, '2026-11-01');
  assert.equal(crewToday(new Date('2026-10-21T02:00:00Z')), '2026-10-20');
  for (const date of ['', '2026-02-30', '2026-13-01', '2026-1-1', '2026-10-19T00:00:00Z']) assert.throws(() => crewWeekStart(date));
  assert.throws(() => crewWeekRange('2026-10-20'), /Monday/);
});

test('weekly hours, worker count, per-line quantities and exact project/work-type rate are measurable', () => {
  const result = report();
  const crew = alex(result);
  assert.equal(result.foremanCount, 1);
  assert.equal(result.through, '2026-10-25');
  assert.equal(crew.hours, 50);
  assert.equal(crew.workers, 1);
  assert.equal(crew.concrete, 100);
  assert.equal(crew.timecardCount, 1);
  assert.equal(crew.logCount, 1);
  assert.equal(crew.days.length, 1);
  assert.equal(crew.review.length, 0);
  const rate = crew.rates[0];
  assert.equal(rate.actualRate, 2);
  assert.equal(rate.estimatedRate, 1.5);
  assert.ok(Math.abs(rate.percentOfEstimate - 133.3333333333333) < 1e-9);
  assert.equal(rate.estimateName, 'Selected estimate');
  assert.equal(rate.projectId, 'p1');
  assert.equal(rate.workType, 'Slab On Grade');
  assert.equal(crew.quantities[0].unit, 'CY');
  assert.ok(!('workerIds' in crew));
  assert.ok(!('creatorLogin' in crew));
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('current foremen without records remain visible and other submitters do not become an invented sixth crew', () => {
  const result = report({
    employees: [person(), person({ id: 'second', firstName: 'Jo', email: 'jo@example.test' }), person({ id: 'inactive', firstName: 'Past', isActive: false })],
    timecards: [timecard(), timecard({ procoreId: '2', creatorId: 'relief', creatorName: 'Relief Lead', creatorLogin: 'relief@example.test' })],
  });
  assert.equal(result.foremanCount, 2);
  assert.equal(result.crews.length, 3);
  const noRecords = result.crews.find(crew => crew.id === 'foreman:second');
  assert.equal(noRecords.hours, 0);
  assert.equal(noRecords.review.length, 0);
  assert.equal(noRecords.days.length, 0);
  const relief = result.crews.find(crew => crew.id === 'id:relief');
  assert.equal(relief.isForeman, false);
  assert.equal(relief.hours, 50);
});

test('same submitter IDs and unambiguous email/name aliases join sources, without nickname guesses', () => {
  const result = report({ logs: [log({ creatorId: null, creatorName: ' ALEX   FOREMAN ', creatorLogin: 'ALEX@EXAMPLE.TEST' })] });
  assert.equal(result.crews.length, 1);
  assert.equal(alex(result).rates[0].actualRate, 2);
  const other = report({
    employees: [],
    timecards: [timecard({ creatorName: 'Alex Lead' })],
    logs: [log({ creatorId: null, creatorName: 'Alex Lead' })],
  });
  assert.equal(other.crews.length, 1);
  assert.equal(other.crews[0].rates[0].actualRate, 2);
  const nickname = report({ logs: [log({ creatorId: 'different', creatorLogin: 'other@example.test', creatorName: 'Al Foreman' })] });
  assert.equal(nickname.crews.length, 2);
  assert.equal(alex(nickname).rates[0].actualRate, null);
});

test('different creator IDs sharing a display name do not get combined through a guessed employee match', () => {
  const result = report({
    timecards: [timecard({ creatorLogin: null })],
    logs: [log({ creatorId: 'actor-2', creatorLogin: null })],
  });
  assert.equal(result.crews.length, 3);
  assert.equal(alex(result).hours, 0);
  assert.ok(result.crews.filter(crew => !crew.isForeman).every(crew => crew.rates.every(rate => rate.percentOfEstimate === null)));
});

test('company scoping and project IDs prevent identical project names and foreign records from mixing', () => {
  const result = report({
    projects: [project(), project({ procoreProjectId: 'p2', bidBoardId: 'b2' })],
    timecards: [timecard(), timecard({ projectId: 'p2', hours: 20 }), timecard({ companyId: 'foreign', hours: 9000 })],
    logs: [log(), log({ companyId: 'foreign', quantity: 9000 })],
  });
  const crew = alex(result);
  assert.equal(crew.hours, 70);
  assert.equal(crew.concrete, 100);
  assert.equal(crew.rates.length, 2);
  assert.equal(crew.rates.find(rate => rate.projectId === 'p2').percentOfEstimate, null);
});

test('estimate selection requires explicit project identity and respects the canonical bid link', () => {
  assert.equal(selectCrewEstimate(undefined, [estimate()]), null);
  assert.equal(selectCrewEstimate(project(), [estimate({ procoreProjectId: 'other' })]), null);
  assert.equal(selectCrewEstimate(project(), [estimate({ bidBoardId: 'other' })]), null);
  assert.equal(selectCrewEstimate(project(), [estimate(), estimate()]), null);
  assert.equal(selectCrewEstimate(project({ bidBoardId: null }), [estimate(), estimate({ bidBoardId: 'other' })]), null);
  assert.equal(selectCrewEstimate(project(), [estimate(), estimate({ bidBoardId: 'other' })]).selectedProposalId, 'e1');
});

test('latest source copies win, tombstones do not resurrect and records moved to another week disappear', () => {
  const result = report({
    timecards: [timecard({ id: 'copy', hours: 900, sourceUpdatedAt: '2026-10-19T10:00:00Z' }), timecard()],
    logs: [log(), log({ id: 'deleted-copy', deletedAt: '2026-10-21', sourceUpdatedAt: '2026-10-21T10:00:00Z' })],
  });
  assert.equal(alex(result).hours, 50);
  assert.equal(alex(result).concrete, 0);
  assert.equal(result.excluded.deleted, 1);
  const moved = report({ timecards: [timecard(), timecard({ date: '2026-10-26', sourceUpdatedAt: '2026-10-21T10:00:00Z' })] });
  assert.equal(alex(moved).hours, 0);
  const voided = report({ timecards: [timecard({ status: 'Voided' })], logs: [log({ deletedAt: '2026-10-21' })] });
  assert.equal(voided.excluded.deleted, 2);
});

test('zero and signed corrections are retained rather than silently converted into positive production', () => {
  const result = report({
    timecards: [timecard({ hours: 8 }), timecard({ procoreId: 'correction', hours: -2 }), timecard({ procoreId: 'zero', hours: 0 })],
    logs: [log({ quantity: 16 }), log({ procoreId: 'correction', quantity: -4 })],
  });
  assert.equal(alex(result).hours, 6);
  assert.equal(alex(result).concrete, 12);
  assert.equal(alex(result).timecardCount, 3);
  assert.equal(alex(result).rates[0].actualRate, 2);
  const netZero = report({ logs: [log({ quantity: 0 })] });
  assert.equal(alex(netZero).rates[0].actualRate, null);
  assert.equal(alex(netZero).rates[0].percentOfEstimate, null);
});

test('generic subcontractor time, subcontractor logs and billing-only logs never become crew hours', () => {
  const result = report({
    timecards: [timecard(), timecard({ procoreId: 'sub', workerName: ' Sub Contractor ', hours: 200 })],
    logs: [
      log({ procoreId: 'billing', holderTitle: 'Monthly Billing File', uom: 'hours', costType: 'L', quantity: 999 }),
      log({ procoreId: 'sub', description: 'Subcontractor Hours', quantity: 300, uom: 'hours' }),
    ],
  });
  assert.equal(alex(result).hours, 50);
  assert.equal(alex(result).logHours, 0);
  assert.equal(alex(result).logCount, 0);
  assert.deepEqual(result.excluded, { subcontractorTimecards: 1, billingLogs: 1, subcontractorLogs: 1, deleted: 0 });
});

test('daily-log quantities on hour-unit labor items count as field hours and support the pace comparison', () => {
  const result = report({ timecards: [], logs: [
    log(),
    log({ procoreId: 'labor', lineItemId: 'labor-line', uom: 'hours', costType: 'Labor', costCode: '03-300-20-10', description: 'Labor Slab On Grade', quantity: 50 }),
  ] });
  const crew = alex(result);
  assert.equal(crew.hours, 50);
  assert.equal(crew.logHours, 50);
  assert.equal(crew.timecardHours, 0);
  assert.equal(crew.workers, 0);
  assert.equal(crew.logCount, 2);
  assert.equal(crew.quantities.length, 1);
  assert.equal(crew.days[0].logHours, 50);
  assert.equal(crew.review.length, 0);
  assert.equal(crew.rates[0].hours, 50);
  assert.equal(crew.rates[0].actualRate, 2);
  assert.ok(Math.abs(crew.rates[0].percentOfEstimate - 133.3333333333333) < 1e-9);
});

test('hour-unit travel and other-type labor logs follow the same travel/other classification as timecards', () => {
  const crew = alex(report({ timecards: [], logs: [
    log(),
    log({ procoreId: 'sog', lineItemId: 'sog-line', uom: 'hours', costType: 'Labor', costCode: '03-300-20-10', description: 'Labor Slab On Grade', quantity: 50 }),
    log({ procoreId: 'travel', lineItemId: 'travel-line', uom: 'Hours', costType: 'Other', costCode: '01-300-10-30', description: 'Travel Labor', quantity: 7 }),
  ] }));
  assert.equal(crew.hours, 57);
  assert.equal(crew.travelHours, 7);
  assert.equal(crew.rates[0].hours, 50);
  assert.equal(crew.rates[0].actualRate, 2);
});

test('confirmed labor LS quantities count as hours but labor in other units is flagged', () => {
  const crew = alex(report({ timecards: [], logs: [
    log({ procoreId: 'ls-labor', lineItemId: 'ls-labor-line', uom: 'LS', costType: 'L', costCode: '03-300-00-10', description: 'CO1 - Labor Foundation Concrete', quantity: 19 }),
  ] }));
  assert.equal(crew.hours, 19);
  assert.equal(crew.logHours, 19);
  assert.equal(crew.travelHours, 0);
  assert.equal(crew.rates[0].hours, 19);
  assert.equal(crew.review.length, 0);
});

test('labor quantities in non-hour non-LS units are flagged instead of being guessed into hours', () => {
  const crew = alex(report({ logs: [
    log(),
    log({ procoreId: 'cy-labor', lineItemId: 'cy-labor-line', uom: 'ea', costType: 'Labor', costCode: '03-300-20-10', description: 'Labor Slab On Grade', quantity: 19 }),
  ] }));
  assert.equal(crew.hours, 50);
  assert.equal(crew.logHours, 0);
  assert.ok(crew.review.some(item => item.kind === 'source' && /not hours/.test(item.message)));
  assert.equal(crew.rates[0].actualRate, null);
});

test('hours from both timecards and daily-log labor on one project/day are flagged as possible duplicates', () => {
  const crew = alex(report({ logs: [log(), log({ procoreId: 'labor', lineItemId: 'labor-line', uom: 'hours', costType: 'L', costCode: '03-300-20-10', quantity: 50 })] }));
  assert.equal(crew.hours, 100);
  assert.equal(crew.timecardHours, 50);
  assert.equal(crew.logHours, 50);
  assert.deepEqual(crew.review.map(item => item.kind), ['hours-overlap']);
  assert.equal(crew.rates[0].actualRate, null);
  assert.match(crew.rates[0].reason, /duplicate/);
});

test('travel and other hours stay visible but are excluded from the matching concrete rate denominator', () => {
  const result = report({ timecards: [
    timecard(),
    timecard({ procoreId: 'travel', hours: 5, costCode: '01-300-10-30', costCodeName: 'Travel' }),
    timecard({ procoreId: 'pm', hours: 10, costCode: '01-300-10-20', costCodeName: 'Project Management' }),
  ] });
  assert.equal(alex(result).hours, 65);
  assert.equal(alex(result).travelHours, 5);
  assert.equal(alex(result).otherHours, 10);
  assert.equal(alex(result).rates[0].hours, 50);
  assert.equal(alex(result).rates[0].actualRate, 2);
});

test('fiber, rebar and mixed PO items never masquerade as cubic yards or a combined each quantity', () => {
  const result = report({ logs: [
    log({ uom: 'ea' }),
    log({ procoreId: 'fiber', lineItemId: 'fiber-line', description: 'Fiber from Ready Mix Supplier', uom: 'ea', quantity: 9 }),
    log({ procoreId: 'rebar', lineItemId: 'rebar-line', costCode: '03-200-30-20', description: 'Rebar', uom: 'ea', quantity: 7 }),
    log({ procoreId: 'foam', lineItemId: 'foam-line', costCode: '03-150-10-85', description: 'Foam', uom: 'ea', quantity: 3 }),
  ] });
  assert.equal(alex(result).concrete, 100);
  assert.equal(alex(result).quantities.length, 4);
  assert.deepEqual(alex(result).quantities.filter(line => line.unit === 'EA').map(line => line.quantity).sort((a, b) => a - b), [3, 7, 9]);
});

test('rebar tons use recognized bar weight and explicit length; chairs, dowels, mesh, and incomplete entries are excluded', () => {
  assert.equal(calculateInstalledRebarTons(165, 'ea', "#9 - #4 Rebar - 20' Pc - SOG"), 1.1022);
  assert.equal(calculateInstalledRebarTons(10, 'pieces', '#5 Rebar 20 ft'), 0.1043);
  assert.equal(calculateInstalledRebarTons(10, 'ea', '#4 Rebar By The Piece'), null);
  assert.equal(calculateInstalledRebarTons(10, 'ea', '#5 Rebar Speed Dowel Tube 5/8" x 9"'), null);
  assert.equal(calculateInstalledRebarTons(10, 'ea', 'Rebar Chairs'), null);
  assert.equal(calculateInstalledRebarTons(10, 'ea', '#4 Rebar 20 ft Wire Mesh'), null);
  assert.equal(calculateInstalledRebarTons(10, 'lb', '#4 Rebar 20 ft'), null);

  const crew = alex(report({ timecards: [], logs: [
    log({ procoreId: 'bar', lineItemId: 'bar-line', description: 'Rebar material', logDescription: "#9 - #4 Rebar - 20' Pc - SOG", quantity: 165, uom: 'ea' }),
    log({ procoreId: 'missing-length', lineItemId: 'missing-length-line', description: 'Rebar material', logDescription: '#4 Rebar By The Piece', quantity: 10, uom: 'ea' }),
    log({ procoreId: 'dowel', lineItemId: 'dowel-line', logDescription: '#4 Rebar Speed Dowel Tube 5/8" x 9"', quantity: 10, uom: 'ea' }),
    log({ procoreId: 'unmatched', lineItemId: 'unmatched-line', description: 'Rebar material', logDescription: "#4 Rebar - 20' Pc", quantity: 8, uom: 'ea', metadataMatches: 0 }),
  ] }));
  assert.equal(crew.rebarTons, 1.1022);
  assert.equal(crew.rebarCalculatedEntries, 1);
  assert.equal(crew.rebarUncalculatedEntries, 2);
  assert.equal(crew.quantities.find(line => line.lineItemId === 'bar-line').rebarTons, 1.1022);
  assert.equal(crew.quantities.find(line => line.lineItemId === 'missing-length-line').rebarTons, null);
});

test('missing and conflicting PO metadata remain explicit, not zero or a usable production rate', () => {
  for (const metadataMatches of [0, 2]) {
    const crew = alex(report({ logs: [log({ metadataMatches })] }));
    assert.equal(crew.concrete, 0);
    assert.equal(crew.quantities[0].quantity, 100);
    assert.equal(crew.quantities[0].unit, 'Unknown unit');
    assert.match(crew.review[0].message, /PO metadata/);
    assert.equal(crew.rates[0].percentOfEstimate, null);
  }
});

test('reporting gaps are evidence-backed past project/days only, not days inferred from an absent schedule', () => {
  const result = report({
    timecards: [timecard(), timecard({ procoreId: 'today', date: '2026-10-21' }), timecard({ procoreId: 'future', date: '2026-10-22' })],
    logs: [log({ date: '2026-10-20' })],
  });
  const gaps = alex(result).review;
  assert.equal(gaps.length, 2);
  assert.deepEqual(gaps.map(item => [item.date, item.kind]), [['2026-10-19', 'quantity-log'], ['2026-10-20', 'timecards']]);
  const empty = alex(report({ timecards: [], logs: [] }));
  assert.equal(empty.review.length, 0);
});

test('another person logging quantities does not satisfy this submitter reporting coverage or rate', () => {
  const result = report({ logs: [log({ creatorId: 'office', creatorName: 'Office Admin', creatorLogin: 'office@example.test' })] });
  assert.equal(alex(result).rates[0].actualRate, null);
  assert.equal(alex(result).review[0].kind, 'quantity-log');
  const office = result.crews.find(crew => crew.id === 'id:office');
  assert.equal(office.rates[0].actualRate, null);
  assert.equal(office.review[0].kind, 'timecards');
});

test('unattributed entries cannot manufacture a combined crew rate or a reassuring gap result', () => {
  const noIdentity = { creatorId: null, creatorName: null, creatorLogin: null };
  const result = report({ timecards: [timecard(noIdentity)], logs: [log(noIdentity)] });
  const unattributed = result.crews.find(crew => crew.id === 'unattributed');
  assert.equal(unattributed.hours, 50);
  assert.equal(unattributed.rates[0].actualRate, null);
  assert.ok(unattributed.review.some(item => /submitter is missing/.test(item.message)));
});

test('invalid source values and unlinked projects surface review items without financial-looking defaults', () => {
  const result = report({ timecards: [timecard({ hours: null })], logs: [log({ quantity: NaN })] });
  assert.equal(alex(result).hours, 0);
  assert.equal(alex(result).concrete, 0);
  assert.equal(alex(result).review.length, 2);
  const unlinked = alex(report({ timecards: [timecard({ projectId: null })], logs: [log({ projectId: null, id: 'different-log' })] }));
  assert.equal(unlinked.days.length, 2);
  assert.ok(unlinked.review.some(item => /project link is missing/.test(item.message)));
  assert.ok(unlinked.rates.every(rate => rate.percentOfEstimate === null));
});

test('a missing or zero estimate baseline stays unavailable; actual measured pace can still be read', () => {
  for (const estimates of [[], [estimate({ pmcGroup: { 'Slab On Grade Labor': 0 } })]]) {
    const rate = alex(report({ estimates })).rates[0];
    assert.equal(rate.actualRate, 2);
    assert.equal(rate.estimatedRate, null);
    assert.equal(rate.percentOfEstimate, null);
    assert.ok(rate.reason);
  }
});

test('partial project/day coverage, including an unfinished day, cannot generate a favorable pace comparison', () => {
  for (const date of ['2026-10-20', '2026-10-21']) {
    const result = report({ logs: [log(), log({ procoreId: 'extra-day', date, quantity: 500 })] });
    const rate = alex(result).rates[0];
    assert.equal(rate.actualRate, null);
    assert.equal(rate.estimatedRate, 1.5);
    assert.equal(rate.percentOfEstimate, null);
    assert.match(rate.reason, /without matching field hours|unfinished day/);
  }
  const badSource = report({ logs: [log(), log({ procoreId: 'bad-metadata', metadataMatches: 2 })] });
  assert.equal(alex(badSource).rates[0].actualRate, null);
  assert.match(alex(badSource).rates[0].reason, /source-data/);
});

test('past hours-only prep days stay in the pace denominator and remain listed for review', () => {
  const result = report({ timecards: [timecard(), timecard({ procoreId: 'prep', date: '2026-10-20', hours: 25 })] });
  const crew = alex(result);
  assert.equal(crew.rates[0].hours, 75);
  assert.equal(crew.rates[0].actualRate, 100 / 75);
  assert.deepEqual(crew.review.map(item => [item.date, item.kind]), [['2026-10-20', 'quantity-log']]);
  const today = alex(report({ timecards: [timecard(), timecard({ procoreId: 'today', date: '2026-10-21', hours: 25 })] }));
  assert.equal(today.rates[0].actualRate, null);
  assert.match(today.rates[0].reason, /unfinished day/);
});

test('source problems on a different same-named project do not suppress a valid comparison', () => {
  const result = report({
    projects: [project(), project({ procoreProjectId: 'p2', bidBoardId: 'b2' })],
    logs: [log(), log({ projectId: 'p2', metadataMatches: 0 })],
  });
  assert.equal(alex(result).rates.find(rate => rate.projectId === 'p1').actualRate, 2);
  assert.equal(alex(result).review.find(item => item.kind === 'source').projectId, 'p2');
});

test('a stable submitter ID keeps entries together even when a mirror omits the display name and login', () => {
  const result = report({ logs: [log({ creatorName: null, creatorLogin: null })] });
  assert.equal(result.crews.length, 1);
  assert.equal(alex(result).rates[0].actualRate, 2);
});

test('explicit hour units cannot become cubic yards through legacy concrete-code unit correction', () => {
  const result = report({ logs: [log({ uom: 'hours', costType: 'L', quantity: 40 })] });
  assert.equal(alex(result).hours, 90);
  assert.equal(alex(result).logHours, 40);
  assert.equal(alex(result).logCount, 1);
  assert.equal(alex(result).concrete, 0);
  assert.equal(alex(result).quantities.length, 0);
  assert.equal(alex(result).rates[0].actualRate, null);
});

test('a missing unit stays unavailable even when the cost code usually identifies concrete', () => {
  const crew = alex(report({ logs: [log({ uom: null })] }));
  assert.equal(crew.concrete, 0);
  assert.equal(crew.quantities[0].unit, 'Unknown unit');
  assert.ok(crew.review.some(item => /no unit/.test(item.message)));
  assert.equal(crew.rates[0].actualRate, null);
});

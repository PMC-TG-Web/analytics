import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOpenArAlerts, openArAlertEmail, parseOpenArAlertStatus } from '../src/lib/qboOpenArAlerts.ts';
import { config } from '../netlify/functions/qbo-open-ar-monitor.mts';

function monitor() {
  let record = null, version = 0;
  const f = { status: { reason: null, lastReadAt: '2026-11-25T12:09:00.000Z', lastFailureId: 'before-launch' }, deliveries: [], rejectEmail: false };
  const store = {
    async getWithMetadata() { return record && { data: structuredClone(record), etag: String(version) }; },
    async setJSON(key, value, options) {
      if (options.onlyIfNew ? record !== null : options.onlyIfMatch !== String(version)) return { modified: false };
      record = structuredClone(value); return { modified: true, etag: String(++version) };
    },
  };
  f.check = () => checkOpenArAlerts(store, '123/primary', async () => parseOpenArAlertStatus(f.status), async alert => {
    f.deliveries.push({ id: alert.id, ...openArAlertEmail(alert) });
    if (f.rejectEmail) throw new Error('Provider unavailable');
  });
  return f;
}

test('every five minutes an independent monitor detects failed, stuck, offline and stale reports', async () => {
  assert.equal(config.schedule, '*/5 * * * *');
  for (const reason of ['expired', 'failed', 'stale', 'offline', 'missing']) {
    const f = monitor();
    assert.equal(await f.check(), 'healthy');
    f.status.reason = reason;
    await Promise.all([f.check(), f.check()]);
    assert.equal(await f.check(), 'already-alerted');
    assert.equal(f.deliveries.length, 1);
    assert.deepEqual(f.deliveries[0].to, ['todd@pmcdecor.com']);
    assert.match(f.deliveries[0].text, /7:09 AM Eastern/);
    assert.match(f.deliveries[0].text, /https:\/\/analyticspmc\.netlify\.app\/accounting\/open-ar/);
    f.status.reason = null; await f.check();
    f.status.reason = 'stale'; await f.check();
    assert.equal(f.deliveries.length, 2);
    assert.notEqual(f.deliveries[0].id, f.deliveries[1].id);
  }
});

test('malformed or unreachable status alerts using the last known date and retries identical email after recovery', async () => {
  const f = monitor(); await f.check();
  f.status = {}; f.rejectEmail = true;
  await assert.rejects(f.check(), /Provider unavailable/);
  f.status = { reason: null, lastReadAt: '2026-11-25T13:09:00.000Z', lastFailureId: 'before-launch' };
  f.rejectEmail = false;
  assert.equal(await f.check(), 'alerted');
  assert.deepEqual(f.deliveries[0], f.deliveries[1]);
  assert.match(f.deliveries[0].text, /could not check/);
  assert.equal(await f.check(), 'healthy');
  for (const status of [null, {}, { reason: 'ok' }, { reason: null, lastReadAt: '', lastFailureId: null }]) {
    assert.throws(() => parseOpenArAlertStatus(status));
  }
});

test('a failed read that recovered between checks is reported once and historical failures are skipped at activation', async () => {
  const f = monitor(); await f.check();
  assert.equal(f.deliveries.length, 0);
  f.status.lastFailureId = 'new-failure';
  assert.equal(await f.check(), 'alerted');
  assert.match(f.deliveries[0].text, /between monitoring checks/);
  assert.equal(await f.check(), 'healthy');
  assert.equal(f.deliveries.length, 1);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, fetchLatestRelease, shouldNotify } = require('../electron/updater');

test('compares semantic versions including v prefixes and prereleases', () => {
  assert.equal(compareVersions('v0.0.2', '0.0.1'), 1);
  assert.equal(compareVersions('0.0.1', '0.0.1'), 0);
  assert.equal(compareVersions('0.0.1-beta.2', '0.0.1-beta.10'), -1);
  assert.equal(compareVersions('0.0.1', '0.0.1-rc.1'), 1);
});

test('fetches the latest published release from the internal API', async () => {
  const release = await fetchLatestRelease('https://example.test/api/latest', async () => ({ ok: true, async json() { return { release: { version: '0.0.2', name: 'Future release' } }; } }));
  assert.deepEqual(release, { version: '0.0.2', name: 'Future release' });
});

test('does not notify for the current version or the same already-notified release', () => {
  assert.equal(shouldNotify({ version: '0.0.1' }, '0.0.1', ''), false);
  assert.equal(shouldNotify({ version: '0.0.2' }, '0.0.1', '0.0.2'), false);
  assert.equal(shouldNotify({ version: '0.0.2' }, '0.0.1', ''), true);
  assert.equal(shouldNotify({ version: '0.0.3' }, '0.0.1', '0.0.2'), true);
});

test('fails safely when the release endpoint is unavailable', async () => {
  await assert.rejects(() => fetchLatestRelease('https://example.test/api/latest', async () => ({ ok: false, status: 503 })));
});

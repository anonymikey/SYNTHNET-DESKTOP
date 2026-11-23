'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const github = require('../api/_github');
const latest = require('../api/latest');
const releases = require('../api/releases');
const download = require('../api/download');
const waitlist = require('../api/waitlist');

function responseRecorder() { return { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, redirect(code, location) { this.statusCode = code; this.location = location; return this; } }; }

test('API normalizes releases from a fake GitHub server', { concurrency: false }, async (t) => {
  let fail = false;
  const server = http.createServer((req, res) => { if (fail) { res.writeHead(500); return res.end('nope'); } res.setHeader('content-type', 'application/json'); res.end(JSON.stringify([{ id: 1, tag_name: 'v0.10.0', name: 'Desktop 0.10', body: '**TV support**', html_url: 'https://github.com/example/release', published_at: '2026-01-02T00:00:00Z', assets: [{ name: 'SYNTHNET Setup 0.10.0.exe', size: 42, browser_download_url: 'https://downloads.example/setup.exe', content_type: 'application/octet-stream' }] }, { id: 2, tag_name: 'v0.9.0', name: 'Desktop 0.9', body: 'Older', html_url: 'https://github.com/example/old', published_at: '2025-12-01T00:00:00Z', assets: [] }])); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  process.env.GITHUB_OWNER = 'example'; process.env.GITHUB_REPO = 'synthnet'; process.env.GITHUB_API_BASE = `http://127.0.0.1:${server.address().port}`; github.clearCache();
  const latestRes = responseRecorder(); await latest({}, latestRes); assert.equal(latestRes.statusCode, 200); assert.equal(latestRes.body.release.version, '0.10.0'); assert.equal(latestRes.body.release.installer.name, 'SYNTHNET Setup 0.10.0.exe'); assert.equal(JSON.stringify(latestRes.body).includes('github.com'), false); assert.equal(JSON.stringify(latestRes.body).includes('downloads.example'), false);
  const historyRes = responseRecorder(); await releases({}, historyRes); assert.equal(historyRes.body.releases.length, 2);
  const downloadRes = responseRecorder(); await download({ query: { version: '0.10.0' } }, downloadRes); assert.equal(downloadRes.location, 'https://downloads.example/setup.exe');
  fail = true; process.env.GITHUB_OWNER = 'example'; process.env.GITHUB_REPO = 'synthnet'; process.env.GITHUB_API_BASE = `http://127.0.0.1:${server.address().port}`; for (const entry of github._cache.values()) entry.updatedAt = Date.now() - 121000; const staleRes = responseRecorder(); await releases({}, staleRes); assert.equal(staleRes.statusCode, 200); assert.equal(staleRes.body.stale, true);
});

test('API returns safe errors without exposing GitHub details', { concurrency: false }, async () => { process.env.GITHUB_OWNER = ''; process.env.GITHUB_REPO = ''; github.clearCache(); const result = responseRecorder(); await latest({}, result); assert.equal(result.statusCode, 503); assert.equal(result.body.error, 'not_configured'); assert.equal(JSON.stringify(result.body).includes('token'), false); });

test('waitlist registers a Resend contact and sends a confirmation without exposing provider errors', { concurrency: false }, async () => {
  const previousFetch = global.fetch;
  const previous = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL, segment: process.env.RESEND_SEGMENT_ID };
  const calls = [];
  process.env.RESEND_API_KEY = 'test-resend-key'; process.env.RESEND_FROM_EMAIL = 'updates@anonymiketech.space'; process.env.RESEND_SEGMENT_ID = 'segment-early-access';
  global.fetch = async (url, options) => { calls.push({ url, options: JSON.parse(options.body) }); return { ok: true, status: 200, async json() { return { id: 'resend-id' }; } }; };
  try {
    const result = responseRecorder(); await waitlist({ method: 'POST', body: { email: 'Person@example.com', website: '' } }, result);
    assert.equal(result.statusCode, 200); assert.deepEqual(result.body, { ok: true, already_registered: false }); assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://api.resend.com/contacts'); assert.equal(calls[0].options.email, 'person@example.com'); assert.deepEqual(calls[0].options.segments, [{ id: 'segment-early-access' }]);
    assert.equal(calls[1].url, 'https://api.resend.com/emails'); assert.deepEqual(calls[1].options.to, ['person@example.com']); assert.equal(calls[1].options.from, 'updates@anonymiketech.space');
  } finally { global.fetch = previousFetch; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[{ key: 'RESEND_API_KEY', from: 'RESEND_FROM_EMAIL', segment: 'RESEND_SEGMENT_ID' }[key]]; else process.env[{ key: 'RESEND_API_KEY', from: 'RESEND_FROM_EMAIL', segment: 'RESEND_SEGMENT_ID' }[key]] = value; } }
});

test('waitlist fails safely when Resend is not configured', { concurrency: false }, async () => {
  const previous = { key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL };
  delete process.env.RESEND_API_KEY; delete process.env.RESEND_FROM_EMAIL;
  try { const result = responseRecorder(); await waitlist({ method: 'POST', body: { email: 'person@example.com' } }, result); assert.equal(result.statusCode, 503); assert.deepEqual(result.body, { error: 'not_configured' }); }
  finally { if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key; if (previous.from === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = previous.from; }
});

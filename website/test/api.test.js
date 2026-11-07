'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const github = require('../api/_github');
const latest = require('../api/latest');
const releases = require('../api/releases');
const download = require('../api/download');

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

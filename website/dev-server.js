'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const build = require('./build');
const root = path.join(__dirname, 'public');
const mockRelease = { id: 'mock-010', tag: 'v0.10.0', version: '0.10.0', name: 'SYNTHNET Desktop v0.10.0', body: 'Add a TV by MAC address to My devices.', htmlUrl: 'https://github.com/', publishedAt: '2026-01-01T00:00:00Z', prerelease: false, draft: false, assets: [{ name: 'SYNTHNET Setup 0.10.0.exe', size: 0, downloadUrl: 'https://example.com/SYNTHNET-Setup.exe', contentType: 'application/octet-stream' }] };
const mock = process.argv.includes('--mock');
function json(response, code, body) { response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); }
function serve(response, pathname) { const file = pathname === '/' ? 'index.html' : pathname.slice(1); const safe = path.normalize(file).replace(/^\.\.(?:[\\/]|$)/, ''); const target = path.join(root, safe); if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return json(response, 404, { error: 'Not found' }); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' }; response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' }); fs.createReadStream(target).pipe(response); }
const server = http.createServer((request, response) => { const parsed = url.parse(request.url, true); if (mock && parsed.pathname === '/api/latest') return json(response, 200, { release: mockRelease, stale: false }); if (mock && parsed.pathname === '/api/releases') return json(response, 200, { releases: [mockRelease], stale: false }); if (mock && parsed.pathname === '/api/download') return response.writeHead(302, { location: mockRelease.assets[0].downloadUrl }).end(); if (parsed.pathname.startsWith('/api/')) return json(response, 404, { error: 'Not found' }); return serve(response, parsed.pathname); });
const port = Number(process.env.PORT || 4173); server.listen(port, '127.0.0.1', () => console.log(`SYNTHNET website -> http://127.0.0.1:${port}${mock ? ' (mock APIs)' : ''}`));

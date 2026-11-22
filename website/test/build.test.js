'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');

test('build creates the deployable static site', () => {
  execFileSync(process.execPath, ['build.js'], { cwd: root, stdio: 'pipe', env: { ...process.env, ISP_ENABLED: 'false' } });
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /id="features"/); assert.match(html, /Courtney Tech/); assert.match(html, /SMS\.OTS/); assert.match(html, /id="download"/); assert.match(html, /src="\/app\.js"/); assert.doesNotMatch(html, /<script(?![^>]+src)/i); assert.doesNotMatch(html, / on[a-z]+=/i);
  assert.ok(fs.existsSync(path.join(root, 'public/manus-routes.json'))); assert.ok(fs.existsSync(path.join(root, 'public/favicon.svg'))); assert.ok(fs.existsSync(path.join(root, 'public/status.html'))); assert.ok(fs.existsSync(path.join(root, 'public/status.js'))); assert.ok(fs.existsSync(path.join(root, 'public/isp.html'))); assert.ok(!fs.existsSync(path.join(root, 'public/isp.js'))); assert.ok(!fs.existsSync(path.join(root, 'public/isp.css')));
  const isp = fs.readFileSync(path.join(root, 'public/isp.html'), 'utf8'); assert.match(isp, /ISP Network/); assert.match(isp, /coming soon/i); assert.match(isp, /Access is currently closed/); assert.doesNotMatch(isp, /MikroTik HotSpot/); assert.doesNotMatch(isp, /<script/i);
  const routes = fs.readFileSync(path.join(root, 'public/manus-routes.json'), 'utf8'); assert.match(routes, /"\/status"/); assert.match(routes, /"\/isp"/);
});

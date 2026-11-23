'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
test('ISP workspace is a separate route with explicit product boundaries', () => {
  execFileSync(process.execPath, ['build.js'], { cwd: root, stdio: 'pipe', env: { ...process.env, ISP_ENABLED: 'true' } });
  const html = fs.readFileSync(path.join(root, 'public/isp.html'), 'utf8');
  assert.match(html, /SYNTHNET ISP Network/);
  assert.match(html, /MikroTik HotSpot/);
  assert.match(html, /TP-Link Omada/);
  assert.match(html, /Other AP \/ RADIUS/);
  assert.match(html, /Courtney Tech/);
  assert.match(html, /SMS\.OTS/);
  assert.match(html, /bring-your-own Courtney Tech M-Pesa credentials/);
  assert.match(html, /Desktop remains the local-first single-site hotspot manager/);
  assert.match(html, /This is the product surface and information architecture/);
  assert.match(html, /src="\/isp\.js"/);
  assert.match(html, /href="\/isp\.css"/);
});

test('ISP is maintenance-only by default', () => {
  execFileSync(process.execPath, ['build.js'], { cwd: root, stdio: 'pipe', env: { ...process.env, ISP_ENABLED: '' } });
  const html = fs.readFileSync(path.join(root, 'public/isp.html'), 'utf8');
  assert.match(html, /is coming soon/i);
  assert.match(html, /Access is currently closed/);
  assert.doesNotMatch(html, /MikroTik HotSpot/);
  assert.doesNotMatch(html, /isp\.js/);
  assert.match(html, /isp-waitlist-form/);
  assert.match(html, /waitlist\.js/);
  assert.ok(!fs.existsSync(path.join(root, 'public/isp.js')));
  assert.ok(!fs.existsSync(path.join(root, 'public/isp.css')));
});

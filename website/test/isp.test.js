'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
test('ISP workspace is a separate route with explicit product boundaries', () => {
  execFileSync(process.execPath, ['build.js'], { cwd: root, stdio: 'pipe' });
  const html = fs.readFileSync(path.join(root, 'public/isp.html'), 'utf8');
  assert.match(html, /SYNTHNET ISP Network/);
  assert.match(html, /MikroTik HotSpot/);
  assert.match(html, /TP-Link Omada/);
  assert.match(html, /Other AP \/ RADIUS/);
  assert.match(html, /Desktop remains the local-first single-site hotspot manager/);
  assert.match(html, /This is the product surface and information architecture/);
  assert.match(html, /src="\/isp\.js"/);
  assert.match(html, /href="\/isp\.css"/);
});

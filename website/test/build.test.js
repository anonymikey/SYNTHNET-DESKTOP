'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');

test('build creates the deployable static site', () => {
  execFileSync(process.execPath, ['build.js'], { cwd: root, stdio: 'pipe' });
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  assert.match(html, /id="features"/); assert.match(html, /id="download"/); assert.match(html, /src="\/app\.js"/); assert.doesNotMatch(html, /<script(?![^>]+src)/i); assert.doesNotMatch(html, / on[a-z]+=/i);
  assert.ok(fs.existsSync(path.join(root, 'public/manus-routes.json'))); assert.ok(fs.existsSync(path.join(root, 'public/favicon.svg'))); assert.ok(fs.existsSync(path.join(root, 'public/status.html'))); assert.ok(fs.existsSync(path.join(root, 'public/status.js')));
  assert.match(fs.readFileSync(path.join(root, 'public/manus-routes.json'), 'utf8'), /"\/status"/);
});

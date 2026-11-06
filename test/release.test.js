'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bump, promote } = require('../scripts/release');
const { extract } = require('../scripts/release-notes');
const CHANGELOG = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n**New thing.** Works.\n\n## [0.10.0] - 2026-10-25\n\n### Added\n\n**Old thing.** Done.\n`;
test('supports patch minor major and exact prerelease bumps', () => {
  assert.equal(bump('1.2.3', 'patch'), '1.2.4');
  assert.equal(bump('1.2.3', 'minor'), '1.3.0');
  assert.equal(bump('1.2.3', 'major'), '2.0.0');
  assert.equal(bump('1.2.3', '1.3.0-pre.1'), '1.3.0-pre.1');
});
test('rejects invalid or older versions', () => {
  assert.throws(() => bump('1.2.3', 'wat'), /Invalid/);
  assert.throws(() => bump('1.2.3', '1.2.3'), /not newer/);
  assert.throws(() => bump('1.2.3', '1.1.9'), /not newer/);
});
test('promotes non-empty unreleased notes and inserts a fresh section', () => {
  const out = promote(CHANGELOG, '0.11.0', '2026-11-06');
  assert.match(out, /## \[Unreleased\]/);
  assert.match(out, /## \[0\.11\.0\] - 2026-11-06/);
  assert.equal(extract('0.11.0', out).includes('New thing'), true);
});
test('ignores comments and empty headings when judging content', () => {
  assert.throws(() => promote('# Changelog\n\n## [Unreleased]\n\n<!-- no -->\n\n### Added\n', '1.0.0', '2026-11-06'), /no real content/);
});

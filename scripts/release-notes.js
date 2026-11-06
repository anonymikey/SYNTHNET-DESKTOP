'use strict';
const fs = require('node:fs');
const path = require('node:path');
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
function readChangelog(file = path.join(process.cwd(), 'CHANGELOG.md')) { return fs.readFileSync(file, 'utf8'); }
function extract(version, text = readChangelog()) {
  if (!versionPattern.test(version)) throw new Error(`Invalid version: ${version}`);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^## \\[${escaped}\\].*$`, 'm');
  const m = re.exec(text);
  if (!m) throw new Error(`No changelog section found for ${version}`);
  const start = m.index;
  const next = text.slice(m.index + m[0].length).search(/^## \[/m);
  const section = text.slice(start, next < 0 ? text.length : m.index + m[0].length + next).trim();
  const body = section.replace(/^## \[[^\]]+\](?:[^\n]*)\n?/, '').replace(/<!--[^]*?-->/g, '').replace(/^### .*\n?$/gm, '').trim();
  if (!body) throw new Error(`Changelog section for ${version} is empty`);
  return section;
}
function main(argv) {
  const check = argv.indexOf('--check-tag');
  if (check !== -1) {
    const tag = argv[check + 1];
    if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('Usage: --check-tag vX.Y.Z');
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json')));
    const version = tag.slice(1);
    if (pkg.version !== version) throw new Error(`Tag ${tag} does not match package.json version ${pkg.version}`);
    process.stdout.write(extract(version) + '\n');
    return;
  }
  const version = argv.find((x) => !x.startsWith('-'));
  if (!version) throw new Error('Usage: node scripts/release-notes.js X.Y.Z');
  process.stdout.write(extract(version) + '\n');
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (err) { console.error(`release-notes: ${err.message}`); process.exitCode = 1; } }
module.exports = { extract };

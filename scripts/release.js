'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { extract } = require('./release-notes');
const ROOT = process.cwd();
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
function git(args, opts = {}) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: opts.stdio || ['ignore', 'pipe', 'pipe'] }).trim(); }
function fail(message) { throw new Error(message); }
function parse(v) { const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/); return { a:+m[1], b:+m[2], c:+m[3], pre:m[4] || '' }; }
function bump(current, spec) {
  if (['patch','minor','major'].includes(spec)) { const v = parse(current); if (spec === 'major') v.a++; if (spec === 'minor') { v.b++; v.c=0; } if (spec === 'patch') v.c++; v.pre=''; return `${v.a}.${v.b}.${v.c}`; }
  if (!VERSION.test(spec)) fail(`Invalid bump kind or version: ${spec}`);
  const a=parse(current), b=parse(spec); if ([b.a,b.b,b.c].some((n,i)=>n < [a.a,a.b,a.c][i]) || (b.a===a.a&&b.b===a.b&&b.c===a.c&&(!b.pre || a.pre))) fail(`Version ${spec} is not newer than ${current}`);
  return spec;
}
function promote(text, version, date) {
  const heading = `## [${version}] - ${date}`;
  const re = /^## \[Unreleased\][^\n]*\n?/m; const m = re.exec(text); if (!m) fail('CHANGELOG.md is missing ## [Unreleased]');
  const after = text.slice(m.index + m[0].length); const next = after.search(/^## \[/m); const body = (next < 0 ? after : after.slice(0,next)).replace(/<!--[^]*?-->/g,'').replace(/^### .*\n?$/gm,'').trim();
  if (!body) fail('CHANGELOG.md Unreleased has no real content');
  return text.slice(0,m.index) + '## [Unreleased]\n\n<!-- Add plain-language notes under Unreleased. -->\n\n' + heading + '\n\n' + after;
}
function main(argv) {
  const spec=argv[0], dry=argv.includes('--dry-run'), push=argv.includes('--push'), allowDirty=argv.includes('--allow-dirty');
  if (!spec || argv.some(x=>x.startsWith('--') && !['--dry-run','--push','--allow-dirty'].includes(x))) fail('Usage: npm run release -- patch|minor|major|x.y.z[-pre.n] [--dry-run] [--push] [--allow-dirty]');
  try { git(['rev-parse','--show-toplevel']); } catch { fail('Not a git repository'); }
  if (!allowDirty && git(['status','--porcelain','--untracked-files=no'])) fail('Tracked changes are present; commit or use --allow-dirty');
  const pkgPath=path.join(ROOT,'package.json'), lockPath=path.join(ROOT,'package-lock.json'); const pkg=JSON.parse(fs.readFileSync(pkgPath)); const lock=JSON.parse(fs.readFileSync(lockPath));
  const next=bump(pkg.version,spec), tag=`v${next}`; try { git(['rev-parse','--verify',tag]); fail(`Tag already exists: ${tag}`); } catch (e) { if (e.message.includes('Tag already')) throw e; }
  const notes=extract(next, promote(fs.readFileSync(path.join(ROOT,'CHANGELOG.md'),'utf8'), next, new Date().toISOString().slice(0,10)));
  console.log(`Plan: ${pkg.version} -> ${next}\nTag: ${tag}\n\n${notes}`); if (dry) return;
  const changelog=promote(fs.readFileSync(path.join(ROOT,'CHANGELOG.md'),'utf8'), next, new Date().toISOString().slice(0,10));
  pkg.version=next; lock.version=next; if (lock.packages && lock.packages['']) lock.packages[''].version=next;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg,null,2)+'\n'); fs.writeFileSync(lockPath, JSON.stringify(lock,null,2)+'\n'); fs.writeFileSync(path.join(ROOT,'CHANGELOG.md'),changelog);
  git(['add','package.json','package-lock.json','CHANGELOG.md']); git(['commit','-m',`Release ${tag}`]); git(['tag','-a',tag,'-m',`SYNTHNET ${tag}`]);
  if (push) git(['push','origin','HEAD','--follow-tags']); else console.log(`Push with: git push origin HEAD --follow-tags`);
}
if (require.main===module) { try { main(process.argv.slice(2)); } catch (e) { console.error(`release: ${e.message}`); process.exitCode=1; } }
module.exports={bump,promote};

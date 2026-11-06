'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname, src = path.join(root, 'src'), out = path.join(root, 'public');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const siteUrl = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) || '';
const repo = process.env.GITHUB_REPO || ''; const hash = crypto.createHash('sha256');
for (const file of ['styles.css', 'app.js']) hash.update(fs.readFileSync(path.join(src, file)));
const assetVersion = hash.digest('hex').slice(0, 12);
for (const file of fs.readdirSync(src)) { const source = path.join(src, file); const dest = path.join(out, file); if (fs.statSync(source).isFile()) { let data = fs.readFileSync(source); if (/\.(html|svg|xml|txt|json)$/.test(file)) data = Buffer.from(data.toString().replaceAll('%SITE_URL%', siteUrl).replaceAll('%REPO%', repo).replaceAll('%YEAR%', String(new Date().getFullYear())).replaceAll('%ASSET_V%', assetVersion)); fs.writeFileSync(dest, data); } }
function copyTree(source, destination) { fs.mkdirSync(destination, { recursive: true }); for (const entry of fs.readdirSync(source, { withFileTypes: true })) { const from = path.join(source, entry.name); const to = path.join(destination, entry.name); if (entry.isDirectory()) copyTree(from, to); else fs.copyFileSync(from, to); } }
if (fs.existsSync(path.join(src, 'assets'))) copyTree(path.join(src, 'assets'), path.join(out, 'assets'));
for (const file of ['favicon.svg', 'og.svg']) { const source = path.join(root, 'public', file); if (fs.existsSync(source)) fs.copyFileSync(source, path.join(out, file)); }
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /api/\n'); fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteUrl || '/'}</loc></url></urlset>\n`); fs.writeFileSync(path.join(out, 'manus-routes.json'), JSON.stringify({ routes: [{ path: '/', title: 'SYNTHNET Desktop' }] }, null, 2) + '\n'); console.log(`Built ${out}`);

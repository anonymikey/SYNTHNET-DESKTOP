'use strict';
const { listReleases, latest } = require('./_github');
const publicRelease = (release) => ({ version: release.version, tag: release.tag, name: release.name, publishedAt: release.publishedAt, prerelease: release.prerelease, notes: release.notes, sha256: release.sha256, installer: release.installer ? { name: release.installer.name, size: release.installer.size, downloads: release.installer.downloads } : null });
module.exports = async function latestRoute(req, res) {
  try { const result = await listReleases(); const release = latest(result.data); if (!release) return res.status(404).json({ error: 'not_found' }); res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600'); return res.status(200).json({ release: publicRelease(release), stale: Boolean(result.stale) }); }
  catch (error) { const code = error.code || 'upstream'; const status = code === 'not_configured' ? 503 : code === 'not_found' ? 404 : code === 'bad_token' ? 401 : code === 'rate_limited' ? 429 : 503; return res.status(status).json({ error: code }); }
};

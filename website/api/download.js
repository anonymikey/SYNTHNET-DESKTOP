'use strict';
const { listReleases } = require('./_github');
const VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/i;
module.exports = async function download(req, res) {
  try {
    const requested = String((req.query && (req.query.v || req.query.version || req.query.tag)) || '').trim();
    if (requested && !VERSION.test(requested)) return res.redirect(302, '/?dl=bad_version#download');
    const result = await listReleases(); const target = requested ? requested.replace(/^v/i, '').toLowerCase() : null;
    const release = (target ? result.data.find((r) => r.version.toLowerCase() === target || r.tag.toLowerCase() === requested.toLowerCase()) : null) || result.data.find((r) => !r.prerelease && r.installer);
    if (!release || !release.installer) return res.redirect(302, '/?dl=not_found#download');
    const token = process.env.GITHUB_TOKEN;
    if (!token) return res.writeHead ? res.writeHead(302, { Location: release.installer.downloadUrl, 'Cache-Control': 'no-store' }).end() : res.redirect(302, release.installer.downloadUrl);
    const upstream = await fetch(release.installer.apiUrl, { headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${token}`, 'User-Agent': 'synthnet-website/1.0' }, redirect: 'manual' });
    const location = upstream.headers.get('location'); if (!location) throw new Error('No signed download location');
    return res.writeHead ? res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }).end() : res.redirect(302, location);
  } catch { return res.redirect(302, '/?dl=upstream#download'); }
};

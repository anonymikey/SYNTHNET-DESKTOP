'use strict';
const { listReleases } = require('./_github');

function installer(asset) {
  return asset && /\.(exe|msi|zip)$/i.test(asset.name) ? asset : null;
}

module.exports = async function download(req, res) {
  try {
    const requested = String((req.query && (req.query.version || req.query.tag)) || '').trim().toLowerCase();
    const result = await listReleases();
    const release = result.data.find((item) => requested && (item.version.toLowerCase() === requested || item.tag.toLowerCase() === requested)) || result.data.find((item) => !item.prerelease) || result.data[0];
    const asset = release && (release.assets.find((item) => /^SYNTHNET Setup .*\.exe$/i.test(item.name)) || installer(release.assets[0]));
    if (!release || !asset || !asset.downloadUrl) return res.status(404).json({ error: 'Installer is not available yet' });
    res.setHeader('cache-control', 'public, max-age=300');
    return res.redirect(302, asset.downloadUrl);
  } catch (error) {
    return res.status(503).json({ error: 'Download service is temporarily unavailable' });
  }
};

'use strict';
const { listReleases, latest } = require('./_github');
module.exports = async function latestRoute(req, res) {
  try { const result = await listReleases(); const release = latest(result.data); if (!release) return res.status(404).json({ error: 'not_found' }); res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600'); return res.status(200).json({ release, stale: Boolean(result.stale) }); }
  catch (error) { const code = error.code || 'upstream'; const status = code === 'not_configured' ? 503 : code === 'not_found' ? 404 : code === 'bad_token' ? 401 : code === 'rate_limited' ? 429 : 503; return res.status(status).json({ error: code }); }
};

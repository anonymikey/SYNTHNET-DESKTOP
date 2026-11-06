'use strict';
const { listReleases } = require('./_github');
module.exports = async function releases(req, res) {
  try { const result = await listReleases(); res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600'); return res.status(200).json({ releases: result.data, stale: Boolean(result.stale) }); }
  catch (error) { const code = error.code || 'upstream'; const status = code === 'not_configured' ? 503 : code === 'not_found' ? 404 : code === 'bad_token' ? 401 : code === 'rate_limited' ? 429 : 503; return res.status(status).json({ error: code }); }
};

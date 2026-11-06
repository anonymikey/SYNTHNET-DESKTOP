'use strict';
const { listReleases } = require('./_github');

module.exports = async function releases(req, res) {
  try {
    const result = await listReleases();
    res.setHeader('cache-control', result.stale ? 'public, max-age=60, stale-while-revalidate=300' : 'public, max-age=300, stale-while-revalidate=900');
    res.setHeader('x-release-source', result.stale ? 'cache' : 'github');
    return res.status(200).json({ releases: result.data, stale: Boolean(result.stale) });
  } catch (error) {
    return res.status(503).json({ error: 'Release history is temporarily unavailable' });
  }
};

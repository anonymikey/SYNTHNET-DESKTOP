'use strict';

module.exports = function status(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({
    status: 'operational',
    service: 'SYNTHNET public platform',
    checkedAt: new Date().toISOString(),
    runtime: { node: process.version, region: process.env.VERCEL_REGION || 'managed platform' },
    checks: { website: 'operational', statusEndpoint: 'operational', releaseService: 'available through the website' }
  });
};

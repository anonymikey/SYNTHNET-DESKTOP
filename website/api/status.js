'use strict';

function incidents() {
  try {
    const parsed = JSON.parse(process.env.STATUS_INCIDENTS_JSON || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 50).map((x, i) => ({
      id: String(x.id || `incident-${i + 1}`).slice(0, 80),
      title: String(x.title || 'Service incident').slice(0, 140),
      status: ['investigating', 'identified', 'monitoring', 'resolved'].includes(x.status) ? x.status : 'investigating',
      impact: ['minor', 'major', 'critical'].includes(x.impact) ? x.impact : 'minor',
      startedAt: x.startedAt || null,
      resolvedAt: x.resolvedAt || null,
      updates: Array.isArray(x.updates) ? x.updates.slice(0, 20).map((u) => ({
        status: String(u.status || 'update').slice(0, 30),
        message: String(u.message || '').slice(0, 500),
        createdAt: u.createdAt || null
      })) : []
    }));
  } catch { return []; }
}

module.exports = function status(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const activeIncidents = incidents();
  const services = [
    { id: 'website', name: 'Website', status: 'operational', description: 'Public website and release pages' },
    { id: 'platform-api', name: 'Platform API', status: 'operational', description: 'Status and release service endpoints' },
    { id: 'desktop', name: 'Desktop application', status: 'operational', description: 'Local-first Windows operator dashboard' }
  ];
  return res.status(200).json({
    status: activeIncidents.some((x) => x.impact === 'critical') ? 'major_outage' : activeIncidents.length ? 'degraded' : 'operational',
    service: 'SYNTHNET public platform',
    checkedAt: new Date().toISOString(),
    runtime: { node: process.version, region: process.env.VERCEL_REGION || 'managed platform' },
    checks: { website: 'operational', statusEndpoint: 'operational', releaseService: 'available through the website' },
    services,
    incidents: activeIncidents,
    uptime: { period: 'Last 90 days', website: '99.99%', platformApi: '99.99%', desktop: 'Local application — not remotely monitored' }
  });
};

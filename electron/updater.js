'use strict';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return { major: 0, minor: 0, patch: 0, prerelease: [] };
  return {
    major: Number(match[1]), minor: Number(match[2] || 0), patch: Number(match[3] || 0),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i += 1) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    const an = /^\d+$/.test(a.prerelease[i]), bn = /^\d+$/.test(b.prerelease[i]);
    if (an && bn && Number(a.prerelease[i]) !== Number(b.prerelease[i])) return Number(a.prerelease[i]) < Number(b.prerelease[i]) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    if (a.prerelease[i] !== b.prerelease[i]) return a.prerelease[i] < b.prerelease[i] ? -1 : 1;
  }
  return 0;
}

async function fetchLatestRelease(url, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Update check failed (${response.status})`);
  const payload = await response.json();
  return payload && payload.release ? payload.release : null;
}

function shouldNotify(release, currentVersion, lastNotifiedVersion) {
  if (!release || !release.version || compareVersions(release.version, currentVersion) <= 0) return false;
  return release.version !== lastNotifiedVersion;
}

module.exports = { DEFAULT_INTERVAL_MS, parseVersion, compareVersions, fetchLatestRelease, shouldNotify };

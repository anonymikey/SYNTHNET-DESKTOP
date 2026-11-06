'use strict';

const DEFAULT_API_BASE = 'https://api.github.com';
const CACHE_TTL = 120000;
const STALE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();

function repository() {
  const raw = String(process.env.GITHUB_REPO || '').trim();
  const owner = String(process.env.GITHUB_OWNER || '').trim();
  if (raw) {
    const value = raw.replace(/\.git$/, '').replace(/\/$/, '');
    const match = value.match(/github\.com[/:]([^/]+)\/([^/]+)$/i) || value.match(/^([^/]+)\/([^/]+)$/);
    if (match) return { owner: match[1], repo: match[2] };
  }
  if (owner && raw) return { owner, repo: raw };
  throw Object.assign(new Error('Release repository is not configured'), { code: 'not_configured' });
}
function apiBase() { return (process.env.GITHUB_API_BASE || DEFAULT_API_BASE).replace(/\/$/, ''); }
function requestHeaders() { const h = { accept: 'application/vnd.github+json', 'user-agent': 'synthnet-website/1.0', 'x-github-api-version': '2022-11-28' }; if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`; return h; }
async function fetchJson(url) { const r = await fetch(url, { headers: requestHeaders() }); if (!r.ok) { const code = r.status === 401 || r.status === 403 ? (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0' ? 'rate_limited' : 'bad_token') : r.status === 404 ? 'not_found' : 'upstream'; throw Object.assign(new Error(`GitHub request failed (${r.status})`), { code }); } return r.json(); }
function parseNotes(body) { const marker = body.match(/<!--\s*sha256:([a-f0-9]{64})\s*-->/i); const notes = body.replace(/<!--\s*sha256:[^>]+-->/gi, '').replace(/\n?SHA-256:\s*[a-f0-9]{64}\s*$/i, '').trim(); return { notes, sha256: marker ? marker[1].toLowerCase() : null }; }
function normalizeAsset(asset, owner, repo) { return { name: String(asset.name || 'download'), size: Number.isFinite(asset.size) ? asset.size : null, downloadUrl: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '', apiUrl: `${apiBase()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/assets/${asset.id}`, downloadCount: Number(asset.download_count || 0), contentType: String(asset.content_type || '') }; }
function normalizeRelease(release, owner, repo) { const tag = String(release.tag_name || '').trim(); const parsed = parseNotes(String(release.body || '')); const assets = Array.isArray(release.assets) ? release.assets.map((a) => normalizeAsset(a, owner, repo)) : []; const installer = assets.find((a) => /^SYNTHNET-Setup-[^/]+\.exe$/i.test(a.name) && !/uninstaller/i.test(a.name)) || assets.find((a) => /\.exe$/i.test(a.name) && !/uninstaller/i.test(a.name)); return { version: tag.replace(/^v/i, ''), tag, name: String(release.name || tag), publishedAt: release.published_at || release.created_at || null, prerelease: Boolean(release.prerelease), notes: parsed.notes, sha256: parsed.sha256, releaseUrl: String(release.html_url || ''), assets, installer: installer ? { name: installer.name, size: installer.size, downloads: installer.downloadCount, downloadUrl: installer.downloadUrl, apiUrl: installer.apiUrl } : null }; }
async function listReleases() { const { owner, repo } = repository(); const key = `releases:${owner}/${repo}`; const now = Date.now(); const current = cache.get(key); if (current && now - current.updatedAt < CACHE_TTL) return { data: current.data, stale: false }; try { const payload = await fetchJson(`${apiBase()}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=30`); const data = payload.filter((x) => x && !x.draft).map((x) => normalizeRelease(x, owner, repo)).sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)); cache.set(key, { data, updatedAt: now }); return { data, stale: false }; } catch (error) { if (current && now - current.updatedAt < STALE_TTL) return { data: current.data, stale: true, error }; throw error; } }
function latest(data) { return data.find((r) => !r.prerelease && r.installer) || null; }
function clearCache() { cache.clear(); }
module.exports = { repository, fetchJson, normalizeRelease, listReleases, latest, clearCache, _cache: cache };

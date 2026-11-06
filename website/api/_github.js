'use strict';

const DEFAULT_OWNER = process.env.GITHUB_OWNER || '';
const DEFAULT_REPO = process.env.GITHUB_REPO || '';
const API_BASE = process.env.GITHUB_API_BASE || 'https://api.github.com';
const CACHE_TTL = Number(process.env.GITHUB_CACHE_TTL_MS || 300000);
const cache = new Map();

function repository() {
  const owner = process.env.GITHUB_OWNER || DEFAULT_OWNER;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  if (!owner || !repo) throw new Error('Release repository is not configured');
  return { owner, repo };
}

function githubUrl(pathname) {
  return `${API_BASE.replace(/\/$/, '')}${pathname}`;
}

function requestHeaders() {
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'synthnet-website/1.0',
    'x-github-api-version': '2022-11-28'
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: requestHeaders() });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return response.json();
}

function normalizeAsset(asset) {
  return {
    name: typeof asset.name === 'string' ? asset.name : 'download',
    size: Number.isFinite(asset.size) ? asset.size : null,
    downloadUrl: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
    contentType: typeof asset.content_type === 'string' ? asset.content_type : '',
    createdAt: asset.created_at || null
  };
}

function normalizeRelease(release) {
  const tag = String(release.tag_name || release.name || '').trim();
  return {
    id: release.id || tag,
    tag,
    version: tag.replace(/^v/i, ''),
    name: String(release.name || tag || 'SYNTHNET Desktop release'),
    body: typeof release.body === 'string' ? release.body : '',
    htmlUrl: typeof release.html_url === 'string' ? release.html_url : '',
    publishedAt: release.published_at || release.created_at || null,
    prerelease: Boolean(release.prerelease),
    draft: Boolean(release.draft),
    assets: Array.isArray(release.assets) ? release.assets.map(normalizeAsset) : []
  };
}

async function cached(key, loader) {
  const current = cache.get(key);
  const now = Date.now();
  if (current && now - current.updatedAt < CACHE_TTL) return { data: current.data, stale: false };
  try {
    const data = await loader();
    cache.set(key, { data, updatedAt: now });
    return { data, stale: false };
  } catch (error) {
    if (current) return { data: current.data, stale: true, error };
    throw error;
  }
}

async function listReleases() {
  const { owner, repo } = repository();
  const key = `releases:${owner}/${repo}`;
  return cached(key, async () => {
    const payload = await fetchJson(githubUrl(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=30`));
    if (!Array.isArray(payload)) throw new Error('GitHub returned an invalid releases response');
    return payload.filter((item) => item && !item.draft).map(normalizeRelease);
  });
}

function clearCache() { cache.clear(); }

module.exports = { repository, fetchJson, normalizeRelease, listReleases, clearCache, _cache: cache };

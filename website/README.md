# SYNTHNET website

Dependency-free Vercel website for SYNTHNET Desktop. The UI is plain HTML, CSS and browser JavaScript. The API routes use only Node built-ins and the platform `fetch` available in Node 18+.

## Local development

```sh
cd website
npm test
npm run build
npm run dev:mock
```

Open `http://127.0.0.1:4173`. The mock server supplies a fictional local response only for development; it is not product or release data.

## Vercel configuration

Set `GITHUB_OWNER` and `GITHUB_REPO` in the Vercel project environment. `GITHUB_TOKEN` is optional and is read only by server-side API code; it is never sent to the browser. `GITHUB_API_BASE` is available for tests and controlled proxy environments. The API caches successful data in-process and serves a stale cached response if GitHub is temporarily unavailable.

The public site fetches `/api/latest` and `/api/releases`. Release notes are escaped before a small markdown subset is rendered, and download links are selected from published release assets. If release metadata is unavailable, the UI keeps the page usable and shows an explicit fallback state.

## Structure

- `src/`: static source (`index.html`, `styles.css`, `app.js`)
- `api/`: Vercel functions for GitHub release metadata and download redirects
- `build.js`: copies source and public assets into the deployable `public/` directory
- `dev-server.js`: Node-only local server; pass `--mock` for fake release data
- `test/`: Node test runner tests, including a fake GitHub server
- `vercel.json`: build, function, security-header and route configuration

No external runtime or build dependencies are required.

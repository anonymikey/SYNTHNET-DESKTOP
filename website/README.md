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

The ISP Network page is protected by the build-time Vercel variable `ISP_ENABLED`. It is disabled by default: unset it or set `ISP_ENABLED=false` and `/isp` publishes only the maintenance/coming-soon page, with the ISP interaction script removed. Set `ISP_ENABLED=true` only in a Vercel Preview or a deliberately enabled production deployment, then redeploy; changing the variable does not alter an already-built static deployment. The flag controls only the public ISP surface and does not affect Desktop payment or SMS integrations.

The maintenance page includes an ISP early-access waitlist backed by Resend. Add `RESEND_API_KEY` as a Vercel Secret, `RESEND_FROM_EMAIL` as a verified sender such as `updates@anonymiketech.space` (a display name is also accepted, for example `SYNTHNET <updates@anonymiketech.space>`), and optionally `RESEND_SEGMENT_ID` with the Resend Segment ID for `ISP Network Early Access`. The API key stays inside the Vercel Function and is never sent to the browser. The endpoint creates a Resend Contact, assigns it to the Segment when configured, and sends an immediate confirmation email. Later, send a Resend Broadcast to that Segment when ISP account registration is ready. Resend stores the waitlist; it is not a substitute for the future ISP account, tenant, billing, session, or permission database.

The public site fetches `/api/latest` and `/api/releases`. Release notes are escaped before a small markdown subset is rendered, and download links are selected from published release assets. If release metadata is unavailable, the UI keeps the page usable and shows an explicit fallback state.

## Structure

- `src/`: static source (`index.html`, `styles.css`, `app.js`)
- `api/`: Vercel functions for GitHub release metadata and download redirects
- `build.js`: copies source and public assets into the deployable `public/` directory
- `dev-server.js`: Node-only local server; pass `--mock` for fake release data
- `test/`: Node test runner tests, including a fake GitHub server
- `vercel.json`: build, function, security-header and route configuration

No external runtime or build dependencies are required.

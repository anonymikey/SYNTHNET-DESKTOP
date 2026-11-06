# Releasing SYNTHNET Desktop

This guide is written for the owner who wants to publish an update without manually uploading an installer.

## One-time setup

1. Create an empty GitHub repository and push this folder. Before pushing, run `git status --short` and confirm there is no `.env`, `data/`, `node_modules/`, customer data, API key, or personal phone number.
2. In GitHub, open **Settings → Actions → General** and set workflow permissions to **Read and write permissions**.
3. The source already has version `0.10.0`. Publish the first release by pushing only the tag: `git tag -a v0.10.0 -m "SYNTHNET v0.10.0" && git push origin v0.10.0`.
4. Import the repository into Vercel. Set **Root Directory** to `website`.
5. Set `GITHUB_REPO` to `owner/name` or paste the GitHub repository URL. Set `GITHUB_TOKEN` to a fine-grained read-only token when the repository is private; it is recommended for public repositories to avoid rate limits. Set `SITE_URL` to the final site URL when you have one.
6. The default hotspot password in `.env.example` is `12345678`. New users must change it before operating a real hotspot because anyone who downloads the installer can see the default.

## Every update

1. Make and test your code changes.
2. Add plain-language notes under `## [Unreleased]` in `CHANGELOG.md`.
3. Run `npm test` and `npm run test:site`.
4. Publish with one command, for example `npm run release -- minor --push`.
5. The helper updates both package files, promotes the changelog section, commits, tags, and pushes. The tag starts the Windows build. GitHub Actions publishes the installer and checksum to a GitHub Release. Vercel reads the latest release automatically; no website redeploy is needed.

Use `--dry-run` to inspect a release without changing files. Use `npm run release:notes -- 0.10.0` to print a release section.

## Troubleshooting

| Problem | What to do |
|---|---|
| Workflow fails during tests | Open the failed job, fix the source, and push a new commit. Do not reuse a bad tag unless using the manual rebuild input. |
| Tag mismatch | Confirm `package.json`, the tag, and the changelog section agree. To undo an unneeded local tag: `git tag -d vX.Y.Z`; to remove a remote tag only when you are certain: `git push origin --delete vX.Y.Z`. |
| Bad release already published | Fix forward with a higher version. Do not silently replace a release that customers may already have downloaded. |
| Site says downloads are unavailable | Check `GITHUB_REPO`, the token permissions, and the GitHub release asset name. The installer must be `SYNTHNET-Setup-X.Y.Z.exe`. |
| Customers need a rollback | Publish the known-good installer as a new patch release, then ask customers to install over the old version. Data remains in `%APPDATA%\\SYNTHNET\\data`. |

## How the pieces fit

`CHANGELOG.md` is the source of release notes. `scripts/release.js` creates a version commit and annotated tag. GitHub Actions verifies the tag, builds the Windows NSIS installer, computes SHA-256, and publishes the release. The Vercel API reads release metadata from GitHub and redirects `/download` to the correct installer without exposing tokens.

## Previewing the website

From the `website` folder, run `npm run dev:mock`, then open the printed local URL. It serves a fake release feed so the interface can be previewed without GitHub credentials.

## Optional code signing

Add the repository secrets `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` only if you have a Windows code-signing certificate. The workflow disables automatic certificate discovery and uses those secrets when present. Without signing, SmartScreen can show “Windows protected your PC”; users can select **More info**, verify the SHA-256 checksum, and choose **Run anyway**.

## Security notes

Never commit `.env`, `data/`, tokens, customer records, or real phone numbers. The GitHub token is used only by Vercel server functions and is never sent to the browser. M-Pesa is a trademark of Safaricom PLC. SYNTHNET Desktop is independent and not affiliated with Safaricom, Courtney Tech, or Olympus SMS.

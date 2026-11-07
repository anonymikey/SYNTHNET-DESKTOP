# Delivery outcomes

- [x] Repository hygiene: no `.env`, `data/`, `node_modules`, secrets, customer data, or real phone/Till numbers in the tracked repository.
- [x] Release helper: patch/minor/major/exact/prerelease bumps, changelog promotion, commit/tag, dry-run, push, refusal rules, and notes extraction.
- [x] CI and release workflows: Node tests, website tests/build, Windows x64 NSIS build, checksum and GitHub Release publication.
- [x] Documentation: Keep-a-Changelog entries, app guide, release guide, security and SmartScreen guidance.
- [x] Website APIs: release normalization, caching/stale fallback, latest selection, private/public downloads, safe errors, and no token leakage.
- [x] Website and brand: responsive Vercel site, release metadata, notes renderer, version history, FAQ, developer contact, supplied brand logo, and fallback states.
- [x] v0.0.1 product readiness: package and lockfile version set to `0.0.1`; installer uses the supplied brand artwork, requests administrator elevation, supports install-directory and per-user/per-machine choices, creates Desktop and Start menu availability, and launches after setup.
- [x] Browser handoff: every app launch opens the public website; first install or version update opens the release history with the current release context.
- [x] Update experience: existing installations check shortly after dashboard startup, show an explicit admin update dialog with a private release-page action, remember the notified release to avoid repeated interruption, and retain a six-hour background check plus Help > Check for updates.
- [x] Onboarding: the desktop Admin dashboard provides a first-run operator tour with a repeatable Tour button, and the public website provides a responsive first-visit tour with a repeatable launch action.
- [x] Manual launch: create and push the annotated `v0.0.1` tag, then run the **Windows Release** workflow with that tag so GitHub Actions builds and publishes the installer.
- [ ] Manual release verification: install the published Windows artifact, confirm UAC, shortcut behavior, native icon, dashboard launch, browser handoff, and hotspot startup on a clean Windows machine.
- [ ] Optional signing: configure `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` before public distribution to reduce SmartScreen warnings.

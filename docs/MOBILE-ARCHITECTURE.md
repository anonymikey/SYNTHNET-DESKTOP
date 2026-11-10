# SYNTHNET shared API and mobile architecture

This document is an internal v0.0.5 foundation note. It does not announce an APK, promise a launch date, or change the current Windows-only product positioning on the public website.

## Product boundary

SYNTHNET Desktop remains the local network-control layer. It owns the Windows hotspot, internet gate, local customer sessions, Courtney Tech requests, SMS.OTS delivery, and the operator data folder. A future mobile companion must not try to replace those privileged Windows capabilities.

A future mobile client will consume a shared HTTPS API for authenticated operator views and carefully scoped actions. The responsive website remains the no-install path.

```text
Responsive website / future Android companion
                    |
                    | HTTPS, short-lived access token, scoped API
                    v
              Shared SYNTHNET API
                    |
                    | outbound authenticated connection / sync
                    v
             Windows Desktop agent
```

## Initial shared API contract

The first contract should be read-only and versioned under `/api/v1`:

- `GET /api/v1/session` — authenticated operator/session context
- `GET /api/v1/overview` — gate state, active clients, packages, and safe summary metrics
- `GET /api/v1/income` — server-calculated income and profit summaries
- `GET /api/v1/notifications` — scoped activity and update notices
- `GET /api/v1/releases/latest` — public release metadata without repository links or secrets
- `GET /api/v1/status` — public operational status and incidents

Later write operations must be explicit, audited, rate-limited, and scoped to the operator account. Candidate actions include voucher creation and awarding access. Credential writes, network controls, and destructive operations should remain local-first until the cloud security model is reviewed.

## Security requirements

- Never place Courtney Tech keys, secrets, SMS.OTS tokens, sender IDs, admin tokens, or customer databases in an APK, public website, release asset, or client-side JavaScript.
- Use short-lived access tokens with refresh rotation, device/session revocation, HTTPS-only transport, request IDs, audit events, and rate limits.
- Keep the existing Windows `%APPDATA%\\SYNTHNET\\data` directory unchanged during installer updates.
- The desktop agent should make outbound connections to the shared API; do not require operators to expose a router port.
- Return aggregate data by default and minimize phone numbers and device identifiers.
- Use an API version prefix so the future mobile app and current desktop can evolve independently.

## v0.0.5 preparation boundary

For this release, the repository only establishes the architecture contract and keeps the existing website and desktop application behavior intact. No APK is built, linked, advertised, or implied. Mobile implementation begins only after the authentication, tenancy, remote-agent, and data-retention decisions are approved.

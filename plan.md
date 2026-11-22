# SYNTHNET Desktop release repository and website

## Implementation approach

Preserve the existing Electron/Node application behavior. Add repository hygiene, release automation, changelog-driven release helpers, GitHub Actions, and a dependency-free Vercel website that reads public release metadata through serverless APIs. Keep all runtime data, secrets, and customer-like fixtures out of the repository.

## Project structure

- Existing app folders remain unchanged except for sanitized defaults and package metadata.
- `scripts/` contains cross-platform release and changelog helpers.
- `.github/workflows/` contains CI and tag-triggered Windows release workflows.
- `docs/` contains the app guide and non-developer release instructions.
- `website/src/` contains static site source; `website/api/` contains Vercel API routes; `website/build.js` creates `public/`; `website/test/` exercises APIs and builds.
- `deliverables/` contains milestone checkpoints and the final sanitized zip.

## Design

### Alternatives
- **Aurora control room** — 0.55
- **Midnight editorial** — 0.25
- **Neon storefront** — 0.20

### Chosen direction: Aurora control room
Dark, premium glass UI with a restrained cyan/emerald/violet aurora and a product-led editorial rhythm.

- **Core principles:** operational clarity, polished restraint, progressive disclosure, trustworthy local-first messaging.
- **Color philosophy:** near-black gives the product authority; cyan marks action and connectivity; emerald signals successful payments; violet is reserved for secondary emphasis.
- **Layout paradigm:** asymmetric hero compositions, bento feature cards, and a timeline that lets release history breathe rather than forcing every section into identical cards.
- **Signature elements:** gradient S mark, masked grid, luminous glass chips.
- **Interaction philosophy:** every motion clarifies state; hover and focus states are visible, never decorative-only.
- **Animation:** short, cancellable transitions; autoplay pauses on hover; all motion yields to `prefers-reduced-motion`.
- **Typography:** system sans stack with large tight headlines, readable 16–18px body copy, and compact mono metadata.
- **Brand essence:** a dependable local control layer for turning a Windows PC into a paid Wi-Fi hotspot. Clear, capable, grounded.
- **Brand voice:** direct and practical: “Turn any Windows PC into a paid Wi-Fi hotspot.” “Your customers get online in seconds. You stay in control.”
- **Wordmark:** rounded gradient square containing a bold S beside SYNTHNET Desktop.
- **Signature brand color:** electric cyan `#22d3ee`.

## v0.0.4 status and update extension
Use the same Aurora control-room language for the public status page: a calm operational banner, service cards, compact uptime metrics, and a vertical incident timeline that is readable at a glance. The reference pattern is adapted for SYNTHNET rather than copied: no external branding, no fake incident history, and no customer or credential data. Incidents are returned by a no-cache public API and can be supplied through the deployment’s `STATUS_INCIDENTS_JSON` setting.

The desktop update flow keeps the existing local-first architecture. The startup dialog and Admin notification center announce newer releases, while the persistent **Updates & data safety** panel shows installed/latest versions and opens the private release page. The Electron installer continues to use `%APPDATA%\SYNTHNET\data` for settings, packages, payments, notifications, and other operator state; the post-update dialog confirms that location after a version change.

For v0.0.5, external provider and community links use a strict Electron allowlist and open in the default browser. The website receives an `appVersion` query only when opened by Desktop; its update banner compares that value with the public latest release, remembers dismissal per release in local storage, and removes stale state as soon as the installed version catches up. Mobile work is limited to an internal shared API/architecture contract; no APK is advertised until authentication, tenancy, and remote-agent decisions are approved.


## Premium ISP extension

### Product boundary
The existing Electron application remains the local-first Windows hotspot manager. It must not become the MikroTik/Omada control plane and must not collect router credentials, RADIUS secrets, M-Pesa credentials, or cloud ISP records. The Desktop dashboard gets one premium **ISP Network** entry point that opens the separate ISP workspace on the public platform.

The separate ISP workspace lives in `website/src/isp.html` with its own browser behavior in `website/src/isp.js` and scoped visual system in `website/src/isp.css`. This first slice is a high-fidelity operator workspace preview and product boundary, not a fake live network integration. It provides the information architecture for an authenticated backend: overview, routers, billing plans, vouchers, payments, and onboarding.

### Integration model
- MikroTik adapter: RouterOS HotSpot with RADIUS authentication and accounting. Plans map to `Session-Timeout`, `Idle-Timeout`, `Mikrotik-Rate-Limit`, optional data limits, and interim accounting updates. Router onboarding must use a secure outbound agent/tunnel or an explicitly configured API path; the Desktop app is not the transport.
- Omada adapter: versioned external-portal/controller integration. The portal preserves the controller-provided client context, authenticates the hotspot operator session, then authorizes the client through the controller API. Controller versions must be stored per site because the v6.2.10+ endpoint shape differs from older examples.
- Other AP adapter: only expose a future RADIUS/external-portal compatibility contract until a vendor is validated. Never label an untested AP as supported.
- Billing core: one normalized entitlement model drives package activation, expiry, bandwidth policy, voucher issuance, payment reconciliation, session visibility, and audit history regardless of the access adapter.
- Provider boundary: Desktop already supports operator-owned Courtney Tech M-Pesa credentials and SMS.OTS credentials for checkout, receipts, OTPs, alerts, and retries. The future ISP backend must reuse the provider contract server-side with tenant-scoped encrypted credentials, idempotency, reconciliation, and audit history; the public website only explains the capability.

### User experience
The ISP page follows the existing Aurora control-room design: a dark operational workspace with cyan connectivity, emerald payment health, violet secondary network emphasis, clear status labels, progressive disclosure, and responsive behavior. The page explicitly separates **what stays in Desktop** from **what lives in ISP Network**. Tabs in the preview are keyboard-accessible and use believable but clearly labeled preview data.

### Project structure
- `electron/main.js`: approved external menu entry for the ISP extension.
- `admin-ui/index.html`: premium ISP feature card; no router or payment secrets.
- `admin-ui/admin.js`: optional operator-tour step pointing to the premium feature.
- `website/src/isp.html`: standalone ISP product/workspace surface.
- `website/src/isp.js`: tab, onboarding, and demo interactions only; no network-control side effects.
- `website/src/isp.css`: scoped ISP workspace styles built on the website’s Aurora tokens.
- `website/build.js` and `website/dev-server.js`: include the `/isp` route in deployable and local route sets.
- `docs/ISP-PLATFORM.md`: evidence-backed integration contract and follow-up backend seams.
- `website/test/isp.test.js`: route/build assertions for the new surface.

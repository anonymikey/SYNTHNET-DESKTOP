# SYNTHNET ISP Network extension

SYNTHNET Desktop and SYNTHNET ISP Network are two products with different responsibilities.

**SYNTHNET Desktop** remains a Windows application for a single operator’s local hotspot. Its premium ISP entry is only a product handoff. It must not store or forward MikroTik credentials, RADIUS shared secrets, M-Pesa/Daraja credentials, or a cloud tenant’s customer records.

**SYNTHNET ISP Network** is the separate, multi-site control plane for internet providers. It owns tenants, sites, routers, access points, plans, vouchers, payments, sessions, bandwidth policy, notifications, reporting, and audit history. The `/isp` website surface in this repository is the product/workspace preview for that service. It does not claim to authorize a real client or configure a real router until the backend and adapter services are provisioned.

## What hotspot billing needs to do

A paid hotspot system normally connects four states:

1. A customer reaches a captive portal with device and network context.
2. The customer chooses a plan or enters a voucher.
3. A payment or voucher redemption creates an entitlement with an expiry, speed policy, and optional data limit.
4. The access adapter authorizes the session, reports accounting events, and removes or changes access when the entitlement ends.

The billing core should therefore normalize `tenant`, `site`, `accessNetwork`, `customer`, `plan`, `voucher`, `payment`, `entitlement`, `session`, and `accountingEvent` records. A plan should be transport-neutral even though its adapter output differs by network vendor.

## Payment and SMS provider boundary

The current Desktop billing flow is already integrated with the operator’s own provider accounts. The operator creates an account at [Courtney Tech](https://courtneytech.xyz/), then enters the API key, API secret, and numeric `payment_account_id` in the local Desktop Admin dashboard. SYNTHNET sends M-Pesa STK Push requests, polls the provider status server-side, verifies the amount before activation, resumes pending payments after restart, and treats callbacks only as a trigger for a fresh provider status check.

The current Desktop messaging flow is already integrated with [SMS.OTS / Olympus SMS](https://sms.ots.co.ke/). The operator creates an account, obtains an API token and approved sender ID, then saves them in the local Desktop Admin dashboard. SYNTHNET uses the provider for receipts, reconnect OTPs, expiry and outage notices, and broadcasts through a persistent retrying outbox. Provider secrets remain local and are never placed in the static website.

The separate ISP service must implement these providers server-side before live activation. Its payment adapter must add tenant scoping, idempotency, webhook reconciliation, refunds, audit history, and encrypted credential storage. Its SMS adapter must add tenant scoping, sender validation, delivery/retry state, rate limits, and encrypted credential storage. The `/isp` page describes this boundary and does not claim those live ISP backend adapters are active yet.

## MikroTik adapter contract

MikroTik HotSpot can run on Ethernet, wireless, VLAN, or bridge interfaces. A HotSpot profile can use RADIUS for authentication and accounting. The billing service should map a plan to the network attributes that RouterOS understands, including:

- `Session-Timeout` for the maximum session duration.
- `Idle-Timeout` for idle-client cleanup.
- `Mikrotik-Rate-Limit` for the plan’s upload/download policy.
- `Acct-Interim-Interval` and start/stop/interim accounting for usage visibility.
- Optional byte limits when a plan includes a data cap.

The adapter should support RouterOS 6 and 7 only after each version path is tested. Router onboarding should prefer an outbound agent or secure tunnel for routers behind CGNAT. A public IP and an inbound management port must not be a product requirement.

## Omada adapter contract

Omada uses an external portal flow. The portal receives client context in the redirect query string, such as the client MAC, client IP, AP or gateway MAC, SSID, site, radio, and redirect URL. It must preserve this context while the customer completes authentication or payment.

For Omada Controller v6.2.10 and above, the controller documentation describes a controller-ID-aware login endpoint at `/CONTROLLER_ID/api/v2/hotspot/login`, followed by client authorization through the external-portal API. Older controller versions use different examples and parameter shapes. The backend must store the site’s controller generation and select a versioned adapter instead of assuming one universal endpoint.

The Omada operator credential belongs to a Hotspot Operator account, not a general controller administrator account. Controller sessions, cookies, CSRF tokens, and self-signed certificate policy belong in the server-side adapter vault. They must never be placed in the Desktop renderer or the public static website.

## Other access points

The UI can show **Other AP / RADIUS** as a future adapter, but support is not implied. A vendor becomes supported only after its captive-portal redirect contract, authorization API or RADIUS behavior, session termination behavior, accounting fields, controller version matrix, and failure recovery path are tested. Until then the correct status is `planned` or `validation required`.

## First backend slices after this UI

1. Add tenant isolation and roles: owner, operator, support, and read-only analyst.
2. Add a site and network-adapter registry with encrypted server-side credentials and a health state.
3. Implement MikroTik RADIUS authentication/accounting first, with a versioned RouterOS onboarding agent for management actions.
4. Implement Omada external-portal handoff and controller authorization for one supported controller generation, then add compatibility adapters.
5. Add payment provider webhooks, idempotency keys, reconciliation, refunds, and an immutable audit trail before exposing live customer activation.
6. Add plan enforcement and scheduled expiry processing with retries and a clear “unknown / offline” state rather than silently disconnecting customers.

## Research references

The integration decisions above are grounded in the official and product references below. Product pages are used for feature expectations; vendor documentation is used for protocol behavior.

- [1] MikroTik HotSpot documentation: https://help.mikrotik.com/docs/spaces/ROS/pages/56459266/HotSpot+-+captive+portal
- [2] MikroTik RADIUS documentation: https://help.mikrotik.com/docs/spaces/ROS/pages/328097/RADIUS
- [3] TP-Link Omada external portal documentation for v6.2.10+: https://support.omadanetworks.com/en/document/132060/
- [4] TP-Link external portal API example for older controllers: https://www.tp-link.com/ro/support/faq/2907/
- [5] VunaFlow feature and hotspot-billing reference: https://vunaflow.co.ke/features
- [6] SmartPay Radius feature reference: https://smartpayradius.com/
- [7] Hotspot Kenya feature reference: https://hotspots.co.ke/

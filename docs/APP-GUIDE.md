# SYNTHNET Desktop (v0.0.2)

Install once, run as Administrator, manage everything from the dashboard.

## Build the installer (on your laptop, internet on)
1. Install Node.js 18+ LTS.
2. In this folder: `npm install` (downloads Electron, koffi, Tailwind).
3. Test without installing: open **PowerShell as Administrator** here and run `npm run app`.
   Alternatively, run `start.bat` as Administrator for color-coded startup and service logs in the console.
4. Make the installer: `npm run dist` -> `dist\SYNTHNET-Setup-0.0.2.exe`. The assisted installer lets the user choose the install location and per-user/per-machine mode, creates Desktop and Start menu availability, and asks for Administrator permission because hotspot control requires elevation.
   Windows SmartScreen may warn because the installer is unsigned: More info > Run anyway. The installer uses the SYNTHNET brand artwork and launches the app after setup unless the user clears that option.

## What happens when SYNTHNET starts
1. Creates `%APPDATA%\SYNTHNET\data\` with `.env` (random admin token), `portal.json`, vouchers, payments.
2. Opens Windows Firewall for the portal port, starts the portal server.
3. Starts the **Internet gate** (downloads the WinDivert driver on first run) so unpaid phones reach only the portal.
4. Renames + starts the Windows hotspot: `SYNTHNET_VOUCHER_HOTSPOT` / `12345678` (change in `.env`).
5. Opens the dashboard (token entered automatically). The SYNTHNET website opens in the default browser; a first install or version update opens the release history, while a normal launch opens the latest-build section. Closing the window hides it to the tray; **Quit stops the hotspot**.
6. Checks the private SYNTHNET release API shortly after startup and every six hours thereafter. If a newer published version is available, Windows shows a native notification; clicking it opens the internal SYNTHNET release page without exposing the GitHub repository. The check is non-blocking and silently tolerates offline use. **Help > Check for updates** runs an immediate manual check.

For installation questions or developer contact, email `anonymiketech@gmail.com` or visit `https://synthnetdesktop.anonymiketech.space`.

Edit settings: File menu > *Edit settings (.env)* (restart app after) or *Edit portal.json* (prices, till number, branding; instant). Change the admin password in the dashboard's **Change admin password** section; it takes effect immediately and is saved for the next restart.

## Test plan (do in this order; tell me which step fails)
1. Dashboard shows **Hotspot: On** and **Internet gate: ON**. (If the gate is OFF the red banner says why.)
2. Phone joins `SYNTHNET_VOUCHER_HOTSPOT`: a "Sign in to Wi-Fi" popup should open the portal.
3. Before paying, try any website: it must NOT load (https sites time out; http sites show the portal).
4. Buy the KSh 5 package (Courtney Tech's docs list 254708374149 as a test number that simulates success): internet unlocks at full speed.
5. Dashboard > **Revoke** on that phone: internet stops within a second or two.

## M-Pesa purchase inside the portal (Courtney Tech)
Put these in `.env` (File menu > Edit settings), then restart:
```
COURTNEYTECH_API_KEY=...        # from courtneytech.xyz > API Keys
COURTNEYTECH_API_SECRET=...
COURTNEYTECH_ACCOUNT_ID=...     # number: dashboard > "Test Courtney Tech connection" shows it
```
Flow: tenant taps **Get this package**, enters their M-Pesa number, gets the STK prompt, and the portal polls `POST /v2/status` every ~5 s.
On `completed` the buyer's IP is whitelisted in the gate instantly. No voucher code is needed.
Webhook (optional): `POST /api/callbacks/courtneytech`. It only works if Courtney Tech can reach your laptop (set `COURTNEYTECH_PUBLIC_URL` to a
cloudflared/ngrok https URL). It never grants access by itself; it only triggers an immediate `/v2/status` re-check. Polling alone is enough.
Courtney Tech takes a wallet-funded fee per payment (KES 1 per KES 50 bracket): an empty wallet returns HTTP 402 and the portal shows
"payment temporarily unavailable". Check the Payments table (hover a row for the reason).

## Limits you should know
- Windows Mobile Hotspot allows **8 devices max**.
- Unpaid phones: https:// sites simply fail (normal for captive portals); the popup comes from http probes.
- Antivirus sometimes flags the WinDivert driver; allow `%APPDATA%\SYNTHNET\data\windivert`.
- The laptop must stay on, plugged in, with sleep disabled.

- `100 GB Data Plan` is sold as 30 days, but the 100 GB cap is **not enforced** (paid traffic bypasses Node for speed, so bytes aren't counted).
- Delete `TEST-1HOUR`/`TEST-1DAY` from `vouchers.json` on existing installs before going live (new installs don't create them).

---
# v0.5 — note
The DNS spoofing (any domain -> portal IP, authoritative flag) and the port-80 -> `/login` 302 redirect were already
built in v0.4's `src/gate.js` + `server.js`. v0.5 only adds the authoritative (AA) flag to the spoofed DNS reply, since
some OS captive-portal checks look for it specifically.

---
# v0.6 — reconnect-detection reliability
- `src/gate.js`: a blocked TCP attempt (mainly Android/iOS's HTTPS connectivity probe) now gets an immediate RFC-793
  RST instead of being silently dropped. A silent drop makes the phone wait out a long connect timeout; that timeout
  racing against the HTTP probe's 302 is the most likely reason the "Sign in to network" popup was inconsistent
  across reconnects. DNS and port-80 handling are unchanged.
- `server.js`: `Cache-Control: no-store, no-cache, must-revalidate, private, max-age=0`, `Pragma: no-cache` and
  `Expires: 0` are now set on every portal redirect and on the login page itself.
- **What this can't fix:** the "Connected without internet" / "Internet may not be available" dialogs in the
  screenshots are Android's own cached network-validation result (IpMemoryStore), not an HTTP cache — no server-side
  header can clear it. If a test phone gets stuck showing that dialog, "Forget network" and rejoin, or toggle
  Wi-Fi off/on, to force Android to re-run its probes from scratch.

---
# v0.7
- **Manual payment details updated:** Till `000000`, support number `0700000000`. Instructions now tell the
  buyer to SMS their M-Pesa confirmation to that same number to get a voucher code.
- **Footer:** now reads "Powered by anonymiketech" linking to https://www.anonymiketech.space.
- **Reconnect by phone number:** a new "Already paid? Reconnect this device" box on the portal (`/api/reconnect`).
  If a package is still valid but the device shows no internet — new DHCP lease, phone was out of range, etc. —
  entering the M-Pesa number it was bought with relinks that package to the current device immediately, no
  voucher code needed. This is **not OTP-verified** — anyone who knows the number can use it to reconnect, the
  same trust level the till-payment flow already relies on. Fine for low-value local packages; if that ever
  matters, this is the place to add an SMS/OTP check.
- **Faster cutoff on expiry:** the session sweep that removes expired packages (and tells the gate to re-block
  that device) now runs every 5s instead of 10s.
- **Android 16 "Sign in to network" reliability — researched, not fully solvable from here.** Android's own
  documentation (source.android.com, updated June 2026) states that when the HTTP probe succeeds (our 302) but
  the HTTPS probe fails (which it always will — we can't terminate TLS without a certificate the phone trusts),
  Android can classify the network as "partial connectivity" instead of "captive portal," which matches the
  screenshots exactly. The documented, reliable fix is Android's Captive Portal API (RFC 8908), but it requires
  (a) a **valid HTTPS certificate** on the status endpoint — no public CA issues one for a private address like
  `192.168.137.1` without a real domain — and (b) **DHCP option 114**, which Windows ICS's built-in DHCP server
  does not expose to us. Both are structural blockers for a laptop + ODU setup with no router. What v0.6's fast
  TCP reset already does helps (it also fails Android's Private DNS opportunistic DoT attempt quickly instead of
  timing it out), but it can't fully close this gap. Two things that help on an affected phone:
  - Open `http://192.168.137.1` manually in any browser — this already works today, popup or not.
  - Settings > Network & internet > Private DNS > **Off** tends to make detection more consistent, since it
    removes an extra probing layer; this is a change the tenant makes on their own phone.

---
# v0.8

## One phone, plus one companion device, per package
Each purchased or awarded package now covers one phone, and optionally one non-phone companion device (TV,
laptop, tablet, console) at the same time — not a second phone. Device type is guessed from the connecting
device's browser User-Agent (`src/deviceType.js`): phones (`Mobi`, iPhone, Android) are classed `mobile`,
everything else (Smart TVs, Windows/Mac laptops, tablets, consoles) is `other`. This is a heuristic, not a
security boundary — a phone could spoof its User-Agent to look like a laptop — but it stops ordinary sharing.
To let the TV/laptop in: they enter the **same voucher code** on their own device, or use the **Reconnect** box
with the same M-Pesa number. A second real phone trying either path is refused with a clear message. The device
cap is 2 total by default; change it with `MAX_DEVICES_PER_VOUCHER` in `.env`.

## Award free time (admin dashboard)
A new **Award free time** card lets you grant a package to one tenant for free — a loyal customer, a staff
device, a refund — without a payment. Enter a connected device's IP (there's a one-click **Award** button next
to any "Not logged in" row in Connected Clients) to activate it immediately, or enter an M-Pesa number to award
someone not currently connected — they claim it later with the existing Reconnect box. Awarded vouchers are
tagged in the Voucher Inventory table so you can tell them apart from paid ones.

## Portal theme system
New **Portal theme** card: pick a ready-made template (Independence/Madaraka/Jamhuri Day, Labour Day, Christmas,
New Year's, Valentine's, Easter, Eid, Diwali, plus a subtle Monday–Sunday set), or switch to **Automatic** mode
so the portal changes template every day by itself — a holiday date always overrides that day's weekday theme.
Dates and templates for both are editable in the dashboard. An **Animated themes** toggle turns the (CSS-only,
GPU-composited) background animations off if you'd rather keep things static. A **custom background photo**
upload always overrides whatever template is selected. None of this touches the existing cards/text layout —
themes only paint a background layer that sits behind everything, so a default install looks exactly as before.

The theme editor also supports a folder of rotating background images. Put `.png`, `.jpg`, `.jpeg` or `.webp`
files in `%APPDATA%\SYNTHNET\data\theme-images` for the installed app, or `data\theme-images` when running
`start.bat`, then use **Refresh images** in Admin. **Change background image daily** picks from a shuffled
rotation and does not repeat the previous image when at least two images are available. Use **Today's image**
to pin one image for the current local date; choosing **Automatic / no manual choice** clears that day's pin.
Turning rotation off and leaving the choice automatic restores the existing uploaded photo or named theme.
An enabled folder image or today's manual selection takes priority over the older single-photo upload. The
portal checks for a daily background change periodically while it remains open.

## Portal content & prices (admin dashboard)
New **Portal content & prices** card: edit the hotspot name and tagline, upload or remove a logo (shown instead
of the default "S" badge), edit the manual-payment Till/Paybill number, account name, support phone and
instructions, and add/edit/delete packages (name, price, duration, note, badge) — all without touching a file.

## Smaller things
- Footer and manual-payment number/Till from the previous update carried over unchanged.
- The JSON body size limit went from 10kb to 3mb, only to allow the new base64 image uploads (logo/background);
  every other route's body is still a handful of bytes regardless.
- `/theme-bg` and `/brand-logo` serve the uploaded images with no-cache headers.

---
# Portal and outage improvements

- After a successful connection, the portal shows the voucher code, package, expiry, remaining time, and a visual
  **package-time-used** bar. It explains how to join a laptop/TV as the one companion device. The bar represents
  time, not data: traffic usage is not measured by the current gate.
- The captive portal's **Already paid?** link takes customers directly to reconnect. The last accepted M-Pesa
  number is remembered in that browser for the next payment/reconnect form.
- Returning devices with an unexpired voucher now have their session restored before the portal is shown and
  during operating-system connectivity probes, using the device key already bound to the voucher. This avoids
  requiring a manual reconnect when the device can still be identified by its MAC address (or retained IP).
- If Android does not show its sign-in notification, the portal displays a direct link to the hotspot sign-in
  address. Android controls whether to display that notification; Private DNS settings and cached network
  validation can still suppress it. The supported fallback is to open the hotspot sign-in link in a browser.
- Phone-number reconnect is restricted to laptop/TV companions. A phone must use its voucher code; the existing
  one-phone-per-package rule still rejects a second phone. Device-type detection is User-Agent based, so it is a
  practical deterrent rather than protection against deliberate User-Agent spoofing.
- The captive portal's **My devices** page lists the device records attached to the active voucher. To add a
  companion, open that page on the laptop/TV, enter the already-active voucher code, and add that device. An unused
  voucher cannot be started through this companion flow. The original package device is protected from removal,
  even when that first device is a laptop/TV. This flow cannot be used from a phone; a second phone must use a
  separate package. A customer can remove a registered companion
  from the active package, which immediately removes its portal session. Device records indicate package
  registration, not whether the device is currently online; legacy single-device records are protected from
  removal because their original type is unknown.
- The admin dashboard has a manual **Record outage / Service restored** control. While an outage is recorded,
  active package timers pause; when service is restored, each affected package is extended by its overlap with the
  outage. The connected portal shows the active pause and the credited time. This must be operated by an admin;
  the system does not automatically determine whether upstream internet service is down.
- Joining Wi-Fi with its password is not package authorization. With the Internet gate active, a device still
  needs a valid voucher/payment to access the internet.

---
# v0.9 — SMS messaging (Olympus SMS)

Customers now get SMS for purchases, expiry, outages and offers. All of it runs through Olympus SMS
(`https://sms.ots.co.ke/api/v3`) and is controlled from **Admin dashboard > SMS messaging**.

## Set up (2 minutes)
1. Olympus dashboard > **Developers** > *Reveal token*. Copy it.
2. SYNTHNET Admin > **SMS messaging > Connection**: paste the token and your **approved sender ID**, press **Save**.
   (Saved to the same `.env` the app uses; no restart. The token is never shown again in the dashboard.)
3. Press **Test connection**, then send a **test SMS** to your own number.
Until the token and sender ID are saved, nothing is sent and everything else works exactly as before.
You can also set `OLYMPUS_SMS_TOKEN` / `OLYMPUS_SMS_SENDER_ID` in `.env` directly.

## What gets sent
| Message | When | Default |
|---|---|---|
| Payment receipt | M-Pesa purchase succeeds (code, amount, M-Pesa receipt, expiry) | on |
| Voucher code | You generate **1** voucher and type the buyer's number (manual Till flow) | on |
| Free time awarded | **Award free time** to a phone number | on |
| Expiry reminder | When 1 day and/or 15 min are left (editable), once each | on, packages >= KSh 20 |
| Package ended | Shortly after expiry | **off** |
| Outage started / Service restored | Dashboard outage buttons (checkbox lets you skip the SMS). Restored message includes each customer's credited time and new expiry | on |
| Offers / announcements | **Send a message or offer to customers** (all, online now, lapsed, or typed numbers; optional schedule) | you choose |

Every wording is editable (placeholders: `{brand} {support} {package} {code} {expires} {amount} {receipt} {left} {credit}`),
with a live length counter. Typos in placeholders are rejected on save.

## Things worth knowing
- **Cost.** Every SMS segment costs Olympus balance. Defaults are one segment each, plain ASCII (a curly quote or emoji
  switches to Unicode: 70 chars per SMS instead of 160, and the counter warns you). Reminders only go to packages priced
  at or above **KSh 20** (changeable) and "Package ended" is off, so a KSh 5 package does not spend more on SMS than it earns.
  Check your per-SMS rate on Olympus and tune these in *Automatic messages*.
- **Outbox with retry.** Messages are saved first, then delivered by a background worker; failures caused by network or
  Olympus errors retry with backoff (20 s up to 1 h, 10 attempts). The laptop's internet is also the hotspot's uplink, so an
  "Outage started" SMS may not be able to leave during a real outage. If service returns first, that stale notice is
  cancelled automatically and only "Service restored" is sent. Permanent errors (bad token, unapproved sender ID, no balance)
  are shown in the **Message log** with a **Retry** button once fixed. "Sent" means Olympus accepted it.
- **Reminders are smart.** Paused during a recorded outage, skipped if the customer already bought a newer package,
  and a 1-hour package never gets a "1 day left" message. Right after upgrading, customers who are already near expiry
  may get one reminder.
- **Who counts as a customer.** Anyone with a phone number on a purchase or award (admin-generated vouchers without a
  number have none). Numbers are Kenyan Safaricom format (07/01/254).
- **Promotional SMS.** Only message people who bought from you. There is no inbound "STOP" webhook in the Olympus docs
  provided, so opt-outs are manual: add numbers to **Do not message** (skipped by every message and broadcast).
  Kenyan regulations on promotional SMS (sender ID approval, opt-out) are your responsibility.
- **Scheduled broadcasts** send `schedule_time` as typed (`YYYY-MM-DD HH:mm`); Olympus interprets it in your account's time zone.
- **Not used:** the Hashed SMS API (for Pay Bill callbacks that only carry a hashed number; STK push gives us the real
  number, so normal SMS is used) and the Contacts/Campaign endpoints. A `sendHashed()` helper is in `src/sms.js` for later.

## Files
`src/sms.js` Olympus client + outbox · `src/notify.js` templates, triggers, reminders, broadcasts ·
`src/smsAdmin.js` dashboard API · `admin-ui/sms.js` dashboard UI · `src/phone.js`, `src/envfile.js` helpers.
Data: `sms-settings.json`, `sms-log.json`, `sms-state.json` next to `portal.json`.

## Tests
`npm test` runs 84 integration tests (SMS, greeting, customer journeys, income and profit, notifications, connection sound, TVs by MAC) against a fake Olympus server (no real SMS): receipts, retry/permanent errors,
reminders, outage start/restore + stale cancellation, broadcasts (chunking, schedule, opt-out), credentials, and the
"SMS not configured" case.

---
# v0.9 — Portal greeting (Good morning / afternoon / evening / night)

A welcome card sits at the top of the customer login page and changes with the time of day in **Nairobi (EAT, UTC+3)**.
The time comes from this laptop's clock (sent with the portal settings), so a customer's wrong phone clock cannot show
the wrong greeting. Defaults: **05:00** Good morning, **12:00** Good afternoon, **17:00** Good evening, **21:00** Good night,
each with a Swahili line (Habari za asubuhi / mchana / jioni, Usiku mwema), an emoji and its own colour style.

**Admin dashboard > Portal greeting**: switch the greeting on/off, show or hide the date & time line, and for each time
of day edit the emoji, start hour, colour style (sunrise, sky, sunset, night, emerald, violet), greeting and message.
Placeholders: `{brand}`, `{support}`, `{day}`. A **live preview** (with a "Preview as" picker) uses the exact same
renderer as the portal. **Reset to defaults** restores everything. Customers see changes within a minute.
Animations follow the existing portal animation setting and the device's "reduce motion" preference.
Files: `public/greeting.js` (shared renderer) · `src/greeting.js` · `admin-ui/greeting.js` · stored in `portal.json` under `greeting`.

---
# v0.9 — Payments, reconnect, My devices, income dashboard

## Payment popup and faster confirmation
- **Animated popup** when a customer taps Pay: *Sending request > Check your phone (phone-ringing animation, 3 steps, 2:30 countdown) > Payment confirmed (check mark, confetti, package, expiry, M-Pesa receipt)*. Clear screens for cancelled / no response / failed, with **Try again** and **Pay manually**. If the page is reloaded mid-payment, the popup resumes.
- **Faster:** the page checks every ~1.2 s (was 4 s). M-Pesa itself is asked at most every 5 s (Courtney Tech's rule), so confirmation lands about 5-6 s after the PIN instead of up to ~10 s.
- **Bug fixed:** payments used to be confirmed only while the customer's browser kept polling. If the sign-in popup closed when the M-Pesa PIN prompt appeared (common on phones), a customer could pay and stay offline. The **server now watches every pending payment itself** (also after an app restart), activates the buyer and sends the receipt SMS, with or without the browser.
- A buyer paying from a **laptop** is now recorded as a laptop (was always "phone").

## Reconnecting a purchased phone number
- Phones reconnect **automatically** when their Wi-Fi address (MAC) is recognised. When a phone rotates its private address, it can now get back online with **just the M-Pesa number it paid with** (Portal > Reconnect a device). Before, phones were refused and a buyer who never saw a voucher code was stuck.
- Because anyone can type someone else's number, the default is an **SMS code**: we text a 6-digit code (valid 5 min, 5 tries, single use, 45 s between resends, 3 per 15 min) to that number. Only the phone slot is replaced; a linked TV/laptop stays.
- **Admin dashboard > Customer reconnect by phone number**: *Automatic* (SMS code when SMS is set up, otherwise number only; default), *Always SMS code*, *Number only (no code: anyone who knows a customer's number could take over their phone slot)*, or *Off* (voucher code only). Laptop/TV reconnect by number is unchanged in every mode.
- The code SMS is sent immediately (not queued), costs one SMS unit, and appears in the Message log as "Reconnect code" with the code hidden.

## My devices
Shows the package and expiry, "x of 2 devices in use", your **package code with a Copy button** (so a number-only buyer can add a laptop/TV), each device as Phone / TV / laptop with a **This device** badge and short ID, and **Remove** for companions. Visitors who are not connected get a link to Reconnect with their number.

## Business overview (Admin, top of the page)
Daily income and growth from **confirmed M-Pesa payments**, in Nairobi days: Today (vs yesterday *so far*, like for like), Yesterday, Last 7 / 30 days (rolling, vs the period before), This month vs last month so far, Customers (new vs returning); a daily bar chart with a 7-day trend line and hover details; a plain-language trend banner; weekly growth table (weeks start Monday); best-selling packages; busiest hours; average sale and M-Pesa success rate. Range 7/14/30/90 days. Optional checkbox adds **manual Till sales as an estimate** (vouchers you generated that customers redeemed, at current package price; STK vouchers are not double counted; awarded vouchers never count).

## SMS automation checks done
Receipt (once per payment), reminders (once per window; skipped for cheap packages, renewed customers and during outages), ended notice, outage start/restored (stale start notice cancelled), award/voucher SMS and broadcasts are all covered by tests, including the outbox surviving an app restart. Fixes: legacy vouchers without a length no longer break reminders, and a receipt can no longer print a blank expiry.

---
# v0.9 — Daily earnings pie charts and profit (Admin > Business overview)

- **Revenue & profit cards** for the selected range: Revenue, Costs (with a breakdown), Profit (plus today and this month) and Profit margin.
- **Daily earnings** with a day picker (‹ date › Today). Two pie charts for the chosen day, with hover details and a legend:
  **Earnings by package** and **Where the revenue goes** (profit vs M-Pesa fees, SMS, running cost, one-off expenses; on a loss day it shows the costs alone and says so).
- **Daily profit chart**: green bars for profit, red for loss, today hatched; hover for revenue and costs.
- **Costs & profit settings** (open the section at the bottom of Business overview). Profit = revenue - M-Pesa fees - SMS cost - daily running cost - one-off expenses.
  - *M-Pesa / provider fee (%)*: applied to each M-Pesa payment (not to manual Till sales).
  - *SMS cost per unit (KSh)*: multiplied by the SMS units Olympus actually accepted that day (recipients x segments, from the Message log; failed messages cost nothing).
  - *Running cost per day (KSh)*: internet, power, rent. Starts on the day of your first sale; **today's share is pro-rated** through the day so a quiet morning is not shown as a big loss.
  - *One-off expenses*: date, description, amount (repairs, equipment, airtime). Counted on that day; can be deleted.
- **Until you enter costs, profit equals revenue** and the dashboard tells you so. The fee %, SMS rate and daily cost are values only you know: check them with Safaricom/Courtney Tech, Olympus and your own bills.
- All days are Nairobi (EAT) days. Manual Till sales (optional checkbox) are estimates and carry no M-Pesa fee.

---
# v0.9 — Notification bell (Admin, top right)

A bell in the admin header records **everything that happens on the platform** and tells you about what needs your attention.

**How the bell behaves**
- It **rings** (swinging bell, pulsing ring, glow, bouncing badge) while there are notifications you have **not seen**. Opening the panel counts as seeing them and calms the bell.
- The **badge** shows how many are **unread**; an item becomes read when you click it, or with *Mark all read*. A new notification rings the bell again. The bell and badge change colour with the most serious unread item (cyan info, green money, amber warning, red critical), and the browser tab title shows the count, e.g. "(3) SYNTHNET".
- New items while the panel is closed pop up as small toasts (click one to open the panel), with an optional **sound** (a bright chime for money, a lower tone for problems) and optional **desktop alerts** when the window is in the background. Both are switches in the panel's settings (gear).
- Filters: All, Unread, and each kind (Payments, Customers, Outages, SMS, Security, Admin changes, System). "Go to section" jumps to the related part of the dashboard. Repeats are merged ("x5") instead of flooding the list. Times are Nairobi (EAT). The log is kept for 90 days (last 1500 entries) in `notifications.json` and survives restarts.

**What is recorded** (routine activity is stored quietly in the history; only things that deserve attention ring the bell)
| Kind | Rings the bell | Recorded quietly |
|---|---|---|
| Payments | payment received (amount, package, masked number, receipt, NEW or returning customer); payment failed; timed out; amount mismatch (critical); M-Pesa rejected / wallet needs top-up / service unreachable; customer paid but internet was not unlocked | M-Pesa request sent; cancelled by the customer |
| Customers | voucher redeemed for the first time (manual Till sales); customer reconnected by phone number | later logins, automatic reconnects, logouts, TV/laptop added or removed, reconnect codes sent, package expired |
| Outages | | outage recorded, service restored (with credited time) |
| SMS | balance too low or token/sender rejected (critical); messages cannot be sent / provider unreachable | broadcasts queued or scheduled, test SMS, retries, settings changes |
| Security | 3 wrong admin tokens, admin sign-in locked, 5 wrong voucher codes, 5 wrong reconnect codes, admin password changed | admin panel opened |
| Admin changes | | every change you make: vouchers, awards, prices and content, theme, greeting, reconnect mode, costs and expenses, SMS settings (never the secrets) |
| System | platform updated to a new version (with what is new); internet gate not active (critical); server error; M-Pesa checkout not set up | platform started, gate active |

Your own admin changes are logged but never ring the bell. In the panel's settings you can stop recording a kind altogether, clear read items, or clear everything.

---
# v0.9 — "You are connected" sound (Admin > Connection sound)

A short sound plays **on the customer's own phone** the moment their connection is established, and **never lasts longer than 2 seconds**.

- **When it plays:** after a voucher login, when a payment finishes (together with the "You're online!" screen), and after a reconnect. It does **not** play when someone just reopens the portal while already connected, never more than once per 4 seconds, and only if you have it switched on.
- **Admin controls:** switch it on/off, pick one of **10 sounds** (Little beep (default), Double beep, Soft chime, Success, Bell, Sparkle, Droplet, Power-up, Welcome, Fanfare) with a play button on each, set the **volume** (5-100%), and optionally **upload your own** short clip (MP3, WAV, OGG or M4A, up to 300 KB). Press **Save sound** to apply. Customers get the change within about a minute.
- **The 2-second limit is enforced in the player**, not just in the sound files: every note is clipped to fit, the output fades out and stops at 2.0 s, and an uploaded clip longer than 2 s is cut at 2 s.
- The built-in sounds are generated in the browser (no downloads, work offline). Uploaded files are checked for real audio content and size before they are stored.
- **Browser rules you cannot override:** phones only allow sound after the customer has tapped something on the page (the first tap unlocks it, and tapping Connect/Pay/Reconnect counts), and a phone on silent mode or with the volume down will not play it. Some captive-portal mini browsers (notably on iPhones) block audio completely; in that case the customer is simply connected without the sound.
Files: `public/connectsound.js` (player, shared with the admin preview) · `src/sound.js` · `admin-ui/sound.js`.

---
# v0.10 — Add a TV by MAC address (My devices)

Some TVs, consoles and streaming sticks cannot open a sign-in page. They can now be **registered by their Wi-Fi (MAC) address** and connect by themselves.

**For the customer** (portal > My devices, while connected on their phone): *Add a TV by its MAC address*. Type or paste the address (any format: `AA:BB:CC:DD:EE:FF`, `aa-bb-...`, `AABBCCDDEEFF`; it formats itself), optionally name it ("Living room TV"), press **Add TV**. A help panel shows where to find the address on Samsung, LG, Android/Google TV, Fire TV and Roku. Switch the TV on and join the Wi-Fi: it gets internet within a few seconds, no sign-in. The list shows each TV as **Online** or **Waiting for the TV**, and **Remove** switches it off immediately.

**What happens when the package ends:** the TV is cut off at the same moment as the phone (same internet gate, same clock, outages credited as usual). It stays off until the customer buys again. **Their registered TVs are carried over automatically** to the next package they buy (M-Pesa in the portal, or a voucher tied to the same phone number), as long as there is room, so they do not have to add the TV again. If a different phone buys the next package, that customer adds the TV again from My devices.

**How it works:** every ~4 seconds the server checks who is on the hotspot (the ARP table). For each registered TV on an **active** package it opens the gate for the TV's current IP. Safety rules: only MACs saved on an active package are linked; if the TV's IP is now used by a different device, access is dropped at once; a TV not seen for 10 minutes loses its session so a reused IP cannot inherit it; a TV can be on only one active package at a time; during a recorded outage nothing is removed.

**Rules and limits**
- A TV counts toward the package's **device limit** (default: 1 phone + 1 other device, set with `MAX_DEVICES_PER_VOUCHER` in `.env`). A TV added by MAC is never bumped out by another device reconnecting by number: that device is refused until you remove one or raise the limit.
- Use the TV's **Wi-Fi** address. If the TV has a "Private Wi-Fi address" / "Random MAC" setting, turn it off, otherwise the address can change and the TV will need to be added again.
- The customer needs one device (usually the phone) that can open the portal to add the TV. For customers who cannot, use the admin tool below.
- The phone's own address cannot be registered as a TV.

**For the admin:** *Link a TV by MAC address* (below Connected clients): enter the customer's phone number or voucher code, the TV's MAC and an optional name. TVs show a violet **📺** badge in Connected clients. Kicking a TV (Revoke) keeps it off until it is linked or added again. Linking, adding and connecting are recorded quietly in the notification bell's history.
Files: `src/mac.js` · `src/tvlink.js` · `src/vouchers.js` (addTvByMac, tvTargets, carryOverTvs) · `admin-ui/tv.js`.

---
# Building the desktop app (Windows installer)

`SYNTHNET Setup 0.10.0.exe` is the installer for this version (NSIS, x64). To rebuild it yourself on Windows:

1. Install Node.js 20+ and run `npm install` in the project folder (this also fetches the build assets).
2. Run `npm run dist`. The installer is written to `dist\SYNTHNET Setup <version>.exe`.

Good to know
- **The app asks for Administrator rights** every time it starts (the .exe is marked "run as administrator"). That is required: the internet gate (WinDivert) and the hotspot settings need it. Windows shows the normal UAC prompt.
- **The installer is not code-signed**, so Windows SmartScreen may say "Windows protected your PC": click *More info* > *Run anyway*. A code-signing certificate removes that warning (set `CSC_LINK` / `CSC_KEY_PASSWORD` before `npm run dist`).
- On first run the app creates its data folder at `%APPDATA%\SYNTHNET\data` (settings, vouchers, payments, notifications) and, if needed, downloads the WinDivert driver, which needs internet once. Uninstalling the app does not delete that data folder.
- The installer lets you choose the install folder and adds a desktop shortcut. Your `data` folder is never part of the installer, so updating means installing the new version over the old one.
- Fixed in this build: the tray/window icon (`build/icon.png`) was not being packaged; it is now included.

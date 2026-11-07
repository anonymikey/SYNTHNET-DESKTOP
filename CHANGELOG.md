# Changelog

All notable changes to SYNTHNET Desktop are documented here.

## [Unreleased]

<!-- Add plain-language notes under Unreleased. -->

## [0.0.3] - 2026-11-07


### Fixed

**More reliable first-run internet gate setup.** WinDivert downloads now use an isolated temporary staging folder, retry incomplete downloads, validate both x64 driver files before activation, and avoid reusing stale archives from interrupted setup attempts. Failure messages now explain likely Windows Security, antivirus, permissions, and locked-file causes without allowing the hotspot to start with an inactive gate.

**Credential setup guidance.** The Admin dashboard and application guide now explain the Courtney Tech API key, API secret, numeric account ID, SMS.OTS token, and approved sender ID setup in a clear sequence. Provider credentials remain local to the operator's computer and are never displayed or sent to the public website.

**Cleaner update flow.** Existing installations check for a newer release shortly after the Admin dashboard opens. Administrators receive a clear update dialog with a private SYNTHNET release page, download instructions, and a Later option; the background check remains available every six hours and from Help > Check for updates.

**Guided desktop onboarding.** The desktop Admin dashboard now opens a first-run operator tour covering the gate, connected devices, payments, SMS, notifications, and support tools. The public website remains tour-free for a cleaner release experience.

## [0.0.2] - 2026-11-07



### Added

**Automatic update notifications.** SYNTHNET now checks the private release service shortly after startup and every six hours thereafter. When a newer version is published, Windows shows a native notification with a direct link to the private SYNTHNET release page.

**Manual update check.** Use **Help → Check for updates** whenever you want to check immediately instead of waiting for the next scheduled check.

**Safe update behavior.** Update checks are non-blocking, tolerate offline use, compare semantic versions correctly, and remember the last notified release so the same update does not interrupt you repeatedly.

**Private release pages.** Update notifications open SYNTHNET’s own release page with the current features, notes, download action, and earlier releases. Users do not need to visit the GitHub repository.

**Developer support and feature requests.** The desktop Help menu now includes a direct contact action for bug reports, ideas, and feature requests at anonymiketech@gmail.com.

**Operator support card.** The admin dashboard now includes a visible “Build with me” contact card so operators can quickly report an issue or suggest an improvement.

**Founder story and product context.** The public website now explains the thought behind SYNTHNET: building something useful from the tools already available, turning a “could this earn money?” idea into a practical local-first hotspot product, and encouraging other operators to make their own connection work harder.

### Changed

**More useful release experience.** The website’s release history and internal release detail pages now provide a clearer path from a new version notification to its notes and installer.

**Responsive website polish.** The public website keeps its dark SYNTHNET visual system across desktop, tablet, and mobile layouts, including the new founder story and release pages.

**Installer continuity.** Existing user data remains in `%APPDATA%\SYNTHNET\data` while users install the new version over the previous version.

### Fixed

**Repeated update prompts.** The desktop app no longer uses a one-time startup-only update check. It now handles future releases consistently across startup, scheduled checks, and manual checks.

**Offline startup resilience.** A failed or unavailable release service cannot prevent the local dashboard, hotspot, or internet gate from starting.

## [0.0.1] - 2026-11-06

### Added

**First public SYNTHNET Desktop release.** Run a local-first paid Wi-Fi hotspot with the Windows desktop dashboard, guest portal, package access, device visibility, and local configuration.

**Branded Windows installer.** The installer uses the SYNTHNET brand artwork, requests the administrator permission required for hotspot control, offers installation-directory and shortcut choices, and can launch SYNTHNET after setup.

**Release-aware website.** The desktop app opens the SYNTHNET website on launch, and a new installation or version update opens the release history so users can see the current build, past releases, and release notes.

**Developer support contact.** Product and installation questions can be sent to anonymiketech@gmail.com.

## [0.10.0] - 2026-10-25

### Added

**Add a TV by MAC address.** Register TVs and other devices that cannot open a sign-in page by their MAC address.

**Link a TV from the dashboard.** Admins can link a named TV to a customer's active package from My devices.

**Help for finding MAC addresses.** The My devices screen explains where to find a TV's MAC address.

### Changed

**TVs are not bumped by other devices.** A customer's TV stays linked to its package when the same customer connects another device.

## [0.9.0] - 2026-10-21

### Added

**SMS receipts and reminders.** Customers receive payment receipts, expiry reminders, outage notices, voucher and award messages, broadcasts, and offers.

**Time-of-day greeting.** The portal greets customers with the right Nairobi-time morning, afternoon, evening, or night message.

**Payment popup.** Customers see clear progress while an M-Pesa payment is being confirmed.

**Reconnect by number and SMS code.** Remembered devices can reconnect with the customer's M-Pesa number and a six-digit SMS code.

**My devices.** Customers can see and manage their remembered devices.

**Business overview.** Admins can review income, growth, weekly activity, packages, and busiest hours.

**Daily earnings pies and profit.** The dashboard shows daily earnings categories plus revenue, costs, and profit.

**Notification bell.** Important payments and problems ring the bell while routine activity stays in quiet history.

**Connection sound.** Choose from built-in sounds or upload a short custom clip.

**Windows installer.** Install SYNTHNET Desktop with the Windows installer.

### Fixed

**Payment confirmation happens on the server.** A customer can close the payment page without losing a confirmed connection.

**Laptop is recorded as a phone.** Laptop connections are classified correctly for reconnect and device history.

**Tray icon is included.** The packaged app now keeps its tray icon.

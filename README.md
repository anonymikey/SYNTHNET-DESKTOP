# SYNTHNET Desktop

SYNTHNET Desktop is a Windows 10/11 x64 Electron application for running a paid Wi-Fi hotspot with a captive portal, M-Pesa STK push payments, SMS notifications, reconnect codes, TV-by-MAC support, and an admin dashboard. Customer and business data stays on the owner's PC.

## Everyday commands

```bash
npm ci
npm test
npm run test:site
npm run release -- patch --dry-run
```

For the full app guide, see [`docs/APP-GUIDE.md`](docs/APP-GUIDE.md). For releasing a version, see [`docs/RELEASING.md`](docs/RELEASING.md).

The app requires Windows Administrator rights for network-level hotspot and internet-gate control. The installer is not code-signed yet, so Windows SmartScreen may require **More info → Run anyway**.

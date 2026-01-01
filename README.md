# invoice-app

Local-first invoice creation and management app built with Next.js (intended to be Electron-packaged later).

## Getting Started

- Install dependencies: `npm install`
- Run dev server: `npm run dev`

Open:
- Home: http://localhost:3000
- Invoices: http://localhost:3000/invoices
- Settings: http://localhost:3000/settings

## Scripts

- `npm run dev` – local dev server
- `npm run build` – production build
- `npm run start` – run production server (after build)
- `npm run lint` – ESLint

## Electron (Desktop)

This repo can be packaged as an Electron desktop app.

- Dev (Electron + Next): `npm run electron:dev`
- Build (Electron installers):
	- Windows: `npm run electron:build:win`
	- macOS: `npm run electron:build:mac`
	- Linux: `npm run electron:build:linux`

Note: The Electron build scripts run `scripts/prepare-electron-standalone.mjs` to copy Next.js assets into the standalone server output. If you run `electron-builder --mac` directly without the prepare step, the packaged app may load with missing CSS ("unstyled/scuffed").

### macOS troubleshooting ("layout is scuffed")

If the macOS installer/app looks unstyled:

- Ensure you built with `npm run electron:build:mac` (not a bare `electron-builder --mac`).
- Build with lockfile installs for consistent versions: `npm ci`.
- Check the startup log shown in the loading screen and the persisted log at `~/Library/Application Support/Helferlein/main.log` for 404s to `/_next/static/*` or server startup errors.

## Data & Offline

- Data is stored locally in the browser via `localStorage` (no backend).
- Settings + invoices persist across restarts.
- The storage layer is intentionally isolated so it can be swapped for filesystem/SQLite when moving to Electron.

## Requirements

See [REQUIREMENTS.md](REQUIREMENTS.md).

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

## Data & Offline

- Data is stored locally in the browser via `localStorage` (no backend).
- Settings + invoices persist across restarts.
- The storage layer is intentionally isolated so it can be swapped for filesystem/SQLite when moving to Electron.

## Requirements

See [REQUIREMENTS.md](REQUIREMENTS.md).

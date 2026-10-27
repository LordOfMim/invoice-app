# Helferlein development

- Keep `com.invoiceapp.desktop`, product name `Helferlein`, the existing userData directory, `invoice-app:v1`, and the electron-store name/encryption configuration compatible with installed versions.
- Never initialize an empty database over an unreadable or unsupported existing snapshot. Preserve originals and create a recovery copy before imports or migration writes. Optional new invoice fields must remain additive.
- Run `npm ci`, `npm run einvoice:prepare`, `EINVOICE_REQUIRE_INTEGRATION=1 npm run check`, and `npm run build:app` for meaningful runtime/export changes. Changes to packaging also require `node scripts/smoke-packaged.mjs` against a native unpacked app.
- Build Mac architectures separately. Keep the Java bundle architecture aligned with Electron. Do not raise the macOS minimum version without checking the installed user's OS.
- E-invoice files are released only after the pinned XML/PDF-A validator succeeds. Do not change historical accounting amounts silently to make a document validate. Keep ordinary PDFs available for legacy invoices.
- UI uses system fonts, flat neutral surfaces, accessible labels, and no persistent GPU animation. Keep primary invoice tasks clear and preserve advanced accounting features.
- Sign and notarize release packages, then test upgrading a copy of real legacy data before delivery. A source-tree test or unsigned DMG does not prove a safe production Mac upgrade.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

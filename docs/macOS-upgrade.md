# Helferlein: macOS upgrade and local data

The application ID (`com.invoiceapp.desktop`), product name (`Helferlein`), data key (`invoice-app:v1`), electron-store name (`invoice-app-data`) and existing encryption configuration are unchanged. Production data continues to live in `~/Library/Application Support/Helferlein/invoice-app-data.json`. No login, network connection or external Node installation is required by the packaged runtime.

Any valid existing desktop snapshot is authoritative, including intentionally empty snapshots and settings-only data. An existing browser-local snapshot is retained unchanged. Only when the desktop data key is absent can the legacy browser snapshot be adopted. First adoption also saves the source snapshot in a recovery entry before writing the primary key. This does not merge conflicting records; preserve both snapshots and inspect/export them when reconciling an older browser-only installation. Random historical localhost origins cannot be enumerated through browser localStorage. If an old version used only browser storage at another port, export JSON from that version and import it through Backup.

Imports save the previous raw snapshot under an `invoice-app:v1:recovery:*:before-import` key before replacing it. Missing newly introduced collections are added in memory. Invalid existing collections, unknown schema versions and invalid JSON are rejected instead of becoming an empty account. An unreadable encrypted store is copied to a uniquely named sibling recovery file and startup stops; neither the original file nor its path is changed.

Desktop edits update a preload snapshot immediately. Disk writes are coalesced within 250 ms, including while continuously typing; app close flushes the latest snapshot synchronously. A failed flush prevents normal close and displays a save error. An OS crash or force quit can lose the last 250 ms of edits. electron-store continues to provide its atomic file writes. Desktop edits no longer rewrite a second full localStorage copy.

## Release verification on real Macs

Before releasing an upgrade, test both Intel and Apple Silicon DMGs on supported macOS:

1. With the old app closed, copy the entire `~/Library/Application Support/Helferlein` folder to a safe location. Never test migration on the only copy of customer data.
2. Install the new app over the old one. Verify invoices, customers, products, attachments, logos, settings, recurring invoices, credits and templates against the old version.
3. Disable the network. Open, edit, export and import invoices, restart, and verify the last edit after closing immediately while typing.
4. Close the last window and reopen from the Dock; check standard macOS edit shortcuts and menus. A second launch should focus the existing instance.
5. Test disk-write failure on a disposable profile: error must be visible and normal close must preserve the pending snapshot. Test corrupt JSON/encrypted data and unsupported schema using copies only: startup must stop, without creating empty data over the original.
6. Verify JSON import creates a recovery copy, then test invalid JSON and malformed collections. Check that documents and settings are unchanged after a rejected import.
7. Confirm server binds only to 127.0.0.1, no remote requests are required, and startup succeeds with no system Node installation. Check packaging, macOS signing/notarization and Gatekeeper separately; CI building a DMG alone does not certify these.

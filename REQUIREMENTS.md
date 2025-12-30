# Invoice App — Requirements

Current date: 2025-12-30

## 1) Product Goal
Build a local-first invoice creation and management app that runs as a web app (Next.js) and can later be packaged as a macOS desktop app via Electron.

Core principles:
- Offline-first
- No backend required
- Fully customizable invoices
- Simple, predictable data model
- Easy PDF export / printing

## 2) Target Users
- Freelancers / solo founders
- Small businesses
- Anyone needing custom invoices without SaaS lock-in

## 3) Functional Requirements

### 3.1 Invoice Creation
The app must allow users to:
- Create a new invoice
- Edit an existing invoice
- Duplicate an invoice

Invoice fields (fully editable text):
- Invoice number
- Invoice date
- Due date
- Sender information (name, address, contact)
- Recipient information
- Line items:
  - Description
  - Quantity
  - Unit price
  - Tax rate (optional)
  - Subtotal
  - Tax total
  - Grand total
- Bottom / footer text (e.g. payment terms, thank you note)

Requirement:
- Every visible piece of text on the invoice must be user-editable (no hardcoded labels).
  - This includes headings, section titles, column headers, and any labels rendered inside the invoice preview/print.

### 3.2 Invoice Layout & Design
Layout customization must include:
- Multiple invoice layout templates (at least for MVP):
  - Classic
  - Modern
  - Minimal
- Ability to switch layouts per invoice

Logo placement:
- Show/hide logo
- Position (top-left, top-center, top-right)

Adjustable sections:
- Sender position
- Recipient position
- Footer visibility

Constraint:
- Layouts are template-based (no free-form drag-and-drop for MVP).

### 3.3 Default Settings
Global defaults configurable in a Settings screen:
- Default sender details
- Default footer text
- Default tax rate
- Default currency
- Default invoice layout
- Default logo image

Behavior:
- Defaults are auto-applied when creating a new invoice but can be overridden per invoice.

### 3.4 Invoice Management
The app must provide:
- A list view of all invoices

Sorting by:
- Date
- Invoice number
- Total amount

Filtering by:
- Paid / unpaid (manual toggle)

Actions per invoice:
- Edit
- Delete
- Duplicate
- Mark as paid/unpaid

Nice-to-have (later):
- Search by client name or invoice number

### 3.5 Local Persistence (Critical)
All data must be stored locally and permanently, including:
- Invoices
- Settings
- Layout preferences
- Logo image

Requirements:
- No cloud dependency
- No authentication
- Data must persist across app restarts
- Must work offline

Implementation note (guidance):
- Browser: IndexedDB / localStorage
- Electron: filesystem-based storage or SQLite

### 3.6 Exporting & Printing
Export capabilities:
- Export invoice to PDF
- Print invoice using system print dialog

PDF requirements:
- PDF output must match on-screen layout
- No watermarks
- High-quality (print-ready)

Export scope:
- Single invoice export
- Filename pattern configurable (e.g. `Invoice-2025-001.pdf`)

## 4) Non-Functional Requirements

### 4.1 Platform Compatibility
- Web app (Next.js)
- macOS desktop app (Electron)
- No reliance on browser-only APIs that break in Electron

### 4.2 Performance
- Invoice list loads instantly (≤ 1s)
- Editing an invoice feels real-time
- PDF export completes within a few seconds

### 4.3 UX Requirements
- WYSIWYG invoice preview (live preview while editing)
- Clear separation between:
  - Data (invoice content)
  - Presentation (layout template)
- Keyboard-friendly editing

### 4.4 Maintainability
- Layouts must be modular and reusable
- Invoices stored in a structured, versionable format (JSON)
- Easy to add new invoice templates later

## 5) Language Requirement
- The app MUST be able to be set to the German language.
  - At minimum: app UI must support German; language preference must be persisted locally.

## 6) Design Philosophy (Apple-inspired, KISS)
The interface follows a clean, minimal, Apple-inspired design philosophy focused on clarity, restraint, and content-first presentation.

Overall feel:
- Calm
- Professional
- Trustworthy
- Timeless

KISS principle:
- If an element does not improve clarity, remove it.

### 6.1 Color Scheme
Intentionally small and neutral.

Primary:
- Background: soft off-white / light gray (example given: #F5F5F7)
- Surface / Cards: pure white (#FFFFFF)
- Primary text: near-black (#1D1D1F)
- Secondary text: muted gray (#6E6E73)

Accent:
- A single subtle accent color used sparingly for:
  - Primary actions
  - Active states
  - Highlights
- Example given: Apple-blue inspired tone (#007AFF)

Usage rules:
- Accent color is functional, never decorative
- No more than one accent color in the entire UI
- Avoid gradients, neon tones, or high saturation

### 6.2 Typography
- System font first (e.g. SF Pro, `-apple-system`, `system-ui`)
- Clear typographic hierarchy
  - Headings: Medium / Semibold
  - Body: Regular
  - Secondary text: smaller, lighter
- Generous line height
- No custom fonts in MVP

### 6.3 Layout & Spacing
- Consistent spacing using an 8px or 4px grid
- Generous whitespace between sections
- Separation via spacing (not heavy borders)

Cards/panels:
- Subtle rounded corners
- Soft shadows or none
- Never heavy/boxed

### 6.4 UI Elements
Buttons:
- Simple, flat appearance
- Primary button uses accent
- Secondary buttons are neutral

Inputs:
- Clean, border-light
- Clear focus states
- No heavy outlines/shadows

Icons:
- Thin, line-based
- Used sparingly

Motion:
- Subtle transitions only (150–250ms)
- Motion reinforces hierarchy/state
- No flashy animations

## 7) Implementation Constraints & Sequencing
- Start as a Next.js web app; later convertible to Electron.
- Keep storage layer abstract to support switching persistence implementation.
- Layouts are template-based (no drag/drop).

## 8) MVP Deliverables (Initial Implementation Target)
- Local persistence for settings + invoices
- Invoice list with sort/filter and paid toggle
- Invoice editor with live preview
- 3 templates (Classic/Modern/Minimal)
- Logo upload + position
- Settings screen with defaults
- Print + PDF export flow
- German language support with persisted preference

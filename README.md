# Durgawati Mahavidyalaya — Bonafide Management

A responsive administrative dashboard built with HTML, CSS, native JavaScript modules, and a small Node.js server. Student records are persisted in SQLite. There is no compilation or build step.

## Run locally

Install Node.js 24 or newer, then run from this folder:

```sh
npm install
npm start
```

Open http://localhost:5173. Once dependencies are installed, `node server.mjs` works without npm. `npm run dev` also starts the server. If using pnpm, use `pnpm install --frozen-lockfile` and `pnpm start`. Set `PORT` to change the local port. Stop with Ctrl+C.

## Structure

- `public/index.html`: accessible application shell and navigation.
- `public/css/styles.css`: original dashboard styling and responsive layouts.
- `public/css/students.css`: import forms, tables, and record dialogs.
- `public/js/app.js`: dashboard, live student counts, placeholders, and navigation.
- `public/js/student-ui.js`: upload/preview/import, manual entry, search, and record management.
- `public/js/student-schema.js`: the ten shared field definitions and input validation.
- `public/js/certificate-ui.js`: registration search and preview/print controls.
- `public/js/certificate-template.js`: the fixed college certificate markup and field mapping.
- `public/css/certificate.css`: A4 portrait certificate and print-only styles.
- `public/images/certificate-header.jpg` and `certificate-watermark.jpeg`: original images extracted unchanged from the supplied Word template.
- `lib/certificates.mjs`: persistent sequential preview numbers and student snapshots.
- `public/js/icons.js`: shared inline SVG icons.
- `public/templates/student-template.xlsx`: blank, formatted template and Instructions sheet.
- `lib/store.mjs`: SQLite storage, unique registration keys, transactions, and pagination.
- `lib/excel-worker.mjs`: isolated workbook parsing and archive checks.
- `lib/imports.mjs`: row validation and conflict classification.
- `server.mjs`: static server and student/import API.
- `tests/student-system.test.mjs`: isolated integration tests, including 2,500-record import.
- `scripts/check.mjs`: syntax checks.
- `data/students.sqlite`: automatically created private database, excluded from version control.

## Current scope

## Office workflow

1. Open **Add Student Data** and download the Excel template.
2. Keep the headers on row 1. Fill one student per row on the Students sheet, save, and select the .xlsx file. Selection automatically uploads and validates it. **Upload / Validate** lets you retry.
3. Review counts, exact row errors, and the first 100 valid records. Every row is validated and every error is listed.
4. Existing registrations are excluded by default. Check **Update Existing Records** only when intentionally replacing their data. Updates replace all ten fields, including blank optional fields.
5. Click **Import Students**. Only valid rows are saved. Skipped-row errors remain visible until leaving the page or starting another import.
6. Alternatively, use **Manual Add** to enter one student. Search and manage records under **Student Database**. **View / Edit** opens all ten fields. Deleting requires a separate confirmation.

Registration keys ignore surrounding whitespace and letter case, while preserving the entered display value. Leading zeroes are preserved for text cells and simple zero-padded numeric formats. Use Excel Text format for identifiers, especially long registration numbers. All occurrences of a duplicate registration inside one file are excluded. Completely empty rows are ignored.

The importer reads the Students sheet when present, otherwise the first sheet other than Instructions. The chosen sheet is shown in the preview. Excel dates are converted to yyyy-mm-dd; existing text dates are retained. Limits: 5 MB uploaded, 10,000 data rows, 100 columns, 64 MB expanded archive. Formula cells are rejected; macros, embedded files, encrypted archives, and malformed workbooks are not accepted. Uploads stay in memory and are never executed or extracted to disk. Preview tokens expire after 15 minutes or a server restart. If records change after validation, validate again before importing.

## Certificate issue, print and PDF (Step 4)

Open Generate Bonafide, enter Registration Number and click Search. Not Issued records require Generate / Preview to assign a number. Existing certificates open with their saved number and issue date. PRINT CERTIFICATE opens the browser print dialog; DOWNLOAD PDF downloads `Bonafide_<RegistrationNumber>_<CertificateNumber>.pdf`. Certificate Records supports search, view, print and download with 50 records per page.

The original template/header/watermark are preserved. Mother's Name, Class Roll Number, Date of Admission, Academic Year and signature/seal areas remain blank. Current database values populate all other student fields, including Course Complete as Expected Year of Course Completion. Certificate generation never edits student data.

SQLite `certificates` has a UNIQUE normalized registration number and an AUTOINCREMENT number. Issuance runs in an immediate transaction. Retries return the existing number/date, including after restart. Dates use Asia/Kolkata. Migration preserves the latest displayed legacy preview per student, retaining the old preview table for audit. Existing duplicate previews are not additional issued certificates. Issued status records number assignment; a certificate still requires authorized signatures.

PDF uses local Puppeteer/Chromium and the same HTML template and print CSS, with selectable text. Assets are embedded locally, scripts disabled, external requests blocked. Every generated PDF is checked by pdf-lib for exactly one page. Overflow fails clearly instead of clipping. Failed downloads never allocate numbers. One PDF is rendered at a time; another request receives a friendly retry message.

Install dependencies with `npm install` (or `pnpm install`), then install the local browser with `node node_modules/puppeteer/lib/puppeteer/node/cli.js browsers install chrome`. Start with `node server.mjs`. Hosting needs Node 24+, persistent disk and support for Chromium plus installed fonts. No cloud PDF service, authentication or QR verification is used.

For physical printing choose A4 portrait, scale 100%, no margins and disable browser headers/footers. Printer-driver overrides remain outside application control. The original watermark is low resolution; it is preserved rather than replaced. Very long student fields can require authorized data review before the fixed one-page certificate can print.

Changed modules: `lib/certificates.mjs`, `lib/certificate-pdf.mjs`, `server.mjs`, `public/js/certificate-ui.js`, `public/js/certificate-records-ui.js`, `public/js/certificate-template.js`, `public/js/app.js`, `public/css/certificate.css`, dependency manifests and certificate tests.

## Data persistence and backup

Records remain in `data/students.sqlite` after a restart. To use another database file, set `DATA_FILE` before starting the server. For a backup, stop the server and copy the entire `data/` folder, including any SQLite sidecar files. Do not place the database inside `public/`. Use one application process per database and a local, non-synchronized disk for a deployed database.

The attached college workbook was imported on 2026-09-12 after authorization: 2,456 records added, 40 duplicate rows excluded. See `outputs/student-import/duplicate-rows.md` for the original Excel row numbers and registration numbers requiring review. The source workbook was not changed.

## Check and deploy

```sh
npm run check
npm test
```

Without npm, use `node scripts/check.mjs` and `node --test tests/*.test.mjs`. Tests use temporary databases and never write to the application database. They cover template download and structure, valid/partial imports, empty rows, missing fields/columns, duplicates, explicit updates, stale previews, manual creation, search, edit/delete conflicts, persistence, and volume.

This version requires **Node.js hosting with persistent disk**; static-only hosting cannot store student records. The server currently binds to loopback and accepts localhost hosts for local office use. Public deployment requires a deliberate hosting configuration and authorization layer before exposing real student data. Those are outside this step.

Fonts load from Google Fonts with local sans-serif fallbacks. Uploaded content is displayed as escaped text. The API uses parameterized queries, transactions, version checks, and same-origin write checks.

## QA audit and visual polish

See [QA-REPORT.md](QA-REPORT.md) for the audit results, fixes, data-integrity checks and manual verification limits. The screen-only `public/css/ui-polish.css` improves the office UI and adds short animations when reduced motion is not requested. The print certificate template remains unchanged. Run all checks with `node scripts/check.mjs` and `node --test tests/*.test.mjs`.

The lockfile and overrides update yauzl and ExcelJS's transitive uuid. jsdom is a development-only dependency for asynchronous form regression tests. The app has not been deployed to Netlify; copying index.html alone does not host the database/API/PDF renderer.

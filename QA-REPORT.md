# QA audit and visual polish — 13 September 2026

## Result

- Final automated test runner: **31 tests, 31 passed, 0 failed, 0 skipped** (includes two parent test groups).
- Syntax checks: 18 JavaScript/module files passed.
- Dependency audit after fixes: 0 reported vulnerabilities; no peer dependency conflicts.
- Clean live server restart passed. Existing student search, certificate retrieval and PDF generation passed after restart.
- Six real records were rendered from an isolated database copy. All six PDFs had one A4 portrait page, selectable text, correct mapped fields, number/date, two preserved image assets, and no dashboard/buttons. All six rendered pages were visually inspected: no overlap or clipping.
- Responsive checks: all five pages at 1280, 768 and 390px (15 checks), repeated after visual polish; no document-wide horizontal overflow. Wide tables and the A4 preview scroll within their own areas.
- No QR codes, authentication or additional certificate types added. Visual changes and animations were explicitly requested after the audit began.

## Data integrity

| Check | Before | After |
|---|---:|---:|
| Students | 2,456 | 2,456 |
| Issued certificates | 3 | 5 |
| Duplicate normalized registrations | 0 | 0 |
| Missing required registration/name | 0 | 0 |
| Orphan certificates | 0 | 0 |

All student fields, IDs, versions and the metadata revision matched the baseline exactly. The three original certificate records retained their number, registration and issue date. Two additional live records (numbers 6 and 7) appeared during the audit; they were not issued by the isolated QA scripts and were preserved. The application does not record the actor, so this audit does not attribute those additions to a particular person. A strict whole-certificate-table comparison initially detected this count change; the original-record comparison subsequently passed. Legacy preview rows were unchanged. SQLite integrity_check returned ok.

Existing optional blanks were preserved: DOB 515; category 77; semester 515; session 515; course completion 727. These are source-data omissions, not repaired or fabricated values.

All import/update/manual/edit/delete QA mutations used temporary databases or the isolated copy on port 5174. No disposable student records were added to the live database.

## Issues fixed — 12 groups

1. Updated yauzl 3.2.0 to 3.4.0, resolving its security advisory and Puppeteer's peer requirement.
2. Updated ExcelJS's transitive uuid to compatible 11.1.1 through package-manager overrides. ExcelJS only uses v4, but the vulnerable package version is no longer installed.
3. Rejected null, array and primitive JSON request bodies before handlers could expose internal TypeError messages.
4. Rejected malformed Unicode and dot-only registration identifiers that could be saved but could not reliably round-trip through record URLs.
5. Replaced raw malformed-URI errors with a clear invalid-address message.
6. Added readable network/non-JSON response errors instead of raw fetch/parser exceptions.
7. Locked manual form inputs and Reset while saving, preventing newer operator input from being silently cleared when an earlier save completed.
8. Locked record inputs, save/delete and modal close while a mutation is pending; ignored superseded record-open responses.
9. Ignored stale failed student/record-list requests so an older error cannot replace a newer successful result.
10. Cleared the issue-status loading message and disabled issuance when its lookup fails.
11. Removed obsolete placeholder page code and obsolete dashboard wording; certificate-count failures now display an unavailable message.
12. Added frame protection and no-referrer headers to reduce clickjacking and unintended referrer disclosure.

Focused regression tests initially failed for malformed JSON, invalid identifiers/text and malformed-URL messaging (three child failures plus their parent group). They passed after fixes. No failures are hidden from the final result.

## Browser checks performed

- Valid Excel upload, preview, empty-row detection, two-student import and success state.
- Existing-record rejection, conscious Update Existing Records selection and successful update.
- Manual creation containing literal HTML-like text; text stayed escaped.
- Student partial search, record open, edit cancellation, save, delete cancellation, confirmed deletion of a disposable record, and no-result search after refresh.
- First certificate issuance for a disposable student, Not Issued/Issued transition, saved number 000010 in the isolated copy, refresh persistence and Print button invocation.
- Certificate Records search and PDF action completed; the UI reported download initiation/completion.
- Direct hash routes and all five sections; mobile menu opening, section navigation and automatic closing.
- Real certificate preview after the live restart retained 000003 and 13/09/2026.
- Dashboard, forms and certificate preview inspected after styling changes; 15 responsive checks passed.
- Final normal browser smoke console: no errors or warnings.

One extended browser automation call timed out. It was not counted as passed; the automation session was reset and shorter smoke checks recovered successfully. An intentionally stopped isolated server produced a network error used to verify friendly failure handling; this is separate from the clean normal smoke run.

## Automated coverage

Template download/headers/empty template/instructions; valid and partial imports; blank rows; missing values/columns; duplicate headers/registrations; explicit updates; stale/replayed previews; invalid extension; zero-byte/tiny/corrupt and oversized files; row limits; formula rejection and hyperlink-label handling; manual CRUD; stale edits/deletes; escaped text; SQL wildcard/special-character search; pagination and 2,500-record import; cross-origin rejection; private-file/path-traversal rejection; persistent/sequential certificates; concurrent issuance; current-record rendering; restart/migration; PDF failure/retry and missing student protection; UI asynchronous save/search regressions; screen-only, reduced-motion-aware polish.

The full test suite uses isolated storage. New test directories are removed after tests complete. The isolated QA server was stopped and its database copy, workbooks, temporary PDF/PNG outputs and scripts were removed after verification.

## Print/PDF limits and manual checks

- **Manual verification required.** Native browser print-preview dialog, physical printer output/driver margins, and the final downloaded-file save destination were not exposed reliably by the in-app browser tooling. The Print button was invoked, print CSS reviewed, and the Chromium PDF bytes/page size/content/filename were verified.
- The browser's download event did not provide reliable confirmation. Successful API output and UI response are not claimed as proof of the operating system's saved-file location.
- The original watermark is low resolution and remains unchanged by request.
- Extremely long content is rejected rather than clipped to force a one-page document.
- Actual crafted macro archives and cross-browser Firefox/Safari print behavior were not separately exercised; macro rejection code was reviewed, and formulas/invalid archives were tested.

## Performance observations

On this machine after restart: exact student lookup 76ms; name search 6ms; last database page 17ms; certificate-record search 3ms; certificate retrieval 18ms. Six real-record PDFs took approximately 2.1–3.2 seconds each; post-restart PDF checks took 2.33 and 5.07 seconds in two runs. These are local observations, not load-test guarantees. Lists return 50 rows per page; targeted certificate lookups do not load all students.

## Requested visual polish

Green/neutral office theme retained with clearer typography, softer backgrounds, improved card borders/shadows, more readable feedback and tables, refined buttons, and improved tablet certificate controls. Short page-entry, hover and modal animations respect reduced-motion preferences. All polish rules are scoped to screen media; the certificate format and PDF template were not redesigned.

## Changed files

- server.mjs
- public/index.html
- public/css/ui-polish.css (new)
- public/js/app.js
- public/js/student-schema.js
- public/js/student-ui.js
- public/js/certificate-ui.js
- public/js/certificate-records-ui.js
- package.json
- pnpm-lock.yaml
- pnpm-workspace.yaml
- tests/qa-regressions.test.mjs (new)
- tests/ui-regressions.test.mjs (new)
- tests/student-system.test.mjs (temporary-directory cleanup)
- tests/certificate.test.mjs (temporary-directory cleanup)
- README.md
- QA-REPORT.md

## Hosting status

The local application runs at http://localhost:5173. It was not deployed. Uploading public/index.html alone to Netlify does not deploy this project's Node HTTP server, persistent SQLite storage or Chromium PDF renderer. Netlify runs functions in an ephemeral runtime; a complete Netlify deployment needs a deliberate backend/database deployment plan. No student data was uploaded to an external host.

Sources checked: [yauzl advisory](https://github.com/advisories/GHSA-gmq8-994r-jv83), [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [Netlify Functions](https://docs.netlify.com/build/functions/overview/).

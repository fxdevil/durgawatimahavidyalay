import { secureFetch } from './auth-client.js';
import { fields } from './student-schema.js';
import { icon } from './icons.js';
import * as db from './client-db.js';
import { parseExcelFile, commitImport } from './excel-client.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export async function api(url, options = {}) {
  const isBrowser = typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
  if (isBrowser && !window.__USE_SERVER_API__) {
    const u = new URL(url, location.href || 'http://localhost');
    const pathname = u.pathname;
    const method = options.method || 'GET';

    if (pathname === '/api/students' && method === 'GET') {
      const registration = u.searchParams.get('registration') || '';
      const name = u.searchParams.get('name') || '';
      const page = Number(u.searchParams.get('page')) || 1;
      return await db.listStudents({ registration, name, page });
    }
    if (pathname === '/api/students' && method === 'POST') {
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
      return await db.saveStudent(body, false);
    }
    if (pathname.startsWith('/api/students/')) {
      const id = decodeURIComponent(pathname.slice('/api/students/'.length));
      if (method === 'GET') {
        const student = await db.getStudent(id);
        if (!student) throw new Error('Student record was not found.');
        return { student };
      }
      if (method === 'PUT') {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
        return await db.saveStudent(body, true);
      }
      if (method === 'DELETE') {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
        return await db.deleteStudent(id, body.version);
      }
    }

    if (pathname === '/api/certificates' && method === 'GET') {
      const search = u.searchParams.get('search') || '';
      const page = Number(u.searchParams.get('page')) || 1;
      return await db.listCertificates({ search, page });
    }
    if (pathname === '/api/certificates/status' && method === 'GET') {
      const reg = u.searchParams.get('registration') || '';
      const certificate = await db.getCertificateByRegistration(reg);
      return { certificate };
    }
    if (pathname === '/api/certificates/preview' && method === 'POST') {
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body || {};
      return await db.issueCertificate(body.registrationNumber);
    }
    if (pathname.match(/^\/api\/certificates\/(\d+)$/) && method === 'GET') {
      const num = Number(pathname.split('/').pop());
      const certificate = await db.getCertificate(num);
      if (!certificate) throw new Error('Certificate preview was not found.');
      return { certificate };
    }
  }

  let response, result;
  try { response = await secureFetch(url, { cache: 'no-store', ...options }); }
  catch { throw new Error('Cannot reach the server. Check the connection and try again.'); }
  try { result = await response.json(); }
  catch { throw new Error('The server returned an unreadable response. Please try again.'); }
  if (!response.ok) throw new Error(result.error || 'The request failed. Please try again.');
  return result;
}

const send = (url, data, method = 'POST') => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

const heading = (title, text) => `<section class="page-heading"><div><div class="eyebrow">STUDENT ADMINISTRATION</div><h1>${title}</h1><p>${text}</p></div><a class="button outline" href="#${title === 'Student Database' ? 'add-data' : 'students'}">${title === 'Student Database' ? 'Add Student Data' : 'View Student Database'} ${icon('arrow')}</a></section>`;

function inputs(student = {}, readonly = false) {
  return fields.map(([key, label]) => `<label class="field"><span>${escapeHtml(label)}${['registrationNumber', 'studentName'].includes(key) ? ' <span aria-hidden="true">*</span>' : ''}</span><input name="${key}" value="${escapeHtml(student[key])}" maxlength="300" ${['registrationNumber', 'studentName'].includes(key) ? 'required' : ''} ${readonly ? 'readonly' : ''} ${key === 'dateOfBirth' ? 'placeholder="yyyy-mm-dd"' : ''}></label>`).join('');
}

function message(element, text, error = false) {
  element.textContent = text;
  element.className = `feedback ${error ? 'error' : 'success'}`;
  element.hidden = !text;
}

const table = (headers, rows) => `<div class="table-scroll" tabindex="0" role="region" aria-label="${escapeHtml(headers.join(', '))}"><table><thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;

export function mountAddStudents(main) {
  main.innerHTML = heading('Add Student Data', 'Import an Excel workbook or add one verified student record.') + `
    <section class="panel student-panel" aria-labelledby="bulk-title">
      <div class="section-title"><div><span class="eyebrow">METHOD A · BULK IMPORT</span><h2 id="bulk-title">Add students from Excel</h2></div><a class="button primary" href="./templates/student-template.xlsx" download="student-template.xlsx">${icon('upload')} Download Excel Template</a></div>
      <p class="section-description">Download template → Fill Excel → Upload → Validate → Import</p>
      <p class="help-text">Use the exact column names and one student per row. Registration Number and Student Name are required. Only .xlsx files, up to 5 MB and 10,000 rows.</p>
      <div class="upload-box"><label class="field" for="excel-file">Choose Excel File<input id="excel-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label><button id="validate-file" class="button outline" disabled>Upload / Validate</button></div>
      <div id="file-status" class="file-status" role="status">No file selected.</div>
      <label class="update-option"><input type="checkbox" id="update-existing" disabled><span><strong>Update Existing Records</strong><small>Off by default. When selected, matching records are replaced with all ten uploaded fields, including blank optional fields. Registration matching ignores letter case and surrounding spaces.</small></span></label>
      <div id="import-feedback" class="feedback" role="status" hidden></div>
      <div id="import-preview"></div>
    </section>
    <section class="panel student-panel" aria-labelledby="manual-title"><div class="section-title"><div><span class="eyebrow">METHOD B · MANUAL ADD</span><h2 id="manual-title">Add one student</h2></div></div><p class="help-text">Fields marked * are required. Enter the registration number exactly as recorded by the college.</p><form id="manual-form"><div class="student-form-grid">${inputs()}</div><div class="form-actions"><button class="button primary" type="submit">Add Student ${icon('plus')}</button><button class="button outline" type="reset">Clear form</button></div><div class="feedback" role="status" hidden></div></form></section>`;

  const fileInput = main.querySelector('#excel-file');
  const validateButton = main.querySelector('#validate-file');
  const update = main.querySelector('#update-existing');
  const status = main.querySelector('#file-status');
  const feedback = main.querySelector('#import-feedback');
  const preview = main.querySelector('#import-preview');
  let plan;
  let busy = false;
  let sequence = 0;

  function setBusy(value) {
    busy = value;
    fileInput.disabled = value;
    validateButton.disabled = value || !fileInput.files.length;
    update.disabled = value || !plan;
    const button = preview.querySelector('#import-students');
    if (button) button.disabled = value || !plan?.validRecords;
  }

  function showPlan() {
    status.textContent = `${fileInput.files[0].name} · ${plan.detectedRows} detected rows · Sheet: ${plan.sheet} · ${plan.errorCount ? 'Validated with errors' : plan.detectedRows ? 'Validation passed' : 'No student rows found'}`;
    preview.innerHTML = `<div class="import-counts">${[['Valid Records', plan.validRecords], ['New Records', plan.newRecords], ['Records to Update', plan.recordsToUpdate], ['Errors', plan.errorCount]].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
      ${plan.errorCount ? `<details class="error-details" open><summary>${plan.errorCount} rows will not be imported</summary>${table(['Row', 'Registration Number', 'Exact reason'], plan.errors.map(error => `<tr><td>${error.row}</td><td>${escapeHtml(error.registrationNumber) || '—'}</td><td>${error.reasons.map(escapeHtml).join('<br>')}</td></tr>`).join(''))}</details>` : ''}
      ${plan.preview.length ? `<h3 class="preview-title">Records ready to import</h3><p class="help-text">Showing ${plan.preview.length} of ${plan.validRecords} valid records. Use the horizontal scroll to review all fields.</p>${table(['Row', 'Action', ...fields.map(([, label]) => label)], plan.preview.map(item => `<tr><td>${item.row}</td><td><span class="badge ${item.action === 'new' ? 'neutral' : ''}">${item.action === 'new' ? 'New' : 'Update'}</span></td>${fields.map(([key]) => `<td>${escapeHtml(item.student[key]) || '—'}</td>`).join('')}</tr>`).join(''))}` : '<p class="help-text">There are no valid records to import. Correct the errors in Excel, save, and select the file again.</p>'}
      <div class="form-actions"><button class="button primary" id="import-students" ${plan.validRecords ? '' : 'disabled'}>Import Students</button><span class="help-text">Only valid records will be saved. ${plan.errorCount} rows will be skipped.</span></div>`;

    preview.querySelector('#import-students').addEventListener('click', async () => {
      if (busy || !plan.validRecords) return;
      setBusy(true);
      try {
        let result;
        if (typeof window !== 'undefined' && window.ExcelJS && plan.valid) {
          result = await commitImport(plan.valid);
        } else {
          result = await send(`/api/imports/${plan.token}/commit`, { updateExisting: update.checked });
        }
        message(feedback, `Import complete. Added ${result.added}, updated ${result.updated || 0}. Total students: ${result.total}.`);
        const rejectedRows = preview.querySelector('.error-details');
        preview.innerHTML = '<a class="button outline" href="#students">Open Student Database</a>';
        if (rejectedRows) {
          rejectedRows.querySelector('summary').textContent = `${result.skipped || (plan.detectedRows - result.added - (result.updated || 0))} rows were not imported — correct these in Excel`;
          preview.prepend(rejectedRows);
        }
        plan = null;
        fileInput.value = '';
        status.textContent = 'Import finished. Choose another file to start a new import.';
        update.checked = false;
      } catch (error) {
        message(feedback, error.message, true);
        plan = null;
        preview.innerHTML = '';
        status.textContent = 'Import was not completed. Click Upload / Validate to review the file again.';
      } finally { setBusy(false); }
    });
  }

  async function validate() {
    const file = fileInput.files[0];
    if (!file || busy) return;
    const current = ++sequence;
    plan = null;
    update.checked = false;
    preview.innerHTML = '';
    message(feedback, '');
    if (!/\.xlsx$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
      status.textContent = `${file.name} · Validation failed · Detected rows: unavailable`;
      message(feedback, 'Choose an .xlsx file no larger than 5 MB.', true);
      setBusy(false);
      return;
    }
    status.textContent = `${file.name} · Uploading and validating…`;
    setBusy(true);
    try {
      if (typeof window !== 'undefined' && window.ExcelJS) {
        const result = await parseExcelFile(file, update.checked);
        if (current !== sequence || !main.contains(status)) return;
        plan = result;
        showPlan();
      } else {
        const result = await api('/api/imports', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
        if (current !== sequence || !main.contains(status)) return;
        plan = result;
        showPlan();
      }
    } catch (error) {
      status.textContent = `${file.name} · Validation failed · Detected rows: unavailable`;
      message(feedback, error.message, true);
    } finally { setBusy(false); }
  }

  fileInput.addEventListener('change', validate);
  validateButton.addEventListener('click', validate);
  update.addEventListener('change', async () => {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const file = fileInput.files[0];
      if (typeof window !== 'undefined' && window.ExcelJS && file) {
        plan = await parseExcelFile(file, update.checked);
        showPlan();
      } else {
        plan = await send(`/api/imports/${plan.token}/preview`, { updateExisting: update.checked });
        showPlan();
      }
    } catch (error) {
      plan = null;
      preview.innerHTML = '';
      message(feedback, error.message, true);
    } finally { setBusy(false); }
  });

  const form = main.querySelector('#manual-form');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    const data = Object.fromEntries(new FormData(form));
    [...form.elements].forEach(element => { element.disabled = true; });
    message(form.querySelector('.feedback'), 'Saving student…');
    try {
      await send('/api/students', data);
      form.reset();
      message(form.querySelector('.feedback'), 'Student added successfully. The record is now available in Student Database.');
    } catch (error) { message(form.querySelector('.feedback'), error.message, true); }
    finally { [...form.elements].forEach(element => { element.disabled = false; }); }
  });
  form.addEventListener('reset', () => message(form.querySelector('.feedback'), ''));
}

export function mountDatabase(main) {
  main.innerHTML = heading('Student Database', 'Find, review, and maintain authorized student records.') + `
    <section class="panel student-panel"><div class="section-title"><h2>Student records</h2><button type="button" class="button outline" id="export-backup-btn" style="margin-left:auto;font-size:11px;">${icon('upload')} Backup Database (JSON)</button><span class="badge neutral" id="total-count">Loading…</span></div><form id="student-search" class="search-form"><label class="field">Search by Registration Number<input name="registration" maxlength="300" type="search"></label><label class="field">Search by Student Name<input name="name" maxlength="300" type="search"></label><button class="button primary" type="submit">Search</button><button class="button outline" type="reset">Clear</button></form><div id="database-feedback" class="feedback" role="status" hidden></div><div id="student-results" aria-live="polite">Loading student records…</div></section>
    <dialog id="student-dialog" aria-labelledby="record-title"><div class="dialog-heading"><h2 id="record-title">Student record</h2><button class="icon-button" id="close-record" aria-label="Close student record">${icon('close')}</button></div><form id="record-form"><p class="help-text">Registration Number is the unique identifier. All other fields can be edited.</p><div class="student-form-grid"></div><div class="feedback" role="status" hidden></div><div class="form-actions"><button type="button" class="button primary" id="edit-record">Edit Record</button><button type="submit" class="button primary" id="save-record" hidden>Save Changes</button><button type="button" class="button outline danger" id="delete-record">Delete Record</button></div><div id="delete-confirmation" class="feedback error" hidden><p></p><div class="form-actions"><button type="button" class="button outline" id="cancel-delete">Cancel</button><button type="button" class="button primary" id="confirm-delete">Confirm Delete</button></div></div></form></dialog>`;

  const results = main.querySelector('#student-results');
  const feedback = main.querySelector('#database-feedback');
  const search = main.querySelector('#student-search');
  const dialog = main.querySelector('#student-dialog');
  const recordForm = main.querySelector('#record-form');
  const backupBtn = main.querySelector('#export-backup-btn');

  if (backupBtn) {
    backupBtn.addEventListener('click', async () => {
      try {
        await db.exportDatabaseBackup();
      } catch (err) {
        alert('Could not export backup: ' + err.message);
      }
    });
  }

  let page = 1;
  let generation = 0;
  let student;
  let recordBusy = false;
  let opening = 0;
  let query = { registration: '', name: '' };

  async function load() {
    const current = ++generation;
    results.textContent = 'Loading student records…';
    try {
      const result = await api(`/api/students?${new URLSearchParams({ ...query, page })}`);
      if (current !== generation || !main.contains(results)) return;
      page = result.page;
      main.querySelector('#total-count').textContent = `Total students: ${result.total}`;
      results.innerHTML = `<p class="help-text result-count">${result.matched} matching students</p>${result.students.length ? table(['Registration Number', 'Student Name', 'Programme / MJC', 'Semester', 'Session', 'Record'], result.students.map(item => `<tr><td>${escapeHtml(item.registrationNumber)}</td><td>${escapeHtml(item.studentName)}</td><td>${escapeHtml(item.programme) || '—'}</td><td>${escapeHtml(item.semester) || '—'}</td><td>${escapeHtml(item.session) || '—'}</td><td><button class="button outline view-record" data-id="${escapeHtml(item.id)}">View / Edit</button></td></tr>`).join('')) : '<div class="empty-state"><h3>No students found</h3><p>Try another search or add authorized student data.</p></div>'}<div class="pagination"><button class="button outline" id="previous-page" ${page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${page} of ${result.pages} · 50 per page</span><button class="button outline" id="next-page" ${page >= result.pages ? 'disabled' : ''}>Next</button></div>`;
      results.querySelector('#previous-page').addEventListener('click', () => { page--; load(); });
      results.querySelector('#next-page').addEventListener('click', () => { page++; load(); });
      results.querySelectorAll('.view-record').forEach(button => button.addEventListener('click', () => openRecord(button.dataset.id)));
    } catch (error) {
      if (current !== generation || !main.contains(results)) return;
      results.textContent = '';
      message(feedback, error.message, true);
    }
  }

  search.addEventListener('submit', event => {
    event.preventDefault();
    query = Object.fromEntries(new FormData(search));
    page = 1;
    message(feedback, '');
    load();
  });

  search.addEventListener('reset', () => {
    query = { registration: '', name: '' };
    page = 1;
    message(feedback, '');
    load();
  });

  async function openRecord(id) {
    if (recordBusy) return;
    const current = ++opening;
    try {
      const result = await api(`/api/students/${encodeURIComponent(id)}`);
      if (current !== opening || !main.contains(dialog)) return;
      student = result.student;
      recordForm.querySelector('.student-form-grid').innerHTML = inputs(student, true);
      recordForm.querySelector('#edit-record').hidden = false;
      recordForm.querySelector('#save-record').hidden = true;
      recordForm.querySelector('#delete-confirmation').hidden = true;
      message(recordForm.querySelector('.feedback'), '');
      dialog.showModal();
    } catch (error) {
      if (current === opening && main.contains(dialog)) message(feedback, error.message, true);
    }
  }

  const closeRecord = main.querySelector('#close-record');
  function setRecordBusy(value) {
    recordBusy = value;
    closeRecord.disabled = value;
    [...recordForm.elements].forEach(element => { element.disabled = value; });
  }

  dialog.addEventListener('cancel', event => { if (recordBusy) event.preventDefault(); });
  closeRecord.addEventListener('click', () => { if (!recordBusy) dialog.close(); });
  recordForm.querySelector('#edit-record').addEventListener('click', () => {
    recordForm.querySelectorAll('input').forEach(input => { input.readOnly = input.name === 'registrationNumber'; });
    recordForm.querySelector('#edit-record').hidden = true;
    recordForm.querySelector('#save-record').hidden = false;
    recordForm.elements.studentName.focus();
  });

  recordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const button = recordForm.querySelector('#save-record');
    if (button.hidden || recordBusy) return;
    const data = { ...Object.fromEntries(new FormData(recordForm)), version: student.version };
    setRecordBusy(true);
    try {
      await send(`/api/students/${encodeURIComponent(student.id)}`, data, 'PUT');
      dialog.close();
      message(feedback, 'Student record updated successfully.');
      load();
    } catch (error) {
      message(recordForm.querySelector('.feedback'), error.message, true);
    } finally {
      setRecordBusy(false);
    }
  });

  recordForm.querySelector('#delete-record').addEventListener('click', () => {
    const confirmation = recordForm.querySelector('#delete-confirmation');
    confirmation.querySelector('p').textContent = `Delete the record for ${student.studentName} (${student.registrationNumber})? This cannot be undone.`;
    confirmation.hidden = false;
    recordForm.querySelector('#cancel-delete').focus();
  });

  recordForm.querySelector('#cancel-delete').addEventListener('click', () => {
    recordForm.querySelector('#delete-confirmation').hidden = true;
    recordForm.querySelector('#delete-record').focus();
  });

  recordForm.querySelector('#confirm-delete').addEventListener('click', async () => {
    if (recordBusy) return;
    setRecordBusy(true);
    try {
      await send(`/api/students/${encodeURIComponent(student.id)}`, { version: student.version }, 'DELETE');
      dialog.close();
      message(feedback, 'Student record deleted.');
      load();
    } catch (error) {
      message(recordForm.querySelector('.feedback'), error.message, true);
    } finally {
      setRecordBusy(false);
    }
  });

  load();
}

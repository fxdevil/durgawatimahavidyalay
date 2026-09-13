import { authenticatedClient } from './auth-helper.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { createApplication } from '../server.mjs';
import { createStore } from '../lib/store.mjs';
import { fields } from '../public/js/student-schema.js';

// Synthetic fixtures are confined to temporary test databases. Never seed the application.
test('student import and record management', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'bonafide-tests-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const databasePath = path.join(folder, 'test.sqlite');
  const { server, store } = createApplication({ databasePath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
 const fetch = await authenticatedClient(base, store);
  const request = async (url, data, method = 'POST') => {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, ...await response.json() };
  };
  const fixture = (id, name = 'TEST ONLY Student') => ({ registrationNumber: id, studentName: name, fatherName: 'TEST ONLY Parent', dateOfBirth: '2000-01-02', programme: 'TEST ONLY' });
  const workbook = async rows => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Students');
    sheet.addRow(fields.map(([, label]) => label));
    rows.forEach(row => sheet.addRow(row === null ? [] : fields.map(([key]) => row[key] ?? '')));
    return book.xlsx.writeBuffer();
  };
  const upload = async buffer => {
    const response = await fetch(base + '/api/imports', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'test.xlsx' }, body: buffer });
    return { status: response.status, ...await response.json() };
  };
  try {
    await t.test('template is downloadable, empty, formatted, and contains instructions', async () => {
      const response = await fetch(base + '/templates/student-template.xlsx');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-disposition'), /attachment/);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await response.arrayBuffer());
      assert.deepEqual(book.getWorksheet('Students').getRow(1).values.slice(1), fields.map(([, label]) => label));
      let populated = 0;
      book.getWorksheet('Students').eachRow(row => { if (row.number > 1 && row.hasValues) populated++; });
      assert.equal(populated, 0);
      assert.equal(book.getWorksheet('Students').getCell('B2').numFmt, '@');
      assert.ok(book.getWorksheet('Instructions').getCell('A6').text.includes('STUDENT NAME'));
    });
    await t.test('valid workbook preview, blank rows, dates, leading zeroes, import and replay protection', async () => {
      const preview = await upload(await workbook([fixture('000123'), null, { ...fixture('TEST-2'), dateOfBirth: new Date('2000-01-02T00:00:00Z') }]));
      assert.equal(preview.status, 200);
      assert.equal(preview.detectedRows, 2);
      assert.equal(preview.validRecords, 2);
      assert.equal(preview.preview[1].student.dateOfBirth, '2000-01-02');
      const result = await request(`/api/imports/${preview.token}/commit`, { updateExisting: false });
      assert.equal(result.added, 2);
      assert.equal((await request(`/api/imports/${preview.token}/commit`, { updateExisting: false })).status, 410);
    });
    await t.test('duplicate registrations exclude every occurrence, with original row numbers', async () => {
      const preview = await upload(await workbook([fixture('DUP'), null, fixture(' dup ')]));
      assert.equal(preview.validRecords, 0);
      assert.deepEqual(preview.errors.map(error => error.row), [2, 4]);
      assert.match(preview.errors[0].reasons.join(' '), /duplicated/);
    });
    await t.test('missing required values and formula cells are excluded; only valid rows import', async () => {
      const preview = await upload(await workbook([{ studentName: 'TEST ONLY' }, { registrationNumber: 'MISSING' }, { ...fixture('FORMULA'), studentName: { formula: '"Unsafe"', result: 'Unsafe' } }, fixture('VALID-ONLY')]));
      assert.equal(preview.errorCount, 3);
      assert.equal(preview.validRecords, 1);
      assert.match(preview.errors[0].reasons.join(' '), /Registration Number is missing/);
      assert.match(preview.errors[1].reasons.join(' '), /Student Name is missing/);
      assert.match(preview.errors[2].reasons.join(' '), /Formulas are not accepted/);
      assert.equal((await request(`/api/imports/${preview.token}/commit`, { updateExisting: false })).added, 1);
    });
    await t.test('existing records are protected until an explicit update preview', async () => {
      let preview = await upload(await workbook([fixture('000123', 'TEST ONLY Updated')]));
      assert.equal(preview.validRecords, 0);
      assert.equal((await request(`/api/imports/${preview.token}/commit`, { updateExisting: true })).status, 409);
      preview = await request(`/api/imports/${preview.token}/preview`, { updateExisting: true });
      assert.equal(preview.recordsToUpdate, 1);
      assert.equal((await request(`/api/imports/${preview.token}/commit`, { updateExisting: true })).updated, 1);
      assert.equal((await request('/api/students/000123', undefined, 'GET')).student.studentName, 'TEST ONLY Updated');
    });
    await t.test('manual add, duplicate prevention, safe literal values, and search', async () => {
      assert.equal((await request('/api/students', fixture('MANUAL', '<img src=x onerror=alert(1)> TEST ONLY'))).status, 201);
      assert.equal((await request('/api/students', fixture(' manual '))).status, 409);
      assert.equal((await request('/api/students', { studentName: 'TEST ONLY' })).status, 400);
      const byId = await request('/api/students?registration=man', undefined, 'GET');
      assert.equal(byId.matched, 1);
      assert.match(byId.students[0].studentName, /<img/);
      assert.equal((await request('/api/students?name=Updated', undefined, 'GET')).matched, 1);
      assert.equal((await request('/api/students?name=%25', undefined, 'GET')).matched, 0);
    });
    await t.test('record edit, identifier protection, stale edits, and delete', async () => {
      const { student } = await request('/api/students/MANUAL', undefined, 'GET');
      assert.equal((await request('/api/students/MANUAL', { ...student, registrationNumber: 'OTHER' }, 'PUT')).status, 400);
      const edited = await request('/api/students/MANUAL', { ...student, semester: 'TEST Semester' }, 'PUT');
      assert.equal(edited.student.semester, 'TEST Semester');
      assert.equal((await request('/api/students/MANUAL', student, 'PUT')).status, 409);
      assert.equal((await request('/api/students/MANUAL', { version: student.version }, 'DELETE')).status, 409);
      assert.equal((await request('/api/students/MANUAL', { version: edited.student.version }, 'DELETE')).status, 200);
      assert.equal((await request('/api/students/MANUAL', undefined, 'GET')).status, 404);
    });
    await t.test('changes after preview require revalidation', async () => {
      const preview = await upload(await workbook([fixture('STALE')]));
      await request('/api/students', fixture('CONCURRENT'));
      assert.equal((await request(`/api/imports/${preview.token}/commit`, { updateExisting: false })).status, 409);
    });
    await t.test('invalid workbook and missing columns fail clearly', async () => {
      assert.equal((await upload(Buffer.from('not an Excel file'))).status, 400);
      const book = new ExcelJS.Workbook();
      book.addWorksheet('Students').addRow(['Wrong header']);
      const result = await upload(await book.xlsx.writeBuffer());
      assert.equal(result.status, 400);
      assert.match(result.error, /Missing required columns/);
    });
    await t.test('cross-origin writes and private data paths are blocked', async () => {
      const response = await fetch(base + '/api/students', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify(fixture('CROSS')) });
      assert.equal(response.status, 403);
      assert.equal((await fetch(base + '/data/students.sqlite')).status, 404);
    });
    // Clear pending previews using a fresh isolated app for the volume check.
  } finally { await new Promise(resolve => server.close(resolve)); }
  const reopened = createStore(databasePath);
  assert.equal(reopened.get('000123').studentName, 'TEST ONLY Updated');
  reopened.close();
});

test('2,500 record workbook imports transactionally and paginates', async () => {
  const { server, store } = createApplication({ databasePath: ':memory:' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
 const fetch = await authenticatedClient(base, store);
  try {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Students');
    sheet.addRow(fields.map(([, label]) => label));
    for (let i = 0; i < 2500; i++) sheet.addRow([i + 1, `TEST-${String(i).padStart(5, '0')}`, 'TEST ONLY Volume']);
    const response = await fetch(base + '/api/imports', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'volume.xlsx' }, body: await book.xlsx.writeBuffer() });
    const preview = await response.json();
    assert.equal(preview.validRecords, 2500);
    const result = await fetch(`${base}/api/imports/${preview.token}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updateExisting: false }) });
    assert.equal((await result.json()).added, 2500);
    assert.equal(store.count(), 2500);
    const page = await (await fetch(base + '/api/students?page=50')).json();
    assert.equal(page.students.length, 50);
    assert.equal(page.pages, 50);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

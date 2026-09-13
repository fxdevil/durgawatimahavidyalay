import { authenticatedClient } from './auth-helper.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createApplication } from '../server.mjs';
import { normalizeStudent } from '../public/js/student-schema.js';
import { issueDate } from '../lib/certificates.mjs';
import { certificateTemplate, formatIssueDate } from '../public/js/certificate-template.js';

test('certificate previews are sequential, persistent, unique, and separate from students', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'bonafide-certificate-test-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'test.sqlite');
  let store = createStore(filename);
  const student = store.save(normalizeStudent({ registrationNumber: 'TEST-9000', studentName: 'TEST ONLY <script>unsafe</script>', fatherName: 'TEST Parent', dateOfBirth: '2001-02-03', category: 'TEST Category', programme: 'TEST Programme', semester: 'III', session: '2025-29', courseComplete: '2029' }).student);
  const input = { registrationNumber: student.id, studentVersion: student.version, requestKey: 'certificate-request-test-one' };
  const first = store.transaction(() => store.certificates.create(input));
  assert.equal(first.number, 1);
  assert.equal(first.issueDate, issueDate());
  assert.equal(store.transaction(() => store.certificates.create(input)).number, 1);
  assert.equal(store.transaction(() => store.certificates.create({ ...input, studentVersion: -1 })).number, 1);
  assert.throws(() => store.transaction(() => store.certificates.create({ ...input, registrationNumber: 'MISSING', requestKey: 'missing-request-0001' })), /No student/);
  store.save({ ...student, studentName: 'TEST Updated Name' }, true);
  assert.equal(store.certificates.get(1).student.studentName, 'TEST Updated Name');
  const next = store.transaction(() => store.certificates.create({ ...input, studentVersion: store.get(student.id).version, requestKey: 'certificate-request-test-two' }));
  assert.equal(next.number, 1);
  const html = certificateTemplate(first);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  for (const field of ['motherName', 'classRollNumber', 'academicYear']) assert.match(html, new RegExp(`cert-blank[^>]*data-certificate-field="${field}"[^>]*>&nbsp;`));
  assert.match(html, /data-certificate-field="dateOfAdmission"[^>]*>__ \/ __ \/____/);
  assert.ok(html.includes('BONAFIEDE CERTIFICATE'));
  assert.ok(html.includes('certificate-header.jpg'));
  for (const key of ['studentName', 'registrationNumber', 'fatherName', 'dateOfBirth', 'category', 'programme', 'semester', 'session', 'courseComplete']) assert.ok(html.includes(`data-certificate-field="${key}"`));
  assert.equal(formatIssueDate('2026-09-13'), '13/09/2026');
  store.close();
  store = createStore(filename);
  assert.equal(store.certificates.get(1).number, 1);
  assert.equal(store.count(), 1);
  store.close();
});

test('normal student search and preview API use stored records only', async () => {
  const { server, store } = createApplication({ databasePath: ':memory:' });
  const student = store.save(normalizeStudent({ registrationNumber: 'TEST-API', studentName: 'TEST ONLY API Student' }).student);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
 const fetch = await authenticatedClient(base, store);
  try {
    const found = await (await fetch(base + '/api/students/TEST-API')).json();
    assert.equal(found.student.studentName, student.studentName);
    const response = await fetch(base + '/api/certificates/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registrationNumber: student.id, studentVersion: found.student.version, studentName: 'INJECTED NAME', requestKey: 'api-certificate-test-001' }) });
    assert.equal(response.status, 201);
    const { certificate } = await response.json();
    assert.equal(certificate.student.studentName, student.studentName);
    const saved = await (await fetch(base + '/api/certificates/' + certificate.number)).json();
    assert.deepEqual(saved.certificate, certificate);
    assert.equal((await fetch(base + '/api/certificates/999999')).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('legacy migration preserves latest number/date, restart and next sequential issue', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const folder = await mkdtemp(path.join(tmpdir(), 'bonafide-migration-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const filename = path.join(folder, 'test.sqlite');
  let store = createStore(filename);
  const first = store.save(normalizeStudent({registrationNumber:'LEGACY',studentName:'TEST Legacy'}).student);
  store.close();
  const db=new DatabaseSync(filename);
  db.prepare('INSERT INTO certificate_previews (number, requestKey, issueDate, registrationNumber, studentSnapshot) VALUES (?,?,?,?,?)').run(1,'legacy-one','2026-01-01','LEGACY',JSON.stringify(first));
  db.prepare('INSERT INTO certificate_previews (number, requestKey, issueDate, registrationNumber, studentSnapshot) VALUES (?,?,?,?,?)').run(3,'legacy-three','2026-01-03','LEGACY',JSON.stringify(first));
  db.close();
  store=createStore(filename);
  assert.equal(store.certificates.list().total,1);
  assert.equal(store.certificates.find(' legacy ').number,3);
  assert.equal(store.certificates.find('LEGACY').issueDate,'2026-01-03');
  const second=store.save(normalizeStudent({registrationNumber:'NEXT',studentName:'TEST Next'}).student);
  assert.throws(()=>store.transaction(()=>store.certificates.create({registrationNumber:second.id,studentVersion:-1})),/changed/);
  assert.equal(store.transaction(()=>store.certificates.create({registrationNumber:second.id,studentVersion:second.version})).number,4);
  store.close();store=createStore(filename);
  assert.equal(store.certificates.list().total,2);
  assert.equal(store.transaction(()=>store.certificates.create({registrationNumber:'LEGACY'})).number,3);
  store.close();
});

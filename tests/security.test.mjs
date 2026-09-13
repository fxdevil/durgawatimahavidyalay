import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { createApplication } from '../server.mjs';
import { createStore } from '../lib/store.mjs';
import { createAuth, validatePassword } from '../lib/auth.mjs';
import { normalizeStudent, fields } from '../public/js/student-schema.js';
import { authenticatedClient, provision, testPassword } from './auth-helper.mjs';

async function app(t, options = {}) {
  const application = createApplication({ databasePath: ':memory:', ...options });
  await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
  t.after(() => { application.server.closeAllConnections?.(); return new Promise(resolve => application.server.close(resolve)); });
  return { ...application, base: `http://127.0.0.1:${application.server.address().port}` };
}
const jsonOptions = input => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });

test('all private routes deny anonymous requests; public login contains no student data', async t => {
  const { base, store } = await app(t);
  store.save(normalizeStudent({ registrationNumber: 'PRIVATE', studentName: 'PRIVATE STUDENT TEST' }).student);
  const routes = [['/api/students','GET'],['/api/students/PRIVATE','GET'],['/api/students','POST'],['/api/students/PRIVATE','PUT'],['/api/students/PRIVATE','DELETE'],['/api/imports','POST'],['/api/imports/token/preview','POST'],['/api/imports/token/commit','POST'],['/api/certificates','GET'],['/api/certificates/status','GET'],['/api/certificates/preview','POST'],['/api/certificates/1','GET'],['/api/certificates/1/pdf','GET'],['/api/auth/session','GET'],['/api/auth/logout','POST'],['/api/database','GET']];
  for (const [route, method] of routes) { const response = await fetch(base + route, { method }); assert.equal(response.status,401, route); assert.doesNotMatch(await response.text(), /PRIVATE STUDENT TEST/); }
  for (const route of ['/', '/index.html', '/dashboard', '/students', '/generate', '/records', '/templates/student-template.xlsx', '/js/app.js', '/css/certificate.css', '/data/students.sqlite', '/.env', '/server.mjs', '/backups/students.sqlite']) {
    const response = await fetch(base + route, { redirect: 'manual' }); assert.equal(response.status,303,route); assert.equal(response.headers.get('location'),'/login');
  }
  const page = await fetch(base + '/login'); assert.equal(page.status,200); assert.doesNotMatch(await page.text(), /PRIVATE STUDENT TEST|passwordHash/); assert.match(page.headers.get('cache-control'), /no-store/);
});

test('two operators, generic errors, CSRF, fixation, logout, protected files and audit', async t => {
  const { base, store } = await app(t);
  const nadim = await authenticatedClient(base,store), shivam = await authenticatedClient(base,store,'shivam.bharti');
  assert.equal(nadim.session.operator.displayName,'Nadim Khan'); assert.equal(shivam.session.operator.displayName,'Shivam Kumar Bharti');
  assert.equal(nadim.session.operator.role,shivam.session.operator.role); assert.doesNotMatch(JSON.stringify(nadim.session),/passwordHash|credentialVersion/);
  for (const username of ['nadim.khan', 'unknown', "' OR 1=1 --"]) {
    const response = await fetch(base+'/api/auth/login',jsonOptions({username,password:'wrong-password-value'})); assert.equal(response.status,401); assert.deepEqual(await response.json(),{error:'Invalid username or password.'});
  }
  for (const token of ['', 'x'.repeat(43), 'é'.repeat(43)]) {
    const response = await fetch(base+'/api/students',{...jsonOptions({}),headers:{'Content-Type':'application/json',Cookie:nadim.cookie,'X-CSRF-Token':token}}); assert.equal(response.status,403);
  }
  assert.equal((await fetch(base+'/api/students',{headers:{Cookie:'dm_session='+'a'.repeat(43)}})).status,401);
  assert.equal((await fetch(base+'/api/students',{headers:{Cookie:nadim.cookie+'; '+nadim.cookie}})).status,401);
  const login = await fetch(base+'/api/auth/login',{...jsonOptions({username:'nadim.khan',password:testPassword}),headers:{'Content-Type':'application/json',Cookie:nadim.cookie}});
  const setCookie=login.headers.get('set-cookie'); assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.match(setCookie,/Max-Age=28800/);assert.doesNotMatch(setCookie,/Domain=/);
  assert.notEqual(setCookie.split(';')[0],nadim.cookie);assert.equal((await nadim(base+'/api/students')).status,401);
  for(const route of ['/data/students.sqlite','/.env','/server.mjs','/lib/auth.mjs','/uploads/book.xlsx','/.tools/auth-check/baseline.sqlite','/%2e%2e%5cserver.mjs']) assert.equal((await shivam(base+route)).status,404,route);
  const added=await (await shivam(base+'/api/students',jsonOptions({registrationNumber:'AUDIT',studentName:'PRIVATE NAME'}))).json();
  const edited=await (await shivam(base+'/api/students/AUDIT',{...jsonOptions({...added.student,category:'X'}),method:'PUT'})).json();
  assert.equal((await shivam(base+'/api/students/AUDIT',{...jsonOptions({version:edited.student.version}),method:'DELETE'})).status,200);
  const out=await shivam(base+'/api/auth/logout',jsonOptions({}));assert.equal(out.status,200);assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await shivam(base+'/api/students')).status,401);assert.equal((await shivam(base+'/',{redirect:'manual'})).status,303);
  const audit=store.security.auditRecords();for(const action of ['login_success','logout','student_added','student_edited','student_deleted']) assert.ok(audit.some(row=>row.action===action));
  assert.doesNotMatch(JSON.stringify(audit),/PRIVATE NAME|passwordHash/);assert.ok(!JSON.stringify(audit).includes(testPassword));
  assert.match(store.security.get('nadim.khan').passwordHash,/^\$2[aby]\$12\$/);
});

test('rate limit is generic, blocks repeated failures and expires',async t=>{
  let now=0;const {base}=await app(t,{authOptions:{now:()=>now}});
  for(let i=0;i<11;i++){const response=await fetch(base+'/api/auth/login',jsonOptions({username:'unknown',password:'incorrect'}));assert.equal(response.status,i===10?429:401);assert.deepEqual(await response.json(),{error:'Invalid username or password.'});}
  now=15*60_000+1;assert.equal((await fetch(base+'/api/auth/login',jsonOptions({username:'unknown'}))).status,401);
});

test('idle and absolute expiry, password reset and role denial invalidate sessions',async t=>{
  let now=1000;const {base,store}=await app(t,{authOptions:{now:()=>now,idleMs:100,absoluteMs:250}});
  const first=await authenticatedClient(base,store);now+=90;assert.equal((await first(base+'/api/auth/session')).status,200);now+=11;assert.equal((await first(base+'/api/students')).status,401);
  const second=await authenticatedClient(base,store);for(let i=0;i<3;i++){now+=80;assert.equal((await second(base+'/api/students')).status,200);}now+=11;assert.equal((await second(base+'/api/students')).status,401);
  const third=await authenticatedClient(base,store);store.security.setPassword('nadim.khan',store.security.get('nadim.khan').passwordHash,true);assert.equal((await third(base+'/api/students')).status,401);
  const realGet=store.security.get;const fourth=await authenticatedClient(base,store);store.security.get=name=>({...realGet(name),role:'unapproved'});assert.equal((await fourth(base+'/api/students')).status,401);
});

test('production origin required and secure cookie attributes enforced',async t=>{
  assert.throws(()=>createApplication({databasePath:':memory:',production:true}),/HTTPS/);
  assert.throws(()=>createApplication({databasePath:':memory:',production:true,appOrigin:'http://example.org'}),/HTTPS/);
  const {base,store}=await app(t,{production:true,appOrigin:'https://office.example.org'});await provision(store);
  assert.equal((await fetch(base+'/login')).status,403);
  const http = await import('node:http');
  const response = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/auth/login', {
      method: 'POST',
      headers: {
        Host: 'office.example.org',
        Origin: 'https://office.example.org',
        'Content-Type': 'application/json'
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: { get: name => name.toLowerCase() === 'set-cookie' ? res.headers['set-cookie']?.[0] : res.headers[name.toLowerCase()] },
        text: async () => Buffer.concat(chunks).toString()
      }));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ username: 'nadim.khan', password: testPassword }));
    req.end();
  });
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/^__Host-dm_session=.*; Secure$/);
});

test('import plans belong to a session; audit issuance only once and refuse PDF after logout',async t=>{
  let finish, started;const ready=new Promise(resolve=>started=resolve);
  const {base,store}=await app(t,{pdfRenderer:()=>{started();return new Promise(resolve=>finish=resolve);}});
  const first=await authenticatedClient(base,store),second=await authenticatedClient(base,store,'shivam.bharti');
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Students');sheet.addRow(fields.map(([,label])=>label));sheet.addRow(['1','IMPORT-SEC','TEST ONLY']);
  const preview=await (await first(base+'/api/imports',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':'test.xlsx'},body:await book.xlsx.writeBuffer()})).json();
  assert.equal((await second(base+`/api/imports/${preview.token}/commit`,jsonOptions({updateExisting:false}))).status,410);
  assert.equal((await first(base+`/api/imports/${preview.token}/commit`,jsonOptions({updateExisting:false}))).status,200);
  const student=store.get('IMPORT-SEC');
  for(let i=0;i<2;i++) assert.equal((await first(base+'/api/certificates/preview',jsonOptions({registrationNumber:student.id,studentVersion:student.version}))).status,201);
  const pending=first(base+'/api/certificates/1/pdf');await ready;await first(base+'/api/auth/logout',jsonOptions({}));finish(Buffer.from('%PDF'));
  assert.equal((await pending).status,401);assert.equal(store.certificates.list().total,1);
  assert.equal(store.security.auditRecords().filter(row=>row.action==='certificate_issued').length,1);
  assert.ok(store.security.auditRecords().some(row=>row.action==='excel_import'));
  assert.ok(!store.security.auditRecords().some(row=>row.action==='certificate_pdf_generated'));
});

test('secure setup command, no plaintext on disk, and restart invalidates sessions',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'dm-auth-'));t.after(()=>rm(directory,{recursive:true,force:true}));const databasePath=path.join(directory,'students.sqlite');
  const setup=spawnSync(process.execPath,['scripts/setup-operators.mjs','--env'],{env:{...process.env,DATA_FILE:databasePath,NADIM_PASSWORD:testPassword,SHIVAM_PASSWORD:testPassword},encoding:'utf8'});
  assert.equal(setup.status,0,setup.stderr);assert.ok(!setup.stdout.includes(testPassword));
  const {base,store,server}=await app(t,{databasePath});const client=await authenticatedClient(base,store);const hash=store.security.get('nadim.khan').passwordHash;
  server.closeAllConnections?.();
  await new Promise(resolve=>server.close(resolve));
  assert.ok(!(await readFile(databasePath)).includes(Buffer.from(testPassword)));
  const restarted=await app(t,{databasePath});assert.equal((await client(restarted.base+'/api/students')).status,401);assert.equal(restarted.store.security.get('nadim.khan').passwordHash,hash);assert.ok(restarted.store.security.auditRecords().length);
  restarted.server.closeAllConnections?.();
  await new Promise(resolve=>restarted.server.close(resolve));
  const operator={username:'nadim.khan',displayName:'Nadim Khan'};
  for(const password of ['Nadim Khan','nadim.khan-password-123','x'.repeat(73)])assert.throws(()=>validatePassword(password,operator));
});

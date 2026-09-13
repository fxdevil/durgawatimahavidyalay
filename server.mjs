import { createAuth } from './lib/auth.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { renderCertificatePdf, pdfFilename } from './lib/certificate-pdf.mjs';
import { createStore } from './lib/store.mjs';
import { parseExcel, validateRows } from './lib/imports.mjs';
import { normalizeStudent, registrationKey } from './public/js/student-schema.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function createApplication({ databasePath = process.env.DATA_FILE || fileURLToPath(new URL('./data/students.sqlite', import.meta.url)), pdfRenderer = renderCertificatePdf, authOptions = {}, production = process.env.NODE_ENV === 'production', appOrigin = process.env.APP_ORIGIN } = {}) {
  if (production && (!appOrigin || new URL(appOrigin).protocol !== 'https:' || new URL(appOrigin).origin !== appOrigin)) throw new Error('Production requires APP_ORIGIN set to an HTTPS origin.');
  const store = createStore(databasePath);
  const auth = createAuth(store.security, { ...authOptions, secure: production });
  const imports = new Map();
  let parsing = false;
  function json(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
  }
  async function body(request, binary = false) {
    const maximum = binary ? 5 * 1024 * 1024 : 32 * 1024;
    if (Number(request.headers['content-length']) > maximum) throw fail('File or request is too large. Excel uploads must be at most 5 MB.', 413);
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maximum) throw fail('File or request is too large.', 413);
      chunks.push(chunk);
    }
    if (request.privateSession) auth.require(request);
    const buffer = Buffer.concat(chunks);
    if (binary) return buffer;
    let input;
    try { input = JSON.parse(buffer.toString()); } catch { throw fail('The submitted information could not be read.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Submit the information as a JSON object.');
    return input;
  }
  function preview(session) {
    const plan = validateRows(session.rows, store, session.updateExisting);
    session.revision = store.revision();
    return { ...plan, valid: undefined, preview: plan.valid.slice(0, 100), token: session.token, sheet: session.sheet, updateExisting: session.updateExisting };
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(request.url, 'http://localhost');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw fail('The requested address is invalid.'); }
      const method = request.method;
      const host = request.headers.host || '';
      if (production ? host !== new URL(appOrigin).host : !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) throw fail('Unrecognized request host.', 403);
      const publicPaths = new Set(['/login', '/login.html', '/css/login.css', '/js/login.js', '/images/college-logo.png', '/images/college-logo.jpg']);
      const login = pathname === '/api/auth/login' && method === 'POST';
      let operatorSession;
      if (!login && !publicPaths.has(pathname)) {
        operatorSession = auth.get(request, pathname !== '/api/auth/session');
        if (!operatorSession) {
          if (!pathname.startsWith('/api/') && ['GET', 'HEAD'].includes(method)) { response.writeHead(303, { Location: '/login' }); return response.end(); }
          throw fail('Your session has ended. Please log in again.', 401);
        }
        request.privateSession = true;
        if (pathname !== '/api/auth/session') auth.require(request, pathname.startsWith('/api/students') ? 'students' : pathname.startsWith('/api/imports') ? 'imports' : pathname.startsWith('/api/certificates') ? 'certificates' : 'workspace');
      }
      if (pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(method)) {
          if (request.headers.origin && request.headers.origin !== (production ? appOrigin : 'http://' + host)) throw fail('Cross-site requests are not allowed.', 403);
          if (request.headers['sec-fetch-site'] === 'cross-site') throw fail('Cross-site requests are not allowed.', 403);
          const expected = pathname === '/api/imports' ? 'application/octet-stream' : 'application/json';
          if (request.headers['content-type']?.split(';')[0].trim() !== expected) throw fail('Unsupported request type.', 415);
          if (!login) auth.csrf(request, operatorSession);
        }
        if (login) {
          const result = await auth.login(request, await body(request));
          response.setHeader('Set-Cookie', auth.cookie(result.token));
          return json(response, 200, { operator: result.operator, csrfToken: result.csrfToken, expiresAt: result.expiresAt });
        }
        if (pathname === '/api/auth/session' && method === 'GET') return json(response, 200, { operator: operatorSession.operator, csrfToken: operatorSession.csrf, expiresAt: operatorSession.expires });
        if (pathname === '/api/auth/logout' && method === 'POST') {
          auth.logout(request);
          for (const [token, plan] of imports) if (plan.owner === operatorSession.key) imports.delete(token);
          response.setHeader('Set-Cookie', auth.cookie('', true));
          return json(response, 200, { loggedOut: true });
        }
        const audit = (action, id = '') => store.security.audit(operatorSession.username, action, id);
        if (pathname === '/api/certificates/preview' && method === 'POST') {
          const input = await body(request);
          return json(response, 201, { certificate: store.transaction(() => { const existing = store.certificates.find(input.registrationNumber); const certificate = store.certificates.create(input); if (!existing) audit('certificate_issued', String(certificate.number)); return certificate; }) });
        }
        if (pathname === '/api/certificates' && method === 'GET') return json(response, 200, store.certificates.list(url.searchParams.get('search') || '', Number(url.searchParams.get('page')) || 1));
        if (pathname === '/api/certificates/status' && method === 'GET') {
          return json(response, 200, { certificate: store.certificates.find(url.searchParams.get('registration') || '') });
        }
        const pdfMatch = pathname.match(/^\/api\/certificates\/(\d+)\/pdf$/);
        if (pdfMatch && method === 'GET') {
          const certificate = store.certificates.get(Number(pdfMatch[1]));
          if (!certificate) throw fail('Certificate was not found.', 404);
          if (!certificate.student) throw fail('The student record is unavailable. Restore the authorized record before printing.', 409);
          let bytes;
          try { bytes = await pdfRenderer(certificate); } catch (error) { throw fail(error.status ? error.message : 'PDF could not be prepared. Please retry. Your certificate number and issue date are saved.', error.status || 503); }
          auth.require(request, 'certificates');
          audit('certificate_pdf_generated', String(certificate.number));
          response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${pdfFilename(certificate)}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          return response.end(bytes);
        }
        const certificateMatch = pathname.match(/^\/api\/certificates\/(\d+)$/);
        if (certificateMatch && method === 'GET') {
          const certificate = store.certificates.get(Number(certificateMatch[1]));
          if (!certificate) throw fail('Certificate preview was not found.', 404);
          return json(response, 200, { certificate });
        }
        if (pathname === '/api/students' && method === 'GET') return json(response, 200, store.list({ registration: url.searchParams.get('registration') || '', name: url.searchParams.get('name') || '', page: Math.floor(Number(url.searchParams.get('page'))) || 1 }));
        if (pathname === '/api/students' && method === 'POST') {
          const { student, errors } = normalizeStudent(await body(request));
          if (errors.length) throw fail(errors.join(' '));
          return json(response, 201, { student: store.transaction(() => { const saved = store.save(student); audit('student_added', saved.id); return saved; }) });
        }
        if (pathname.startsWith('/api/students/')) {
          const id = pathname.slice('/api/students/'.length);
          if (method === 'GET') {
            const student = store.get(id);
            if (!student) throw fail('Student record was not found.', 404);
            return json(response, 200, { student });
          }
          if (['PUT', 'DELETE'].includes(method)) {
            const input = await body(request);
            const result = store.transaction(() => {
              const existing = store.get(id);
              if (!existing) throw fail('Student record was not found.', 404);
              if (input.version !== existing.version) throw fail('This record changed since you opened it. Close and reopen it before saving or deleting.', 409);
              if (method === 'DELETE') { store.remove(id); audit('student_deleted', registrationKey(id)); return { deleted: true }; }
              const { student, errors } = normalizeStudent(input);
              if (errors.length) throw fail(errors.join(' '));
              if (registrationKey(student.registrationNumber) !== registrationKey(id)) throw fail('Registration Number is the record identifier and cannot be changed here.');
              const saved = store.save(student, true); audit('student_edited', saved.id); return { student: saved };
            });
            return json(response, 200, result);
          }
        }
        for (const [token, session] of imports) if (session.expires < Date.now()) imports.delete(token);
        if (pathname === '/api/imports' && method === 'POST') {
          if (parsing) throw fail('Another workbook is being checked. Please try again shortly.', 429);
          if (imports.size >= 10) throw fail('Too many pending imports. Wait a few minutes and try again.', 429);
          if (!(request.headers['x-file-name'] || '').toLowerCase().endsWith('.xlsx')) throw fail('Choose an .xlsx file.');
          parsing = true;
          try {
            const buffer = await body(request, true);
            if (!buffer.length) throw fail('The selected file is empty.');
            const parsed = await parseExcel(buffer);
            auth.require(request, 'imports');
            const token = randomUUID();
            const session = { ...parsed, token, owner: operatorSession.key, updateExisting: false, expires: Date.now() + 15 * 60 * 1000 };
            imports.set(token, session);
            return json(response, 200, preview(session));
          } finally { parsing = false; }
        }
        const match = pathname.match(/^\/api\/imports\/([a-z0-9-]+)\/(preview|commit)$/);
        if (match && method === 'POST') {
          const session = imports.get(match[1]);
          if (!session || session.owner !== operatorSession.key) throw fail('This import preview expired or was already imported. Select and validate the file again.', 410);
          const input = await body(request);
          if (match[2] === 'preview') {
            session.updateExisting = input.updateExisting === true;
            return json(response, 200, preview(session));
          }
          const result = store.transaction(() => {
            if (store.revision() !== session.revision) throw fail('Student records changed after validation. Validate again before importing.', 409);
            if (input.updateExisting !== session.updateExisting) throw fail('Update preference changed. Validate again before importing.', 409);
            const plan = validateRows(session.rows, store, session.updateExisting);
            if (!plan.validRecords) throw fail('No valid records are available to import.');
            for (const item of plan.valid) store.save(item.student, item.action === 'update');
            audit('excel_import', session.token);
            return { added: plan.newRecords, updated: plan.recordsToUpdate, skipped: plan.errorCount, total: store.count() };
          });
          imports.delete(session.token);
          return json(response, 200, result);
        }
        throw fail('This action is not available.', 404);
      }
      if (!['GET', 'HEAD'].includes(method)) throw fail('Method not allowed.', 405);
      const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname === '/login' ? '/login.html' : pathname));
      if (!target.startsWith(root) || !types[path.extname(target)]) throw fail('Not found.', 404);
      let content;
      try { content = await readFile(target); } catch { throw fail('Not found.', 404); }
      const headers = { 'Content-Type': types[path.extname(target)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' };
      if (path.extname(target) === '.xlsx') headers['Content-Disposition'] = 'attachment; filename="student-template.xlsx"';
      response.writeHead(200, headers);
      response.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      const status = error.status || (error.code ? 500 : 400);
      json(response, status, { error: status === 500 ? 'The record could not be saved or loaded. Please try again.' : error.message });
    }
  });
  server.requestTimeout = 30000;
  server.on('close', () => { imports.clear(); auth.close(); store.close(); });
  return { server, store };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApplication();
  server.listen(Number(process.env.PORT) || 5173, '127.0.0.1', () => console.log(`Dashboard available at http://localhost:${server.address().port}`));
}

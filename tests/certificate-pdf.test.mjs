import { authenticatedClient } from './auth-helper.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { createApplication } from '../server.mjs';
import { normalizeStudent } from '../public/js/student-schema.js';

test('repeat issuance, PDF, searches and renderer failure preserve identity and student data', async () => {
  let fail = false;
  const { renderCertificatePdf } = await import('../lib/certificate-pdf.mjs');
  const {server,store} = createApplication({databasePath: ':memory:', pdfRenderer: c => { if (fail) throw new Error('test failure'); return renderCertificatePdf(c); }});
  const student = store.save(normalizeStudent({registrationNumber:'TEST-PDF',studentName:'TEST ONLY',programme:'Botany',session:'2023-27'}).student);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
 const fetch = await authenticatedClient(base, store);
  const issue = () => fetch(base+'/api/certificates/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({registrationNumber:student.id,studentVersion:student.version})}).then(r=>r.json());
  try {
    assert.equal((await (await fetch(base+'/api/certificates/status?registration=TEST-PDF')).json()).certificate,null);
    const repeated = await Promise.all(Array.from({length:8}, issue));
    assert.ok(repeated.every(x=>x.certificate.number===1));
    const original = repeated[0].certificate;
    for (let i=0;i<2;i++) {
      const response = await fetch(base+'/api/certificates/1/pdf');
      assert.equal(response.status,200);
      assert.equal(response.headers.get('content-disposition'),'attachment; filename="Bonafide_TEST-PDF_000001.pdf"');
      const pdf=await PDFDocument.load(await response.arrayBuffer());
      assert.equal(pdf.getPageCount(),1);
      const {width,height}=pdf.getPage(0).getSize();
      assert.ok(Math.abs(width-595.28)<1 && Math.abs(height-841.89)<1);
      assert.deepEqual((await issue()).certificate,original);
    }
    fail=true;
    const response=await fetch(base+'/api/certificates/1/pdf');
    assert.equal(response.status,503);
    assert.match((await response.json()).error,/number and issue date are saved/);
    assert.deepEqual((await issue()).certificate,original);
    for(const search of ['000001','TEST-PDF','TEST ONLY']) assert.equal((await (await fetch(base+'/api/certificates?search='+encodeURIComponent(search))).json()).total,1);
    assert.deepEqual(store.get(student.id),student);
    store.remove(student.id);
    assert.equal((await fetch(base+'/api/certificates/1/pdf')).status,409);
    assert.equal(store.certificates.get(1).number,1);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

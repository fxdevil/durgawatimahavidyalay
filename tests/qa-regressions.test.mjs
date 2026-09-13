import { authenticatedClient } from './auth-helper.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {createApplication} from '../server.mjs';
import {normalizeStudent,fields} from '../public/js/student-schema.js';

test('QA: malformed requests, hostile paths, workbook limits and search boundaries',async t=>{
 const {server,store}=createApplication({databasePath:':memory:'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const fetch = await authenticatedClient(base, store);
 const request=(route,body,method='POST')=>fetch(base+route,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const upload=(body,name='test.xlsx')=>fetch(base+'/api/imports',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':name},body});
 const make=async(rows,headers=fields.map(([,label])=>label))=>{const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Students');sheet.addRow(headers);rows.forEach(row=>sheet.addRow(row));return book.xlsx.writeBuffer();};
 try {
  const student=store.save(normalizeStudent({registrationNumber:'QA-1',studentName:'QA O\'Brien %_ <script>',programme:'Botany'}).student);
  await t.test('non-object JSON is rejected without internal exception details',async()=>{
   for(const body of [null,[],true,42,'text']) {
    const response=await request('/api/students/QA-1',body,'PUT');
    assert.equal(response.status,400);
    assert.match((await response.json()).error,/JSON object/i);
   }
   assert.deepEqual(store.get('QA-1'),student);
  });
  await t.test('unusable dot identifiers and malformed Unicode cannot enter the database',()=>{
   for(const registrationNumber of ['.','..','bad\ud800']) assert.ok(normalizeStudent({registrationNumber,studentName:'QA'}).errors.length);
   assert.ok(normalizeStudent({registrationNumber:'QA',studentName:'bad\udfff'}).errors.length);
  });
  await t.test('hostile paths and direct private-file access fail safely',async()=>{
   for(const route of ['/data/students.sqlite','/../server.mjs','/%2e%2e%5cserver.mjs','/images/..%5c..%5cpackage.json','/.tools/qa-audit/baseline.sqlite']) assert.equal((await fetch(base+route)).status,404);
   const malformed=await fetch(base+'/%ZZ');assert.equal(malformed.status,400);assert.match((await malformed.json()).error,/address/i);
  });
  await t.test('search safely handles case, wildcards, empty and no results, and page extremes',async()=>{
   for(const search of ['qa','%','_','O\'Brien','<script>']) assert.equal(store.list({name:search}).matched,1);
   assert.equal(store.list({name:"' OR 1=1 --"}).matched,0);
   assert.equal(store.list({}).matched,1);
   for(const page of ['-1','1.5','Infinity','99999999999999999','NaN']) {const response=await fetch(base+'/api/students?page='+page);assert.equal(response.status,200);assert.equal((await response.json()).page,1);}
  });
  await t.test('zero-byte, tiny corrupt, invalid extension and oversized uploads fail',async()=>{
   for(const value of [Buffer.alloc(0),Buffer.from('PK'),Buffer.from('not xlsx')]) assert.equal((await upload(value)).status,400);
   assert.equal((await upload(await make([]),'test.csv')).status,400);
   assert.equal((await upload(Buffer.alloc(5*1024*1024+1))).status,413);
  });
  await t.test('empty workbook validates zero rows; duplicate/missing headers rejected',async()=>{
   const empty=await upload(await make([[],['','','   ']]));assert.equal(empty.status,200);assert.equal((await empty.json()).detectedRows,0);
   assert.equal((await upload(await make([],['SR NO']))).status,400);
   assert.equal((await upload(await make([], [...fields.map(([,label])=>label),'SR NO']))).status,400);
  });
  await t.test('row limit enforced before import',async()=>{
   const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Students');sheet.addRow(fields.map(([,label])=>label));sheet.getCell('B10002').value='QA-LIMIT';
   const response=await upload(await book.xlsx.writeBuffer());assert.equal(response.status,400);assert.match((await response.json()).error,/10,000/);
  });
  await t.test('hyperlinks are labels only, formulas rejected and updates never implicit',async()=>{
   const file=await make([[1,'QA-LINK',{text:'QA label',hyperlink:'file:///C:/private'},'', '', '', '', '', '', ''],[2,'QA-FORMULA',{formula:'1+1',result:2}],[3,'QA-1','Replacement']]);
   const response=await upload(file);const preview=await response.json();assert.equal(preview.validRecords,1);assert.equal(preview.errorCount,2);assert.equal(preview.preview[0].student.studentName,'QA label');
   assert.deepEqual(store.get('QA-1'),student);
  });
 } finally {await new Promise(r=>server.close(r));}
});

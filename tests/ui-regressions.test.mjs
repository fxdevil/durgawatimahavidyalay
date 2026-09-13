import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountAddStudents,mountDatabase,api} from '../public/js/student-ui.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=data=>({ok:true,json:async()=>data});
const student={id:'QA',registrationNumber:'QA',studentName:'QA ONLY',version:1};
const listing={students:[student],matched:1,total:1,page:1,pages:1};
function setup(t,fetch) {
 const dom=new JSDOM('<main></main>',{url:'http://localhost/'});
 const keys=['window','document','FormData','fetch'];const prior=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,FormData:dom.window.FormData,fetch});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 t.after(()=>{dom.window.close();Object.assign(globalThis,prior);});
 return document.querySelector('main');
}

test('manual save locks inputs and reset until the request finishes',async t=>{
 let finish; const main=setup(t,()=>new Promise(resolve=>{finish=resolve;}));mountAddStudents(main);
 const form=document.querySelector('#manual-form');form.elements.registrationNumber.value='QA';form.elements.studentName.value='QA ONLY';
 form.dispatchEvent(new window.Event('submit',{cancelable:true}));
 assert.ok([...form.elements].every(el=>el.disabled));
 finish(response({student}));await tick();
 assert.ok([...form.elements].every(el=>!el.disabled));assert.equal(form.elements.studentName.value,'');assert.match(form.textContent,/Student added successfully/);
});

test('stale failed student search cannot erase newer successful results',async t=>{
 let rejectFirst,calls=0;
 const main=setup(t,()=>++calls===1?new Promise((resolve,reject)=>{rejectFirst=reject;}):Promise.resolve(response(listing)));
 mountDatabase(main);document.querySelector('#student-search').dispatchEvent(new window.Event('submit',{cancelable:true}));await tick();
 assert.match(document.querySelector('#student-results').textContent,/QA ONLY/);
 rejectFirst(new Error('network'));await tick();
 assert.match(document.querySelector('#student-results').textContent,/QA ONLY/);assert.equal(document.querySelector('#database-feedback').hidden,true);
});

test('record save prevents overlapping close, delete and input actions',async t=>{
 let finish;
 const main=setup(t,(url,options)=>options?.method==='PUT'?new Promise(resolve=>{finish=resolve;}):Promise.resolve(response(url.startsWith('/api/students?')?listing:{student})));
 mountDatabase(main);await tick();document.querySelector('.view-record').click();await tick();document.querySelector('#edit-record').click();
 const form=document.querySelector('#record-form');form.dispatchEvent(new window.Event('submit',{cancelable:true}));
 assert.ok([...form.elements].every(el=>el.disabled));assert.equal(document.querySelector('#close-record').disabled,true);
 const cancel=new window.Event('cancel',{cancelable:true});document.querySelector('dialog').dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);
 finish(response({student}));await tick();assert.equal(document.querySelector('dialog').hasAttribute('open'),false);assert.ok([...form.elements].every(el=>!el.disabled));
});

test('network and non-JSON errors have understandable messages',async t=>{
 setup(t,async()=>{throw new Error('fetch failed');});await assert.rejects(()=>api('/api/students'),/Cannot reach the server/);
 globalThis.fetch=async()=>({json:async()=>{throw new Error('Unexpected token');}});await assert.rejects(()=>api('/api/students'),/unreadable response/);
});

test('failed issue-status lookup clears loading status and keeps issuance disabled',async t=>{
 const {mountCertificate}=await import('../public/js/certificate-ui.js');
 const main=setup(t,url=>url.startsWith('/api/students/')?Promise.resolve(response({student})):Promise.reject(new Error('offline')));
 const previousLocation=globalThis.location;globalThis.location=window.location;t.after(()=>{globalThis.location=previousLocation;});
 mountCertificate(main);document.querySelector('#certificate-search input').value='QA';document.querySelector('#certificate-search').dispatchEvent(new window.Event('submit',{cancelable:true}));await tick();
 assert.equal(document.querySelector('#issue-status').textContent,'No certificate loaded. Search again.');
 assert.equal(document.querySelector('#issue-certificate').disabled,true);assert.match(document.querySelector('#certificate-status').textContent,/Cannot reach/);
});

test('visual polish is screen-only and animation respects reduced motion',async()=>{
 const {readFile}=await import('node:fs/promises');const css=await readFile(new URL('../public/css/ui-polish.css',import.meta.url),'utf8');
 const dom=new JSDOM(`<style>${css}</style>`);
 try {
  const rules=[...dom.window.document.styleSheets[0].cssRules];
  assert.ok(rules.length>0);assert.ok(rules.every(rule=>rule.conditionText?.startsWith('screen')));
  const animations=rules.filter(rule=>rule.cssText.includes('office-enter'));
  assert.ok(animations.length);assert.ok(animations.every(rule=>rule.conditionText.includes('prefers-reduced-motion: no-preference')));
 } finally {dom.window.close();}
});

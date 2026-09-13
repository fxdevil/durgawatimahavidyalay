import { api, escapeHtml } from './student-ui.js';
import { formatIssueDate } from './certificate-template.js';
import { downloadCertificate } from './certificate-ui.js';
export function mountCertificateRecords(main) {
  main.innerHTML = `<section class="page-heading"><div><div class="eyebrow">CERTIFICATE DESK</div><h1>Certificate Records</h1><p>Issued certificates retain their number and issue date.</p></div></section><section class="panel student-panel"><form class="search-form"><label class="field">Search certificate number, registration number or student name<input name="search" maxlength="300"></label><button class="button primary">Search</button></form><p role="status" id="records-status"></p><div id="records-table" class="table-scroll"></div><div class="search-form"><button id="previous" class="button outline">Previous</button><span id="page-number"></span><button id="next" class="button outline">Next</button></div></section>`;
  let page = 1, serial = 0;
  const status = main.querySelector('#records-status'), form = main.querySelector('form');
  async function load() {
    const current = ++serial;
    try {
      const result = await api(`/api/certificates?search=${encodeURIComponent(form.elements.search.value)}&page=${page}`);
      if (current !== serial || !main.contains(status)) return;
      page = result.page; status.textContent = `${result.total} issued certificates`;
      main.querySelector('#page-number').textContent = `Page ${page} of ${Math.ceil(result.total / 50) || 1}`;
      main.querySelector('#previous').disabled = page === 1; main.querySelector('#next').disabled = page * 50 >= result.total;
      main.querySelector('#records-table').innerHTML = `<table class="student-table"><thead><tr>${['Certificate Number','Registration Number','Student Name','Programme','Session','Issue Date','Status','Actions'].map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${result.records.map(c => `<tr><td>${String(c.number).padStart(6, '0')}</td><td>${escapeHtml(c.registrationNumber)}</td><td>${escapeHtml(c.student?.studentName || 'Student record unavailable')}</td><td>${escapeHtml(c.student?.programme || '')}</td><td>${escapeHtml(c.student?.session || '')}</td><td>${formatIssueDate(c.issueDate)}</td><td>Issued</td><td><a href="#generate?certificate=${c.number}">View Certificate</a> · <a href="#generate?certificate=${c.number}&action=print">Print</a> · <button class="button outline" data-download="${c.number}" ${c.student ? '' : 'disabled'}>Download PDF</button></td></tr>`).join('') || '<tr><td colspan="8">No matching certificates.</td></tr>'}</tbody></table>`;
    } catch (error) { if (current === serial && main.contains(status)) status.textContent = error.message; }
  }
  form.addEventListener('submit', event => { event.preventDefault(); page = 1; load(); });
  main.querySelector('#previous').onclick = () => { page--; load(); };
  main.querySelector('#next').onclick = () => { page++; load(); };
  main.querySelector('#records-table').addEventListener('click', async event => {
    const button = event.target.closest('[data-download]'); if (!button) return;
    button.disabled = true; status.textContent = 'Preparing PDF…';
    try { await downloadCertificate(Number(button.dataset.download)); status.textContent = 'PDF downloaded.'; }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  load();
}

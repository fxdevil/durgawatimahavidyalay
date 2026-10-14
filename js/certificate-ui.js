import { secureFetch } from './auth-client.js';
import { api } from './student-ui.js';
import { certificateTemplate, formatIssueDate } from './certificate-template.js';

export async function downloadCertificate(number) {
  try {
    const response = await secureFetch(`/api/certificates/${number}/pdf`, { cache: 'no-store' });
    if (response && response.ok) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'Bonafide.pdf';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
  } catch {
    // Fallback on static hosting: invoke native print-to-PDF
  }
  window.print();
}

export function mountCertificate(main) {
  const params = new URLSearchParams(location.hash.split('?')[1]);
  main.innerHTML = `<section class="page-heading certificate-controls"><div><div class="eyebrow">CERTIFICATE DESK</div><h1>Bonafide Certificate</h1><p>Search, review and issue a certificate from the current student record.</p></div><a href="#dashboard" class="button outline">Back</a></section>
  <section class="panel student-panel certificate-controls"><form id="certificate-search" class="search-form"><label class="field">Registration Number<input name="registrationNumber" required maxlength="300" autocomplete="off" placeholder="Enter exact Registration Number"></label><button class="button primary" type="submit">Search</button><button type="button" id="issue-certificate" class="button primary" disabled>Generate / Preview</button><button type="button" id="print-certificate" class="button outline" disabled>PRINT CERTIFICATE</button><button type="button" id="download-certificate" class="button outline" disabled>DOWNLOAD PDF</button></form><div id="academic-year-editor" class="session-editor" hidden><div class="session-editor-inner"><span class="session-editor-title">Academic Year:</span><label class="field"><input id="academic-year-input" name="academicYear" placeholder="e.g. 2025-26" maxlength="50" autocomplete="off"></label><button type="button" id="update-academic-year" class="button outline">Update Academic Year</button><span class="help-text" id="academic-year-notice"></span></div></div><p id="issue-status" class="help-text">Search a student to check issue status.</p><div id="certificate-status" role="status" class="feedback" hidden></div><p class="help-text">Print: A4 portrait, scale 100%, margins none; turn off browser headers and footers. Missing fields remain blank.</p></section><div id="certificate-preview" class="certificate-stage"></div>`;
  const form = main.querySelector('form'), stage = main.querySelector('#certificate-preview'), feedback = main.querySelector('#certificate-status'), status = main.querySelector('#issue-status');
  const issue = main.querySelector('#issue-certificate'), print = main.querySelector('#print-certificate'), download = main.querySelector('#download-certificate');
  const yearEditor = main.querySelector('#academic-year-editor'), yearInput = main.querySelector('#academic-year-input'), updateYear = main.querySelector('#update-academic-year'), yearNotice = main.querySelector('#academic-year-notice');
  let student, certificate, busy = false;
  function getAcademicYear() {
    return certificate?.academicYear || (typeof localStorage !== 'undefined' ? localStorage.getItem('dm_academic_year') : null) || '2025-26';
  }
  function updateYearEditor() {
    if (student) {
      yearEditor.hidden = false;
      const curYear = getAcademicYear();
      yearInput.value = curYear;
      yearNotice.textContent = `Student: ${student.studentName} · "DURING ACADEMIC YEAR": ${curYear}`;
    } else {
      yearEditor.hidden = true;
      yearInput.value = '';
      yearNotice.textContent = '';
    }
  }
  function message(text, error = false) { feedback.textContent = text; feedback.hidden = !text; feedback.className = `feedback ${error ? 'error' : 'success'}`; }
  function fits() { const frame = stage.querySelector('.certificate-frame'); return frame && frame.scrollHeight <= frame.clientHeight + 1 && frame.scrollWidth <= frame.clientWidth + 1; }
  async function show(saved) {
    if (!main.contains(stage)) return;
    certificate = null;
    stage.innerHTML = '';
    if (!saved.student) throw new Error('Student record unavailable. Restore the authorized record before printing.');
    if (!saved.academicYear) {
      saved.academicYear = getAcademicYear();
    }
    stage.innerHTML = certificateTemplate(saved);
    await document.fonts.ready;
    await Promise.all([...stage.querySelectorAll('img')].map(img => img.decode().catch(() => {})));
    if (!fits()) throw new Error('The student details exceed one A4 page. Review the authorized record before printing.');
    if (!main.contains(stage)) return;
    certificate = saved;
    status.textContent = `Issued · Certificate No. ${String(saved.number).padStart(6, '0')} · Issue Date: ${formatIssueDate(saved.issueDate)}`;
    history.replaceState(null, '', '#generate?certificate=' + saved.number);
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    [...form.elements].forEach(el => el.disabled = true);
    yearInput.disabled = updateYear.disabled = true;
    message('Please wait…');
    try { await action(); message('Ready. Verify student details before printing or downloading.'); }
    catch (error) {
      if (!certificate) { student = null; status.textContent = 'No certificate loaded. Search again.'; }
      message(error.message, true);
    }
    finally {
      busy = false;
      form.elements.registrationNumber.disabled = false;
      form.querySelector('[type="submit"]').disabled = false;
      yearInput.disabled = updateYear.disabled = !student;
      issue.disabled = !student || !!certificate;
      print.disabled = download.disabled = !certificate || !fits();
    }
  }
  form.elements.registrationNumber.addEventListener('input', () => { student = certificate = null; stage.innerHTML = ''; issue.disabled = print.disabled = download.disabled = true; status.textContent = 'Search to check issue status.'; message(''); updateYearEditor(); });
  form.addEventListener('submit', event => { event.preventDefault(); run(async () => {
    certificate = student = null; stage.innerHTML = ''; updateYearEditor();
    status.textContent = 'Checking issue status…';
    const registration = form.elements.registrationNumber.value.trim();
    try { student = (await api('/api/students/' + encodeURIComponent(registration))).student; }
    catch (error) { status.textContent = 'No certificate loaded.'; updateYearEditor(); throw error; }
    const existing = (await api('/api/certificates/status?registration=' + encodeURIComponent(registration))).certificate;
    if (existing) await show(existing);
    else { status.textContent = `Not Issued · ${student.studentName}. Click Generate / Preview to issue the first certificate.`; }
    updateYearEditor();
  }); });
  updateYear.addEventListener('click', () => run(async () => {
    if (!student) return;
    const newYear = yearInput.value.trim();
    if (!newYear) throw new Error('Please enter an Academic Year (e.g. 2025-26).');
    if (typeof localStorage !== 'undefined') localStorage.setItem('dm_academic_year', newYear);
    if (certificate) {
      const res = await api('/api/certificates/' + certificate.number, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicYear: newYear })
      });
      certificate = res.certificate || { ...certificate, academicYear: newYear };
      await show(certificate);
    }
    updateYearEditor();
    message(`Academic Year updated to "${newYear}".`);
  }));
  yearInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      updateYear.click();
    }
  });
  issue.addEventListener('click', () => run(async () => {
    const academicYear = yearInput.value.trim() || getAcademicYear();
    if (typeof localStorage !== 'undefined') localStorage.setItem('dm_academic_year', academicYear);
    const result = await api('/api/certificates/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationNumber: student.registrationNumber,
        studentVersion: student.version,
        academicYear
      })
    });
    await show(result.certificate);
    updateYearEditor();
  }));
  print.addEventListener('click', () => run(async () => { await show((await api('/api/certificates/' + certificate.number)).certificate); window.print(); }));
  download.addEventListener('click', () => run(async () => { await show((await api('/api/certificates/' + certificate.number)).certificate); await downloadCertificate(certificate.number); }));
  if (/^\d+$/.test(params.get('certificate') || '')) run(async () => {
    await show((await api('/api/certificates/' + params.get('certificate'))).certificate);
    student = certificate.student;
    form.elements.registrationNumber.value = student.registrationNumber;
    updateYearEditor();
    if (params.get('action') === 'print') window.print();
    if (params.get('action') === 'download') await downloadCertificate(certificate.number);
  });
}

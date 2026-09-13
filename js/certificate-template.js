import { escapeHtml } from './student-ui.js';

export const formatIssueDate = value => value.split('-').reverse().join('/');
const value = (text, field) => `<span class="cert-value ${text ? '' : 'cert-blank'}" data-certificate-field="${field}" ${text ? '' : 'aria-label="Not available in student record"'}>${text ? escapeHtml(text) : '&nbsp;'}</span>`;

export function certificateTemplate(certificate) {
  const student = certificate.student;
  return `<article class="certificate-page" aria-label="A4 Bonafide Certificate">
    <div class="certificate-frame">
      <img class="certificate-watermark" src="/images/certificate-watermark.jpeg" alt="" aria-hidden="true">
      <header class="certificate-header"><img class="certificate-header-image" src="/images/certificate-header.jpg" alt="DURGAWATI MAHAVIDYALAYA. BICHCHIYAN, DUMARI, KAIMUR - 416. (Affiliate Unit of Veer Kunwar Singh University, Ara) Bhojpur (BIHAR), PIN-802301. Email: helpdeskdmb@gmail.com. Website: https://durgawatimahavidyalay.ac.in/"></header>
      <div class="certificate-content"><div class="certificate-meta"><span>Certificate No:- <strong data-certificate-number>${String(certificate.number).padStart(6, '0')}</strong></span><span>Date :- <strong data-issue-date>${formatIssueDate(certificate.issueDate)}</strong></span></div>
      <h1 class="certificate-title">BONAFIEDE CERTIFICATE</h1>
      <p class="certificate-statement">THIS IS TO CERTIFY THAT MR./MISS. / MRS ${value(student.studentName, 'studentName')} BEARING REGISTRATION NO. ${value(student.registrationNumber, 'registrationNumber')} AND CLASS ROLL NO ${value('', 'classRollNumber')} IS BONAFIEDE STUDENT OF THIS COLLEGE, STUDYING IN THE ${value(student.programme, 'programme')} COURSE, SESSION-${value(student.session, 'session')} <strong>SEM -</strong> ${value(student.semester, 'semester')} DURING ACADEMIC YEAR ${value('', 'academicYear')}.</p>
      <p class="certificate-intro">THE STUDENT DETAILS AS ENTERED IN OUR COLLEGE RECORD ARE :</p>
      <dl class="certificate-details">
        <div><dt>DATE OF BIRTH:</dt><dd>${value(student.dateOfBirth, 'dateOfBirth')}</dd></div>
        <div><dt>FATHER’S NAME:</dt><dd>${value(student.fatherName, 'fatherName')}</dd></div>
        <div><dt>MOTHER’S NAME:</dt><dd>${value('', 'motherName')}</dd></div>
        <div><dt>CATEGORY:</dt><dd>${value(student.category, 'category')}</dd></div>
        <div><dt>DATE OF ADMISSION:</dt><dd><span class="cert-date-blank" data-certificate-field="dateOfAdmission" aria-label="Not available in student record">__ / __ /____</span></dd></div>
        <div><dt>EXPECTED YEAR OF<br>COURSE COMPLETION:</dt><dd>${value(student.courseComplete, 'courseComplete')}</dd></div>
      </dl>
      <p class="certificate-note"><strong>NOTE:</strong> THIS IS A COMPUTER-GENERATED BONAFIDE CERTIFICATE. IT IS VALID ONLY WHEN VERIFIED AND SIGNED BY THE ASSISTANT AND IS INTENDED EXCLUSIVELY FOR SCHOLARSHIP PURPOSES.</p></div>
      <footer class="certificate-signatures"><div><div class="signature-space"></div><strong>ASSISTANT</strong></div><div><div class="signature-space"></div><strong>PRINCIPAL</strong></div></footer>
    </div>
  </article>`;
}

import { startSession, logout } from './auth-client.js';
const operator = await startSession();
document.querySelector('#operator-name').textContent = operator.displayName;
document.querySelector('#operator-role').textContent = operator.roleLabel;
const avatar = document.querySelector('#operator-avatar');
if (avatar) avatar.textContent = operator.displayName.split(' ').map(part => part[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'OP';
document.querySelector('#logout').addEventListener('click', async () => { try { await logout(); } catch { alert('Could not log out. Please try again.'); } });
import { mountCertificateRecords } from './certificate-records-ui.js';
import { icon } from './icons.js';
import { mountAddStudents, mountDatabase, api } from './student-ui.js';
import { mountCertificate } from './certificate-ui.js';
const pages = { dashboard: 'Dashboard', generate: 'Generate Bonafide', students: 'Student Database', records: 'Certificate Records', 'add-data': 'Add Student Data' };
const main = document.querySelector('main');
const mobileLayout = window.matchMedia('(max-width: 850px)');
function syncNavigation() {
  document.querySelector('.sidebar').inert = mobileLayout.matches && !document.body.classList.contains('nav-open');
}
const dashboard = () => `
  <section class="page-heading"><div><div class="eyebrow">ADMINISTRATIVE OVERVIEW</div><h1>A simpler way to certify.</h1><p>Manage student records and bonafide certificates in one place.</p></div><div class="date-label"><img class="date-label-logo" src="/images/college-logo.png" alt=""><span>Office dashboard</span></div></section>
  <div class="setup-notice">${icon('info')}<p><strong>Loading workspace.</strong> Checking stored records…</p><span class="badge neutral">Loading</span></div>
  <section class="stats-grid" aria-label="Workspace overview">
    ${stat('people', 'Student records', 'Loading records…', 'sage')}
    ${stat('document', 'Certificates generated', 'Loading issued certificates…', 'sand')}
    ${stat('records', 'Certificate records', 'Loading certificate records…', 'lavender')}
  </section>
  <section class="actions-grid" aria-label="Quick actions">
    <article class="generate-card"><div class="action-icon">${icon('document')}</div><span class="hero-kicker">CERTIFICATE DESK</span><h2>Generate Bonafide</h2><p>From a student record to an official certificate.<br class="desktop-break"> A clear, consistent workflow for your college office.</p><a class="button light" href="#generate">Generate Bonafide ${icon('arrow')}</a><span class="hero-note">Search · Issue · Print or download PDF</span><div class="paper-art" aria-hidden="true"><div class="paper-seal"><img class="paper-seal-img" src="/images/college-logo.png" alt=""></div><div class="paper-line short"></div><div class="paper-line"></div><div class="paper-rule"></div><div class="paper-line"></div><div class="paper-line"></div><div class="paper-line medium"></div><div class="paper-sign"></div></div></article>
    <article class="data-card"><div class="action-icon">${icon('upload')}</div><h2>Start with student data</h2><p>A reliable certificate starts with a verified student record. Import or maintain authorized student information here.</p><a class="button outline" href="#add-data">${icon('plus')} Add Student Data</a><span class="card-note">Import an Excel workbook or add a student manually.</span></article>
  </section>
  <section class="lower-grid">
    <article class="panel"><div class="panel-heading"><h2>Student Database</h2><a href="#students">View section ${icon('arrow')}</a></div><div class="empty-state"><span class="empty-icon">${icon('people')}</span><h3>A home for your student records</h3><p>Once connected, authorized student information<br class="desktop-break"> will be available here.</p><span class="badge neutral">No data connected</span></div></article>
    <article class="panel"><div class="panel-heading"><h2>Certificate Records</h2><a href="#records">View section ${icon('arrow')}</a></div><div class="empty-state"><span class="empty-icon">${icon('records')}</span><h3>Your certificate history starts here</h3><p>Generated certificate records will appear here<br class="desktop-break"> when the certificate workflow is enabled.</p><span class="badge neutral">No certificates yet</span></div></article>
  </section>
  <section class="workflow"><div><span class="eyebrow">THE WORKFLOW</span><h2>Three steps. One official document.</h2></div><div class="steps"><span><b>01</b> Find student</span>${icon('arrow')}<span><b>02</b> Preview certificate</span>${icon('arrow')}<span><b>03</b> Print on A4</span></div></section>`;

function stat(symbol, label, note, color) {
  return `<article class="stat-card"><div><h2>${label}</h2><strong>—</strong><p>${note}</p></div><span class="stat-icon ${color}">${icon(symbol)}</span></article>`;
}

function closeMenu() {
  document.body.classList.remove('nav-open');
  document.querySelector('.scrim').hidden = true;
  document.querySelector('.menu-toggle').setAttribute('aria-expanded', 'false');
  syncNavigation();
}
function render() {
  const requested = location.hash.slice(1).split('?')[0] || 'dashboard';
  const page = Object.hasOwn(pages, requested) ? requested : 'dashboard';
  if (page === 'add-data') mountAddStudents(main);
  else if (page === 'students') mountDatabase(main);
  else if (page === 'generate') mountCertificate(main);
  else if (page === 'records') mountCertificateRecords(main);
  else main.innerHTML = dashboard();
  if (page === 'dashboard') {
    const notice = main.querySelector('.setup-notice p');
    main.querySelector('.hero-note').textContent = 'Search · Issue · Print or download PDF';
    api('/api/certificates').then(({total}) => {
      if (!main.contains(notice)) return;
      main.querySelectorAll('.stat-card strong').forEach((el,i) => { if (i) el.textContent = total; });
      main.querySelectorAll('.stat-card p').forEach((el,i) => { if (i) el.textContent = 'Issued certificates'; });
      const panel = main.querySelectorAll('.lower-grid .empty-state')[1];
      panel.querySelector('h3').textContent = 'Issued certificate records';
      panel.querySelector('p').textContent = 'Search, view, print or download previously issued certificates.';
      panel.querySelector('.badge').textContent = `${total} issued`;
    }).catch(() => { if (main.contains(notice)) main.querySelectorAll('.stat-card p').forEach((el,i) => { if (i) el.textContent = 'Could not load certificate records'; }); });
    main.querySelector('.data-card .card-note').textContent = 'Import an Excel workbook or add a student manually.';
    api('/api/students').then(({ total }) => {
      if (!main.contains(notice)) return;
      main.querySelector('.stat-card strong').textContent = total;
      main.querySelector('.stat-card p').textContent = total ? 'Authorized records available' : 'Ready for student data';
      notice.textContent = total ? `${total} student records are available. Manage records from the Student Database.` : 'Your workspace is ready. Import an Excel workbook or add your first student.';
      main.querySelector('.setup-notice .badge').textContent = total ? 'Data available' : 'Ready to import';
      main.querySelector('.lower-grid .empty-state h3').textContent = total ? 'Student records are available' : 'A home for your student records';
      main.querySelector('.lower-grid .empty-state p').textContent = 'Search by registration number or student name, and view or edit stored information.';
      main.querySelector('.lower-grid .empty-state .badge').textContent = `${total} students`;
    }).catch(() => { if (main.contains(notice)) { notice.textContent = 'Student records could not be loaded. Check that the server is running.'; main.querySelector('.stat-card strong').textContent = '—'; } });
  }
  document.querySelector('#breadcrumb-current').textContent = pages[page];
  document.title = `${pages[page]} · Durgawati Mahavidyalaya`;
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  closeMenu();
}
document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
document.querySelector('#year').textContent = new Date().getFullYear();
document.querySelector('.menu-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  document.querySelector('.scrim').hidden = !open;
  document.querySelector('.menu-toggle').setAttribute('aria-expanded', String(open));
  syncNavigation();
});
mobileLayout.addEventListener('change', closeMenu);
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView();
});
document.querySelector('.scrim').addEventListener('click', closeMenu);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
window.addEventListener('hashchange', () => { render(); main.focus(); window.scrollTo(0, 0); });
render();

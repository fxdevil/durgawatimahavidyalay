let csrfToken = '';
let channel;
function lock() {
  csrfToken = '';
  document.body.replaceChildren();
  location.replace('/login');
}
export async function secureFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase()) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401 && csrfToken) { lock(); throw new Error('Your session has ended. Please log in again.'); }
  return response;
}
export async function startSession() {
  async function check() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) { lock(); return null; }
      const data = await response.json(); csrfToken = data.csrfToken;
      return data.operator;
    } catch { lock(); return null; }
  }
  const operator = await check();
  if (!operator) throw new Error('Login required.');
  if ('BroadcastChannel' in window) { channel = new BroadcastChannel('dm-office-session'); channel.onmessage = () => lock(); }
  setInterval(check, 30000);
  window.addEventListener('pagehide', () => document.body.classList.add('session-checking'));
  window.addEventListener('pageshow', async event => { if (event.persisted) { await check(); document.body.classList.remove('session-checking'); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  document.body.classList.remove('session-checking');
  return operator;
}
export async function logout() {
  const response = await secureFetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!response.ok) throw new Error('Could not log out. Please try again.');
  channel?.postMessage('logout'); lock();
}

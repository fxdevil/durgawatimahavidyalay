import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
export const testPassword = randomBytes(24).toString('base64url');
const hash = bcrypt.hash(testPassword, 12);
export async function provision(store) {
  for (const username of ['nadim.khan', 'shivam.bharti']) if (!store.security.get(username).passwordHash) store.security.setPassword(username, await hash);
}
export async function authenticatedClient(base, store, username = 'nadim.khan') {
  await provision(store);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: testPassword }) });
  if (!login.ok) throw new Error('Test login failed.');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const session = await login.json();
  const client = (url, options = {}) => {
    const headers = new Headers(options.headers); headers.set('Cookie', cookie);
    if (!['GET', 'HEAD'].includes(options.method || 'GET')) headers.set('X-CSRF-Token', session.csrfToken);
    return fetch(url, { ...options, headers });
  };
  return Object.assign(client, { cookie, session });
}

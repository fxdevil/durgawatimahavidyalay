import bcrypt from 'bcryptjs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);
export const permissions = Object.freeze({ computer_operator: new Set(['students', 'certificates', 'imports', 'workspace']) });
export const invalidLogin = 'Invalid username or password.';
const error = (message, status) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(value).digest('hex');
const publicOperator = row => ({ username: row.username, displayName: row.displayName, role: row.role, roleLabel: 'Computer Operator' });

export function validatePassword(password, operator) {
  if (typeof password !== 'string' || !password.isWellFormed() || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Use a password of at least 8 characters and at most 72 UTF-8 bytes.');
  const plain = password.toLowerCase().replace(/[^a-z0-9]/g, '');
  if ([operator.username, operator.displayName].some(value => plain.includes(value.toLowerCase().replace(/[^a-z0-9]/g, '')))) throw new Error('Use a password unrelated to the operator name or username.');
}
export async function setOperatorPassword(security, username, password, reset = false) {
  const operator = security.get(username);
  if (!operator) throw new Error('Unknown operator.');
  validatePassword(password, operator);
  security.setPassword(username, await bcrypt.hash(password, 12), reset);
}

export function createAuth(security, { secure = false, now = Date.now, idleMs = 30 * 60_000, absoluteMs = 8 * 60 * 60_000 } = {}) {
  const sessions = new Map();
  const attempts = new Map();
  const cookieName = secure ? '__Host-dm_session' : 'dm_session';
  let verifying = 0;
  function cookie(token, expire = false) {
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expire ? 0 : Math.floor(absoluteMs / 1000)}${secure ? '; Secure' : ''}`;
  }
  function tokenFor(request) {
    const values = (request.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(cookieName + '='));
    if (values.length !== 1) return '';
    const value = values[0].slice(cookieName.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
  }
  function get(request, touch = true) {
    const token = tokenFor(request);
    if (!token) return null;
    const key = digest(token), session = sessions.get(key);
    if (!session) return null;
    const row = security.get(session.username);
    if (session.expires <= now() || session.lastSeen + idleMs <= now() || !row?.passwordHash || row.credentialVersion !== session.version || !permissions[row.role]) {
      sessions.delete(key); return null;
    }
    if (touch) session.lastSeen = now();
    return { ...session, key, operator: publicOperator(row) };
  }
  return {
    cookie, get,
    require(request, permission = 'workspace') {
      const session = get(request);
      if (!session) throw error('Your session has ended. Please log in again.', 401);
      if (!permissions[session.operator.role]?.has(permission)) throw error('Access is not allowed.', 403);
      return session;
    },
    csrf(request, session) {
      const value = request.headers['x-csrf-token'];
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value) || !timingSafeEqual(Buffer.from(value), Buffer.from(session.csrf))) throw error('Please refresh the page and try again.', 403);
    },
    async login(request, input) {
      const stamp = now();
      for (const [key, value] of attempts) if (value.until <= stamp) attempts.delete(key);
      const ip = request.socket.remoteAddress || 'unknown';
      let bucket = attempts.get(ip);
      if (!bucket) {
        if (attempts.size >= 1000) throw error(invalidLogin, 429);
        bucket = { count: 0, until: stamp + 15 * 60_000 }; attempts.set(ip, bucket);
      }
      if (bucket.count >= 10 || verifying >= 2) throw error(invalidLogin, 429);
      bucket.count++;
      const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
      const password = typeof input.password === 'string' && input.password.isWellFormed() && Buffer.byteLength(input.password) <= 72 ? input.password : '';
      const row = username.length <= 80 ? security.get(username) : null;
      verifying++;
      let matches;
      try { matches = await bcrypt.compare(password, row?.passwordHash || dummyHash); }
      finally { verifying--; }
      // Recheck credentials in case a local administrator reset them during hashing.
      if (!matches || !row?.passwordHash || !permissions[row.role] || security.get(row.username)?.credentialVersion !== row.credentialVersion) throw error(invalidLogin, 401);
      bucket.count = Math.max(0, bucket.count - 1);
      const previous = tokenFor(request);
      if (previous) sessions.delete(digest(previous));
      for (const [key, value] of sessions) if (value.expires <= now() || value.lastSeen + idleMs <= now()) sessions.delete(key);
      const userSessions = [...sessions].filter(([, value]) => value.username === row.username);
      if (userSessions.length >= 5) sessions.delete(userSessions[0][0]);
      const token = randomBytes(32).toString('base64url');
      const session = { username: row.username, version: row.credentialVersion, csrf: randomBytes(32).toString('base64url'), lastSeen: now(), expires: now() + absoluteMs };
      security.audit(row.username, 'login_success');
      sessions.set(digest(token), session);
      return { token, operator: publicOperator(row), csrfToken: session.csrf, expiresAt: session.expires };
    },
    logout(request) {
      const session = get(request, false);
      if (session) { sessions.delete(session.key); security.audit(session.username, 'logout'); }
      return session;
    },
    close() { sessions.clear(); attempts.clear(); },
  };
}

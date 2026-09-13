import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { createStore } from '../lib/store.mjs';
import { operators } from '../lib/security-store.mjs';
import { validatePassword } from '../lib/auth.mjs';

function hidden(prompt) {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal, or --env with protected environment variables.');
  process.stdout.write(prompt);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function done(error) { process.stdin.off('keypress', key); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? reject(error) : resolve(value); }
    function key(text, event = {}) {
      if (event.ctrl && event.name === 'c') return done(new Error('Setup cancelled.'));
      if (event.name === 'return') return done();
      if (event.name === 'backspace') value = [...value].slice(0, -1).join('');
      else if (text && !event.ctrl && !event.meta && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    }
    process.stdin.on('keypress', key);
  });
}
const args = process.argv.slice(2);
const reset = args.includes('--reset');
const resetName = args[args.indexOf('--reset') + 1];
const store = createStore(process.env.DATA_FILE || fileURLToPath(new URL('../data/students.sqlite', import.meta.url)));
try {
  if (args.some(arg => !['--env', '--reset', ...operators.map(o => o.username)].includes(arg)) || (reset && !operators.some(o => o.username === resetName))) throw new Error('Usage: node scripts/setup-operators.mjs [--env] [--reset username]');
  const pending = [];
  for (const operator of operators) {
    if (reset ? operator.username !== resetName : store.security.get(operator.username).passwordHash) continue;
    let password;
    if (args.includes('--env')) password = process.env[operator.username === 'nadim.khan' ? 'NADIM_PASSWORD' : 'SHIVAM_PASSWORD'];
    else { password = await hidden(`New password for ${operator.displayName} (${operator.username}): `); if (password !== await hidden('Confirm password: ')) throw new Error('Passwords do not match.'); }
    validatePassword(password, operator);
    pending.push([operator.username, await bcrypt.hash(password, 12)]);
    password = undefined;
  }
  store.transaction(() => { for (const [username, hash] of pending) store.security.setPassword(username, hash, reset); });
  console.log(pending.length ? `${pending.length} operator account(s) configured securely.` : 'Accounts already configured. Use --reset username for an explicit password reset.');
} catch (error) { console.error(error.code ? 'Account setup could not be saved.' : error.message); process.exitCode = 1; }
finally { store.close(); }

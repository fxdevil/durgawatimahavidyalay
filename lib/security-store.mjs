export const operators = Object.freeze([
  { username: 'nadim.khan', displayName: 'Nadim Khan', role: 'computer_operator' },
  { username: 'shivam.bharti', displayName: 'Shivam Kumar Bharti', role: 'computer_operator' },
]);

export function createSecurityStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS operators (
    username TEXT PRIMARY KEY, displayName TEXT NOT NULL, role TEXT NOT NULL,
    passwordHash TEXT, credentialVersion INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, operator TEXT NOT NULL,
    action TEXT NOT NULL, recordIdentifier TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL
  );`);
  const insert = db.prepare('INSERT OR IGNORE INTO operators (username,displayName,role) VALUES (?,?,?)');
  for (const operator of operators) insert.run(operator.username, operator.displayName, operator.role);
  return {
    get(username) { return db.prepare('SELECT * FROM operators WHERE username=?').get(username); },
    setPassword(username, hash, reset = false) {
      if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(hash)) throw new Error('A bcrypt cost-12 hash is required.');
      const result = db.prepare(`UPDATE operators SET passwordHash=?,credentialVersion=credentialVersion+1 WHERE username=? ${reset ? '' : 'AND passwordHash IS NULL'}`).run(hash, username);
      if (!result.changes) throw new Error('Account not found or already initialized. Use an explicit reset for an existing account.');
    },
    audit(username, action, identifier = '') {
      db.prepare('INSERT INTO audit_log (operator,action,recordIdentifier,createdAt) VALUES (?,?,?,?)')
        .run(username, action, String(identifier), new Date().toISOString());
    },
    auditRecords() { return db.prepare('SELECT * FROM audit_log ORDER BY id').all(); },
  };
}

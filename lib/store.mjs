import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fields, registrationKey } from '../public/js/student-schema.js';
import { createCertificates } from './certificates.mjs';
import { createSecurityStore } from './security-store.mjs';

export function createStore(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  const columns = fields.map(([key]) => key);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      ${columns.map(key => `${key} TEXT NOT NULL DEFAULT ''`).join(',')},
      version INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO metadata VALUES (1, 0);`);
  const revision = () => db.prepare('SELECT revision FROM metadata WHERE id = 1').get().revision;
  const bump = () => { db.exec('UPDATE metadata SET revision = revision + 1 WHERE id = 1'); return revision(); };
  const get = id => db.prepare('SELECT * FROM students WHERE id = ?').get(registrationKey(id));
  const save = (student, update = false) => {
    const values = columns.map(key => student[key]);
    const id = registrationKey(student.registrationNumber);
    if (!update && get(id)) throw Object.assign(new Error('This Registration Number already exists. No record was overwritten.'), { status: 409 });
    const version = bump();
    db.prepare(`INSERT INTO students (id, ${columns.join(',')}, version)
      VALUES (${Array(columns.length + 2).fill('?').join(',')})
      ON CONFLICT(id) DO UPDATE SET ${columns.map(key => `${key} = excluded.${key}`).join(',')}, version = excluded.version`).run(id, ...values, version);
    return get(id);
  };
  return {
    security: createSecurityStore(db),
    certificates: createCertificates(db, get),
    get, save, revision,
    count: () => db.prepare('SELECT COUNT(*) AS count FROM students').get().count,
    list({ registration = '', name = '', page = 1 } = {}) {
      const escaped = value => `%${value.replace(/[!%_]/g, '!$&')}%`;
      const params = [escaped(registration), escaped(name)];
      const where = "WHERE registrationNumber LIKE ? ESCAPE '!' AND studentName LIKE ? ESCAPE '!'";
      const matched = db.prepare(`SELECT COUNT(*) AS count FROM students ${where}`).get(...params).count;
      const currentPage = Math.max(1, Math.min(Math.ceil(matched / 50) || 1, Number(page) || 1));
      const students = db.prepare(`SELECT * FROM students ${where} ORDER BY id LIMIT 50 OFFSET ?`).all(...params, (currentPage - 1) * 50);
      return { students, matched, total: this.count(), page: currentPage, pages: Math.ceil(matched / 50) || 1 };
    },
    remove(id) { const result = db.prepare('DELETE FROM students WHERE id = ?').run(registrationKey(id)); if (result.changes) bump(); },
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => { try { db.close(); } catch {} },
  };
}

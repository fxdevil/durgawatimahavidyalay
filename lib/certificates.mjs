import { registrationKey } from '../public/js/student-schema.js';
const problem = (text, status = 400) => Object.assign(new Error(text), { status });
export const issueDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function createCertificates(db, getStudent) {
  // Keep the last displayed legacy preview per student; retain legacy rows for audit.
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS certificate_previews (number INTEGER PRIMARY KEY AUTOINCREMENT, requestKey TEXT NOT NULL UNIQUE, issueDate TEXT NOT NULL, registrationNumber TEXT NOT NULL, studentSnapshot TEXT NOT NULL, templateVersion INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS certificates (number INTEGER PRIMARY KEY AUTOINCREMENT, registrationNumber TEXT NOT NULL UNIQUE, issueDate TEXT NOT NULL);
    INSERT OR IGNORE INTO certificates (number, registrationNumber, issueDate)
      SELECT number, upper(trim(registrationNumber)), issueDate FROM certificate_previews
      WHERE number IN (SELECT max(number) FROM certificate_previews GROUP BY upper(trim(registrationNumber)));
    COMMIT;`);
  const decode = row => row ? { number: row.number, registrationNumber: row.registrationNumber, issueDate: row.issueDate, status: 'Issued', student: getStudent(row.registrationNumber), templateVersion: 1 } : null;
  return {
    get(number) { return decode(db.prepare('SELECT * FROM certificates WHERE number = ?').get(number)); },
    find(registration) { return decode(db.prepare('SELECT * FROM certificates WHERE registrationNumber = ?').get(registrationKey(registration))); },
    list(search = '', page = 1) {
      const query = '%' + search.trim().replace(/[!%_]/g, '!$&') + '%';
      const where = `FROM certificates c LEFT JOIN students s ON s.id=c.registrationNumber WHERE printf('%06d',c.number) LIKE ? ESCAPE '!' OR c.registrationNumber LIKE ? ESCAPE '!' OR s.studentName LIKE ? ESCAPE '!'`;
      const total = db.prepare(`SELECT count(*) AS n ${where}`).get(query, query, query).n;
      page = Math.max(1, Math.min(Math.ceil(total / 50) || 1, Number.isSafeInteger(page) ? page : 1));
      return { total, page, records: db.prepare(`SELECT c.* ${where} ORDER BY c.number DESC LIMIT 50 OFFSET ?`).all(query, query, query, (page - 1) * 50).map(decode) };
    },
    create(input) {
      if (!input || typeof input.registrationNumber !== 'string' || !input.registrationNumber.trim()) throw problem('Enter a Registration Number.');
      const student = getStudent(input.registrationNumber);
      if (!student) throw problem('No student found with this Registration Number.', 404);
      const existing = this.find(student.id);
      if (existing) return existing;
      if (student.version !== input.studentVersion) throw problem('Student details changed. Search again to load the latest record.', 409);
      const result = db.prepare('INSERT INTO certificates (registrationNumber, issueDate) VALUES (?, ?)').run(student.id, issueDate());
      return this.get(Number(result.lastInsertRowid));
    },
  };
}

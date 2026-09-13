import { fields, normalizeStudent, registrationKey } from './student-schema.js';

const DB_NAME = 'DurgawatiMahavidyalayaDB';
const DB_VERSION = 1;

let dbPromise = null;

export function getDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('students')) {
        const studentStore = db.createObjectStore('students', { keyPath: 'id' });
        studentStore.createIndex('registrationNumber', 'registrationNumber', { unique: false });
        studentStore.createIndex('studentName', 'studentName', { unique: false });
      }
      if (!db.objectStoreNames.contains('certificates')) {
        const certStore = db.createObjectStore('certificates', { keyPath: 'number' });
        certStore.createIndex('registrationNumber', 'registrationNumber', { unique: true });
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'key' });
      }
    };
    request.onsuccess = async event => {
      const db = event.target.result;
      try {
        await seedInitialData(db);
        resolve(db);
      } catch (err) {
        console.warn('Initial data seed warning:', err);
        resolve(db);
      }
    };
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function seedInitialData(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['metadata', 'students', 'certificates'], 'readonly');
    const metaStore = tx.objectStore('metadata');
    const checkReq = metaStore.get('initialized');
    checkReq.onsuccess = async () => {
      if (checkReq.result?.value) return resolve();
      try {
        const res = await fetch('./data/initial-data.json');
        if (!res.ok) return resolve();
        const data = await res.json();
        const writeTx = db.transaction(['metadata', 'students', 'certificates'], 'readwrite');
        const sStore = writeTx.objectStore('students');
        for (const s of data.students || []) {
          sStore.put(s);
        }
        const cStore = writeTx.objectStore('certificates');
        for (const c of data.certificates || []) {
          cStore.put(c);
        }
        writeTx.objectStore('metadata').put({ key: 'initialized', value: true });
        writeTx.objectStore('metadata').put({ key: 'revision', value: data.revision || 1 });
        writeTx.oncomplete = () => resolve();
        writeTx.onerror = () => resolve(); // Non-blocking
      } catch (e) {
        console.warn('Could not fetch initial-data.json:', e);
        resolve();
      }
    };
    checkReq.onerror = () => resolve();
  });
}

export async function getStudent(registrationNumber) {
  const db = await getDb();
  const id = registrationKey(registrationNumber);
  return new Promise((resolve, reject) => {
    const tx = db.transaction('students', 'readonly');
    const req = tx.objectStore('students').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listStudents({ registration = '', name = '', page = 1, pageSize = 50 } = {}) {
  const db = await getDb();
  const regQuery = registration.trim().toLowerCase();
  const nameQuery = name.trim().toLowerCase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('students', 'readonly');
    const req = tx.objectStore('students').getAll();
    req.onsuccess = () => {
      let list = req.result || [];
      if (regQuery || nameQuery) {
        list = list.filter(s => {
          const matchReg = !regQuery || (s.registrationNumber && s.registrationNumber.toLowerCase().includes(regQuery));
          const matchName = !nameQuery || (s.studentName && s.studentName.toLowerCase().includes(nameQuery));
          return matchReg && matchName;
        });
      }
      const total = list.length;
      const pages = Math.ceil(total / pageSize) || 1;
      const currentPage = Math.max(1, Math.min(page, pages));
      const start = (currentPage - 1) * pageSize;
      const students = list.slice(start, start + pageSize);
      resolve({ students, total, matched: total, page: currentPage, pages });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveStudent(studentData, updateExisting = false) {
  const { student, errors } = normalizeStudent(studentData);
  if (errors.length) throw new Error(errors.join(' '));

  const db = await getDb();
  const id = registrationKey(student.registrationNumber);

  return new Promise((resolve, reject) => {
    const tx = db.transaction('students', 'readwrite');
    const store = tx.objectStore('students');
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (existing && !updateExisting) {
        return reject(new Error('A student with this Registration Number already exists.'));
      }
      if (existing && updateExisting && studentData.version && studentData.version !== existing.version) {
        return reject(new Error('This record changed since you opened it. Close and reopen it before saving.'));
      }
      const newVersion = (existing?.version || 0) + 1;
      const toSave = { ...student, id, version: newVersion };
      const putReq = store.put(toSave);
      putReq.onsuccess = () => resolve({ student: toSave });
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function deleteStudent(id, expectedVersion) {
  const db = await getDb();
  const key = registrationKey(id);

  return new Promise((resolve, reject) => {
    const tx = db.transaction('students', 'readwrite');
    const store = tx.objectStore('students');
    const getReq = store.get(key);

    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) return reject(new Error('Student record was not found.'));
      if (expectedVersion && expectedVersion !== existing.version) {
        return reject(new Error('This record changed since you opened it. Close and reopen it before deleting.'));
      }
      const delReq = store.delete(key);
      delReq.onsuccess = () => resolve({ deleted: true });
      delReq.onerror = () => reject(delReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getCertificate(number) {
  const db = await getDb();
  const num = Number(number);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['certificates', 'students'], 'readonly');
    const certReq = tx.objectStore('certificates').get(num);

    certReq.onsuccess = () => {
      const cert = certReq.result;
      if (!cert) return resolve(null);
      const studentReq = tx.objectStore('students').get(registrationKey(cert.registrationNumber));
      studentReq.onsuccess = () => {
        resolve({ ...cert, student: studentReq.result || null });
      };
      studentReq.onerror = () => reject(studentReq.error);
    };
    certReq.onerror = () => reject(certReq.error);
  });
}

export async function getCertificateByRegistration(registrationNumber) {
  const db = await getDb();
  const key = registrationKey(registrationNumber);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['certificates', 'students'], 'readonly');
    const certStore = tx.objectStore('certificates');
    const req = certStore.getAll();

    req.onsuccess = () => {
      const all = req.result || [];
      const cert = all.find(c => registrationKey(c.registrationNumber) === key);
      if (!cert) return resolve(null);
      const studentReq = tx.objectStore('students').get(key);
      studentReq.onsuccess = () => {
        resolve({ ...cert, student: studentReq.result || null });
      };
      studentReq.onerror = () => reject(studentReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function listCertificates({ search = '', page = 1, pageSize = 50 } = {}) {
  const db = await getDb();
  const q = search.trim().toLowerCase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['certificates', 'students'], 'readonly');
    const certReq = tx.objectStore('certificates').getAll();
    const studentReq = tx.objectStore('students').getAll();

    tx.oncomplete = () => {
      const certs = certReq.result || [];
      const studentsMap = new Map((studentReq.result || []).map(s => [s.id, s]));

      let records = certs.map(c => ({
        ...c,
        student: studentsMap.get(registrationKey(c.registrationNumber)) || null
      }));

      if (q) {
        records = records.filter(c => {
          const matchNum = String(c.number).includes(q) || String(c.number).padStart(6, '0').includes(q);
          const matchReg = c.registrationNumber && c.registrationNumber.toLowerCase().includes(q);
          const matchName = c.student?.studentName && c.student.studentName.toLowerCase().includes(q);
          return matchNum || matchReg || matchName;
        });
      }

      records.sort((a, b) => b.number - a.number);
      const total = records.length;
      const pages = Math.ceil(total / pageSize) || 1;
      const currentPage = Math.max(1, Math.min(page, pages));
      const start = (currentPage - 1) * pageSize;
      const slice = records.slice(start, start + pageSize);

      resolve({ records: slice, total, page: currentPage, pages });
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function issueCertificate(registrationNumber) {
  const db = await getDb();
  const key = registrationKey(registrationNumber);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['certificates', 'students'], 'readwrite');
    const sReq = tx.objectStore('students').get(key);

    sReq.onsuccess = () => {
      const student = sReq.result;
      if (!student) return reject(new Error('Student record was not found.'));

      const cStore = tx.objectStore('certificates');
      const allReq = cStore.getAll();

      allReq.onsuccess = () => {
        const certs = allReq.result || [];
        const existing = certs.find(c => registrationKey(c.registrationNumber) === key);
        if (existing) {
          return resolve({ certificate: { ...existing, student } });
        }

        let maxNum = 2; // Default starting point before #3
        for (const c of certs) {
          if (c.number > maxNum) maxNum = c.number;
        }
        const nextNum = maxNum + 1;
        const today = new Date().toISOString().slice(0, 10);
        const newCert = {
          number: nextNum,
          registrationNumber: student.registrationNumber,
          issueDate: today
        };

        const putReq = cStore.put(newCert);
        putReq.onsuccess = () => resolve({ certificate: { ...newCert, student } });
        putReq.onerror = () => reject(putReq.error);
      };
      allReq.onerror = () => reject(allReq.error);
    };
    sReq.onerror = () => reject(sReq.error);
  });
}

export async function validateWorkbookRows(rows, updateExisting = false) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('students', 'readonly');
    const req = tx.objectStore('students').getAll();

    req.onsuccess = () => {
      const existingMap = new Map((req.result || []).map(s => [s.id, s]));
      const frequencies = new Map();
      rows.forEach(({ student }) => {
        const key = registrationKey(student.registrationNumber);
        if (key) frequencies.set(key, (frequencies.get(key) || 0) + 1);
      });

      const valid = [];
      const errors = [];
      let newRecords = 0;
      let updates = 0;

      for (const row of rows) {
        const normalized = normalizeStudent(row.student);
        const key = registrationKey(normalized.student.registrationNumber);
        const reasons = [...(row.errors || []), ...normalized.errors];

        if (frequencies.get(key) > 1) {
          reasons.push('Registration Number is duplicated inside this file. All occurrences are excluded.');
        }

        const existing = key && existingMap.get(key);
        if (existing && !updateExisting) {
          reasons.push('Registration Number already exists. Select Update Existing Records to replace this record.');
        }

        if (reasons.length) {
          errors.push({ row: row.row, registrationNumber: normalized.student.registrationNumber, reasons });
        } else {
          const action = existing ? 'update' : 'new';
          if (existing) updates++; else newRecords++;
          valid.push({ row: row.row, student: normalized.student, action });
        }
      }

      resolve({
        detectedRows: rows.length,
        validRecords: valid.length,
        newRecords,
        recordsToUpdate: updates,
        errorCount: errors.length,
        errors,
        valid
      });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function commitImport(validRecords) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('students', 'readwrite');
    const store = tx.objectStore('students');
    let added = 0;
    let updated = 0;

    for (const item of validRecords) {
      const id = registrationKey(item.student.registrationNumber);
      const toSave = { ...item.student, id, version: 1 };
      store.put(toSave);
      if (item.action === 'update') updated++; else added++;
    }

    tx.oncomplete = () => {
      const countReq = db.transaction('students', 'readonly').objectStore('students').count();
      countReq.onsuccess = () => resolve({ added, updated, total: countReq.result });
      countReq.onerror = () => resolve({ added, updated, total: added + updated });
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function exportDatabaseBackup() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['students', 'certificates'], 'readonly');
    const sReq = tx.objectStore('students').getAll();
    const cReq = tx.objectStore('certificates').getAll();

    tx.oncomplete = () => {
      const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        students: sReq.result || [],
        certificates: cReq.result || []
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `durgawati_database_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      resolve(backup);
    };
    tx.onerror = () => reject(tx.error);
  });
}

import { Worker } from 'node:worker_threads';
import { normalizeStudent, registrationKey } from '../public/js/student-schema.js';

export function parseExcel(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./excel-worker.mjs', import.meta.url), {
      workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Reading the workbook took too long. Use a simpler .xlsx file.')); }, 20000);
    worker.once('message', message => {
      clearTimeout(timer);
      worker.terminate();
      if (message.error) reject(new Error(message.error));
      else resolve(message);
    });
    worker.once('error', () => { clearTimeout(timer); reject(new Error('The workbook could not be processed safely. Use a smaller, plain .xlsx file.')); });
    worker.once('exit', code => { clearTimeout(timer); if (code) reject(new Error('Workbook processing stopped. Please try a smaller file.')); });
  });
}

export function validateRows(rows, store, updateExisting = false) {
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
    const reasons = [...row.errors, ...normalized.errors];
    if (frequencies.get(key) > 1) reasons.push('Registration Number is duplicated inside this file. All occurrences are excluded.');
    const existing = key && store.get(key);
    if (existing && !updateExisting) reasons.push('Registration Number already exists. Select Update Existing Records to replace this record.');
    if (reasons.length) {
      errors.push({ row: row.row, registrationNumber: normalized.student.registrationNumber, reasons });
    } else {
      const action = existing ? 'update' : 'new';
      if (existing) updates++; else newRecords++;
      valid.push({ row: row.row, student: normalized.student, action });
    }
  }
  return { detectedRows: rows.length, validRecords: valid.length, newRecords, recordsToUpdate: updates, errorCount: errors.length, errors, valid };
}

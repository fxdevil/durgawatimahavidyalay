import { parentPort, workerData } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { fields } from '../public/js/student-schema.js';

// Inspect archive boundaries before decompression. Never extract files to disk.
async function inspectArchive(buffer) {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(new Error('The file is not a readable .xlsx workbook.'));
      let size = 0;
      let entries = 0;
      const fail = message => { zip.close(); reject(new Error(message)); };
      zip.on('error', () => fail('The workbook archive is damaged.'));
      zip.on('entry', entry => {
        size += entry.uncompressedSize;
        if (++entries > 2000 || size > 64 * 1024 * 1024) return fail('This workbook is too large after unpacking. Use a simpler workbook.');
        if (/vbaProject|macrosheets|embeddings/i.test(entry.fileName) || entry.generalPurposeBitFlag & 1) return fail('Macros, embedded files, and encrypted workbooks are not accepted. Save a plain .xlsx workbook.');
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail('The workbook archive is damaged.');
          let expanded = 0;
          stream.on('data', chunk => {
            expanded += chunk.length;
            if (expanded > entry.uncompressedSize || expanded > 64 * 1024 * 1024) {
              stream.destroy();
              fail('The workbook archive exceeds its declared size.');
            }
          });
          stream.on('error', () => fail('The workbook archive is damaged.'));
          stream.on('end', () => zip.readEntry());
        });
      });
      zip.on('end', resolve);
      zip.readEntry();
    });
  });
}

function readCell(cell, key) {
  const value = cell.value;
  if (value == null) return '';
  if (cell.type === ExcelJS.ValueType.Formula || (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value))) throw new Error('Formulas are not accepted. Replace formulas with plain values.');
  if (value instanceof Date) {
    if (key !== 'dateOfBirth' || Number.isNaN(value.getTime())) throw new Error('Unexpected date value. Format identifiers as Text.');
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(part => part.text).join('');
    if (typeof value.text === 'string') return value.text; // Hyperlink label only; never follow links.
    throw new Error('Excel error or unsupported cell value. Replace it with plain text.');
  }
  if (key === 'registrationNumber' && typeof value === 'number') {
    if (!Number.isSafeInteger(value) || String(Math.abs(value)).length > 15) throw new Error('Registration Number may have lost precision in Excel. Enter it as Text.');
    if (/^0+$/.test(cell.numFmt || '')) return String(value).padStart(cell.numFmt.length, '0');
  }
  return String(value).trim();
}

try {
  const buffer = Buffer.from(workerData);
  await inspectArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Students') || workbook.worksheets.find(item => item.name !== 'Instructions');
  if (!sheet) throw new Error('No student worksheet was found.');
  if (sheet.rowCount > 10001 || sheet.columnCount > 100) throw new Error('Use a maximum of 10,000 data rows and 100 columns per workbook.');
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, index) => {
    const label = readCell(cell).trim();
    if (headers.has(label)) throw new Error(`Duplicate column header: ${label}.`);
    headers.set(label, index);
  });
  const missing = fields.filter(([, label]) => !headers.has(label)).map(([, label]) => label);
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}. Keep the exact headers in row 1.`);
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = [];
    row.eachCell(cell => values.push(cell.value));
    if (values.every(value => value == null || typeof value === 'string' && !value.trim())) return;
    const student = {};
    const errors = [];
    for (const [key, label] of fields) {
      try { student[key] = readCell(row.getCell(headers.get(label)), key); }
      catch (error) { student[key] = ''; errors.push(`${label}: ${error.message}`); }
    }
    rows.push({ row: rowNumber, student, errors });
  });
  parentPort.postMessage({ sheet: sheet.name, rows });
} catch (error) {
  parentPort.postMessage({ error: error.message || 'Unable to read this workbook.' });
}

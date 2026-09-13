import { fields } from './student-schema.js';
import { validateWorkbookRows, commitImport } from './client-db.js';

function readCell(cell, key) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    throw new Error('Formulas are not accepted. Replace formulas with plain values.');
  }
  if (value instanceof Date) {
    if (key !== 'dateOfBirth' || Number.isNaN(value.getTime())) {
      throw new Error('Unexpected date value. Format identifiers as Text.');
    }
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map(part => part.text).join('');
    if (typeof value.text === 'string') return value.text;
    throw new Error('Excel error or unsupported cell value. Replace it with plain text.');
  }
  if (key === 'registrationNumber' && typeof value === 'number') {
    if (!Number.isSafeInteger(value) || String(Math.abs(value)).length > 15) {
      throw new Error('Registration Number may have lost precision in Excel. Enter it as Text.');
    }
    if (/^0+$/.test(cell.numFmt || '')) return String(value).padStart(cell.numFmt.length, '0');
  }
  return String(value).trim();
}

export async function parseExcelFile(file, updateExisting = false) {
  if (!window.ExcelJS) {
    throw new Error('Excel parsing library is loading. Please try again in a moment.');
  }
  const buffer = await file.arrayBuffer();
  if (!buffer.byteLength) throw new Error('The selected file is empty.');

  const workbook = new window.ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.getWorksheet('Students') || workbook.worksheets.find(item => item.name !== 'Instructions');
  if (!sheet) throw new Error('No student worksheet was found.');
  if (sheet.rowCount > 10001 || sheet.columnCount > 100) {
    throw new Error('Use a maximum of 10,000 data rows and 100 columns per workbook.');
  }

  const headers = new Map();
  sheet.getRow(1).eachCell((cell, index) => {
    const label = (cell.value == null ? '' : String(cell.value)).trim();
    if (headers.has(label)) throw new Error(`Duplicate column header: ${label}.`);
    headers.set(label, index);
  });

  const missing = fields.filter(([, label]) => !headers.has(label)).map(([, label]) => label);
  if (missing.length) {
    throw new Error(`Missing required columns: ${missing.join(', ')}. Keep the exact headers in row 1.`);
  }

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = [];
    row.eachCell(cell => values.push(cell.value));
    if (values.every(value => value == null || (typeof value === 'string' && !value.trim()))) return;

    const student = {};
    const errors = [];
    for (const [key, label] of fields) {
      try {
        student[key] = readCell(row.getCell(headers.get(label)), key);
      } catch (error) {
        student[key] = '';
        errors.push(`${label}: ${error.message}`);
      }
    }
    rows.push({ row: rowNumber, student, errors });
  });

  const plan = await validateWorkbookRows(rows, updateExisting);
  return {
    ...plan,
    sheet: sheet.name,
    preview: plan.valid.slice(0, 100),
    updateExisting
  };
}

export { commitImport };

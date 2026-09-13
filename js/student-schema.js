export const fields = [
  ['srNo', 'SR NO'],
  ['registrationNumber', 'REGISTRATION NUMBER'],
  ['studentName', 'STUDENT NAME'],
  ['fatherName', "FATHER'S NAME"],
  ['dateOfBirth', 'DATE OF BIRTH'],
  ['category', 'CATEGORY'],
  ['programme', 'PROGRAMME / MJC'],
  ['semester', 'SEMESTER'],
  ['session', 'SESSION'],
  ['courseComplete', 'COURSE COMPLETE'],
];
export const registrationKey = value => String(value ?? '').trim().toUpperCase();

export function normalizeStudent(input) {
  const student = {};
  const errors = [];
  for (const [key, label] of fields) {
    const value = input?.[key] ?? '';
    if (!['string', 'number'].includes(typeof value)) errors.push(`${label} must be text.`);
    student[key] = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (student[key].length > 300) errors.push(`${label} must contain at most 300 characters.`);
    if (!student[key].isWellFormed()) errors.push(`${label} contains invalid text characters.`);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(student[key])) errors.push(`${label} contains unsupported control characters.`);
  }
  if (!student.registrationNumber) errors.push('Registration Number is missing.');
  if (['.', '..'].includes(student.registrationNumber)) errors.push('Registration Number cannot be only dots.');
  if (!student.studentName) errors.push('Student Name is missing.');
  return { student, errors };
}

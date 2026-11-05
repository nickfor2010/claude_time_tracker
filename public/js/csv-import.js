// Reads timesheet CSV files exported from other systems / Excel / Google Sheets.
// Pure functions (no DOM) so they can be tested in Node.

// RFC 4180-ish parser; detects comma, semicolon or tab; handles quotes and a BOM.
export function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}

const ALIASES = {
  employee: ['employee', 'name', 'staff', 'employee name', 'worker', '員工', '姓名', '名字', '員工姓名'],
  date: ['date', 'day', 'work date', '日期', '工作日期'],
  in: ['clock in', 'in', 'start', 'check in', 'time in', 'start time', '上班', '上班時間', '上班打卡', '開始', '開始時間'],
  out: ['clock out', 'out', 'end', 'check out', 'time out', 'end time', '下班', '下班時間', '下班打卡', '結束', '結束時間'],
  break: ['break', 'break (min)', 'break min', 'break minutes', 'break (minutes)', '休息', '休息（分鐘）', '休息(分鐘)', '休息時間'],
  hours: ['hours', 'duration (hours)', 'duration', 'hours worked', 'worked hours', '工時', '工時（小時）', '工時(小時)', '時數'],
  note: ['note', 'notes', 'comment', 'remark', '備註', '說明'],
};
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Finds which column holds what. Returns { employee, date, in, out, break, hours, note } -> column index (or -1)
export function mapColumns(header) {
  const h = header.map(norm);
  const out = {};
  for (const [key, names] of Object.entries(ALIASES)) out[key] = h.findIndex((x) => names.includes(x));
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
// '2026-08-05', '2026/8/5', '8/5/2026' (US), '5/8/2026' when the first part is > 12, '2026年8月5日'
export function normalizeDate(s) {
  s = String(s || '').trim().replace(/年|月/g, '/').replace(/日/g, '');
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return valid(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/))) {
    const a = +m[1], b = +m[2];
    return a > 12 ? valid(+m[3], b, a) : valid(+m[3], a, b);
  }
  return null;
}
function valid(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
}
// '9:00', '09:00:00', '9:00 AM', '1:05 PM', '上午8:44', '下午1:05', '13.30', '0900'
export function normalizeTime(s) {
  s = String(s || '').trim();
  if (!s) return null;
  let pm = /pm|下午|晚上/i.test(s), am = /am|上午|早上/i.test(s);
  const core = s.replace(/am|pm|上午|下午|早上|晚上/gi, '').trim();
  let m = core.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/) || core.match(/^(\d{2})(\d{2})$/);
  if (!m) return null;
  let h = +m[1]; const min = +m[2];
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
}
const isSummaryRow = (cells) => cells.some((c) => /^(total|合計|小計|總計)/i.test(c));

/**
 * Turns parsed CSV rows into import rows.
 * @param rows        parseCSV() output (first row = header)
 * @param employees   [{ id, name }]
 * @param opts        { employeeId: for files without an employee column, breakUnit: 'min'|'h', defaultStart: '09:00' }
 * @returns { columns, items: [{ line, raw, row?, error? }] }  row = { employee_id, date, in, out, break_min, note }
 */
export function buildImport(rows, employees, { employeeId = null, breakUnit = 'min', defaultStart = '09:00' } = {}) {
  const [header = [], ...body] = rows;
  const col = mapColumns(header);
  const byName = new Map(employees.map((e) => [norm(e.name), e.id]));
  const items = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (k) => (col[k] >= 0 ? cells[col[k]] ?? '' : '');
    if (isSummaryRow(cells)) return; // "TOTAL" lines from payroll sheets
    const item = { line, raw: cells };
    try {
      let emp = employeeId;
      if (col.employee >= 0) {
        const n = norm(get('employee'));
        if (!n) throw new Error('No employee name');
        emp = byName.get(n);
        if (!emp) throw new Error(`Unknown employee "${get('employee')}"`);
      }
      if (!emp) throw new Error('Choose the employee for this file');
      const date = normalizeDate(get('date'));
      if (!date) throw new Error(`Bad date "${get('date')}"`);
      let tin = normalizeTime(get('in')), tout = normalizeTime(get('out'));
      if ((!tin || !tout) && col.hours >= 0 && Number(get('hours')) > 0) {
        // Only a number of hours (no times): start at the default time
        tin = tin || defaultStart;
        const mins = Math.round(Number(get('hours')) * 60);
        const [h, m] = tin.split(':').map(Number);
        const end = h * 60 + m + mins;
        tout = `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
      }
      if (!tin) throw new Error(`Bad clock-in time "${get('in')}"`);
      if (!tout) throw new Error(`Bad clock-out time "${get('out')}"`);
      const brRaw = Number(get('break')) || 0;
      item.row = { employee_id: emp, date, in: tin, out: tout, break_min: Math.round(breakUnit === 'h' ? brRaw * 60 : brRaw), note: get('note') };
    } catch (e) { item.error = e.message; }
    items.push(item);
  });
  return { columns: col, items };
}

export const TEMPLATE = 'Employee,Date,Clock in,Clock out,Break (min),Note\r\nVera,2025-08-05,09:00,18:00,60,\r\nVera,2025-08-06,08:30,17:30,60,\r\n';

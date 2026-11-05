import { test } from 'node:test';
import assert from 'node:assert';
import { parseCSV, normalizeDate, normalizeTime, buildImport } from '../public/js/csv-import.js';

test('parse CSV with quotes, BOM and semicolons', () => {
  assert.deepEqual(parseCSV('﻿a,b\r\n"x, y","He said ""hi"""\n'), [['a', 'b'], ['x, y', 'He said "hi"']]);
  assert.deepEqual(parseCSV('a;b\n1;2\n'), [['a', 'b'], ['1', '2']]);
});

test('dates and times in common formats', () => {
  assert.deepEqual(['2026-08-05', '2026/8/5', '8/5/2026', '25/8/2026', '2026年8月5日', '2026-02-30', 'x'].map(normalizeDate),
    ['2026-08-05', '2026-08-05', '2026-08-05', '2026-08-25', '2026-08-05', null, null]);
  assert.deepEqual(['9:00', '09:00:00', '9:00 AM', '1:05 PM', '12:30 AM', '上午8:44', '下午1:05', '13.30', '0900', '25:00', ''].map(normalizeTime),
    ['09:00', '09:00', '09:00', '13:05', '00:30', '08:44', '13:05', '13:30', '09:00', null, null]);
});

test('payroll-sheet style file without employee column, with TOTAL row and hour breaks', () => {
  const rows = parseCSV('Date,Clock in,Clock out,Break,Hours to pay\n2026-05-12,9:00:00 AM,7:55:00 PM,2,9.9\n2026-05-13,9:00:00 AM,7:37:55 PM,2,9.6\nTOTAL,,,,19.5\n');
  const r = buildImport(rows, [{ id: 7, name: 'Vera' }], { employeeId: 7, breakUnit: 'h' });
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0].row, { employee_id: 7, date: '2026-05-12', in: '09:00', out: '19:55', break_min: 120, note: '' });
});

test('employee column in Chinese, unknown names and hours-only rows', () => {
  const rows = parseCSV('員工,日期,工時,備註\nvera,2026/8/5,7.5,舊系統\nBob,2026/8/5,8,\n');
  const r = buildImport(rows, [{ id: 7, name: 'Vera' }], { defaultStart: '09:00' });
  assert.deepEqual(r.items[0].row, { employee_id: 7, date: '2026-08-05', in: '09:00', out: '16:30', break_min: 0, note: '舊系統' });
  assert.match(r.items[1].error, /Unknown employee/);
});

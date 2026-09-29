'use strict';

/** RFC4180 风格 CSV 解析，支持引号内的逗号 / 换行 / 双引号转义 */
function parseCSV(text) {
  const src = String(text || '').replace(/^﻿/, '');  // 去掉 Excel 的 BOM
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => String(f).trim() !== ''));
}

function escapeField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** 生成 CSV。带 BOM，Excel 打开中文不乱码。 */
function toCSV(headers, rows) {
  const lines = [headers.map(escapeField).join(',')];
  for (const r of rows) lines.push(r.map(escapeField).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { parseCSV, toCSV };

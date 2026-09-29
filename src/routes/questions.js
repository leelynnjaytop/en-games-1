'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../lib/auth');
const { parseCSV, toCSV } = require('../lib/csv');
const { RULE_TAGS, TAG_MAP, TYPES } = require('../lib/tags');

const router = express.Router();

const CSV_HEADERS = ['id','type','stem','stem_zh','options','answer','rule_tag','difficulty','explain_zh','explain_en','tts_text','enabled'];

function rowToApi(r) {
  let options = [];
  try { options = JSON.parse(r.options || '[]'); } catch { options = []; }
  return { ...r, options, enabled: !!r.enabled };
}

/** 校验一道题，返回错误信息数组（空数组表示通过） */
function validate(q) {
  const errs = [];
  if (!['choice', 'fill', 'fix'].includes(q.type)) errs.push(`题型必须是 choice/fill/fix，收到「${q.type}」`);
  if (!String(q.stem || '').trim()) errs.push('题干不能为空');
  if (!String(q.answer || '').trim()) errs.push('答案不能为空');
  const d = Number(q.difficulty);
  if (![1, 2, 3].includes(d)) errs.push(`难度必须是 1/2/3，收到「${q.difficulty}」`);
  if (q.type === 'choice') {
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length < 2) errs.push('单选题至少要 2 个选项');
    else if (new Set(opts).size !== opts.length) errs.push('选项有重复');
    else if (!opts.includes(String(q.answer).trim())) errs.push(`答案「${q.answer}」不在选项中：${opts.join(' / ')}`);
  }
  return errs;
}

// ── 元数据：语法点 / 题型 / 各自题量 ───────────────────────────────
router.get('/meta', (req, res) => {
  const counts = db.prepare('SELECT rule_tag, COUNT(*) n FROM questions WHERE enabled=1 GROUP BY rule_tag').all();
  const cmap = Object.fromEntries(counts.map((c) => [c.rule_tag, c.n]));
  const diff = db.prepare('SELECT difficulty, COUNT(*) n FROM questions WHERE enabled=1 GROUP BY difficulty').all();
  res.json({
    tags: RULE_TAGS.map((t) => ({ ...t, count: cmap[t.key] || 0 })),
    types: TYPES,
    difficulty: Object.fromEntries(diff.map((d) => [d.difficulty, d.n])),
    total: db.prepare('SELECT COUNT(*) n FROM questions').get().n,
    enabled: db.prepare('SELECT COUNT(*) n FROM questions WHERE enabled=1').get().n,
  });
});

// ── 导出 / 模板 ────────────────────────────────────────────────────
router.get('/export.csv', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM questions ORDER BY id').all().map((r) => [
    r.id, r.type, r.stem, r.stem_zh,
    (() => { try { return JSON.parse(r.options || '[]').join('|'); } catch { return ''; } })(),
    r.answer, r.rule_tag, r.difficulty, r.explain_zh, r.explain_en, r.tts_text, r.enabled,
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="questions-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(toCSV(CSV_HEADERS, rows));
});

router.get('/template.csv', requireAdmin, (req, res) => {
  const sample = [
    ['', 'choice', 'My brother is ___ than me.  (tall)', '我哥哥比我高。', 'taller|tallest|more tall|tall', 'taller', 'reg_er', '1', 'tall 是单音节形容词，比较级直接加 -er。', 'My brother is taller than me.', '', '1'],
    ['', 'fill',   'This river is ___ than that one.  (long)', '这条河比那条长。', '', 'longer', 'reg_er', '1', 'long → longer → longest。', 'This river is longer than that one.', '', '1'],
    ['', 'fix',    'My sister is more young than me.', '改错：找出错误并改正。', '', 'younger', 'reg_er', '2', 'young 是单音节词，比较级加 -er，不用 more。', 'My sister is younger than me.', '', '1'],
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="questions-template.csv"');
  res.send(toCSV(CSV_HEADERS, sample));
});

// ── 导入 ───────────────────────────────────────────────────────────
router.post('/import', requireAdmin, (req, res) => {
  const text = (req.body && req.body.csv) || '';
  if (!String(text).trim()) return res.status(400).json({ error: 'CSV 内容为空' });

  const rows = parseCSV(text);
  if (!rows.length) return res.status(400).json({ error: '没有解析出任何数据行' });

  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const missing = ['type', 'stem', 'answer'].filter((k) => !header.includes(k));
  if (missing.length) {
    return res.status(400).json({ error: `表头缺少必需列：${missing.join(', ')}。请先下载模板 CSV。` });
  }
  const col = (r, name) => {
    const i = header.indexOf(name);
    return i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim();
  };

  const errors = [];
  const parsed = [];
  for (let i = 1; i < rows.length; i++) {
    const line = i + 1;   // CSV 里的实际行号（含表头）
    const r = rows[i];
    const optRaw = col(r, 'options');
    const q = {
      id: col(r, 'id') ? Number(col(r, 'id')) : null,
      type: (col(r, 'type') || 'choice').toLowerCase(),
      stem: col(r, 'stem'),
      stem_zh: col(r, 'stem_zh'),
      options: optRaw ? optRaw.split('|').map((s) => s.trim()).filter(Boolean) : [],
      answer: col(r, 'answer'),
      rule_tag: col(r, 'rule_tag') || 'other',
      difficulty: Number(col(r, 'difficulty') || 1),
      explain_zh: col(r, 'explain_zh'),
      explain_en: col(r, 'explain_en'),
      tts_text: col(r, 'tts_text'),
      enabled: col(r, 'enabled') === '' ? 1 : (['0', 'false', 'no', '否'].includes(col(r, 'enabled').toLowerCase()) ? 0 : 1),
    };
    if (!TAG_MAP[q.rule_tag]) {
      errors.push({ line, level: 'warn', msg: `语法点「${q.rule_tag}」不在已知列表中，已归入 other` });
      q.rule_tag = 'other';
    }
    const errs = validate(q);
    if (errs.length) { errors.push({ line, level: 'error', msg: errs.join('；') }); continue; }
    parsed.push({ line, q });
  }

  // 同一批里题干重复的，只保留第一条
  const seen = new Map();
  const finalRows = [];
  for (const item of parsed) {
    const key = item.q.stem.trim().toLowerCase();
    if (seen.has(key)) {
      errors.push({ line: item.line, level: 'warn', msg: `题干与第 ${seen.get(key)} 行重复，已跳过` });
      continue;
    }
    seen.set(key, item.line);
    finalRows.push(item.q);
  }

  const insert = db.prepare(`
    INSERT INTO questions (type,stem,stem_zh,options,answer,rule_tag,difficulty,explain_zh,explain_en,tts_text,enabled)
    VALUES (@type,@stem,@stem_zh,@options,@answer,@rule_tag,@difficulty,@explain_zh,@explain_en,@tts_text,@enabled)
  `);
  const update = db.prepare(`
    UPDATE questions SET type=@type, stem=@stem, stem_zh=@stem_zh, options=@options, answer=@answer,
      rule_tag=@rule_tag, difficulty=@difficulty, explain_zh=@explain_zh, explain_en=@explain_en,
      tts_text=@tts_text, enabled=@enabled, updated_at=datetime('now','localtime')
    WHERE id=@id
  `);
  const exists = db.prepare('SELECT 1 FROM questions WHERE id=?');

  let inserted = 0, updated = 0;
  db.transaction(() => {
    for (const q of finalRows) {
      const payload = { ...q, options: JSON.stringify(q.options) };
      if (q.id && exists.get(q.id)) { update.run(payload); updated++; }
      else { delete payload.id; insert.run(payload); inserted++; }
    }
  })();

  res.json({
    ok: true, inserted, updated,
    failed: errors.filter((e) => e.level === 'error').length,
    errors,
  });
});

// ── 列表 / 增删改 ──────────────────────────────────────────────────
router.get('/', (req, res) => {
  const where = [];
  const p = [];
  if (req.query.tag)        { where.push('rule_tag = ?');   p.push(req.query.tag); }
  if (req.query.type)       { where.push('type = ?');       p.push(req.query.type); }
  if (req.query.difficulty) { where.push('difficulty = ?'); p.push(Number(req.query.difficulty)); }
  if (req.query.enabled === '0' || req.query.enabled === '1') { where.push('enabled = ?'); p.push(Number(req.query.enabled)); }
  if (req.query.q) { where.push('(stem LIKE ? OR answer LIKE ? OR explain_zh LIKE ?)'); const k = `%${req.query.q}%`; p.push(k, k, k); }
  const sql = `SELECT * FROM questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
  res.json(db.prepare(sql).all(...p).map(rowToApi));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM questions WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: '题目不存在' });
  res.json(rowToApi(row));
});

router.post('/', requireAdmin, (req, res) => {
  const b = req.body || {};
  const q = {
    type: b.type || 'choice',
    stem: String(b.stem || '').trim(),
    stem_zh: String(b.stem_zh || '').trim(),
    options: Array.isArray(b.options) ? b.options.map((s) => String(s).trim()).filter(Boolean) : [],
    answer: String(b.answer || '').trim(),
    rule_tag: TAG_MAP[b.rule_tag] ? b.rule_tag : 'other',
    difficulty: Number(b.difficulty) || 1,
    explain_zh: String(b.explain_zh || '').trim(),
    explain_en: String(b.explain_en || '').trim(),
    tts_text: String(b.tts_text || '').trim(),
    enabled: b.enabled === false || b.enabled === 0 ? 0 : 1,
  };
  const errs = validate(q);
  if (errs.length) return res.status(400).json({ error: errs.join('；') });

  const info = db.prepare(`
    INSERT INTO questions (type,stem,stem_zh,options,answer,rule_tag,difficulty,explain_zh,explain_en,tts_text,enabled)
    VALUES (@type,@stem,@stem_zh,@options,@answer,@rule_tag,@difficulty,@explain_zh,@explain_en,@tts_text,@enabled)
  `).run({ ...q, options: JSON.stringify(q.options) });
  res.status(201).json(rowToApi(db.prepare('SELECT * FROM questions WHERE id=?').get(info.lastInsertRowid)));
});

router.put('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM questions WHERE id=?').get(id);
  if (!cur) return res.status(404).json({ error: '题目不存在' });
  const b = req.body || {};
  let curOpts = [];
  try { curOpts = JSON.parse(cur.options || '[]'); } catch { curOpts = []; }

  const q = {
    id,
    type: b.type ?? cur.type,
    stem: b.stem !== undefined ? String(b.stem).trim() : cur.stem,
    stem_zh: b.stem_zh !== undefined ? String(b.stem_zh).trim() : cur.stem_zh,
    options: b.options !== undefined ? (Array.isArray(b.options) ? b.options.map((s) => String(s).trim()).filter(Boolean) : []) : curOpts,
    answer: b.answer !== undefined ? String(b.answer).trim() : cur.answer,
    rule_tag: b.rule_tag !== undefined ? (TAG_MAP[b.rule_tag] ? b.rule_tag : 'other') : cur.rule_tag,
    difficulty: b.difficulty !== undefined ? Number(b.difficulty) : cur.difficulty,
    explain_zh: b.explain_zh !== undefined ? String(b.explain_zh).trim() : cur.explain_zh,
    explain_en: b.explain_en !== undefined ? String(b.explain_en).trim() : cur.explain_en,
    tts_text: b.tts_text !== undefined ? String(b.tts_text).trim() : cur.tts_text,
    enabled: b.enabled !== undefined ? (b.enabled ? 1 : 0) : cur.enabled,
  };
  const errs = validate(q);
  if (errs.length) return res.status(400).json({ error: errs.join('；') });

  db.prepare(`
    UPDATE questions SET type=@type, stem=@stem, stem_zh=@stem_zh, options=@options, answer=@answer,
      rule_tag=@rule_tag, difficulty=@difficulty, explain_zh=@explain_zh, explain_en=@explain_en,
      tts_text=@tts_text, enabled=@enabled, updated_at=datetime('now','localtime')
    WHERE id=@id
  `).run({ ...q, options: JSON.stringify(q.options) });
  res.json(rowToApi(db.prepare('SELECT * FROM questions WHERE id=?').get(id)));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM questions WHERE id=?').run(id);
  if (!info.changes) return res.status(404).json({ error: '题目不存在' });
  db.prepare('DELETE FROM wrong_book WHERE question_id=?').run(id);
  res.json({ ok: true });
});

module.exports = { router };

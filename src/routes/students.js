'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../lib/auth');

const router = express.Router();

// ── 班级 ───────────────────────────────────────────────────────────
router.get('/classes', (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id=c.id AND s.active=1) AS student_count
    FROM classes c ORDER BY c.name
  `).all());
});

router.post('/classes', requireAdmin, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: '班级名不能为空' });
  try {
    const info = db.prepare('INSERT INTO classes (name) VALUES (?)').run(name);
    res.status(201).json(db.prepare('SELECT * FROM classes WHERE id=?').get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: `班级「${name}」已存在` });
    throw e;
  }
});

router.put('/classes/:id', requireAdmin, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: '班级名不能为空' });
  const info = db.prepare('UPDATE classes SET name=? WHERE id=?').run(name, Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: '班级不存在' });
  res.json({ ok: true });
});

router.delete('/classes/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM classes WHERE id=?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: '班级不存在' });
  res.json({ ok: true });
});

// ── 学生 ───────────────────────────────────────────────────────────
router.get('/classes/:id/students', (req, res) => {
  res.json(db.prepare('SELECT * FROM students WHERE class_id=? ORDER BY seat_no, id').all(Number(req.params.id)));
});

/** 批量粘贴导入：一行一个名字，可写「学号 姓名」或「学号,姓名」 */
router.post('/classes/:id/students', requireAdmin, (req, res) => {
  const classId = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM classes WHERE id=?').get(classId)) {
    return res.status(404).json({ error: '班级不存在' });
  }
  const raw = String((req.body || {}).names || '');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: '没有可导入的姓名' });

  const ins = db.prepare('INSERT OR IGNORE INTO students (class_id, name, seat_no) VALUES (?,?,?)');
  let added = 0;
  const skipped = [];
  db.transaction(() => {
    for (const line of lines) {
      const m = line.match(/^(\d+)\s*[,，、.\s]\s*(.+)$/);
      const seat = m ? m[1] : '';
      const name = (m ? m[2] : line).trim();
      if (!name) continue;
      const info = ins.run(classId, name, seat);
      if (info.changes) added++; else skipped.push(name);
    }
  })();
  res.json({ ok: true, added, skipped, message: `导入 ${added} 人${skipped.length ? `，${skipped.length} 人重名已跳过` : ''}` });
});

router.put('/students/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM students WHERE id=?').get(Number(req.params.id));
  if (!cur) return res.status(404).json({ error: '学生不存在' });
  db.prepare('UPDATE students SET name=?, seat_no=?, active=? WHERE id=?').run(
    b.name !== undefined ? String(b.name).trim() : cur.name,
    b.seat_no !== undefined ? String(b.seat_no).trim() : cur.seat_no,
    b.active !== undefined ? (b.active ? 1 : 0) : cur.active,
    cur.id,
  );
  res.json(db.prepare('SELECT * FROM students WHERE id=?').get(cur.id));
});

router.delete('/students/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM students WHERE id=?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: '学生不存在' });
  res.json({ ok: true });
});

module.exports = { router };

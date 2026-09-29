'use strict';
const express = require('express');
const { db } = require('../db');

const router = express.Router();

function scopeClause(scope) {
  if (scope === 'today') return "date(r.created_at) = date('now','localtime')";
  if (scope === 'week')  return "date(r.created_at) >= date('now','localtime','-6 days')";
  if (scope === 'month') return "date(r.created_at) >= date('now','localtime','-29 days')";
  return '1=1';
}

/** 排行榜：默认总榜、个人赛、前 20 */
router.get('/', (req, res) => {
  const scope = String(req.query.scope || 'all');
  const mode = req.query.mode === 'team' ? 'team' : 'solo';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const where = [scopeClause(scope), 'r.mode = ?'];
  const p = [mode];
  if (req.query.classId) { where.push('r.class_id = ?'); p.push(Number(req.query.classId)); }

  const rows = db.prepare(`
    SELECT r.id, r.player_name, r.score, r.correct_count, r.total, r.max_combo, r.team,
           r.created_at, c.name AS class_name
    FROM records r LEFT JOIN classes c ON c.id = r.class_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.score DESC, r.correct_count DESC, r.created_at ASC
    LIMIT ?
  `).all(...p, limit);

  res.json(rows.map((r, i) => ({
    rank: i + 1,
    ...r,
    accuracy: r.total ? Math.round((r.correct_count / r.total) * 100) : 0,
  })));
});

/** 按人汇总（同一个名字取最好成绩 + 平均正确率） */
router.get('/players', (req, res) => {
  const scope = String(req.query.scope || 'all');
  const mode = req.query.mode === 'team' ? 'team' : 'solo';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const where = [scopeClause(scope), 'r.mode = ?'];
  const p = [mode];
  if (req.query.classId) { where.push('r.class_id = ?'); p.push(Number(req.query.classId)); }

  const rows = db.prepare(`
    SELECT r.player_name, c.name AS class_name,
           MAX(r.score) AS best_score, COUNT(*) AS plays,
           SUM(r.correct_count) AS correct_sum, SUM(r.total) AS total_sum,
           MAX(r.max_combo) AS best_combo, MAX(r.created_at) AS last_play
    FROM records r LEFT JOIN classes c ON c.id = r.class_id
    WHERE ${where.join(' AND ')}
    GROUP BY r.player_name, c.name
    ORDER BY best_score DESC, correct_sum DESC
    LIMIT ?
  `).all(...p, limit);

  res.json(rows.map((r, i) => ({
    rank: i + 1, ...r,
    accuracy: r.total_sum ? Math.round((r.correct_sum / r.total_sum) * 100) : 0,
  })));
});

/** 个人战绩 */
router.get('/personal', (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: '缺少姓名' });
  const agg = db.prepare(`
    SELECT COUNT(*) plays, MAX(score) best, SUM(correct_count) correct_sum,
           SUM(total) total_sum, MAX(max_combo) best_combo
    FROM records WHERE player_name=? AND mode='solo'
  `).get(name);
  const recent = db.prepare(`
    SELECT id, score, correct_count, total, max_combo, created_at
    FROM records WHERE player_name=? AND mode='solo'
    ORDER BY created_at DESC LIMIT 10
  `).all(name);
  res.json({
    name,
    plays: agg.plays || 0,
    best: agg.best || 0,
    bestCombo: agg.best_combo || 0,
    accuracy: agg.total_sum ? Math.round((agg.correct_sum / agg.total_sum) * 100) : 0,
    recent,
  });
});

module.exports = { router, scopeClause };

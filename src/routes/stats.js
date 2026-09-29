'use strict';
const express = require('express');
const { db } = require('../db');
const { toCSV } = require('../lib/csv');
const { requireAdmin } = require('../lib/auth');
const { tagLabel } = require('../lib/tags');
const { scopeClause } = require('./leaderboard');

const router = express.Router();

/** 按语法点统计错误率 —— 下节课该讲什么，看这个 */
router.get('/rules', (req, res) => {
  const where = ['1=1'];
  const p = [];
  const days = Number(req.query.days);
  if (days > 0) { where.push("date(sa.created_at) >= date('now','localtime', ?)"); p.push(`-${days - 1} days`); }
  if (req.query.classId) {
    where.push('sa.student_id IN (SELECT id FROM students WHERE class_id = ?)');
    p.push(Number(req.query.classId));
  }

  const rows = db.prepare(`
    SELECT q.rule_tag,
           COUNT(*) AS asked,
           SUM(CASE WHEN sa.is_correct=0 THEN 1 ELSE 0 END) AS wrong
    FROM session_answers sa JOIN questions q ON q.id = sa.question_id
    WHERE ${where.join(' AND ')}
    GROUP BY q.rule_tag
    ORDER BY (CAST(SUM(CASE WHEN sa.is_correct=0 THEN 1 ELSE 0 END) AS REAL) / COUNT(*)) DESC
  `).all(...p);

  res.json(rows.map((r) => ({
    rule_tag: r.rule_tag,
    label: tagLabel(r.rule_tag),
    asked: r.asked,
    wrong: r.wrong,
    rate: r.asked ? Math.round((r.wrong / r.asked) * 100) : 0,
  })));
});

/** 最容易错的题 TOP N */
router.get('/hard-questions', (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const rows = db.prepare(`
    SELECT id, stem, rule_tag, difficulty, times_asked, times_wrong
    FROM questions WHERE times_asked >= 2
    ORDER BY (CAST(times_wrong AS REAL) / times_asked) DESC, times_asked DESC
    LIMIT ?
  `).all(limit);
  res.json(rows.map((r) => ({ ...r, label: tagLabel(r.rule_tag), rate: Math.round((r.times_wrong / r.times_asked) * 100) })));
});

router.get('/overview', (req, res) => {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  res.json({
    questions: one('SELECT COUNT(*) n FROM questions').n,
    questionsEnabled: one('SELECT COUNT(*) n FROM questions WHERE enabled=1').n,
    classes: one('SELECT COUNT(*) n FROM classes').n,
    students: one('SELECT COUNT(*) n FROM students WHERE active=1').n,
    sessions: one('SELECT COUNT(*) n FROM sessions WHERE finished_at IS NOT NULL').n,
    sessionsToday: one("SELECT COUNT(*) n FROM sessions WHERE date(started_at)=date('now','localtime')").n,
    records: one('SELECT COUNT(*) n FROM records').n,
    answers: one('SELECT COUNT(*) n FROM session_answers').n,
    accuracy: (() => {
      const r = one('SELECT COUNT(*) a, SUM(is_correct) c FROM session_answers');
      return r.a ? Math.round((r.c / r.a) * 100) : 0;
    })(),
  });
});

/** 最近的对局，可展开看逐题明细 */
router.get('/sessions', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const rows = db.prepare(`
    SELECT s.id, s.mode, s.question_count, s.started_at, s.finished_at,
           (SELECT GROUP_CONCAT(player_name || ':' || score, ' / ') FROM records r WHERE r.session_id=s.id) AS players
    FROM sessions s
    WHERE s.finished_at IS NOT NULL
    ORDER BY s.started_at DESC LIMIT ?
  `).all(limit);
  res.json(rows);
});

router.get('/sessions/:id', (req, res) => {
  const id = Number(req.params.id);
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  if (!session) return res.status(404).json({ error: '对局不存在' });
  const answers = db.prepare(`
    SELECT sa.*, q.stem, q.answer AS right_answer, q.rule_tag, q.type
    FROM session_answers sa JOIN questions q ON q.id=sa.question_id
    WHERE sa.session_id=? ORDER BY sa.idx
  `).all(id);
  res.json({
    session,
    records: db.prepare('SELECT * FROM records WHERE session_id=?').all(id),
    answers: answers.map((a) => ({ ...a, label: tagLabel(a.rule_tag) })),
  });
});

/** 成绩导出 CSV */
router.get('/scores.csv', requireAdmin, (req, res) => {
  const scope = String(req.query.scope || 'all');
  const where = [scopeClause(scope)];
  const p = [];
  if (req.query.classId) { where.push('r.class_id = ?'); p.push(Number(req.query.classId)); }

  const rows = db.prepare(`
    SELECT r.created_at, c.name AS class_name, r.player_name, r.mode, r.team,
           r.score, r.correct_count, r.total, r.max_combo
    FROM records r LEFT JOIN classes c ON c.id=r.class_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC
  `).all(...p);

  const csv = toCSV(
    ['时间', '班级', '姓名', '模式', '队伍', '得分', '答对', '总题数', '正确率%', '最高连对'],
    rows.map((r) => [
      r.created_at, r.class_name || '', r.player_name,
      r.mode === 'team' ? '分组赛' : '个人赛',
      r.team === 'red' ? '红队' : r.team === 'blue' ? '蓝队' : '',
      r.score, r.correct_count, r.total,
      r.total ? Math.round((r.correct_count / r.total) * 100) : 0,
      r.max_combo,
    ]),
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="scores-${scope}-${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

module.exports = { router };

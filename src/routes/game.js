'use strict';
const express = require('express');
const { db } = require('../db');
const { drawQuestions, markUsed } = require('../lib/draw');
const { isCorrect, displayAnswer, scoreFor } = require('../lib/grade');
const { getAll } = require('./settings');

const router = express.Router();

/** 开一局：抽题 + 建 session */
router.post('/start', (req, res) => {
  const b = req.body || {};
  const s = getAll();
  const count = Math.max(1, Number(b.count || s.questions_per_round) || 7);
  const mode = b.mode === 'team' ? 'team' : 'solo';

  const drawn = drawQuestions(db, {
    count,
    ratio: b.ratio || s.difficulty_ratio,
    studentId: b.studentId ? Number(b.studentId) : null,
    wrongPct: b.wrongPct !== undefined ? Number(b.wrongPct) : Number(s.wrong_priority_pct),
    ruleTags: Array.isArray(b.ruleTags) ? b.ruleTags : null,
  });

  if (!drawn.questions.length) {
    return res.status(409).json({ error: '题库里没有可用的题目，请先到后台添加或启用题目。' });
  }

  const snapshot = {
    questions_per_round: count,
    timer_enabled: s.timer_enabled,
    timer_seconds: s.timer_seconds,
    difficulty_ratio: b.ratio || s.difficulty_ratio,
    base_score: s.base_score,
    speed_bonus_max: s.speed_bonus_max,
    combo_bonus: s.combo_bonus,
    penalty_on_wrong: s.penalty_on_wrong,
    ruleTags: b.ruleTags || null,
  };
  const info = db.prepare(
    'INSERT INTO sessions (mode, question_count, settings_snapshot) VALUES (?,?,?)'
  ).run(mode, drawn.questions.length, JSON.stringify(snapshot));

  markUsed(db, drawn.questions.map((q) => q.id));

  res.json({
    sessionId: info.lastInsertRowid,
    mode,
    settings: s,
    short: drawn.short,
    note: drawn.note,
    questions: drawn.questions.map((q) => ({
      id: q.id, type: q.type, stem: q.stem, stem_zh: q.stem_zh,
      options: q.options, answer: q.answer, rule_tag: q.rule_tag, difficulty: q.difficulty,
      explain_zh: q.explain_zh, explain_en: q.explain_en,
      tts_text: q.tts_text || q.explain_en,
    })),
  });
});

/** 逐题提交：服务端重新判分并落库，课上意外关页面也不丢数据 */
router.post('/answer', (req, res) => {
  const b = req.body || {};
  const sessionId = Number(b.sessionId);
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (!session) return res.status(404).json({ error: '这一局不存在，请重新开始' });

  const q = db.prepare('SELECT * FROM questions WHERE id=?').get(Number(b.questionId));
  if (!q) return res.status(404).json({ error: '题目不存在' });

  const team = ['red', 'blue'].includes(b.team) ? b.team : '';
  const picked = String(b.picked == null ? '' : b.picked);
  const msUsed = Math.max(0, Number(b.msUsed) || 0);
  const correct = isCorrect(q, picked);

  // combo 由服务端从历史推算，避免前端传错
  const prev = db.prepare(
    'SELECT is_correct FROM session_answers WHERE session_id=? AND team=? ORDER BY idx DESC'
  ).all(sessionId, team);
  let streak = 0;
  for (const r of prev) { if (r.is_correct) streak++; else break; }
  const combo = correct ? streak + 1 : 0;

  const snap = (() => { try { return JSON.parse(session.settings_snapshot || '{}'); } catch { return {}; } })();
  const s = { ...getAll(), ...snap };
  const timerMs = String(s.timer_enabled) === '1' ? Number(s.timer_seconds) * 1000 : 0;
  const sc = scoreFor(correct, msUsed, timerMs, combo, s);

  const idx = Number(b.idx) || prev.length;
  db.prepare(`
    INSERT INTO session_answers (session_id, idx, question_id, student_id, player_name, team, picked, is_correct, ms_used, score_delta, combo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    sessionId, idx, q.id,
    b.studentId ? Number(b.studentId) : null,
    String(b.playerName || ''), team, picked,
    correct ? 1 : 0, msUsed, sc.total, combo,
  );

  if (!correct) db.prepare('UPDATE questions SET times_wrong = times_wrong + 1 WHERE id=?').run(q.id);

  res.json({
    correct,
    combo,
    score: sc,
    answer: displayAnswer(q),
    explain_zh: q.explain_zh,
    explain_en: q.explain_en,
    tts_text: q.tts_text || q.explain_en,
  });
});

/** 结算：回填姓名、写排行榜记录、生成错题本 */
router.post('/finish', (req, res) => {
  const b = req.body || {};
  const sessionId = Number(b.sessionId);
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (!session) return res.status(404).json({ error: '这一局不存在' });

  const players = Array.isArray(b.players) && b.players.length
    ? b.players
    : [{ playerName: String(b.playerName || '匿名'), studentId: b.studentId, classId: b.classId, team: '' }];

  const out = [];
  db.transaction(() => {
    for (const p of players) {
      const team = ['red', 'blue'].includes(p.team) ? p.team : '';
      const name = String(p.playerName || '匿名').trim() || '匿名';
      const studentId = p.studentId ? Number(p.studentId) : null;
      const classId = p.classId ? Number(p.classId)
        : (studentId ? (db.prepare('SELECT class_id FROM students WHERE id=?').get(studentId) || {}).class_id : null);

      // 回填这一局该队/该人的姓名与学生 ID
      db.prepare('UPDATE session_answers SET player_name=?, student_id=? WHERE session_id=? AND team=?')
        .run(name, studentId, sessionId, team);

      const rows = db.prepare('SELECT * FROM session_answers WHERE session_id=? AND team=?').all(sessionId, team);
      if (!rows.length) continue;

      const score = rows.reduce((a, r) => a + r.score_delta, 0);
      const correctCount = rows.filter((r) => r.is_correct).length;
      const maxCombo = rows.reduce((a, r) => Math.max(a, r.combo), 0);

      const info = db.prepare(`
        INSERT INTO records (session_id, student_id, player_name, class_id, mode, team, score, correct_count, total, max_combo)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(sessionId, studentId, name, classId ?? null, session.mode, team, score, correctCount, rows.length, maxCombo);

      // 错题本（只有点选了名单里的学生才记得住是谁错的）
      if (studentId) {
        const up = db.prepare(`
          INSERT INTO wrong_book (student_id, question_id, wrong_count, last_wrong_at)
          VALUES (?,?,1,datetime('now','localtime'))
          ON CONFLICT(student_id, question_id)
          DO UPDATE SET wrong_count = wrong_count + 1, last_wrong_at = datetime('now','localtime')
        `);
        const clear = db.prepare('DELETE FROM wrong_book WHERE student_id=? AND question_id=?');
        for (const r of rows) {
          if (r.is_correct) clear.run(studentId, r.question_id);   // 答对就从错题本移除
          else up.run(studentId, r.question_id);
        }
      }

      out.push({ recordId: info.lastInsertRowid, team, name, score, correctCount, total: rows.length, maxCombo, classId: classId ?? null });
    }
    db.prepare("UPDATE sessions SET finished_at=datetime('now','localtime') WHERE id=?").run(sessionId);
  })();

  // 名次 & 是否破纪录
  for (const r of out) {
    const better = db.prepare(
      "SELECT COUNT(*) n FROM records WHERE mode=? AND score > ? AND id <> ?"
    ).get(session.mode, r.score, r.recordId).n;
    r.rankAll = better + 1;

    const betterToday = db.prepare(
      "SELECT COUNT(*) n FROM records WHERE mode=? AND score > ? AND id <> ? AND date(created_at)=date('now','localtime')"
    ).get(session.mode, r.score, r.recordId).n;
    r.rankToday = betterToday + 1;

    const prevBest = db.prepare(
      'SELECT MAX(score) m FROM records WHERE player_name=? AND mode=? AND id <> ?'
    ).get(r.name, session.mode, r.recordId).m;
    r.personalBest = prevBest == null ? null : prevBest;
    r.isNewPersonalBest = prevBest == null || r.score > prevBest;
  }

  res.json({ ok: true, mode: session.mode, results: out });
});

/** 未完成的局（刷新页面后可以接着打） */
router.get('/session/:id', (req, res) => {
  const id = Number(req.params.id);
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  if (!session) return res.status(404).json({ error: '这一局不存在' });
  const answers = db.prepare('SELECT * FROM session_answers WHERE session_id=? ORDER BY idx').all(id);
  res.json({ session, answers });
});

module.exports = { router };

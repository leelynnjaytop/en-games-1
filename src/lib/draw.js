'use strict';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "3:3:1" → [3,3,1] */
function parseRatio(str) {
  const p = String(str || '3:3:1').split(':').map((n) => Math.max(0, Number(String(n).trim()) || 0));
  while (p.length < 3) p.push(0);
  return p.slice(0, 3);
}

/** 按配比把 count 道题分到三个难度档，余数按小数部分大小分配 */
function allocate(count, ratio) {
  const sum = ratio.reduce((a, b) => a + b, 0);
  if (!sum || count <= 0) return [count > 0 ? count : 0, 0, 0];
  const raw = ratio.map((r) => (count * r) / sum);
  const base = raw.map(Math.floor);
  let rest = count - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v), w: ratio[i] }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) base[order[k].i]++;
  return base;
}

/** 新鲜度排序：没出过的排最前，其次是最久没出的；同档内加随机避免每次顺序一样 */
function byFreshness(list, need) {
  const sorted = list.slice().sort((a, b) => {
    const A = a.last_used_at || '';
    const B = b.last_used_at || '';
    if (A === B) return 0;
    if (!A) return -1;
    if (!B) return 1;
    return A < B ? -1 : 1;
  });
  // 取前 3 倍候选再打乱，兼顾"优先没出过的"和"每局不一样"
  return shuffle(sorted.slice(0, Math.max(need * 3, need + 4)));
}

const TAG_CAP = 2;  // 同一局内同一语法点最多几道

/**
 * 抽一局的题
 * @returns {{questions: Array, short: boolean, wanted: number, note: string}}
 */
function drawQuestions(db, opts = {}) {
  const count = Math.max(1, Number(opts.count) || 7);
  const ratio = parseRatio(opts.ratio);
  const wrongPct = Math.max(0, Math.min(100, Number(opts.wrongPct ?? 30)));
  const studentId = opts.studentId || null;
  const ruleTags = Array.isArray(opts.ruleTags) && opts.ruleTags.length ? opts.ruleTags : null;

  let sql = 'SELECT * FROM questions WHERE enabled = 1';
  const params = [];
  if (ruleTags) {
    sql += ` AND rule_tag IN (${ruleTags.map(() => '?').join(',')})`;
    params.push(...ruleTags);
  }
  const pool = db.prepare(sql).all(...params);

  const picked = [];
  const usedIds = new Set();
  const tagCount = {};
  const notes = [];

  const canTake = (q, relaxTag = false) => {
    if (usedIds.has(q.id)) return false;
    if (!relaxTag && (tagCount[q.rule_tag] || 0) >= TAG_CAP) return false;
    return true;
  };
  const take = (q) => {
    picked.push(q);
    usedIds.add(q.id);
    tagCount[q.rule_tag] = (tagCount[q.rule_tag] || 0) + 1;
  };

  // ① 错题本优先：给这名学生留一部分名额重出错题
  if (studentId && wrongPct > 0) {
    const want = Math.min(count, Math.round((count * wrongPct) / 100));
    if (want > 0) {
      const poolIds = new Set(pool.map((q) => q.id));
      const wrongs = db.prepare(`
        SELECT question_id FROM wrong_book
        WHERE student_id = ?
        ORDER BY wrong_count DESC, last_wrong_at DESC
        LIMIT ?
      `).all(studentId, want * 3).map((r) => r.question_id).filter((id) => poolIds.has(id));

      for (const q of shuffle(pool.filter((x) => wrongs.includes(x.id)))) {
        if (picked.length >= want) break;
        if (canTake(q)) take(q);
      }
      if (picked.length) notes.push(`错题重出 ${picked.length} 道`);
    }
  }

  // ② 按难度配比填满剩余名额
  const alloc = allocate(count - picked.length, ratio);
  const shortfall = [];
  for (let d = 1; d <= 3; d++) {
    let need = alloc[d - 1];
    if (need <= 0) continue;
    const cands = pool.filter((q) => q.difficulty === d && canTake(q));
    for (const q of byFreshness(cands, need)) {
      if (need <= 0) break;
      if (canTake(q)) { take(q); need--; }
    }
    if (need > 0) shortfall.push({ d, need });
  }

  // ③ 某个难度档不够，就近从其他档补
  for (const { d, need: n0 } of shortfall) {
    let need = n0;
    const nearest = [1, 2, 3].filter((x) => x !== d).sort((a, b) => Math.abs(a - d) - Math.abs(b - d));
    for (const alt of nearest) {
      if (need <= 0) break;
      const cands = pool.filter((q) => q.difficulty === alt && canTake(q));
      for (const q of byFreshness(cands, need)) {
        if (need <= 0) break;
        if (canTake(q)) { take(q); need--; }
      }
    }
    if (need > 0) notes.push(`难度 ${d} 的题不够，已用其他难度顶替`);
  }

  // ④ 还差就放宽"同语法点最多 2 道"的限制
  if (picked.length < count) {
    const cands = pool.filter((q) => canTake(q, true));
    for (const q of byFreshness(cands, count - picked.length)) {
      if (picked.length >= count) break;
      if (canTake(q, true)) take(q);
    }
    if (picked.length < count) {
      notes.push(`题库可用题目只有 ${picked.length} 道，不足本局 ${count} 道，建议到后台补题`);
    }
  }

  // ⑤ 打乱出题顺序，并打乱每道选择题的选项，避免答案总在同一位置
  const questions = shuffle(picked).map((q) => {
    let options = [];
    try { options = JSON.parse(q.options || '[]'); } catch { options = []; }
    return { ...q, options: q.type === 'choice' ? shuffle(options) : [] };
  });

  return {
    questions,
    short: questions.length < count,
    wanted: count,
    note: notes.join('；'),
  };
}

/** 标记题目已被使用（影响下次的新鲜度排序） */
function markUsed(db, ids) {
  if (!ids || !ids.length) return;
  const stmt = db.prepare(`
    UPDATE questions
    SET times_asked = times_asked + 1, last_used_at = datetime('now','localtime')
    WHERE id = ?
  `);
  db.transaction(() => { for (const id of ids) stmt.run(id); })();
}

module.exports = { drawQuestions, markUsed, parseRatio, allocate, shuffle };

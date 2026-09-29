/*!
 * game.js —— 大屏游戏状态机
 * 流程：待机 →（随机点名）→ 出题 ×N →（答错弹语法卡）→ 结算 → 记名 → 排行榜
 * 判分策略：本地先判给出瞬时反馈（0 延迟），同时提交服务端权威判分并以服务端分数为准。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const RING_LEN = 2 * Math.PI * 52;   // 结算页圆环周长

  const CHEERS_RIGHT = [
    '漂亮！Excellent!', '语法大师！Grammar master!', '稳！Nailed it!',
    '就是这样！That\'s it!', '太强了！Brilliant!', '完美！Perfect!',
    '这题拿下！Well done!', '手感火热！On fire!',
  ];
  const CHEERS_WRONG = [
    '💪 记住这条规则，下一题稳住！',
    '🌱 错一题不要紧，知道为什么错才是赚到！',
    '🔍 这是个高频考点，能在课堂上踩到很值！',
    '🚀 规则记牢了，下次就是你的送分题！',
    '👏 敢答就值得鼓掌，继续！',
  ];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // ── 状态 ──────────────────────────────────────────────────────
  const S = {
    settings: {}, meta: null, classes: [], students: [],
    mode: 'solo', classId: '',
    player: { name: '', studentId: null },
    teams: { red: [], blue: [] },
    sessionId: null, questions: [], idx: 0, answerSeq: 0,
    score: 0, combo: 0, maxCombo: 0,
    teamScore: { red: 0, blue: 0 }, currentTeam: 'red', stealing: false,
    answers: [], locked: true, saved: false,
    raf: null, tStart: 0, tLimit: 0, lastSec: -1,
    lastResult: null,
  };

  // 后台「⚡ 薄弱点专项练习」会跳到 /?tags=reg_y,as_as,irregular
  const URL_TAGS = (new URLSearchParams(location.search).get('tags') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const on = (k) => String(S.settings[k]) === '1';

  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `请求失败 ${r.status}`);
    return data;
  }

  // ── 屏幕切换 ──────────────────────────────────────────────────
  let screen = 'home';
  function show(name) {
    screen = name;
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === 'screen-' + name);
    document.body.classList.remove('urgent');
  }

  // ── 判分（与服务端 grade.js 保持一致） ─────────────────────────
  const normalize = (s) => String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[‘’]/g, "'").replace(/\s+/g, ' ').replace(/[\s.。!！?？,，;；]+$/, '');
  function gradeLocal(q, picked) {
    if (!picked) return false;
    if (q.type === 'choice') return normalize(picked) === normalize(q.answer);
    return String(q.answer).split('|').map(normalize).filter(Boolean).includes(normalize(picked));
  }
  function localScore(correct, msUsed, combo) {
    if (!correct) return -num(S.settings.penalty_on_wrong, 0);
    const base = num(S.settings.base_score, 10);
    const smax = num(S.settings.speed_bonus_max, 5);
    const limit = on('timer_enabled') ? num(S.settings.timer_seconds, 15) * 1000 : 0;
    const speed = smax > 0 && limit > 0 ? Math.round(smax * Math.max(0, limit - msUsed) / limit) : 0;
    const t = String(S.settings.combo_bonus || '2,3,5').split(',').map((x) => num(x, 0));
    const cb = combo >= 4 ? t[2] : combo === 3 ? t[1] : combo === 2 ? t[0] : 0;
    return base + speed + (cb || 0);
  }

  // ═══════════════ 启动 ═══════════════
  async function boot() {
    try {
      S.settings = await api('GET', '/api/settings');
    } catch { S.settings = {}; }
    SFX.setEnabled(on('sfx_enabled'));
    SFX.setVolume(num(S.settings.sfx_volume, .8));
    TTS.setEnabled(on('tts_enabled'));
    TTS.setRate(num(S.settings.tts_rate, .9));
    syncToggleButtons();

    $('chipCount').textContent = num(S.settings.questions_per_round, 7);
    $('chipTimer').innerHTML = on('timer_enabled')
      ? `每题 <b>${num(S.settings.timer_seconds, 15)}</b> 秒`
      : '<b>不限时</b>';
    $('ttsInfo').textContent = TTS.available() ? '朗读音色：' + TTS.voiceName() : '（此浏览器不支持朗读）';

    try {
      S.meta = await api('GET', '/api/questions/meta');
      $('chipBank').textContent = S.meta.enabled;
    } catch { $('chipBank').textContent = '?'; }

    if (URL_TAGS.length) {
      const names = URL_TAGS.map((t) => tagZh(t)).join('、');
      const tip = document.createElement('div');
      tip.className = 'panel';
      tip.style.cssText = 'width:min(94vw,1100px);border-color:var(--gold);background:rgba(255,209,102,.12)';
      tip.innerHTML = '<b style="color:var(--gold)">⚡ 薄弱点专项练习</b><br>' +
        '<span class="dim">本局只出这些语法点的题：' + esc(names) + '</span>' +
        ' &nbsp;<a href="/" style="color:var(--gold)">切回普通模式</a>';
      $('soloPanel').parentNode.insertBefore(tip, $('soloPanel'));
    }

    await loadClasses();
    refreshHomeBoard();
  }

  async function loadClasses() {
    try { S.classes = await api('GET', '/api/classes'); } catch { S.classes = []; }
    const opts = '<option value="">（不选班级）</option>' +
      S.classes.map((c) => `<option value="${c.id}">${esc(c.name)} · ${c.student_count}人</option>`).join('');
    $('classSel').innerHTML = opts;
    $('boardClassSel').innerHTML = '<option value="">全部班级</option>' +
      S.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const saved = localStorage.getItem('engames.classId');
    if (saved && S.classes.some((c) => String(c.id) === saved)) {
      $('classSel').value = saved;
      await onClassChange();
    }
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function onClassChange() {
    S.classId = $('classSel').value;
    localStorage.setItem('engames.classId', S.classId);
    S.students = [];
    if (S.classId) {
      try {
        S.students = (await api('GET', `/api/classes/${S.classId}/students`)).filter((s) => s.active);
      } catch { S.students = []; }
    }
    S.player = { name: '', studentId: null };
    $('playerInput').value = '';
    S.teams = { red: [], blue: [] };
    renderNameGrid();
    renderTeams();
  }

  function renderNameGrid() {
    const g = $('nameGrid');
    if (!S.students.length) {
      g.innerHTML = '';
      $('nameHint').textContent = S.classId
        ? '这个班还没有学生名单，可以到后台批量粘贴导入。'
        : '选班级后可直接点名字计分（会自动记录个人错题本）；不选也能玩，手动输名字即可。';
      return;
    }
    g.innerHTML = S.students.map((s) =>
      `<button class="name-btn${S.player.studentId === s.id ? ' on' : ''}" data-sid="${s.id}">${esc(s.name)}</button>`).join('');
    $('nameHint').textContent = '点一下名字就选中了，结算时自动计分并记录这名学生的错题本。';
  }

  function renderTeams() {
    const mk = (list) => list.map((s) => `<button class="name-btn" data-tsid="${s.id}">${esc(s.name)}</button>`).join('')
      || '<span class="dim" style="font-size:.9rem">（空）</span>';
    $('redGrid').innerHTML = mk(S.teams.red);
    $('blueGrid').innerHTML = mk(S.teams.blue);
    $('redCount').textContent = S.teams.red.length;
    $('blueCount').textContent = S.teams.blue.length;
  }

  async function refreshHomeBoard() {
    if (!on('show_leaderboard_home')) { $('homeBoard').style.display = 'none'; return; }
    try {
      const rows = await api('GET', '/api/leaderboard?scope=today&limit=5');
      $('homeBoardBody').innerHTML = rows.length
        ? rows.map((r) => `<div class="row" style="gap:.8em;padding:.22em 0">
             <b style="width:2em;color:var(--gold)">${['🥇','🥈','🥉'][r.rank-1] || r.rank}</b>
             <span style="flex:1">${esc(r.player_name)}${r.class_name ? ` <span class="dim">· ${esc(r.class_name)}</span>` : ''}</span>
             <b style="color:var(--gold)">${r.score}</b>
             <span class="dim">${r.correct_count}/${r.total}</span></div>`).join('')
        : '还没有人上榜，快来当第一个！';
    } catch { /* 离线时静默 */ }
  }

  // ═══════════════ 开一局 ═══════════════
  async function startGame() {
    SFX.unlock();
    if (S.mode === 'solo' && !S.player.name) {
      const typed = $('playerInput').value.trim();
      if (typed) S.player = { name: typed, studentId: null };
    }
    $('btnStart').disabled = true;
    try {
      const r = await api('POST', '/api/game/start', {
        mode: S.mode,
        studentId: S.mode === 'solo' ? S.player.studentId : null,
        ruleTags: URL_TAGS.length ? URL_TAGS : null,
      });
      S.sessionId = r.sessionId;
      S.questions = r.questions;
      S.settings = Object.assign(S.settings, r.settings);
      if (r.short) console.warn('题目不足：', r.note);

      S.idx = 0; S.answerSeq = 0; S.score = 0; S.combo = 0; S.maxCombo = 0;
      S.answers = []; S.saved = false; S.lastResult = null;
      S.teamScore = { red: 0, blue: 0 };
      S.currentTeam = 'red'; S.stealing = false;

      $('teamBar').style.display = S.mode === 'team' ? 'flex' : 'none';
      $('scoreNow').style.display = S.mode === 'team' ? 'none' : '';
      updateTeamBar();

      SFX.start();
      show('quiz');
      renderQuestion();
    } catch (e) {
      alert('开局失败：' + e.message);
    } finally {
      $('btnStart').disabled = false;
    }
  }

  const DIFF_LABEL = { 1: '易 Easy', 2: '中 Medium', 3: '难 Hard' };
  const TYPE_LABEL = { choice: '单选 Choice', fill: '填空 Fill', fix: '改错 Fix' };
  const tagZh = (k) => (S.meta && (S.meta.tags.find((t) => t.key === k) || {}).zh) || k;

  function renderQuestion() {
    const q = S.questions[S.idx];
    S.locked = false;
    S.stealing = false;
    if (S.mode === 'team') S.currentTeam = S.idx % 2 === 0 ? 'red' : 'blue';

    // 进度点
    $('dots').innerHTML = S.questions.map((_, i) => {
      const a = S.answers.find((x) => x.qIdx === i);
      const cls = i === S.idx ? 'now' : a ? (a.correct ? 'done' : 'miss') : '';
      return `<span class="dot ${cls}"></span>`;
    }).join('');
    $('qCounter').textContent = `${S.idx + 1} / ${S.questions.length}`;

    $('tagType').textContent = TYPE_LABEL[q.type] || q.type;
    $('tagDiff').textContent = DIFF_LABEL[q.difficulty] || q.difficulty;
    $('tagDiff').className = 'tag d' + q.difficulty;
    $('tagRule').textContent = tagZh(q.rule_tag);

    $('turnBadgeWrap').innerHTML = S.mode === 'team'
      ? `<span class="turn-badge ${S.currentTeam}">${S.currentTeam === 'red' ? '🔴 红队答题' : '🔵 蓝队答题'}</span>` : '';

    $('stem').innerHTML = esc(q.stem).replace(/_{2,}/g, '<span class="blank">______</span>');
    $('stemZh').textContent = q.stem_zh || '';

    if (q.type === 'choice') {
      $('opts').style.display = 'grid';
      $('fillWrap').style.display = 'none';
      $('opts').classList.toggle('one-col', q.options.some((o) => o.length > 22));
      $('opts').innerHTML = q.options.map((o, i) =>
        `<button class="opt" data-val="${esc(o)}"><span class="num">${i + 1}</span><span>${esc(o)}</span></button>`).join('');
    } else {
      $('opts').style.display = 'none';
      $('fillWrap').style.display = 'flex';
      const inp = $('fillInput');
      inp.value = ''; inp.className = 'fill-input en'; inp.disabled = false;
      inp.placeholder = q.type === 'fix' ? '输入改正后的词…' : '在这里输入答案…';
      $('btnSubmitFill').disabled = false;
      setTimeout(() => inp.focus(), 60);
    }

    updateScoreUI();
    startTimer(num(S.settings.timer_seconds, 15));
  }

  function updateScoreUI() {
    $('scoreNow').textContent = S.score;
    const box = $('comboBox');
    box.classList.toggle('on', S.combo >= 2);
    box.classList.toggle('hot', S.combo >= 5);
    $('comboNum').textContent = S.combo;
    box.firstElementChild.textContent = S.combo >= 5 ? '🔥🔥🔥' : S.combo >= 3 ? '🔥🔥' : '🔥';
  }

  function updateTeamBar() {
    if (S.mode !== 'team') return;
    const r = Math.max(0, S.teamScore.red), b = Math.max(0, S.teamScore.blue);
    const total = r + b;
    const pct = total === 0 ? 50 : Math.min(85, Math.max(15, (r / total) * 100));
    $('segRed').style.width = pct + '%';
    $('segBlue').style.width = (100 - pct) + '%';
    $('redScore').textContent = r;
    $('blueScore').textContent = b;
  }

  // ── 倒计时 ────────────────────────────────────────────────────
  function stopTimer() {
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = null;
    document.body.classList.remove('urgent');
  }

  function startTimer(seconds, fraction) {
    stopTimer();
    const fill = $('timerFill');
    if (!on('timer_enabled')) {
      $('timerBar').style.visibility = 'hidden';
      return;
    }
    $('timerBar').style.visibility = 'visible';
    S.tLimit = Math.max(3, seconds) * 1000 * (fraction || 1);
    S.tStart = performance.now();
    S.lastSec = -1;
    fill.classList.remove('warn');

    const step = () => {
      const left = Math.max(0, S.tLimit - (performance.now() - S.tStart));
      const pct = (left / S.tLimit) * 100;
      fill.style.width = pct + '%';
      const sec = Math.ceil(left / 1000);
      if (sec !== S.lastSec) {
        S.lastSec = sec;
        if (sec > 0 && sec <= 5) { SFX.tick(true); fill.classList.add('warn'); document.body.classList.add('urgent'); }
        else if (sec > 0) SFX.tick(false);
      }
      if (left <= 0) { stopTimer(); onTimeout(); return; }
      S.raf = requestAnimationFrame(step);
    };
    S.raf = requestAnimationFrame(step);
  }

  function onTimeout() {
    if (S.locked) return;
    SFX.timeout();
    submit('', true);
  }

  // ── 提交答案 ──────────────────────────────────────────────────
  async function submit(picked, isTimeout) {
    if (S.locked) return;
    S.locked = true;
    stopTimer();

    const q = S.questions[S.idx];
    const msUsed = on('timer_enabled') ? Math.min(S.tLimit, performance.now() - S.tStart) : 0;
    const correct = gradeLocal(q, picked);
    const team = S.mode === 'team' ? S.currentTeam : '';
    const comboNext = correct ? S.combo + 1 : 0;

    // ① 立刻给反馈（不等网络）
    if (q.type === 'choice') {
      for (const el of document.querySelectorAll('.opt')) {
        el.classList.add('locked');
        const v = el.dataset.val;
        if (normalize(v) === normalize(q.answer)) el.classList.add('right');
        else if (v === picked) el.classList.add('wrong');
        else el.classList.add('dimmed');
      }
    } else {
      const inp = $('fillInput');
      inp.disabled = true;
      inp.classList.add(correct ? 'right' : 'wrong');
      $('btnSubmitFill').disabled = true;
    }

    if (correct) {
      S.combo = comboNext;
      S.maxCombo = Math.max(S.maxCombo, S.combo);
      SFX.correct();
      if (S.combo >= 2) setTimeout(() => SFX.combo(S.combo), 260);
      FX.pop('👍', { sub: pick(CHEERS_RIGHT) });
      FX.confetti(90);
      FX.flash('rgba(6,214,160,.22)');
      if (S.combo === 5) setTimeout(() => FX.pop('🔥', { sub: 'ON FIRE! 连对 5 题！', className: 'fire' }), 700);
    } else {
      S.combo = 0;
      if (!isTimeout) SFX.wrong();
      FX.shake(document.body, 'hard');
      FX.flash('rgba(239,71,111,.2)');
    }

    S.answers.push({ qIdx: S.idx, questionId: q.id, correct, rule_tag: q.rule_tag, picked, team });

    // ② 服务端权威判分
    let gained = localScore(correct, msUsed, comboNext);
    try {
      const r = await api('POST', '/api/game/answer', {
        sessionId: S.sessionId, idx: S.answerSeq++, questionId: q.id,
        studentId: S.mode === 'solo' ? S.player.studentId : null,
        playerName: S.mode === 'solo' ? S.player.name : (team === 'red' ? '红队' : '蓝队'),
        team, picked, msUsed: Math.round(msUsed),
      });
      gained = r.score.total;
      S.combo = r.combo;
      S.maxCombo = Math.max(S.maxCombo, S.combo);
    } catch (e) {
      console.warn('提交答案失败，先用本地分数继续：', e.message);
    }

    if (S.mode === 'team') S.teamScore[team] += gained;
    else S.score += gained;
    updateScoreUI();
    updateTeamBar();

    if (gained !== 0) {
      FX.floatScore((gained > 0 ? '+' : '') + gained, innerWidth / 2, innerHeight * 0.42,
        gained < 0 ? 'minus' : (S.combo >= 2 ? 'bonus' : ''));
    }

    // ③ 答对读一遍正确句（英语课的发音价值）
    if (correct) TTS.speak(q.tts_text || q.explain_en);

    // ④ 分组赛：答错给对方抢答机会
    if (!correct && S.mode === 'team' && on('team_steal') && !S.stealingDone) {
      setTimeout(() => offerSteal(q, picked), 900);
      return;
    }

    setTimeout(() => (correct ? next() : showRuleCard(q, picked, isTimeout)), correct ? 1250 : 700);
  }

  /** 分组赛抢答：同一题交给对方，限时减半 */
  function offerSteal(q, wrongPick) {
    S.stealingDone = true;
    S.currentTeam = S.currentTeam === 'red' ? 'blue' : 'red';
    S.locked = false;
    SFX.steal();
    $('turnBadgeWrap').innerHTML =
      `<span class="turn-badge ${S.currentTeam}">🔄 ${S.currentTeam === 'red' ? '红队' : '蓝队'}抢答机会！</span>`;

    if (q.type === 'choice') {
      for (const el of document.querySelectorAll('.opt')) {
        el.classList.remove('locked', 'right', 'wrong', 'dimmed');
        if (el.dataset.val === wrongPick) { el.classList.add('wrong', 'locked', 'dimmed'); }
      }
    } else {
      const inp = $('fillInput');
      inp.disabled = false; inp.value = ''; inp.className = 'fill-input en';
      $('btnSubmitFill').disabled = false;
      setTimeout(() => inp.focus(), 60);
    }
    startTimer(num(S.settings.timer_seconds, 15), 0.5);
  }

  // ── 语法规则卡 ────────────────────────────────────────────────
  function showRuleCard(q, picked, isTimeout) {
    $('rowPicked').style.display = isTimeout || !picked ? 'none' : 'flex';
    $('rcPicked').textContent = picked || '';
    $('rcAnswer').textContent = String(q.answer).split('|')[0];
    $('rcExplain').textContent = q.explain_zh || '';
    $('rcExample').textContent = q.explain_en || '';
    $('rcCheer').textContent = isTimeout ? '⏰ 时间到！先记住这条规则，下一题抢快点！' : pick(CHEERS_WRONG);
    $('ruleOverlay').classList.add('show');
    TTS.speak(q.tts_text || q.explain_en);

    if (!on('rule_card_manual')) setTimeout(closeRuleCard, 5000);
  }

  function closeRuleCard() {
    if (!$('ruleOverlay').classList.contains('show')) return;
    $('ruleOverlay').classList.remove('show');
    TTS.cancel();
    next();
  }

  function next() {
    S.stealingDone = false;
    S.idx++;
    if (S.idx >= S.questions.length) finish();
    else renderQuestion();
  }

  // ═══════════════ 结算 ═══════════════
  async function finish() {
    stopTimer();
    TTS.cancel();
    show('result');

    const correctCount = S.answers.filter((a) => a.correct).length;
    const total = S.questions.length;
    const acc = total ? Math.round((correctCount / total) * 100) : 0;
    const shownScore = S.mode === 'team' ? Math.max(S.teamScore.red, S.teamScore.blue) : S.score;

    $('finalScore').textContent = shownScore;
    $('finalCorrect').textContent = `${correctCount}/${total}`;
    $('finalAcc').textContent = acc + '%';
    $('finalCombo').textContent = S.maxCombo;
    $('finalRank').textContent = '–';

    // 环形进度
    const ring = $('ringFg');
    ring.style.strokeDasharray = RING_LEN;
    ring.style.strokeDashoffset = RING_LEN;
    requestAnimationFrame(() => { ring.style.strokeDashoffset = RING_LEN * (1 - acc / 100); });

    renderWeak();

    if (S.mode === 'team') {
      const r = S.teamScore.red, b = S.teamScore.blue;
      const win = r === b ? null : (r > b ? 'red' : 'blue');
      $('resultTitle').textContent = win === null ? '🤝 平局！势均力敌！' : (win === 'red' ? '🔴 红队获胜！' : '🔵 蓝队获胜！');
      $('teamResult').style.display = 'block';
      $('teamResult').innerHTML = `
        <div class="team-bar" style="height:clamp(44px,5vw,70px)">
          <div class="team-seg red"  style="width:${r + b ? Math.min(85, Math.max(15, r / (r + b) * 100)) : 50}%">🔴 红队 ${r}</div>
          <div class="team-seg blue" style="width:${r + b ? 100 - Math.min(85, Math.max(15, r / (r + b) * 100)) : 50}%">蓝队 ${b} 🔵</div>
        </div>`;
      $('savePanel').style.display = 'none';
      SFX.victory();
      FX.fireworks(8, 2600);
      FX.rain(200, 2000);
      await saveResult([
        { playerName: '红队', team: 'red' },
        { playerName: '蓝队', team: 'blue' },
      ]);
    } else {
      $('resultTitle').textContent = acc === 100 ? '🎉 全对！满分通关！' : acc >= 70 ? '👏 打得不错！' : '💪 再来一局会更好！';
      $('teamResult').style.display = 'none';
      $('savePanel').style.display = 'block';
      renderSaveGrid();
      $('saveName').value = S.player.name || '';
      if (acc >= 70) { SFX.cheer(2200); FX.rain(170, 1800); }
      else SFX.applause(1400);

      if (S.player.name) await saveResult([{ playerName: S.player.name, studentId: S.player.studentId, team: '' }]);
    }
  }

  function renderWeak() {
    const wrong = S.answers.filter((a) => !a.correct);
    if (!wrong.length) { $('weakPanel').style.display = 'none'; return; }
    const byTag = {};
    for (const a of S.answers) {
      byTag[a.rule_tag] = byTag[a.rule_tag] || { n: 0, w: 0 };
      byTag[a.rule_tag].n++;
      if (!a.correct) byTag[a.rule_tag].w++;
    }
    const rows = Object.entries(byTag).filter(([, v]) => v.w > 0)
      .sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n);
    $('weakPanel').style.display = 'block';
    $('weakList').innerHTML = rows.map(([tag, v]) => {
      const rate = Math.round((v.w / v.n) * 100);
      return `<div class="weak-item">
        <span style="min-width:11em">${esc(tagZh(tag))}</span>
        <span class="weak-bar"><i style="width:${rate}%"></i></span>
        <b style="min-width:4.5em;text-align:right">错 ${v.w}/${v.n}</b></div>`;
    }).join('');
  }

  function renderSaveGrid() {
    $('saveGrid').innerHTML = S.students.map((s) =>
      `<button class="name-btn" data-save-sid="${s.id}">${esc(s.name)}</button>`).join('');
  }

  async function saveResult(players) {
    if (S.saved) return;
    S.saved = true;
    try {
      const r = await api('POST', '/api/game/finish', { sessionId: S.sessionId, players });
      S.lastResult = r;
      const mine = r.results.find((x) => x.team === '') || r.results[0];
      if (mine) {
        $('finalRank').textContent = '第 ' + mine.rankToday;
        if (mine.isNewPersonalBest && S.mode === 'solo' && mine.total > 0) {
          setTimeout(() => {
            SFX.record();
            FX.pop('🏆', { sub: '个人新纪录 NEW RECORD!' });
            FX.fireworks(7, 2400);
          }, 900);
        }
      }
      if (S.mode === 'solo') $('savePanel').style.display = 'none';
      refreshHomeBoard();
    } catch (e) {
      S.saved = false;
      alert('保存成绩失败：' + e.message);
    }
  }

  // ═══════════════ 随机点名转盘 ═══════════════
  function openWheel() {
    const pool = S.students.length ? S.students : null;
    if (!pool) { alert('先在上方选一个班级，或到后台给班级导入学生名单。'); return; }
    $('wheelTrack').style.transform = 'translateY(0)';
    $('wheelTrack').innerHTML = pool.map((s) => `<div class="wheel-name">${esc(s.name)}</div>`).join('');
    show('wheel');
  }

  function spin() {
    const pool = S.students;
    if (!pool.length) return;
    SFX.unlock();
    $('btnSpin').disabled = true;

    const winner = pool[Math.floor(Math.random() * pool.length)];
    const track = $('wheelTrack');
    const loops = 6;
    const seq = [];
    for (let i = 0; i < loops; i++) seq.push(...pool);
    seq.push(winner);
    track.innerHTML = seq.map((s) => `<div class="wheel-name">${esc(s.name)}</div>`).join('');

    const itemH = track.firstElementChild.getBoundingClientRect().height;
    const endY = -(seq.length - 1) * itemH;
    const dur = 3000;
    const t0 = performance.now();
    SFX.drumroll();

    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);            // easeOutCubic
      track.style.transform = `translateY(${endY * e}px)`;
      if (p < 1) requestAnimationFrame(step);
      else {
        SFX.wheelStop();
        track.lastElementChild.classList.add('wheel-winner');
        FX.confetti(110);
        S.player = { name: winner.name, studentId: winner.id };
        $('playerInput').value = winner.name;
        renderNameGrid();
        $('btnSpin').disabled = false;
        setTimeout(() => { show('home'); }, 1700);
      }
    };
    requestAnimationFrame(step);
  }

  // ═══════════════ 排行榜 ═══════════════
  let lbScope = 'today', lbMode = 'solo';
  async function openBoard() {
    show('board');
    await loadBoard();
  }
  async function loadBoard() {
    const cls = $('boardClassSel').value;
    try {
      const rows = await api('GET',
        `/api/leaderboard?scope=${lbScope}&mode=${lbMode}&limit=50${cls ? '&classId=' + cls : ''}`);
      $('lbBody').innerHTML = rows.length ? rows.map((r) => `<tr>
        <td class="rk">${['🥇','🥈','🥉'][r.rank-1] || r.rank}</td>
        <td><b>${esc(r.player_name)}</b></td>
        <td class="dim">${esc(r.class_name || '—')}</td>
        <td class="sc">${r.score}</td>
        <td>${r.correct_count}/${r.total}</td>
        <td>${r.accuracy}%</td>
        <td>${r.max_combo}</td>
        <td class="dim">${esc(String(r.created_at || '').slice(5, 16))}</td></tr>`).join('')
        : '<tr><td colspan="8" class="dim center" style="padding:2em">这个范围还没有记录</td></tr>';
    } catch (e) {
      $('lbBody').innerHTML = `<tr><td colspan="8" class="center" style="padding:2em;color:var(--bad)">加载失败：${esc(e.message)}</td></tr>`;
    }
  }

  // ═══════════════ 事件绑定 ═══════════════
  function syncToggleButtons() {
    $('btnSfx').textContent = SFX.isEnabled() ? '🔊 音效' : '🔇 音效';
    $('btnSfx').classList.toggle('ghost', !SFX.isEnabled());
    $('btnTts').textContent = TTS.isEnabled() ? '🗣 朗读' : '🔕 朗读';
    $('btnTts').classList.toggle('ghost', !TTS.isEnabled());
  }

  function bind() {
    document.addEventListener('pointerdown', () => SFX.unlock(), { once: true });

    $('btnSfx').addEventListener('click', () => { SFX.setEnabled(!SFX.isEnabled()); SFX.click(); syncToggleButtons(); });
    $('btnTts').addEventListener('click', () => { TTS.setEnabled(!TTS.isEnabled()); SFX.click(); syncToggleButtons(); });

    $('modeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]'); if (!b) return;
      S.mode = b.dataset.mode;
      for (const x of $('modeSeg').children) x.classList.toggle('on', x === b);
      $('soloPanel').style.display = S.mode === 'solo' ? 'block' : 'none';
      $('teamPanel').style.display = S.mode === 'team' ? 'block' : 'none';
      SFX.select();
    });

    $('classSel').addEventListener('change', onClassChange);

    $('nameGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sid]'); if (!b) return;
      const id = Number(b.dataset.sid);
      const s = S.students.find((x) => x.id === id);
      S.player = S.player.studentId === id ? { name: '', studentId: null } : { name: s.name, studentId: id };
      $('playerInput').value = S.player.name;
      renderNameGrid(); SFX.select();
    });
    $('playerInput').addEventListener('input', () => { S.player = { name: $('playerInput').value.trim(), studentId: null }; renderNameGrid(); });
    $('btnClearPlayer').addEventListener('click', () => { S.player = { name: '', studentId: null }; $('playerInput').value = ''; renderNameGrid(); });

    $('btnSplit').addEventListener('click', () => {
      if (!S.students.length) { alert('先选一个有名单的班级。'); return; }
      const sh = S.students.slice().sort(() => Math.random() - .5);
      S.teams = { red: sh.filter((_, i) => i % 2 === 0), blue: sh.filter((_, i) => i % 2 === 1) };
      renderTeams(); SFX.select();
    });
    $('btnClearTeams').addEventListener('click', () => { S.teams = { red: [], blue: [] }; renderTeams(); });
    const swap = (e) => {
      const b = e.target.closest('[data-tsid]'); if (!b) return;
      const id = Number(b.dataset.tsid);
      const from = S.teams.red.some((s) => s.id === id) ? 'red' : 'blue';
      const to = from === 'red' ? 'blue' : 'red';
      const i = S.teams[from].findIndex((s) => s.id === id);
      S.teams[to].push(S.teams[from].splice(i, 1)[0]);
      renderTeams(); SFX.select();
    };
    $('redGrid').addEventListener('click', swap);
    $('blueGrid').addEventListener('click', swap);

    $('btnStart').addEventListener('click', startGame);
    $('btnWheel').addEventListener('click', openWheel);
    $('btnSpin').addEventListener('click', spin);
    $('btnWheelBack').addEventListener('click', () => show('home'));

    $('opts').addEventListener('click', (e) => {
      const b = e.target.closest('.opt'); if (!b || b.classList.contains('locked')) return;
      submit(b.dataset.val, false);
    });
    $('btnSubmitFill').addEventListener('click', () => submit($('fillInput').value.trim(), false));
    $('fillInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit($('fillInput').value.trim(), false); }
    });
    $('btnSpeak').addEventListener('click', () => {
      const q = S.questions[S.idx]; if (!q) return;
      TTS.speak(q.stem + (q.type === 'choice' ? '. ' + q.options.join(', ') : ''));
    });
    $('btnQuit').addEventListener('click', () => {
      if (confirm('退出本局？已答的题目已经保存，但不会计入排行榜。')) { stopTimer(); TTS.cancel(); show('home'); }
    });

    $('rcNext').addEventListener('click', closeRuleCard);
    $('rcSpeak').addEventListener('click', () => {
      const q = S.questions[S.idx]; if (q) TTS.speak(q.tts_text || q.explain_en);
    });

    $('btnSave').addEventListener('click', async () => {
      const name = $('saveName').value.trim();
      if (!name) { alert('请输入姓名，或点下面名单里的学生。'); return; }
      await saveResult([{ playerName: name, studentId: S.player.studentId, team: '' }]);
    });
    $('btnSkipSave').addEventListener('click', () => { $('savePanel').style.display = 'none'; });
    $('saveGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-save-sid]'); if (!b) return;
      const s = S.students.find((x) => x.id === Number(b.dataset.saveSid));
      if (!s) return;
      S.player = { name: s.name, studentId: s.id };
      $('saveName').value = s.name;
      SFX.select();
      saveResult([{ playerName: s.name, studentId: s.id, team: '' }]);
    });

    $('btnAgain').addEventListener('click', () => { FX.clear(); startGame(); });
    $('btnHome').addEventListener('click', () => { FX.clear(); show('home'); refreshHomeBoard(); });
    $('btnResultBoard').addEventListener('click', openBoard);
    $('btnBoard').addEventListener('click', openBoard);
    $('btnBoardBack').addEventListener('click', () => show(S.lastResult ? 'result' : 'home'));
    $('scopeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-scope]'); if (!b) return;
      lbScope = b.dataset.scope;
      for (const x of $('scopeSeg').children) x.classList.toggle('on', x === b);
      loadBoard();
    });
    $('lbModeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-lbmode]'); if (!b) return;
      lbMode = b.dataset.lbmode;
      for (const x of $('lbModeSeg').children) x.classList.toggle('on', x === b);
      loadBoard();
    });
    $('boardClassSel').addEventListener('change', loadBoard);

    // ── 键盘快捷键（老师可以用无线翻页笔操作） ──
    document.addEventListener('keydown', (e) => {
      const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT';
      const cardOpen = $('ruleOverlay').classList.contains('show');

      if (e.key === 'Escape') {
        if (cardOpen) { closeRuleCard(); return; }
        if (screen === 'board') { show(S.lastResult ? 'result' : 'home'); return; }
        if (screen === 'quiz') { $('btnQuit').click(); return; }
        if (screen === 'wheel') { show('home'); return; }
        return;
      }
      if (e.key === ' ' || e.key === 'Spacebar') {
        if (cardOpen) { e.preventDefault(); closeRuleCard(); return; }
        if (screen === 'home' && !typing) { e.preventDefault(); startGame(); return; }
        if (screen === 'wheel') { e.preventDefault(); if (!$('btnSpin').disabled) spin(); return; }
        if (screen === 'result') { e.preventDefault(); $('btnAgain').click(); return; }
        return;
      }
      if (screen === 'quiz' && !cardOpen && !S.locked && /^[1-4]$/.test(e.key)) {
        const q = S.questions[S.idx];
        if (q && q.type === 'choice') {
          const el = $('opts').children[Number(e.key) - 1];
          if (el) { e.preventDefault(); submit(el.dataset.val, false); }
        }
      }
    });
  }

  bind();
  boot();
})();

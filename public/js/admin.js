/*! admin.js —— 老师后台 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let TAGS = [], QUESTIONS = [], CLASSES = [], curClass = null, editingId = null;

  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `请求失败 ${r.status}`);
    return d;
  }

  let toastTimer = null;
  function toast(msg, kind) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast on ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'bad'); } };

  // ═══ 登录 ═══
  async function checkAuth() {
    const { authed } = await api('GET', '/api/admin/me');
    $('login').style.display = authed ? 'none' : 'grid';
    if (authed) bootData();
    return authed;
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginErr').style.display = 'none';
    try {
      await api('POST', '/api/admin/login', { password: $('loginPw').value });
      $('loginPw').value = '';
      await checkAuth();
      toast('欢迎回来！', 'good');
    } catch (err) {
      $('loginErr').textContent = err.message;
      $('loginErr').style.display = 'block';
    }
  });

  $('btnLogout').addEventListener('click', guard(async () => {
    await api('POST', '/api/admin/logout');
    location.reload();
  }));

  // ═══ 标签页 ═══
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pane]');
    if (!b) return;
    for (const x of $('tabs').children) x.classList.toggle('on', x === b);
    for (const p of document.querySelectorAll('.pane')) p.classList.toggle('on', p.id === 'pane-' + b.dataset.pane);
    const load = { scores: loadScores, stats: loadStats, classes: loadClasses, settings: loadSettings };
    if (load[b.dataset.pane]) load[b.dataset.pane]();
  });

  // ═══ 启动 ═══
  async function bootData() {
    const meta = await api('GET', '/api/questions/meta');
    TAGS = meta.tags;
    const tagOpts = TAGS.map((t) => `<option value="${t.key}">${esc(t.zh)}</option>`).join('');
    $('fTag').innerHTML = '<option value="">全部语法点</option>' + tagOpts;
    $('qmTag').innerHTML = tagOpts;
    $('kTotal').textContent = meta.total;
    $('kEnabled').textContent = meta.enabled;
    $('kTags').textContent = TAGS.filter((t) => t.count > 0).length;
    await loadQuestions();
    await loadSettings();
    await loadClassOptions();
  }

  // ═══════════ 题库 ═══════════
  const DIFF = { 1: ['易', 'd1'], 2: ['中', 'd2'], 3: ['难', 'd3'] };
  const TYPE = { choice: '单选', fill: '填空', fix: '改错' };
  const tagZh = (k) => (TAGS.find((t) => t.key === k) || {}).zh || k;

  async function loadQuestions() {
    const p = new URLSearchParams();
    if ($('qSearch').value.trim()) p.set('q', $('qSearch').value.trim());
    if ($('fTag').value) p.set('tag', $('fTag').value);
    if ($('fType').value) p.set('type', $('fType').value);
    if ($('fDiff').value) p.set('difficulty', $('fDiff').value);
    if ($('fEnabled').value) p.set('enabled', $('fEnabled').value);
    QUESTIONS = await api('GET', '/api/questions?' + p);

    const asked = QUESTIONS.reduce((a, q) => a + q.times_asked, 0);
    const wrong = QUESTIONS.reduce((a, q) => a + q.times_wrong, 0);
    $('kAvgWrong').textContent = asked ? Math.round((wrong / asked) * 100) + '%' : '–';

    $('qBody').innerHTML = QUESTIONS.map((q) => {
      const [dl, dc] = DIFF[q.difficulty] || ['?', ''];
      const rate = q.times_asked ? Math.round((q.times_wrong / q.times_asked) * 100) : null;
      return `<tr class="${q.enabled ? '' : 'off'}">
        <td class="dim mono">${q.id}</td>
        <td><span class="pill">${TYPE[q.type] || q.type}</span></td>
        <td><div style="font-weight:600">${esc(q.stem)}</div>
            ${q.stem_zh ? `<div class="dim sm">${esc(q.stem_zh)}</div>` : ''}</td>
        <td class="mono" style="color:var(--good);font-weight:700">${esc(String(q.answer).split('|')[0])}</td>
        <td><span class="pill brand">${esc(tagZh(q.rule_tag))}</span></td>
        <td><span class="pill ${dc}">${dl}</span></td>
        <td class="nowrap sm">${q.times_asked}/${q.times_wrong}${rate !== null ? ` <b style="color:${rate > 50 ? 'var(--bad)' : 'var(--ink-3)'}">${rate}%</b>` : ''}</td>
        <td class="nowrap">
          <button class="btn tiny" data-edit="${q.id}">编辑</button>
          <button class="btn tiny" data-toggle="${q.id}">${q.enabled ? '停用' : '启用'}</button>
          <button class="btn tiny danger" data-del="${q.id}">删除</button>
        </td></tr>`;
    }).join('') || '<tr><td colspan="8" class="dim" style="padding:2em;text-align:center">没有符合条件的题目</td></tr>';
    $('qCount').textContent = `共 ${QUESTIONS.length} 道题`;
  }

  let searchTimer = null;
  $('qSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadQuestions, 260); });
  for (const id of ['fTag', 'fType', 'fDiff', 'fEnabled']) $(id).addEventListener('change', loadQuestions);

  $('qBody').addEventListener('click', guard(async (e) => {
    const ed = e.target.closest('[data-edit]');
    const tg = e.target.closest('[data-toggle]');
    const dl = e.target.closest('[data-del]');
    if (ed) return openQModal(QUESTIONS.find((q) => q.id === Number(ed.dataset.edit)));
    if (tg) {
      const q = QUESTIONS.find((x) => x.id === Number(tg.dataset.toggle));
      await api('PUT', '/api/questions/' + q.id, { enabled: !q.enabled });
      toast(q.enabled ? '已停用' : '已启用', 'good');
      return loadQuestions();
    }
    if (dl) {
      const q = QUESTIONS.find((x) => x.id === Number(dl.dataset.del));
      if (!confirm(`确定删除这道题？\n\n${q.stem}\n\n删除后无法恢复（建议先在「导入导出」页导出一份备份）。`)) return;
      await api('DELETE', '/api/questions/' + q.id);
      toast('已删除', 'good');
      return loadQuestions();
    }
  }));

  // ── 题目编辑弹窗 ──
  function openQModal(q) {
    editingId = q ? q.id : null;
    $('qmTitle').textContent = q ? `编辑题目 #${q.id}` : '新建题目';
    $('qmType').value = q ? q.type : 'choice';
    $('qmDiff').value = q ? q.difficulty : 1;
    $('qmEnabled').value = q ? (q.enabled ? '1' : '0') : '1';
    $('qmTag').value = q ? q.rule_tag : TAGS[0].key;
    $('qmStem').value = q ? q.stem : '';
    $('qmStemZh').value = q ? q.stem_zh : '';
    $('qmOpts').value = q ? (q.options || []).join('\n') : '';
    $('qmAnswer').value = q ? q.answer : '';
    $('qmEz').value = q ? q.explain_zh : '';
    $('qmEe').value = q ? q.explain_en : '';
    $('qmErr').style.display = 'none';
    syncQType();
    renderPreview();
    $('qModal').classList.add('on');
  }
  const closeQModal = () => $('qModal').classList.remove('on');

  function syncQType() {
    const t = $('qmType').value;
    $('qmOptsWrap').style.display = t === 'choice' ? 'block' : 'none';
    $('qmAnsLabel').textContent = t === 'choice'
      ? '正确答案（必须和某个选项完全一致）'
      : '正确答案（多个可接受答案用 | 分隔，如 taller|more tall）';
    $('qmTip').innerHTML = t === 'choice'
      ? '💡 <b>单选题</b>：大屏上会自动打乱选项顺序，答案不会总在同一个位置。学生可按键盘 1/2/3/4 抢答。'
      : t === 'fill'
        ? '💡 <b>填空题</b>：判分时自动忽略大小写、多余空格和句末标点。同一个空有多种正确写法时，用 <code class="mono">|</code> 都列上。'
        : '💡 <b>改错题</b>：题干写<b>错误的整句</b>，答案写<b>改正后的那个词</b>。例如题干 <code class="mono">My sister is more young than me.</code>，答案 <code class="mono">younger</code>。';
  }

  function renderPreview() {
    const t = $('qmType').value;
    const stem = esc($('qmStem').value || '（题干）').replace(/_{2,}/g, '<span class="blank">______</span>');
    const zh = $('qmStemZh').value;
    const ans = $('qmAnswer').value.trim();
    let body;
    if (t === 'choice') {
      const opts = $('qmOpts').value.split('\n').map((s) => s.trim()).filter(Boolean);
      body = `<div class="p-opts">${opts.map((o) =>
        `<div class="p-opt${o === ans ? ' ans' : ''}">${esc(o)}</div>`).join('') || '<div class="p-opt">（还没填选项）</div>'}</div>`;
    } else {
      body = `<div class="p-fill">${esc(ans.split('|')[0]) || '学生在这里输入答案'}</div>`;
    }
    $('qmPreview').innerHTML = `<div class="p-stem">${stem}</div>${zh ? `<div class="p-zh">${esc(zh)}</div>` : ''}${body}`;
  }

  for (const id of ['qmType', 'qmStem', 'qmStemZh', 'qmOpts', 'qmAnswer']) {
    $(id).addEventListener('input', renderPreview);
    $(id).addEventListener('change', () => { syncQType(); renderPreview(); });
  }
  $('btnNewQ').addEventListener('click', () => openQModal(null));
  $('qmClose').addEventListener('click', closeQModal);
  $('qmCancel').addEventListener('click', closeQModal);
  $('qModal').addEventListener('click', (e) => { if (e.target === $('qModal')) closeQModal(); });

  $('qmSave').addEventListener('click', guard(async () => {
    const body = {
      type: $('qmType').value,
      stem: $('qmStem').value.trim(),
      stem_zh: $('qmStemZh').value.trim(),
      options: $('qmType').value === 'choice' ? $('qmOpts').value.split('\n').map((s) => s.trim()).filter(Boolean) : [],
      answer: $('qmAnswer').value.trim(),
      rule_tag: $('qmTag').value,
      difficulty: Number($('qmDiff').value),
      explain_zh: $('qmEz').value.trim(),
      explain_en: $('qmEe').value.trim(),
      enabled: $('qmEnabled').value === '1',
    };
    try {
      if (editingId) await api('PUT', '/api/questions/' + editingId, body);
      else await api('POST', '/api/questions', body);
    } catch (e) {
      $('qmErr').textContent = e.message;
      $('qmErr').style.display = 'block';
      throw e;
    }
    closeQModal();
    toast(editingId ? '已保存' : '题目已添加', 'good');
    await loadQuestions();
    const meta = await api('GET', '/api/questions/meta');
    $('kTotal').textContent = meta.total;
    $('kEnabled').textContent = meta.enabled;
  }));

  // ═══════════ 导入导出 ═══════════
  $('csvFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { $('csvText').value = rd.result; toast(`已读取 ${f.name}，点「开始导入」继续`); };
    rd.readAsText(f, 'utf-8');
  });
  $('btnClearCsv').addEventListener('click', () => { $('csvText').value = ''; $('csvFile').value = ''; $('importResult').innerHTML = ''; });

  $('btnImport').addEventListener('click', guard(async () => {
    const csv = $('csvText').value.trim();
    if (!csv) return toast('先选文件或粘贴内容', 'bad');
    $('btnImport').disabled = true;
    try {
      const r = await api('POST', '/api/questions/import', { csv });
      const errs = r.errors.filter((e) => e.level === 'error');
      const warns = r.errors.filter((e) => e.level === 'warn');
      $('importResult').innerHTML = `
        <div class="note ${r.failed ? 'warn' : 'good'}">
          新增 <b>${r.inserted}</b> 道、更新 <b>${r.updated}</b> 道${r.failed ? `，<b>${r.failed}</b> 行有错误未导入` : '，全部成功 🎉'}
        </div>
        ${r.errors.length ? `<div class="err-list">${
          [...errs, ...warns].map((e) => `<div class="${e.level === 'error' ? 'e' : 'w'}">第 ${e.line} 行：${esc(e.msg)}</div>`).join('')
        }</div>` : ''}`;
      toast(`导入完成：新增 ${r.inserted}、更新 ${r.updated}`, r.failed ? 'bad' : 'good');
      await loadQuestions();
    } finally { $('btnImport').disabled = false; }
  }));

  // ═══════════ 设置 ═══════════
  const NUM_KEYS = ['questions_per_round', 'timer_seconds', 'base_score', 'speed_bonus_max', 'penalty_on_wrong', 'wrong_priority_pct', 'tts_rate'];
  const TXT_KEYS = ['difficulty_ratio', 'combo_bonus'];
  const BOOL_KEYS = ['timer_enabled', 'rule_card_manual', 'tts_enabled', 'sfx_enabled', 'team_steal', 'show_leaderboard_home'];

  async function loadSettings() {
    const s = await api('GET', '/api/settings');
    for (const k of [...NUM_KEYS, ...TXT_KEYS]) if ($('s_' + k)) $('s_' + k).value = s[k] ?? '';
    for (const k of BOOL_KEYS) if ($('s_' + k)) $('s_' + k).checked = String(s[k]) === '1';
    $('s_sfx_volume').value = s.sfx_volume ?? 0.8;
    $('volLabel').textContent = Math.round((s.sfx_volume ?? .8) * 100) + '%';
  }
  $('s_sfx_volume').addEventListener('input', (e) => { $('volLabel').textContent = Math.round(e.target.value * 100) + '%'; });

  $('btnSaveSettings').addEventListener('click', guard(async () => {
    const body = {};
    for (const k of [...NUM_KEYS, ...TXT_KEYS]) if ($('s_' + k)) body[k] = $('s_' + k).value;
    for (const k of BOOL_KEYS) if ($('s_' + k)) body[k] = $('s_' + k).checked ? '1' : '0';
    body.sfx_volume = $('s_sfx_volume').value;
    if (!/^\d+:\d+:\d+$/.test(body.difficulty_ratio)) return toast('难度配比要写成 3:3:1 这种格式', 'bad');
    if (!/^\d+,\d+,\d+$/.test(body.combo_bonus)) return toast('连对加分要写成 2,3,5 这种格式', 'bad');
    await api('PUT', '/api/settings', body);
    $('settingsHint').textContent = '已保存 · ' + new Date().toLocaleTimeString('zh-CN');
    toast('设置已保存，下一局生效', 'good');
  }));

  // ═══════════ 班级名单 ═══════════
  async function loadClassOptions() {
    CLASSES = await api('GET', '/api/classes');
    const opts = CLASSES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    for (const id of ['scClass', 'stClass']) $(id).innerHTML = '<option value="">全部班级</option>' + opts;
  }

  async function loadClasses() {
    await loadClassOptions();
    $('classBody').innerHTML = CLASSES.map((c) => `<tr${curClass === c.id ? ' style="background:var(--brand-soft)"' : ''}>
      <td><b>${esc(c.name)}</b></td><td>${c.student_count}</td>
      <td class="nowrap">
        <button class="btn tiny" data-pick="${c.id}">查看名单</button>
        <button class="btn tiny" data-rename="${c.id}">改名</button>
        <button class="btn tiny danger" data-delc="${c.id}">删除</button>
      </td></tr>`).join('') || '<tr><td colspan="3" class="dim" style="padding:1.6em;text-align:center">还没有班级，先在上方新建一个</td></tr>';
    if (curClass) await loadStudents();
  }

  $('btnAddClass').addEventListener('click', guard(async () => {
    const name = $('newClassName').value.trim();
    if (!name) return toast('请输入班级名', 'bad');
    await api('POST', '/api/classes', { name });
    $('newClassName').value = '';
    toast('班级已创建', 'good');
    await loadClasses();
  }));

  $('classBody').addEventListener('click', guard(async (e) => {
    const pk = e.target.closest('[data-pick]');
    const rn = e.target.closest('[data-rename]');
    const dl = e.target.closest('[data-delc]');
    if (pk) { curClass = Number(pk.dataset.pick); return loadClasses(); }
    if (rn) {
      const c = CLASSES.find((x) => x.id === Number(rn.dataset.rename));
      const name = prompt('新的班级名：', c.name);
      if (!name || !name.trim()) return;
      await api('PUT', '/api/classes/' + c.id, { name: name.trim() });
      toast('已改名', 'good');
      return loadClasses();
    }
    if (dl) {
      const c = CLASSES.find((x) => x.id === Number(dl.dataset.delc));
      if (!confirm(`删除班级「${c.name}」？\n\n该班的 ${c.student_count} 名学生会一起删除。\n已产生的成绩记录会保留，但不再关联班级。`)) return;
      await api('DELETE', '/api/classes/' + c.id);
      if (curClass === c.id) curClass = null;
      toast('班级已删除', 'good');
      return loadClasses();
    }
  }));

  async function loadStudents() {
    const c = CLASSES.find((x) => x.id === curClass);
    $('curClassName').textContent = c ? c.name : '未选择班级';
    if (!curClass) { $('studentBody').innerHTML = ''; return; }
    const list = await api('GET', `/api/classes/${curClass}/students`);
    $('studentBody').innerHTML = list.map((s) => `<tr class="${s.active ? '' : 'off'}">
      <td class="dim mono">${esc(s.seat_no || '–')}</td>
      <td><b>${esc(s.name)}</b></td>
      <td>${s.active ? '<span class="pill" style="background:var(--good-soft);color:var(--good)">在校</span>' : '<span class="pill">停用</span>'}</td>
      <td class="nowrap">
        <button class="btn tiny" data-sact="${s.id}" data-v="${s.active ? 0 : 1}">${s.active ? '停用' : '启用'}</button>
        <button class="btn tiny danger" data-sdel="${s.id}">删除</button>
      </td></tr>`).join('') || '<tr><td colspan="4" class="dim" style="padding:1.6em;text-align:center">这个班还没有学生，用上面的文本框批量导入</td></tr>';
  }

  $('btnImportNames').addEventListener('click', guard(async () => {
    if (!curClass) return toast('先在左边点一个班级的「查看名单」', 'bad');
    const names = $('namesText').value;
    if (!names.trim()) return toast('请先粘贴名单', 'bad');
    const r = await api('POST', `/api/classes/${curClass}/students`, { names });
    $('namesText').value = '';
    $('namesHint').textContent = r.message;
    toast(r.message, 'good');
    await loadClasses();
  }));

  $('studentBody').addEventListener('click', guard(async (e) => {
    const ac = e.target.closest('[data-sact]');
    const dl = e.target.closest('[data-sdel]');
    if (ac) { await api('PUT', '/api/students/' + ac.dataset.sact, { active: ac.dataset.v === '1' }); return loadClasses(); }
    if (dl) {
      if (!confirm('删除这名学生？其错题本会一并删除，成绩记录保留。')) return;
      await api('DELETE', '/api/students/' + dl.dataset.sdel);
      toast('已删除', 'good');
      return loadClasses();
    }
  }));

  // ═══════════ 成绩 ═══════════
  async function loadScores() {
    await loadClassOptions();
    const scope = $('scScope').value, mode = $('scMode').value;
    const cls = $('scClass').value, group = $('scGroup').value;
    $('btnExportScores').href = `/api/stats/scores.csv?scope=${scope}${cls ? '&classId=' + cls : ''}`;
    const url = `/api/leaderboard${group === 'players' ? '/players' : ''}?scope=${scope}&mode=${mode}&limit=100${cls ? '&classId=' + cls : ''}`;
    const rows = await api('GET', url);

    if (group === 'players') {
      $('scHead').innerHTML = '<th style="width:56px">#</th><th>姓名</th><th>班级</th><th>最高分</th><th>局数</th><th>总正确率</th><th>最佳连对</th><th>最近一次</th>';
      $('scBody').innerHTML = rows.map((r) => `<tr>
        <td class="dim"><b>${r.rank}</b></td><td><b>${esc(r.player_name)}</b></td>
        <td class="dim">${esc(r.class_name || '—')}</td>
        <td><b style="color:var(--brand)">${r.best_score}</b></td>
        <td>${r.plays}</td><td>${r.accuracy}%</td><td>${r.best_combo}</td>
        <td class="dim sm">${esc(String(r.last_play || '').slice(0, 16))}</td></tr>`).join('') || emptyRow(8);
    } else {
      $('scHead').innerHTML = '<th style="width:56px">#</th><th>姓名</th><th>班级</th><th>得分</th><th>答对</th><th>正确率</th><th>最高连对</th><th>时间</th>';
      $('scBody').innerHTML = rows.map((r) => `<tr>
        <td class="dim"><b>${r.rank}</b></td><td><b>${esc(r.player_name)}</b></td>
        <td class="dim">${esc(r.class_name || '—')}</td>
        <td><b style="color:var(--brand)">${r.score}</b></td>
        <td>${r.correct_count}/${r.total}</td><td>${r.accuracy}%</td><td>${r.max_combo}</td>
        <td class="dim sm">${esc(String(r.created_at || '').slice(0, 16))}</td></tr>`).join('') || emptyRow(8);
    }

    const sess = await api('GET', '/api/stats/sessions?limit=30');
    $('sessBody').innerHTML = sess.map((s) => `<tr>
      <td class="dim mono">${s.id}</td>
      <td><span class="pill ${s.mode === 'team' ? 'brand' : ''}">${s.mode === 'team' ? '分组赛' : '个人赛'}</span></td>
      <td>${esc(s.players || '—')}</td><td>${s.question_count}</td>
      <td class="dim sm">${esc(String(s.started_at || '').slice(0, 16))}</td>
      <td><button class="btn tiny" data-sess="${s.id}">明细</button></td></tr>`).join('') || emptyRow(6);
  }
  const emptyRow = (n) => `<tr><td colspan="${n}" class="dim" style="padding:2em;text-align:center">这个范围还没有记录</td></tr>`;

  function clearScores(scope, label) {
    return guard(async () => {
      if (!confirm(`确定清除${label}？\n\n${scope === 'today' ? '今日' : '全部'}的排行榜、对局记录、薄弱点统计与错题本都会被删除，无法恢复。\n建议先导出 CSV 备份。`)) return;
      await api('DELETE', '/api/stats/records?scope=' + scope);
      toast('已清除' + label, 'good');
      await loadScores();
    });
  }
  $('btnClearToday').addEventListener('click', clearScores('today', '今日成绩'));
  $('btnClearAll').addEventListener('click', clearScores('all', '全部成绩'));
  for (const id of ['scScope', 'scMode', 'scClass', 'scGroup']) $(id).addEventListener('change', guard(loadScores));

  $('sessBody').addEventListener('click', guard(async (e) => {
    const b = e.target.closest('[data-sess]');
    if (!b) return;
    const d = await api('GET', '/api/stats/sessions/' + b.dataset.sess);
    $('smTitle').textContent = `对局 #${d.session.id} · ${d.session.mode === 'team' ? '分组赛' : '个人赛'} · ${d.session.started_at}`;
    $('smBody').innerHTML = `
      <div class="row" style="margin-bottom:14px">${d.records.map((r) =>
        `<span class="pill brand" style="font-size:.9rem;padding:6px 14px">${esc(r.player_name)} · ${r.score} 分 · ${r.correct_count}/${r.total}</span>`).join('')}</div>
      <div class="tbl-wrap"><table><thead><tr>
        <th style="width:44px">#</th><th>题干</th><th style="width:130px">选手答案</th>
        <th style="width:130px">正确答案</th><th style="width:60px">结果</th>
        <th style="width:70px">用时</th><th style="width:60px">得分</th><th style="width:120px">语法点</th>
      </tr></thead><tbody>${d.answers.map((a, i) => `<tr>
        <td class="dim">${i + 1}</td><td>${esc(a.stem)}</td>
        <td class="mono" style="color:${a.is_correct ? 'var(--good)' : 'var(--bad)'}">${esc(a.picked || '（超时未答）')}</td>
        <td class="mono dim">${esc(String(a.right_answer).split('|')[0])}</td>
        <td>${a.is_correct ? '✅' : '❌'}</td>
        <td class="dim sm">${(a.ms_used / 1000).toFixed(1)}s</td>
        <td><b>${a.score_delta}</b></td>
        <td><span class="pill">${esc(a.label)}</span></td></tr>`).join('')}</tbody></table></div>`;
    $('sessModal').classList.add('on');
  }));
  $('smClose').addEventListener('click', () => $('sessModal').classList.remove('on'));
  $('sessModal').addEventListener('click', (e) => { if (e.target === $('sessModal')) $('sessModal').classList.remove('on'); });

  // ═══════════ 统计 ═══════════
  let weakTags = [];
  async function loadStats() {
    await loadClassOptions();
    const o = await api('GET', '/api/stats/overview');
    $('oSessions').textContent = o.sessions;
    $('oAnswers').textContent = o.answers;
    $('oAcc').textContent = o.accuracy + '%';
    $('oStudents').textContent = o.students;

    const p = new URLSearchParams();
    if ($('stClass').value) p.set('classId', $('stClass').value);
    if ($('stDays').value) p.set('days', $('stDays').value);
    const rules = await api('GET', '/api/stats/rules?' + p);
    weakTags = rules.filter((r) => r.asked >= 2 && r.rate > 0).slice(0, 3).map((r) => r.rule_tag);

    $('ruleBars').innerHTML = rules.length ? rules.map((r, i) => `
      <div class="bar-row">
        <span>${i === 0 && r.rate > 0 ? '⚠️ ' : ''}<b>${esc(r.label)}</b></span>
        <span class="bar"><i style="width:${r.rate}%"></i></span>
        <b>${r.rate}% <span class="dim" style="font-weight:400">(${r.wrong}/${r.asked})</span></b>
      </div>`).join('') + (rules[0] && rules[0].rate > 0
        ? `<div class="note warn" style="margin-top:14px">👉 <b>全班最薄弱：${esc(rules[0].label)}</b>，错误率 ${rules[0].rate}%。建议下节课重点讲这个点。</div>` : '')
      : '<p class="dim">还没有答题数据。上几局课后这里就有内容了。</p>';
    $('btnWeakRound').disabled = weakTags.length === 0;

    const hard = await api('GET', '/api/stats/hard-questions?limit=10');
    $('hardBody').innerHTML = hard.map((h) => `<tr>
      <td class="dim mono">${h.id}</td><td>${esc(h.stem)}</td>
      <td><span class="pill brand">${esc(h.label)}</span></td>
      <td class="sm">${h.times_asked}/${h.times_wrong}</td>
      <td><b style="color:${h.rate > 60 ? 'var(--bad)' : 'var(--warn)'}">${h.rate}%</b></td>
      <td><button class="btn tiny" data-edit2="${h.id}">查看</button></td></tr>`).join('')
      || '<tr><td colspan="6" class="dim" style="padding:2em;text-align:center">还没有足够的答题数据</td></tr>';
  }
  for (const id of ['stClass', 'stDays']) $(id).addEventListener('change', guard(loadStats));

  $('hardBody').addEventListener('click', guard(async (e) => {
    const b = e.target.closest('[data-edit2]');
    if (!b) return;
    const q = await api('GET', '/api/questions/' + b.dataset.edit2);
    for (const x of $('tabs').children) x.classList.toggle('on', x.dataset.pane === 'questions');
    for (const p of document.querySelectorAll('.pane')) p.classList.toggle('on', p.id === 'pane-questions');
    openQModal(q);
  }));

  $('btnWeakRound').addEventListener('click', () => {
    if (!weakTags.length) return;
    const labels = weakTags.map(tagZh).join('、');
    if (!confirm(`用这 3 个最薄弱的语法点出一局专项练习？\n\n${labels}\n\n会在新标签页打开大屏游戏。`)) return;
    window.open('/?tags=' + encodeURIComponent(weakTags.join(',')), '_blank');
  });

  // ═══ 走起 ═══
  checkAuth().catch((e) => toast(e.message, 'bad'));
})();

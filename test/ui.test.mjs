// 真实浏览器端到端测试（Chrome + CDP，无需额外依赖）
// 用法：先起测试实例，再 npm run test:ui
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.UI_BASE || 'http://localhost:3111';
const PORT = 9333;
const SHOTS = '/tmp/engames-shots';
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m, x = '') => { c ? (pass++, console.log('  ✅', m)) : (fail++, console.log('  ❌', m, x)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const watchdog = setTimeout(() => { console.log('\n⏱ 测试超时（180s），强制退出'); process.exit(2); }, 180000);

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1600,900', '--force-device-scale-factor=1',
  '--autoplay-policy=no-user-gesture-required', `--user-data-dir=/tmp/cdp-profile-${Date.now()}`], { stdio: 'ignore' });
const bye = (code) => { clearTimeout(watchdog); try { chrome.kill(); } catch {} process.exit(code); };

let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE + '/')}`, { method: 'PUT' })).json();
    wsUrl = t.webSocketDebuggerUrl; break;
  } catch { await sleep(200); }
}
if (!wsUrl) { console.error('无法启动 Chrome 调试端口'); bye(1); }

const ws = new WebSocket(wsUrl);
let id = 0; const pend = new Map(); const errors = [];
await new Promise((r) => { ws.onopen = r; });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
  return r.result.value;
};
const shot = async (n) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${SHOTS}/${n}.png`, Buffer.from(r.data, 'base64')); return `${SHOTS}/${n}.png`; };
const waitFor = async (expr, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(`return !!(${expr})`)) return true; await sleep(100); } return false; };

await cdp('Runtime.enable'); await cdp('Page.enable');
// 在页面自身脚本之前注入：拦截 /api/game/start 的响应，测试就能拿到每题的正确答案
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__Q = null; window.__started = 0;
  const of = window.fetch;
  window.fetch = async (...a) => {
    const r = await of(...a);
    const u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
    if (u.includes('/api/game/start')) {
      const c = r.clone();
      c.json().then(d => { window.__Q = d.questions; window.__started++; }).catch(()=>{});
    }
    return r;
  };` });

const goto = async (url) => { await cdp('Page.navigate', { url }); await sleep(1500); };

// 按 want=true/false 精确作答当前题
async function answer(want) {
  return js(`
    const i = +document.getElementById('qCounter').textContent.split('/')[0].trim() - 1;
    const q = window.__Q[i];
    const want = ${want};
    if (q.type === 'choice') {
      const btns = [...document.querySelectorAll('.opt')];
      const right = btns.find(b => b.dataset.val === q.answer);
      const wrong = btns.find(b => b.dataset.val !== q.answer);
      (want ? right : wrong).click();
      return { type:'choice', picked:(want?right:wrong).dataset.val, answer:q.answer };
    } else {
      const inp = document.getElementById('fillInput');
      inp.value = want ? String(q.answer).split('|')[0] : 'zzzz';
      document.getElementById('btnSubmitFill').click();
      return { type:q.type, picked:inp.value, answer:q.answer };
    }`);
}
async function clearCard() {
  if (await js(`return document.getElementById('ruleOverlay').classList.contains('show')`)) {
    await js(`document.getElementById('rcNext').click(); return 1`);
    await sleep(500);
    return true;
  }
  return false;
}

await goto(BASE + '/');

console.log('\n── 1. 首页加载 ──');
ok(await waitFor(`document.getElementById('chipBank').textContent!=='–'`), 'boot() 跑通');
const bank = await js(`return document.getElementById('chipBank').textContent`);
ok(+bank === 60, '题库数显示 ' + bank);
ok(await js(`return document.getElementById('chipCount').textContent==='7'`), '每局 7 题');
ok(await js(`return document.getElementById('chipTimer').textContent.includes('15')`), '倒计时 15 秒');
ok(await js(`return typeof SFX!=='undefined'&&typeof TTS!=='undefined'&&typeof FX!=='undefined'`), '音效/朗读/特效模块已加载');
ok(await js(`return getComputedStyle(document.getElementById('btnStart')).fontSize`), '按钮样式已应用');
console.log('  📸', await shot('1-home'));

console.log('\n── 2. 开一局 ──');
await js(`document.getElementById('btnStart').click(); return 1`);
ok(await waitFor(`document.getElementById('screen-quiz').classList.contains('active')`), '进入出题页');
ok(await waitFor(`window.__Q && window.__Q.length===7`), '拿到 7 道题');
ok(await js(`return document.querySelectorAll('.dot').length===7`), '7 个进度点');
ok(await js(`return document.getElementById('stem').textContent.trim().length>5`), '题干已渲染');
ok(await js(`return document.getElementById('timerFill').style.width!==''`), '倒计时条在走');
const diffs = await js(`return window.__Q.map(q=>q.difficulty).join(',')`);
ok(diffs.split(',').filter((d) => d === '1').length === 3, '难度配比 3:3:1 → ' + diffs);
console.log('  📸', await shot('2-quiz'));

console.log('\n── 3. 答对：反馈 + combo ──');
const a1 = await answer(true);
await sleep(750);   // 答对后 1250ms 会自动进下一题，必须在那之前检查高亮
ok(await js(`return document.querySelectorAll('.opt.right, .fill-input.right').length>0`), `答对高亮（选了 ${a1.picked}）`);
ok(+(await js(`return document.getElementById('scoreNow').textContent`)) > 0, '得分已增加：' + await js(`return document.getElementById('scoreNow').textContent`));
ok(!(await js(`return document.getElementById('ruleOverlay').classList.contains('show')`)), '答对不弹规则卡');
await waitFor(`document.getElementById('qCounter').textContent.startsWith('2')`, 3000);
await answer(true); await sleep(1500);
ok(await js(`return document.getElementById('comboBox').classList.contains('on')`), '连对 2 题点亮 combo 火焰');
ok(await js(`return document.getElementById('comboNum').textContent==='2'`), 'combo 计数 = 2');
console.log('  📸', await shot('3-combo'));

console.log('\n── 4. 答错：语法规则卡 ──');
await waitFor(`document.getElementById('qCounter').textContent.startsWith('3')`, 3000);
const a3 = await answer(false);
await sleep(1500);
ok(await js(`return document.getElementById('ruleOverlay').classList.contains('show')`), '答错弹出规则卡');
ok(await js(`return document.getElementById('rcPicked').textContent.length>0`), '显示"你选的"：' + await js(`return document.getElementById('rcPicked').textContent`));
const rcAns = await js(`return document.getElementById('rcAnswer').textContent`);
ok(rcAns === String(a3.answer).split('|')[0], '显示正确用法：' + rcAns);
ok((await js(`return document.getElementById('rcExplain').textContent`)).length > 8, '有中文语法解释');
ok((await js(`return document.getElementById('rcExample').textContent`)).length > 8, '有英文例句');
ok((await js(`return document.getElementById('rcCheer').textContent`)).length > 4, '有鼓励语');
ok(await js(`return document.getElementById('comboNum').textContent==='0'||!document.getElementById('comboBox').classList.contains('on')`), '答错 combo 归零');
console.log('  📸', await shot('4-rulecard'));
ok(await clearCard(), '点「继续」可关闭规则卡');

console.log('\n── 5. 走完剩下的题 ──');
for (let guard = 0; guard < 10; guard++) {
  if (await js(`return document.getElementById('screen-result').classList.contains('active')`)) break;
  if (await clearCard()) continue;
  if (await js(`return document.getElementById('screen-quiz').classList.contains('active')`)) {
    const i = await js(`return +document.getElementById('qCounter').textContent.split('/')[0].trim()`);
    await answer(i % 2 === 0);
    await sleep(1500);
  } else break;
}
await clearCard();
ok(await waitFor(`document.getElementById('screen-result').classList.contains('active')`, 8000), '7 题走完进入结算页');

console.log('\n── 6. 结算页 ──');
await sleep(1000);
ok(/^\d+\/7$/.test(await js(`return document.getElementById('finalCorrect').textContent`)),
   '答对数 ' + await js(`return document.getElementById('finalCorrect').textContent`));
ok((await js(`return document.getElementById('finalAcc').textContent`)).endsWith('%'),
   '正确率 ' + await js(`return document.getElementById('finalAcc').textContent`));
ok(await js(`return document.getElementById('weakPanel').style.display==='block'`), '薄弱语法点面板已显示');
const weakN = await js(`return document.querySelectorAll('.weak-item').length`);
ok(weakN > 0, `列出 ${weakN} 个薄弱语法点`);
ok(await js(`return document.getElementById('savePanel').style.display!=='none'`), '显示记成绩面板');
console.log('  📸', await shot('5-result'));

console.log('\n── 7. 记成绩 + 排行榜 ──');
await js(`document.getElementById('saveName').value='测试同学'; document.getElementById('btnSave').click(); return 1`);
await sleep(1100);
const rank = await js(`return document.getElementById('finalRank').textContent`);
ok(rank !== '–', '名次已回填：' + rank);
await js(`document.getElementById('btnResultBoard').click(); return 1`);
ok(await waitFor(`document.getElementById('screen-board').classList.contains('active')`), '进入排行榜');
await sleep(800);
ok(await js(`return document.getElementById('lbBody').textContent.includes('测试同学')`), '成绩出现在榜上');
console.log('  📸', await shot('6-board'));

console.log('\n── 8. 键盘快捷键 ──');
const DOMCODE = { ' ': 'Space', Escape: 'Escape', Enter: 'Enter', 1: 'Digit1', 2: 'Digit2', 3: 'Digit3', 4: 'Digit4' };
const key = async (k, code) => {
  const common = { key: k, code: DOMCODE[k], windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...common, ...(k === ' ' ? { text: ' ' } : {}) });
  await sleep(30);
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
  await sleep(60);
};
await key('Escape', 27); await sleep(400);
ok(await js(`return document.getElementById('screen-result').classList.contains('active')`), 'Esc 从排行榜返回');
await js(`document.getElementById('btnHome').click(); return 1`); await sleep(400);
await key(' ', 32);
ok(await waitFor(`document.getElementById('screen-quiz').classList.contains('active')`, 5000), '空格键开始新一局');
await waitFor(`window.__started===2`, 3000);
await sleep(500);
const curType = await js(`
  const i = +document.getElementById('qCounter').textContent.split('/')[0].trim() - 1;
  return window.__Q[i].type;`);
if (curType === 'choice') {
  await key('1', 49); await sleep(1300);
  ok(await js(`return document.querySelectorAll('.opt.locked').length>0`), '数字键 1 可以选答案');
} else {
  await key('1', 49); await sleep(400);
  ok(await js(`return !document.getElementById('fillInput').disabled`), `本题是${curType}题，数字键正确地不响应`);
}
await clearCard();

console.log('\n── 9. 红蓝对抗模式 ──');
await goto(BASE + '/');
await waitFor(`document.getElementById('chipBank').textContent!=='–'`);
await js(`document.querySelector('[data-mode=team]').click(); return 1`);
ok(await js(`return document.getElementById('teamPanel').style.display==='block'`), '切到分组赛显示分队面板');
await js(`document.getElementById('btnStart').click(); return 1`);
ok(await waitFor(`document.getElementById('screen-quiz').classList.contains('active')`), '分组赛开局');
await waitFor(`window.__Q&&window.__Q.length===7`);
ok(await js(`return getComputedStyle(document.getElementById('teamBar')).display!=='none'`), '顶部红蓝比分条已显示');
ok((await js(`return document.getElementById('turnBadgeWrap').textContent`)).includes('红队'), '第 1 题归红队');
await answer(true); await sleep(1600);
ok(+(await js(`return document.getElementById('redScore').textContent`)) > 0, '红队得分：' + await js(`return document.getElementById('redScore').textContent`));
await clearCard();
await waitFor(`document.getElementById('qCounter').textContent.startsWith('2')`, 3000);
ok((await js(`return document.getElementById('turnBadgeWrap').textContent`)).includes('蓝队'), '第 2 题轮到蓝队');
console.log('  📸', await shot('7-team'));
// 蓝队答错 → 红队抢答
await answer(false); await sleep(1800);
const steal = await js(`return document.getElementById('turnBadgeWrap').textContent`);
ok(steal.includes('抢答'), '答错触发对方抢答：' + steal.trim());
console.log('  📸', await shot('8-steal'));

console.log('\n── 10. 薄弱点专项练习（?tags=） ──');
await goto(BASE + '/?tags=reg_y,irregular');
await waitFor(`document.getElementById('chipBank').textContent!=='–'`);
ok((await js(`return document.body.innerText`)).includes('薄弱点专项练习'), '首页显示专项练习提示');
await js(`document.getElementById('btnStart').click(); return 1`);
await waitFor(`window.__Q&&window.__Q.length>0`, 6000);
const tags = await js(`return [...new Set(window.__Q.map(q=>q.rule_tag))].join(',')`);
ok(tags.split(',').every((t) => ['reg_y', 'irregular'].includes(t)), '本局只出指定语法点：' + tags);

console.log('\n── 11. 老师后台 ──');
await goto(BASE + '/admin.html');
ok(await js(`return getComputedStyle(document.getElementById('login')).display!=='none'`), '未登录时显示登录遮罩');
await js(`document.getElementById('loginPw').value='test123'; document.getElementById('loginForm').dispatchEvent(new Event('submit',{cancelable:true})); return 1`);
ok(await waitFor(`document.getElementById('login').style.display==='none'`, 5000), '口令登录成功');
await sleep(1200);
ok(+(await js(`return document.getElementById('kTotal').textContent`)) >= 60, '题库总数 KPI：' + await js(`return document.getElementById('kTotal').textContent`));
ok(await js(`return document.querySelectorAll('#qBody tr').length>=10`), '题库列表已渲染 ' + await js(`return document.querySelectorAll('#qBody tr').length`) + ' 行');
console.log('  📸', await shot('9-admin-questions'));

await js(`document.getElementById('btnNewQ').click(); return 1`);
ok(await js(`return document.getElementById('qModal').classList.contains('on')`), '新建题目弹窗打开');
await js(`
  const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};
  set('qmStem','UI test: This one is ___ than that.  (big)');
  set('qmOpts','bigger\\nbiger\\nmore big\\nbiggest');
  set('qmAnswer','bigger'); return 1`);
await sleep(300);
ok((await js(`return document.getElementById('qmPreview').innerHTML`)).includes('p-opt'), '实时预览渲染了选项');
ok((await js(`return document.getElementById('qmPreview').innerHTML`)).includes('ans'), '预览高亮了正确答案');
console.log('  📸', await shot('10-admin-editor'));
await js(`document.getElementById('qmSave').click(); return 1`);
await sleep(900);
ok(+(await js(`return document.getElementById('kTotal').textContent`)) >= 61, '新题已保存，总数变为 ' + await js(`return document.getElementById('kTotal').textContent`));

for (const [tab, check] of [['settings', 's_questions_per_round'], ['classes', 'classBody'], ['scores', 'scBody'], ['stats', 'ruleBars']]) {
  await js(`document.querySelector('[data-pane=${tab}]').click(); return 1`);
  await sleep(900);
  ok(await js(`return document.getElementById('pane-${tab}').classList.contains('on')`), `切换到「${tab}」标签页`);
  ok(await js(`return !!document.getElementById('${check}')`), `  └ ${tab} 内容已渲染`);
}
ok((await js(`return document.getElementById('ruleBars').innerHTML`)).includes('bar-row'), '语法点错误率柱状图已生成');
console.log('  📸', await shot('11-admin-stats'));

console.log('\n── 12. 控制台错误 ──');
const real = errors.filter((e) => !/favicon|manifest\.json|Failed to load resource/i.test(e));
ok(real.length === 0, '无 JS 运行时错误', real.slice(0, 4).join(' | '));

console.log(`\n═══ UI 测试：通过 ${pass} / 失败 ${fail} ═══`);
console.log(`📸 截图目录：${SHOTS}\n`);
bye(fail ? 1 : 0);

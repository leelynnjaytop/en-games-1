// 端到端 API 自测。用法：
//   1) 先起一个测试实例（用独立数据库，别动生产数据）：
//      PORT=3111 ADMIN_PASSWORD=test123 DB_PATH=data/test.db node src/server.js
//   2) 再跑：npm test
const B=process.env.TEST_BASE||'http://localhost:3111';
const PW=process.env.TEST_PW||'test123';
let cookie='';
let pass=0, fail=0;
const ok=(c,m,extra='')=>{ c?(pass++,console.log('  ✅',m)):(fail++,console.log('  ❌',m,extra)); };
async function j(method,url,body,useCookie=true){
  const h={'Content-Type':'application/json'};
  if(useCookie&&cookie) h.Cookie=cookie;
  const r=await fetch(B+url,{method,headers:h,body:body?JSON.stringify(body):undefined});
  const sc=r.headers.getSetCookie?.()||[];
  if(sc.length) cookie=sc.map(s=>s.split(';')[0]).join('; ');
  const ct=r.headers.get('content-type')||'';
  return {status:r.status, body: ct.includes('json')? await r.json(): await r.text()};
}

console.log('\n── 1. 基础接口 ──');
ok((await j('GET','/api/health')).body.ok, 'health');
const st=(await j('GET','/api/settings')).body;
ok(st.questions_per_round==='7','默认每局 7 题');
ok(st.timer_seconds==='15','默认倒计时 15 秒');
const meta=(await j('GET','/api/questions/meta')).body;
ok(meta.total===60,'题库 60 道，实际 '+meta.total);
ok(meta.tags.length===13,'语法点标签 13 个');

console.log('\n── 2. 权限保护 ──');
ok((await j('POST','/api/questions',{type:'choice',stem:'x',options:['a','b'],answer:'a',difficulty:1})).status===401,'未登录不能建题');
ok((await j('PUT','/api/settings',{questions_per_round:'9'})).status===401,'未登录不能改设置');
ok((await j('GET','/api/questions/export.csv')).status===401,'未登录不能导出题库');
ok((await j('POST','/api/admin/login',{password:'wrong'})).status===401,'错误口令被拒');
ok((await j('POST','/api/admin/login',{password:PW})).status===200,'正确口令登录');
ok((await j('GET','/api/admin/me')).body.authed===true,'登录态生效');

console.log('\n── 3. 班级与名单 ──');
const cls=(await j('POST','/api/classes',{name:'初二(3)班'})).body;
ok(cls.id>0,'建班级');
ok((await j('POST','/api/classes',{name:'初二(3)班'})).status===409,'重名班级被拒');
const imp=(await j('POST',`/api/classes/${cls.id}/students`,{names:'1 张伟\n2,李娜\n3、王芳\n刘洋\n张伟'})).body;
ok(imp.added===4,'批量导入 4 人（重名跳过），实际 '+imp.added);
ok(imp.skipped.length===1,'重名 1 人被跳过');
const studs=(await j('GET',`/api/classes/${cls.id}/students`)).body;
ok(studs.length===4,'名单 4 人');
ok(studs.find(s=>s.name==='李娜')?.seat_no==='2','学号解析正确');
const stu=studs[0];

console.log('\n── 4. 开一局 ──');
const g=(await j('POST','/api/game/start',{mode:'solo',studentId:stu.id})).body;
ok(g.questions.length===7,'抽 7 道题，实际 '+g.questions.length);
ok(new Set(g.questions.map(q=>q.id)).size===7,'局内无重复题');
const diffs=g.questions.map(q=>q.difficulty);
ok(diffs.filter(d=>d===1).length===3 && diffs.filter(d=>d===2).length===3 && diffs.filter(d=>d===3).length===1,
   '难度配比 3:3:1，实际 '+JSON.stringify(diffs.reduce((m,d)=>(m[d]=(m[d]||0)+1,m),{})));
const tagCnt=g.questions.reduce((m,q)=>(m[q.rule_tag]=(m[q.rule_tag]||0)+1,m),{});
ok(Math.max(...Object.values(tagCnt))<=2,'同语法点不超过 2 道');
ok(g.questions.every(q=>q.type!=='choice'||q.options.length>=2),'选择题都有选项');
ok(g.questions.every(q=>q.type!=='choice'||q.options.includes(q.answer)),'选项打乱后答案仍在其中');
ok(g.questions.every(q=>q.explain_zh&&q.explain_en),'每题都有中文解释和英文例句');

console.log('\n── 5. 答题判分 ──');
// 前 5 题答对，后 2 题答错
let expScore=0;
for(let i=0;i<7;i++){
  const q=g.questions[i];
  const right=i<5;
  const picked = right? q.answer : (q.type==='choice'? q.options.find(o=>o!==q.answer) : 'zzz-wrong');
  const r=(await j('POST','/api/game/answer',{sessionId:g.sessionId,idx:i,questionId:q.id,studentId:stu.id,picked,msUsed:3000})).body;
  if(i===0) ok(r.correct===true&&r.combo===1,'第1题答对 combo=1');
  if(i===4) ok(r.correct===true&&r.combo===5,'第5题连对 combo=5，实际 '+r.combo);
  if(i===5) ok(r.correct===false&&r.combo===0,'第6题答错 combo 归零');
  if(i===5) ok(r.answer && r.explain_zh,'答错返回正确答案和规则解释');
  expScore+=r.score.total;
}
// 大小写/空格容错
const fillQ=(await j('GET','/api/questions?type=fill')).body[0];
const g2=(await j('POST','/api/game/start',{count:1})).body;
const tol=(await j('POST','/api/game/answer',{sessionId:g2.sessionId,idx:0,questionId:fillQ.id,picked:'  '+fillQ.answer.split('|')[0].toUpperCase()+' . '})).body;
ok(tol.correct===true,'填空大小写/空格/句号容错');

console.log('\n── 6. 结算与排行 ──');
const fin=(await j('POST','/api/game/finish',{sessionId:g.sessionId,players:[{playerName:stu.name,studentId:stu.id,team:''}]})).body;
const R=fin.results[0];
ok(R.correctCount===5&&R.total===7,'结算 5/7 正确');
ok(R.score===expScore,'结算总分等于逐题累加 '+R.score+' vs '+expScore);
ok(R.maxCombo===5,'最高连对 5');
ok(R.isNewPersonalBest===true,'首次即个人最佳');
const lb=(await j('GET','/api/leaderboard?scope=today')).body;
ok(lb.length===1&&lb[0].player_name===stu.name,'今日榜有记录');
ok(lb[0].class_name==='初二(3)班','排行榜带班级名');

console.log('\n── 7. 错题本生效 ──');
const g3=(await j('POST','/api/game/start',{studentId:stu.id,wrongPct:100,count:2})).body;
ok(g3.questions.length===2,'错题局抽 2 题');
ok(g3.note.includes('错题重出'),'提示错题重出：'+g3.note);

console.log('\n── 8. 统计 ──');
const rules=(await j('GET','/api/stats/rules')).body;
ok(rules.length>0&&rules[0].label&&rules[0].rate>=0,'语法点错误率统计，最薄弱：'+rules[0].label+' '+rules[0].rate+'%');
ok((await j('GET','/api/stats/overview')).body.questions===60,'概览题库数');
ok((await j('GET','/api/stats/sessions')).body.length>=1,'历史对局列表');

console.log('\n── 9. 题库 CSV ──');
const tplBytes=new Uint8Array(await (await fetch(B+'/api/questions/template.csv',{headers:{Cookie:cookie}})).arrayBuffer());
ok(tplBytes[0]===0xEF&&tplBytes[1]===0xBB&&tplBytes[2]===0xBF,'模板带 UTF-8 BOM（Excel 中文不乱码）');
const exp=(await j('GET','/api/questions/export.csv')).body;
ok(exp.split('\r\n').length>=61,'导出 60 题 + 表头');
const badImp=(await j('POST','/api/questions/import',{csv:'type,stem,answer,options,difficulty\nchoice,坏题,zzz,a|b,1\nchoice,,x,a|b,1\nfill,好题 ___ 。,taller,,9'})).body;
ok(badImp.errors.some(e=>e.line===2&&e.msg.includes('不在选项中')),'第2行：答案不在选项中');
ok(badImp.errors.some(e=>e.line===3&&e.msg.includes('题干不能为空')),'第3行：题干为空');
ok(badImp.errors.some(e=>e.line===4&&e.msg.includes('难度')),'第4行：难度非法');
ok(badImp.inserted===0&&badImp.failed===3,'3 行全部拒绝，无脏数据入库');
const goodImp=(await j('POST','/api/questions/import',{csv:'type,stem,answer,options,difficulty,rule_tag\nchoice,Test ___ here.,aaa,aaa|bbb,1,reg_er\nchoice,Test ___ here.,aaa,aaa|bbb,1,reg_er'})).body;
ok(goodImp.inserted===1,'重复题干只入 1 条');
ok(goodImp.errors.some(e=>e.msg.includes('重复')),'重复行有提示');

console.log('\n── 10. 设置读写 ──');
ok((await j('PUT','/api/settings',{questions_per_round:'5',bogus_key:'x'})).body.ignored.includes('bogus_key'),'未知设置键被忽略');
ok((await j('GET','/api/settings')).body.questions_per_round==='5','设置已保存');
ok((await j('POST','/api/game/start',{})).body.questions.length===5,'新设置对开局生效');
await j('PUT','/api/settings',{questions_per_round:'7'});

console.log('\n── 11. 清除成绩 ──');
ok((await j('GET','/api/leaderboard?scope=all')).body.length>=1,'清除前有成绩记录');
ok((await j('DELETE','/api/stats/records?scope=today')).body.ok===true,'清除今日成绩');
ok((await j('GET','/api/leaderboard?scope=all')).body.length===0,'排行榜已清空');
ok((await j('GET','/api/stats/sessions')).body.length===0,'对局列表已清空');
ok((await j('GET','/api/stats/overview')).body.records===0,'成绩记录数归零');

console.log(`\n═══ 通过 ${pass} / 失败 ${fail} ═══\n`);
process.exit(fail?1:0);

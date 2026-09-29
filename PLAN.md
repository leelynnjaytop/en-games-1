# 形容词比较级 / 最高级 课堂抢答游戏 — 实施计划

## 一、定位与形态

单机大屏抢答：老师笔记本接投影，一台设备跑全部逻辑。随机点名转盘抽学生上来答题，
答完输入姓名（或从班级名单点选）计入排行榜。断网也能玩（前端评分，数据落本地 SQLite）。

- 界面：中英双语（按钮/提示中英并排，语法规则卡中文解释 + 英文例句）
- 学段：初中（规则变化 + 不规则变化 + as...as / than / the most + 范围判断）
- 技术栈：Node 24 + Express + better-sqlite3（单文件数据库）+ 原生 HTML/CSS/JS（无构建步骤）
- 部署：`scp` 整个目录到服务器 → `npm ci --omit=dev` → `node src/server.js`，数据库就是一个 `data/app.db` 文件，复制即备份

## 二、目录结构

```
en-games-1/
├── package.json
├── .env.example                 # PORT / ADMIN_PASSWORD / DB_PATH
├── README.md                    # 部署 + 使用 + 备份说明（中文）
├── data/
│   └── app.db                   # SQLite（首次启动自动建库 + 灌 60 道题）
├── src/
│   ├── server.js                # Express 启动、静态托管、路由挂载
│   ├── db.js                    # 建表、迁移、连接
│   ├── seed/
│   │   ├── questions.seed.js    # 60 道题初始题库
│   │   └── settings.seed.js     # 默认设置
│   ├── lib/
│   │   ├── draw.js              # 抽题算法（难度配比 + 错题优先 + 局内不重复）
│   │   ├── grade.js             # 服务端判分（与前端一致，防手改）
│   │   ├── csv.js               # CSV 导入/导出
│   │   └── auth.js              # 后台口令中间件
│   └── routes/
│       ├── game.js      settings.js   questions.js
│       ├── students.js  leaderboard.js  stats.js
└── public/
    ├── index.html               # 大屏游戏主界面
    ├── admin.html               # 老师后台
    ├── css/  screen.css  admin.css
    └── js/
        ├── game.js              # 游戏状态机
        ├── sfx.js              # WebAudio 合成音效（无音频文件）
        ├── tts.js               # 题目/答案英文朗读
        ├── wheel.js             # 随机点名转盘
        ├── fx.js                # 大拇指、火焰 combo、礼花、屏幕震动
        └── admin.js
```

## 三、数据库设计（SQLite）

| 表 | 关键字段 | 用途 |
|---|---|---|
| `questions` | id, type(`choice`\|`fill`\|`fix`), stem, options(JSON), answer, distractor_hint, rule_tag, difficulty(1-3), explain_zh, explain_en, tts_text, enabled, times_asked, times_wrong | 题库，可增删改查 |
| `settings` | key, value | 每局题数、倒计时秒数、难度配比、combo 加成、音效音量、TTS 开关、错题优先权重 |
| `classes` | id, name | 班级 |
| `students` | id, class_id, name, seat_no, active | 名单，供转盘点名 + 免打字计分 |
| `sessions` | id, mode(`solo`\|`team`), question_count, settings_snapshot, started_at, finished_at | 一局游戏 |
| `session_answers` | session_id, idx, question_id, student_id, player_name, team, picked, is_correct, ms_used, score_delta, combo | 逐题落库（中途关页面也不丢数据） |
| `records` | session_id, student_id, player_name, class_id, score, correct_count, total, max_combo, created_at | 排行榜数据源 |
| `wrong_book` | student_id, question_id, wrong_count, last_wrong_at | 错题本，下一局优先重出 |

`rule_tag` 是语法点标签，用于错误率统计：
`reg_er`（单音节+er）、`reg_e`（以 e 结尾）、`reg_y`（辅音+y→ier）、`reg_double`（双写末尾辅音）、
`more_most`（多音节）、`irregular`（good/bad/many/little/far）、`than`、`as_as`、
`the_sup_range`（in/of 范围）、`one_of_sup`（one of the + 最高级 + 复数）、
`degree_adv`（much/even/far/a lot + 比较级）、`comp_vs_sup`（两者比较级 / 三者以上最高级）

## 四、60 道题初始题库配比

| 语法点 | 题数 | 示例 |
|---|---|---|
| reg_er 单音节 +er/-est | 8 | `My brother is ___ than me. (tall)` |
| reg_e 以 e 结尾 +r/-st | 5 | nice → nicer / nicest |
| reg_y 辅音+y→ier/iest | 7 | happy / easy / busy / early / heavy |
| reg_double 双写辅音 | 6 | big / hot / thin / fat / wet |
| more_most 多音节 | 8 | beautiful / interesting / important / expensive |
| irregular 不规则 | 8 | good-better-best / bad-worse-worst / far-farther |
| than 句式 | 4 | `Tom runs faster ___ Jack.` |
| as_as / not as...as | 5 | `She is as ___ as her sister. (tall)` |
| the_sup_range + one_of_sup | 5 | `the tallest ___ the class (in/of)` |
| degree_adv 程度副词 | 2 | `much / very + 比较级` 选择 |
| comp_vs_sup 范围判断 | 2 | 两人用比较级 vs 三人以上用最高级 |

题型分布：单选 44 题（4 选项，键盘 1/2/3/4 秒选）、填空 10 题（自动忽略大小写与首尾空格）、改错 6 题（点出错误单词并给正确形式）。
难度：L1 易 24 题 / L2 中 24 题 / L3 难 12 题。每道题都带中文语法解释 + 英文例句。

## 五、一局游戏流程（大屏状态机）

```
待机页 → [随机点名转盘 or 直接开始] → 出题页 ×N → 结算页 → 输入/点选姓名 → 排行榜页
```

1. **待机页**：超大标题、开始按钮、本局设置速览（7 题 / 15 秒 / 难度配比）、今日榜前 5
2. **随机点名转盘**（可跳过）：从班级名单抽学生，鼓点音效 + 转盘减速 + 定格重音 + 名字放大弹出
3. **出题页**
   - 题干超大字号（投影可读：题干 ≥ 4rem，选项 ≥ 2.5rem，高对比配色）
   - 顶部倒计时条（默认 15 秒，可设置或关闭），最后 5 秒变红 + 心跳滴答音 + 轻微屏幕脉动
   - 🔊 按钮朗读题干/选项（en-US TTS），答完自动朗读正确句
   - 答对：全屏 👍 弹跳放大 + 三连上扬「叮叮叮」+ 撒花粒子 + 加分数字飞入 + 鼓励语随机（"漂亮！Excellent!" / "语法大师！Grammar master!"）
   - 答错：短促「嗡」错误音 + 屏幕左右震动 + 弹出**语法规则卡**：
     ```
     ❌ 你选的：more tall
     ✅ 正确用法：taller
     📖 tall 是单音节形容词，比较级直接加 -er
        My brother is taller than me.
     💪 记住这条规则你就赢了一半，下一题稳住！
     ```
     （规则卡停留至老师点「继续」，方便讲解；答错不扣分，只是不加分）
   - **Combo 连对**：连对 2 题起，右上角火焰计数器升级（🔥→🔥🔥→🔥🔥🔥），音效音高逐级上扬，
     加成 +2/+3/+5 分，连对 5 题触发全屏「ON FIRE!」+ 欢呼音
4. **结算页**：得分环形进度动画、答对 X/N、最高 combo、正确率、按语法点列出本局薄弱项、
   全场欢呼/掌声音效、破纪录时额外礼花 + 「新纪录 NEW RECORD!」
5. **记分**：点选班级名单里的学生（一键，不用打字）或手动输入姓名 → 立即显示本次排名与个人最佳

## 六、红蓝分组对抗赛模式

- 待机页切换「个人赛 / 红蓝对抗」
- 从名单一键均分两队（或手动拖动分配），题目左右轮流归属红队/蓝队
- 屏幕顶部红蓝双色比分条实时拉锯（宽度按分数比例动画过渡），领先方队徽发光
- 答错时对方队获得 1 次「抢答机会」（可在设置里关闭）
- 终局：获胜方礼花 + 胜利号角，比分条爆开动画，记录写入 `sessions.mode='team'`

## 七、音效方案（夸张、无需音频文件）

`sfx.js` 用 WebAudio 实时合成，零外部资源、零版权问题、零加载延迟：

| 事件 | 音效设计 |
|---|---|
| 答对 | 三连上扬正弦叮（C-E-G 琶音）+ 高频闪光音 |
| 连对升级 | 音高随 combo 递增的上扬 whoosh（每级 +2 半音） |
| 答错 | 方波下滑「嗡——」+ 低频轰鸣 |
| 倒计时 | 每秒滴答，最后 5 秒加快并升高音调 |
| 超时 | 低音锣 |
| 转盘 | 鼓点循环 → 减速 → 定格「铛！」 |
| 结算 | 白噪声包络合成掌声 + 五音欢呼 + 上扬号角琶音 |
| 破纪录 | 长号角 + 连续礼花爆响 |

首次点击「开始」时解锁 AudioContext（规避浏览器自动播放限制）。
设置里有音量滑块和总开关；`public/audio/` 目录放同名 mp3 可覆盖内置合成音（想换真人音效时用）。

## 八、老师后台（`/admin.html`，口令保护）

1. **题库管理**：表格列出全部题目（按语法点/难度/题型筛选、搜索），行内编辑、启用/停用、删除；
   新建表单带实时预览（左边填，右边就是大屏长什么样）
2. **批量导入导出**：下载 CSV 模板 → Excel 里编辑 → 上传（校验报错精确到行号，重复题去重）；
   全量导出 CSV 做备份
3. **游戏设置**：每局题数（默认 7）、倒计时秒数（默认 15，可关）、难度配比（默认 3:3:1）、
   combo 加成分值、错题优先权重、TTS 开关与语速、是否允许答错扣分
4. **班级与名单**：班级增删、学生名单批量粘贴导入（一行一个名字）、启用/停用（转盘只抽在校的）
5. **成绩与排行**：今日榜 / 本周榜 / 总榜 / 按班级榜；每局明细可展开逐题查看；导出成绩 CSV
6. **薄弱点统计**：按 `rule_tag` 聚合错误率柱状图（纯 CSS 柱状，不引图表库），
   「全班最薄弱：辅音+y→ier（错误率 58%）」——直接指导下节课讲什么；
   支持按班级/时间范围筛选；可一键「生成一局全是薄弱点的专项练习」

## 九、抽题算法（`draw.js`）

1. 按设置的难度配比算出每档需要几题（7 题 → L1:3 / L2:3 / L3:1）
2. 错题优先：若指定了学生，其 `wrong_book` 里的题按权重提升被抽中概率（默认 30% 名额留给错题）
3. 全局冷却：最近 2 局出现过的题降权，避免连着上课重复
4. 语法点去重：同一局尽量不出现 3 道以上同 `rule_tag` 的题
5. 题量不足时自动放宽约束并在后台提示「题库偏少，建议补充 XX 类题目」

## 十、实施步骤

1. 初始化项目：`package.json`、`.env.example`、`db.js` 建表 + 迁移
2. 编写 60 道题 seed（含中文解释与英文例句）+ 默认设置 seed
3. 后端路由：settings → questions（含 CSV）→ students/classes → game（start/answer/finish）→ leaderboard → stats
4. `sfx.js` + `tts.js` + `fx.js`（音效和特效先做，后面调游戏手感靠它们）
5. `index.html` + `game.js`：待机 → 出题 → 规则卡 → 结算 → 计分 全流程（个人赛）
6. `wheel.js` 随机点名 + 倒计时 + combo 火焰
7. 红蓝对抗模式（复用状态机，加队伍归属与比分条）
8. `admin.html` + `admin.js`：题库 → 导入导出 → 设置 → 名单 → 成绩 → 薄弱点统计
9. 投影适配：1280×720 / 1920×1080 两档字号验证，深色高对比主题
10. `README.md`：部署命令、备份方法（复制 `data/app.db`）、systemd 开机自启示例、常见问题
11. 自测清单：60 题全部走一遍判分、CSV 导入错误行提示、断网可玩、刷新不丢局、口令保护生效

## 十一、我额外建议、已排进计划的点

- **答错不扣分**：课堂上扣分会让学生怕答题，只是「不加分」+ 讲规则，鼓励为主
- **规则卡停留到老师点继续**：给老师留讲解窗口，而不是 3 秒自动跳过
- **一键生成薄弱点专项练习**：统计不只是给你看，能直接变成下一局
- **点选名单代替打字**：课堂节奏最怕打字，名单点一下就计分
- **纯合成音效**：不用找素材、不怕版权、不怕加载慢，且能按 combo 动态变音高
- **TTS 朗读**：英语课的发音价值，比较级读音（-er 弱读、-est）本身就是考点
- **键盘快捷键**：`1/2/3/4` 选答案、`空格` 继续、`Enter` 提交、`Esc` 返回，老师可用无线翻页笔操作
- **settings_snapshot**：每局存下当时的设置，以后改了规则老成绩也解释得通
- **逐题落库**：课上意外关页面/断电，已答的题不丢

## 十二、暂不做（可后续加）

- 学生手机扫码同场竞技（Kahoot 式）：需要 WebSocket 房间系统，工作量约为当前 2-3 倍
- 其他语法专题（时态、从句）：题库表结构已预留 `rule_tag`，加题即可，无需改代码
- 头像/成就徽章体系

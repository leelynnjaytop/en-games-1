# 形容词比较级 & 最高级 · 课堂抢答游戏

初中英语课堂用的大屏抢答游戏。老师笔记本接投影就能玩，**一台设备跑全部功能，不依赖外网**。

- 🎮 **大屏游戏** `http://<服务器>/` —— 上课用
- ⚙️ **老师后台** `http://<服务器>/admin.html` —— 改题库、看成绩、查薄弱点

---

## 一分钟跑起来

```bash
npm ci                  # 安装依赖
cp .env.example .env    # 复制配置，把里面的 ADMIN_PASSWORD 改掉
npm start               # 启动
```

浏览器打开 <http://localhost:3000>。首次启动会自动建库并灌入**内置 60 道题**，不需要任何额外操作。

---

## 上课怎么用

1. **投影打开大屏页**，右上角可随时开关 🔊 音效和 🗣 英文朗读
2. 选**班级**（提前在后台导入名单）→ 点 **🎲 随机点名** 抽学生，或直接点名单里的名字
3. 点 **▶︎ 开始游戏**，默认 7 题、每题 15 秒
4. 学生答题：
   - **答对** → 全屏 👍 + 三连上扬音 + 撒花 + 加分飞入，连对 2 题起火焰 🔥 升级，连对 5 题全屏「ON FIRE!」
   - **答错** → 短促错误音 + 屏幕震动 + 弹出**语法规则卡**（你选的 / 正确用法 / 中文规则 / 英文例句 / 鼓励语），
     **停在那里等你点「继续」**，方便当场讲解。**答错不扣分**，只是不加分
   - 答完自动用英式/美式发音**朗读正确句**（比较级 -er、最高级 -est 的读音本身就是考点）
5. **结算页**：得分环动画、正确率、最高连对、本局薄弱语法点、掌声欢呼，破个人纪录会放礼花
6. 点名单里的学生名字（或输入姓名）即可**记成绩**，立刻看到今日排名

### 键盘快捷键（可用无线翻页笔操作，老师不用回电脑前）

| 键 | 作用 |
|---|---|
| `1` `2` `3` `4` | 选答案 |
| `空格` | 开始游戏 / 关闭规则卡继续 / 再来一局 |
| `Enter` | 提交填空答案 |
| `Esc` | 返回上一屏 / 退出本局 |

### 红蓝分组对抗赛

首页切到「⚔️ 红蓝对抗」→「🔀 一键均分两队」（点名字可换队）→ 开始。
题目左右轮流归属红蓝队，顶部**双色比分条实时拉锯**，一方答错时对方获得**抢答机会**（限时减半，可在设置里关闭），
终局胜方放礼花 + 胜利号角。

---

## 老师后台

| 标签页 | 能做什么 |
|---|---|
| 📚 **题库** | 增删改查、按语法点/题型/难度/状态筛选、搜索、启用停用。编辑时右侧有**大屏实时预览**，所见即所得 |
| 📥 **导入导出** | 下载 CSV 模板 → Excel 里编辑 → 上传；错误**精确到行号**；导出题库/成绩备份 |
| 🎛 **游戏设置** | 每局题数、倒计时、难度配比、各项分值、错题优先比例、音效音量、朗读语速等 |
| 👥 **班级名单** | 建班级、**批量粘贴导入**名单（支持「学号 姓名」格式）、停用转学的学生 |
| 🏅 **成绩** | 今日/本周/近30天/全部 × 个人赛/分组赛 × 按班级；可按每局或按人汇总；每局可展开看**逐题明细** |
| 📊 **薄弱点统计** | 各语法点错误率柱状图 + 最容易错的题 TOP 10；**一键用最薄弱的 3 个语法点生成专项练习** |

### 题库 CSV 格式

必填列：`type`（`choice` 单选 / `fill` 填空 / `fix` 改错）、`stem` 题干、`answer` 答案。

| 列 | 说明 |
|---|---|
| `id` | 留空=新增；填已有 id=更新那道题 |
| `stem` | 题干，用 `___` 表示空，括号里放提示词如 `(tall)` |
| `stem_zh` | 中文提示，显示在大屏题干下方 |
| `options` | 单选题的选项，用 `\|` 分隔，如 `taller\|tallest\|more tall\|tall` |
| `answer` | 单选题必须和某个选项完全一致；填空/改错题多个可接受答案也用 `\|` 分隔 |
| `rule_tag` | 语法点，见下表；填错会归入 `other` 并提示 |
| `difficulty` | `1` 易 / `2` 中 / `3` 难 |
| `explain_zh` | 中文语法解释 —— **答错时规则卡的正文，最重要的一列** |
| `explain_en` | 英文例句 —— 规则卡里的例句，也是朗读内容 |
| `enabled` | `1` 启用 / `0` 停用 |

**改错题怎么写**：`stem` 写**错误的整句**，`answer` 写**改正后的那个词**。
例：`stem = My sister is more young than me.`，`answer = younger`。

### 语法点标签

`reg_er` 单音节+er · `reg_e` 以e结尾 · `reg_y` 辅音+y→ier · `reg_double` 双写辅音 ·
`more_most` 多音节 · `irregular` 不规则 · `than` · `as_as` · `the_sup_range` 最高级范围in/of ·
`one_of_sup` one of the+最高级 · `degree_adv` 程度修饰/越来越 · `comp_vs_sup` 比较级vs最高级 · `other`

> 想加**其他语法专题**（时态、从句等）？直接用这套 CSV 加题即可，**不用改代码**。
> 要新增自己的标签名，编辑 `src/lib/tags.js` 里的 `RULE_TAGS` 数组加一行。

---

## 部署到服务器

### 1. 传文件并启动

```bash
# 本机（不要传 node_modules 和 data）
rsync -av --exclude node_modules --exclude data --exclude .git ./ user@服务器:/opt/en-games/

# 服务器上
cd /opt/en-games
npm ci --omit=dev
cp .env.example .env
vi .env                 # 【务必】改掉 ADMIN_PASSWORD
node src/server.js
```

### 2. 开机自启（systemd）

```ini
# /etc/systemd/system/en-games.service
[Unit]
Description=English Comparative Game
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/en-games
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now en-games
sudo systemctl status en-games        # 看状态
sudo journalctl -u en-games -f        # 看日志
```

### 3. Nginx 反向代理（可选，想用 80 端口或 HTTPS 时）

```nginx
server {
    listen 80;
    server_name game.你的域名.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> **⚠️ 朗读功能需要 HTTPS 或 localhost。** 浏览器的语音合成在纯 HTTP 的非本机地址上可能被禁用。
> 如果学生/老师通过局域网 IP 访问且朗读不出声，用 `certbot --nginx` 配个 HTTPS 就好了。
> 音效是 WebAudio 合成的，**不受此限制**，HTTP 下照常工作。

### 4. 备份与恢复

所有数据（题库、班级名单、成绩、错题本）都在**一个文件**里：`data/app.db`。

```bash
# 备份：复制走就行
cp /opt/en-games/data/app.db ~/backup/app-$(date +%F).db

# 恢复
sudo systemctl stop en-games
cp ~/backup/app-2026-09-29.db /opt/en-games/data/app.db
sudo systemctl start en-games
```

> 建议加个 crontab 每天自动备份：
> `0 2 * * * cp /opt/en-games/data/app.db /opt/en-games/backup/app-$(date +\%F).db`

---

## 配置项

`.env`：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `ADMIN_PASSWORD` | `change-me-please` | **老师后台口令，部署前必须改** |
| `DB_PATH` | `data/app.db` | 数据库文件路径 |

游戏参数（每局题数、倒计时等）都在**后台的「游戏设置」页**改，不用动文件。

---

## 换成真人录的音效

内置音效全部是 WebAudio **实时合成**的（零素材、零版权、零加载延迟，还能按连对数动态升调）。
想换成自己录的：把 mp3 放进 `public/audio/`，并新建 `public/audio/manifest.json`：

```json
{
  "correct": "correct.mp3",
  "wrong": "wrong.mp3",
  "combo": "combo.mp3",
  "applause": "applause.mp3",
  "fanfare": "fanfare.mp3"
}
```

列出的会覆盖内置音，没列的继续用合成音。可用的名字：
`correct` `wrong` `combo` `tick` `tick_urgent` `timeout` `wheel_stop` `applause` `cheer` `fanfare` `record` `victory` `start` `click` `select` `steal`

---

## 常用命令

```bash
npm start           # 启动
npm run dev         # 改代码自动重启（开发用）
npm run reseed      # 【危险】清空题库并恢复内置 60 道题（成绩和名单不受影响，执行前先导出备份）
npm test            # API 端到端自测（51 项）
npm run test:ui     # 真实浏览器自测（64 项，需要装了 Chrome 的机器）
```

> 跑测试请**另起一个实例并用独立数据库**，别污染生产数据：
> ```bash
> PORT=3111 ADMIN_PASSWORD=test123 DB_PATH=data/test.db node src/server.js
> ```

---

## 常见问题

**朗读没声音？** 见上面「部署」第 3 条——需要 HTTPS 或 localhost。也可能是系统没装英文语音包（Windows 到「设置 → 时间和语言 → 语音」里加装英语）。首页页脚会显示当前用的是哪个音色。

**音效没声音？** 浏览器要求先有一次用户点击才允许播放。点一下页面任意位置即可。也检查右上角 🔊 是否被关掉、后台设置里的音量。

**投影上字太小/太大？** 字号是按视口宽度自适应的（已在 1920×1080 / 1600×900 / 1366×768 / 1280×720 / 1024×768 上验证）。想整体调大，改 `public/css/screen.css` 里 `.stem` 和 `.opt` 的 `clamp()` 中间那个 `vw` 值。

**课上不小心关了页面？** 已答的每一题都是**逐题落库**的，不会丢；但那一局不会自动计入排行榜，重开一局即可。

**题库不够用了？** 后台「薄弱点统计」会提示哪类题最需要补。抽题时如果某个难度档题不够，会自动从相邻难度顶替并在日志里提示。

**想让学生用手机各自答题？** 当前是单机大屏形态。做成 Kahoot 那样的多人同场需要 WebSocket 房间系统，是另一个量级的工作量，目前没做。

---

## 项目结构

```
src/
  server.js              Express 启动 + 路由挂载 + 后台登录
  db.js                  建表 / 迁移 / 首次灌数据
  seed/
    questions.seed.js    内置 60 道题（含中文语法解释 + 英文例句）
    settings.seed.js     默认游戏设置
    reseed.js            重置题库脚本
  lib/
    draw.js              抽题：难度配比 + 错题优先 + 语法点去重 + 题库不足降级
    grade.js             判分：大小写/空格/标点容错，多答案支持，算分公式
    csv.js               CSV 解析与生成（带 BOM，Excel 中文不乱码）
    auth.js              后台口令（HMAC 签名 Cookie，恒定时间比较）
    tags.js              语法点标签表（加新专题改这里）
  routes/                settings / questions / students / game / leaderboard / stats
public/
  index.html  css/screen.css  js/game.js     大屏游戏
  admin.html  css/admin.css   js/admin.js    老师后台
  js/sfx.js    WebAudio 合成音效引擎
  js/tts.js    英文朗读
  js/fx.js     礼花 / 大拇指 / 飘分 / 震动
test/
  api.test.mjs   后端 51 项
  ui.test.mjs    真实 Chrome 驱动的端到端 64 项
data/app.db      SQLite，复制即备份
```

技术栈：Node + Express + better-sqlite3 + 原生 HTML/CSS/JS。**无构建步骤**，改完代码直接刷新。

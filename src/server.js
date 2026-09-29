'use strict';
require('dotenv').config();

const path = require('path');
const express = require('express');
const { init, DB_PATH } = require('./db');
const { COOKIE, MAX_AGE_MS, makeToken, verifyToken, readCookie, checkPassword } = require('./lib/auth');

const db = init();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));          // CSV 导入可能比较大
app.use(express.urlencoded({ extended: false }));

// ── 老师后台登录 ───────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  if (!checkPassword((req.body || {}).password)) {
    return res.status(401).json({ error: '口令不对' });
  }
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(makeToken())}; Path=/; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  res.json({ authed: verifyToken(readCookie(req, COOKIE)) });
});

// ── 业务路由 ───────────────────────────────────────────────────────
app.use('/api/settings',    require('./routes/settings').router);
app.use('/api/questions',   require('./routes/questions').router);
app.use('/api',             require('./routes/students').router);   // /api/classes, /api/students
app.use('/api/game',        require('./routes/game').router);
app.use('/api/leaderboard', require('./routes/leaderboard').router);
app.use('/api/stats',       require('./routes/stats').router);

app.get('/api/health', (req, res) => res.json({ ok: true, db: DB_PATH, time: new Date().toISOString() }));

// ── 静态文件 ───────────────────────────────────────────────────────
app.use(express.static(path.resolve(__dirname, '..', 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (/\.(html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use('/api', (req, res) => res.status(404).json({ error: `接口不存在：${req.method} ${req.originalUrl}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[错误]', err);
  res.status(500).json({ error: '服务器出错了：' + (err.message || String(err)) });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  const n = db.prepare('SELECT COUNT(*) n FROM questions').get().n;
  console.log('');
  console.log('  ✅ 比较级/最高级课堂游戏已启动');
  console.log(`  🎮 大屏游戏   http://localhost:${PORT}/`);
  console.log(`  ⚙️  老师后台   http://localhost:${PORT}/admin.html`);
  console.log(`  🗄️  数据库     ${DB_PATH}  （题库 ${n} 道）`);
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'change-me-please') {
    console.log('  ⚠️  后台口令还是默认值，部署到服务器前请在 .env 里改掉 ADMIN_PASSWORD');
  }
  console.log('');
});

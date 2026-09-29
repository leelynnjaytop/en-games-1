'use strict';
/**
 * 热备份：不用停服务，也不怕 WAL 没合并。
 * 用 SQLite 的 VACUUM INTO，直接产出一个自洽、已压实的单文件副本。
 *   node src/backup.js                 → data/backup/app-YYYYMMDD-HHMMSS.db
 *   node src/backup.js /path/to/out.db → 指定路径
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { db, DB_PATH } = require('./db');

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/(\d{8})(\d{6})/, '$1-$2');
const out = path.resolve(process.argv[2] || path.join(path.dirname(DB_PATH), 'backup', `app-${stamp}.db`));

fs.mkdirSync(path.dirname(out), { recursive: true });
if (fs.existsSync(out)) { console.error(`目标已存在，换个名字：${out}`); process.exit(1); }

db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);

// 立刻校验备份是可读且有数据的——备份最怕的就是"以为备了"
const Database = require('better-sqlite3');
const chk = new Database(out, { readonly: true });
const n = (t) => chk.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
const summary = ['questions', 'records', 'sessions', 'classes', 'students'].map((t) => `${t}=${n(t)}`).join(' ');
chk.close();

console.log(`✅ 备份完成：${out}`);
console.log(`   大小 ${(fs.statSync(out).size / 1024).toFixed(0)} KB ｜ ${summary}`);

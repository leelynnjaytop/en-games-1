'use strict';
const crypto = require('crypto');

const COOKIE = 'engames_admin';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;   // 12 小时，够上一天课

function secret() {
  return process.env.ADMIN_PASSWORD || 'change-me-please';
}

function sign(issuedAt) {
  return crypto.createHmac('sha256', secret()).update(String(issuedAt)).digest('hex').slice(0, 32);
}

function makeToken() {
  const t = Date.now();
  return `${t}.${sign(t)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [tsRaw, sig] = token.split('.');
  const ts = Number(tsRaw);
  if (!ts || !sig) return false;
  if (Date.now() - ts > MAX_AGE_MS) return false;
  const expected = sign(ts);
  // 等长时才做恒定时间比较，避免 timingSafeEqual 抛异常
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function checkPassword(input) {
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(secret());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 保护后台写接口 */
function requireAdmin(req, res, next) {
  if (verifyToken(readCookie(req, COOKIE))) return next();
  res.status(401).json({ error: '需要老师口令，请先登录后台' });
}

module.exports = { COOKIE, MAX_AGE_MS, makeToken, verifyToken, readCookie, checkPassword, requireAdmin };

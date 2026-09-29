'use strict';
const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../lib/auth');
const { DEFAULTS } = require('../seed/settings.seed');

const router = express.Router();

function getAll() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

router.get('/', (req, res) => res.json(getAll()));

router.put('/', requireAdmin, (req, res) => {
  const body = req.body || {};
  const allowed = new Set(Object.keys(DEFAULTS));
  const up = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const bad = [];
  db.transaction(() => {
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.has(k)) { bad.push(k); continue; }
      up.run(k, String(v));
    }
  })();
  res.json({ ok: true, settings: getAll(), ignored: bad });
});

module.exports = { router, getAll };

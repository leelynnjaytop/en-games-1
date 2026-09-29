'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.resolve(ROOT, process.env.DB_PATH || 'data/app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** 建表（幂等）。新增字段请走 migrate()，不要改这里的历史语句。 */
function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      type         TEXT    NOT NULL DEFAULT 'choice',   -- choice | fill | fix
      stem         TEXT    NOT NULL,                    -- 题干，用 ___ 表示空
      stem_zh      TEXT    NOT NULL DEFAULT '',         -- 中文提示
      options      TEXT    NOT NULL DEFAULT '[]',       -- JSON 数组，choice 专用
      answer       TEXT    NOT NULL,                    -- choice=正确选项原文；fill/fix=答案，多个用 | 分隔
      rule_tag     TEXT    NOT NULL DEFAULT 'other',    -- 语法点标签
      difficulty   INTEGER NOT NULL DEFAULT 1,          -- 1易 2中 3难
      explain_zh   TEXT    NOT NULL DEFAULT '',         -- 中文规则解释
      explain_en   TEXT    NOT NULL DEFAULT '',         -- 英文例句
      tts_text     TEXT    NOT NULL DEFAULT '',         -- 朗读文本，空则用 explain_en
      enabled      INTEGER NOT NULL DEFAULT 1,
      times_asked  INTEGER NOT NULL DEFAULT 0,
      times_wrong  INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS students (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      name     TEXT    NOT NULL,
      seat_no  TEXT    NOT NULL DEFAULT '',
      active   INTEGER NOT NULL DEFAULT 1,
      UNIQUE(class_id, name)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      mode              TEXT    NOT NULL DEFAULT 'solo',  -- solo | team
      question_count    INTEGER NOT NULL,
      settings_snapshot TEXT    NOT NULL DEFAULT '{}',
      started_at        TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      finished_at       TEXT
    );

    CREATE TABLE IF NOT EXISTS session_answers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      idx         INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      student_id  INTEGER,
      player_name TEXT    NOT NULL DEFAULT '',
      team        TEXT    NOT NULL DEFAULT '',            -- '' | red | blue
      picked      TEXT    NOT NULL DEFAULT '',
      is_correct  INTEGER NOT NULL DEFAULT 0,
      ms_used     INTEGER NOT NULL DEFAULT 0,
      score_delta INTEGER NOT NULL DEFAULT 0,
      combo       INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS records (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
      student_id    INTEGER,
      player_name   TEXT    NOT NULL,
      class_id      INTEGER,
      mode          TEXT    NOT NULL DEFAULT 'solo',
      team          TEXT    NOT NULL DEFAULT '',
      score         INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      total         INTEGER NOT NULL DEFAULT 0,
      max_combo     INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS wrong_book (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id    INTEGER,
      question_id   INTEGER NOT NULL,
      wrong_count   INTEGER NOT NULL DEFAULT 1,
      last_wrong_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(student_id, question_id)
    );

    CREATE INDEX IF NOT EXISTS idx_q_enabled   ON questions(enabled, difficulty);
    CREATE INDEX IF NOT EXISTS idx_q_rule      ON questions(rule_tag);
    CREATE INDEX IF NOT EXISTS idx_sa_session  ON session_answers(session_id);
    CREATE INDEX IF NOT EXISTS idx_sa_question ON session_answers(question_id);
    CREATE INDEX IF NOT EXISTS idx_rec_created ON records(created_at);
    CREATE INDEX IF NOT EXISTS idx_rec_score   ON records(score DESC);
  `);
}

/** 后续版本加字段时在这里补，保证老库能平滑升级 */
function migrate() {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const addIfMissing = (table, col, ddl) => {
    if (!cols(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  // 示例：addIfMissing('questions', 'audio_url', "audio_url TEXT NOT NULL DEFAULT ''");
  addIfMissing('questions', 'last_used_at', 'last_used_at TEXT');
}

function init() {
  createTables();
  migrate();
  // 首次启动灌初始数据
  const { seedSettings } = require('./seed/settings.seed');
  const { seedQuestions } = require('./seed/questions.seed');
  seedSettings(db);
  seedQuestions(db);
  return db;
}

module.exports = { db, init, DB_PATH };

'use strict';
/** 危险操作：清空题库并重新灌入内置 60 道题。成绩/名单不受影响。 */
require('dotenv').config();
const { db, init } = require('../db');
const { seedQuestions } = require('./questions.seed');

init();
const before = db.prepare('SELECT COUNT(*) n FROM questions').get().n;
db.exec('DELETE FROM questions');
db.exec("DELETE FROM sqlite_sequence WHERE name='questions'");
const r = seedQuestions(db);
console.log(`题库已重置：原 ${before} 道 → 现 ${r.inserted} 道（成绩与班级名单未改动）`);

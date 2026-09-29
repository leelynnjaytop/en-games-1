'use strict';

/** 归一化：去首尾空格、转小写、压缩空白、去掉句末标点 */
function normalize(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")   // 中文/弯引号 → 直引号
    .replace(/\s+/g, ' ')
    .replace(/[\s.。!！?？,，;；]+$/, '');   // 句末标点连同空白一起剥掉
}

/** answer 字段支持用 | 分隔多个可接受答案 */
function acceptableAnswers(answer) {
  return String(answer || '').split('|').map(normalize).filter(Boolean);
}

function isCorrect(question, picked) {
  if (picked == null || picked === '') return false;
  if (question.type === 'choice') return normalize(picked) === normalize(question.answer);
  return acceptableAnswers(question.answer).includes(normalize(picked));
}

/** 展示用的标准答案（取 | 前第一个） */
function displayAnswer(question) {
  return String(question.answer || '').split('|')[0].trim();
}

/**
 * 算分：基础分 + 速度奖励 + 连对奖励
 * @param {boolean} correct
 * @param {number}  msUsed    本题用时（毫秒）
 * @param {number}  timerMs   本题限时（毫秒），0 表示不限时
 * @param {number}  combo     含本题在内的连对数
 * @param {object}  s         settings
 */
function scoreFor(correct, msUsed, timerMs, combo, s) {
  const base = Number(s.base_score ?? 10);
  const penalty = Number(s.penalty_on_wrong ?? 0);
  if (!correct) return { total: -penalty, base: 0, speed: 0, comboBonus: 0 };

  let speed = 0;
  const speedMax = Number(s.speed_bonus_max ?? 0);
  if (speedMax > 0 && timerMs > 0) {
    const left = Math.max(0, Math.min(timerMs, timerMs - msUsed));
    speed = Math.round(speedMax * (left / timerMs));
  }

  const tiers = String(s.combo_bonus ?? '2,3,5').split(',').map((n) => Number(n.trim()) || 0);
  let comboBonus = 0;
  if (combo >= 4) comboBonus = tiers[2] ?? 0;
  else if (combo === 3) comboBonus = tiers[1] ?? 0;
  else if (combo === 2) comboBonus = tiers[0] ?? 0;

  return { total: base + speed + comboBonus, base, speed, comboBonus };
}

module.exports = { normalize, acceptableAnswers, isCorrect, displayAnswer, scoreFor };

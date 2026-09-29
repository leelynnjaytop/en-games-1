'use strict';

/** 默认设置。已存在的 key 不覆盖，老师改过的值不会被重启冲掉。 */
const DEFAULTS = {
  questions_per_round: '7',      // 每局题数
  timer_enabled: '1',            // 是否开启倒计时
  timer_seconds: '15',           // 每题倒计时秒数
  difficulty_ratio: '3:3:1',     // 易:中:难 抽题配比
  base_score: '10',              // 答对基础分
  speed_bonus_max: '5',          // 速度奖励上限（按剩余时间比例）
  combo_bonus: '2,3,5',          // 连对 2/3/4+ 题时的额外加分
  penalty_on_wrong: '0',         // 答错扣分（默认 0，课堂鼓励为主）
  wrong_priority_pct: '30',      // 错题本占本局题量的比例（%）
  rule_card_manual: '1',         // 答错后规则卡是否等老师点"继续"
  tts_enabled: '1',              // 英文朗读
  tts_rate: '0.9',               // 朗读语速
  sfx_enabled: '1',              // 音效
  sfx_volume: '0.8',             // 音量 0~1
  team_steal: '1',               // 红蓝对抗：答错后对方可抢答
  show_leaderboard_home: '1',    // 待机页显示今日榜
};

function seedSettings(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(DEFAULTS)) ins.run(k, v);
  });
  tx();
}

module.exports = { seedSettings, DEFAULTS };

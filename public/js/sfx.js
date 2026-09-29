/*!
 * sfx.js —— 课堂游戏音效引擎
 * 全部用 WebAudio 实时合成：不依赖任何音频文件，零加载延迟、零版权问题，
 * 而且连对音效能按 combo 等级动态升调。
 *
 * 想换成真人录的音效：把 mp3 放进 public/audio/，
 * 并在 public/audio/manifest.json 里列出文件名，例如
 *   { "correct": "correct.mp3", "wrong": "wrong.mp3" }
 * 列出的会自动覆盖内置合成音，没列的继续用合成音。
 */
(function (global) {
  'use strict';

  let ctx = null, master = null, noiseBuf = null;
  let enabled = true, volume = 0.8;
  let unlocked = false;
  const overrides = Object.create(null);
  let drumTimer = null;

  function ensure() {
    if (ctx) return ctx;
    const AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    // 压缩器让音效更"冲"，投影仪小喇叭也听得清
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;

    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(comp);
    comp.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    return ctx;
  }

  /** 浏览器要求先有用户手势才能出声，第一次点击时调用 */
  function unlock() {
    const c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    unlocked = true;
  }

  const now = () => (ensure() ? ctx.currentTime : 0);

  /** 单个振荡器音 */
  function tone(o) {
    const c = ensure();
    if (!c || !enabled) return;
    const t0 = c.currentTime + (o.at || 0);
    const dur = o.dur || 0.2;
    const gain = o.gain == null ? 0.3 : o.gain;

    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    if (o.detune) osc.detune.value = o.detune;
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);

    let node = osc;
    if (o.filter) {
      const f = c.createBiquadFilter();
      f.type = o.filter.type || 'lowpass';
      f.frequency.value = o.filter.freq || 2000;
      f.Q.value = o.filter.Q || 1;
      osc.connect(f);
      node = f;
    }

    const g = c.createGain();
    const atk = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    node.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  /** 噪声（掌声、鼓、镲） */
  function noise(o) {
    const c = ensure();
    if (!c || !enabled) return;
    const t0 = c.currentTime + (o.at || 0);
    const dur = o.dur || 0.1;

    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;

    const f = c.createBiquadFilter();
    f.type = (o.filter && o.filter.type) || 'bandpass';
    f.frequency.value = (o.filter && o.filter.freq) || 1500;
    f.Q.value = (o.filter && o.filter.Q) || 1;
    if (o.filter && o.filter.to) {
      f.frequency.setValueAtTime(o.filter.freq, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.to), t0 + dur);
    }

    const g = c.createGain();
    const gain = o.gain == null ? 0.25 : o.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // 半音 → 频率，以 A4=440 为基准
  const hz = (semitonesFromA4) => 440 * Math.pow(2, semitonesFromA4 / 12);

  // ── 外部 mp3 覆盖 ────────────────────────────────────────────────
  function loadOverrides() {
    fetch('audio/manifest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!m) return;
        for (const [name, file] of Object.entries(m)) {
          const a = new Audio('audio/' + file);
          a.preload = 'auto';
          a.addEventListener('canplaythrough', () => { overrides[name] = a; }, { once: true });
        }
      })
      .catch(() => {});   // 没放 manifest.json 是正常情况，静默忽略
  }

  function playOverride(name) {
    const a = overrides[name];
    if (!a || !enabled) return false;
    try {
      const n = a.cloneNode();
      n.volume = volume;
      n.play().catch(() => {});
      return true;
    } catch { return false; }
  }

  // ── 具体音效 ─────────────────────────────────────────────────────
  const S = {
    /** 答对：C-E-G-C 上行琶音 + 高频闪光 */
    correct() {
      if (playOverride('correct')) return;
      const notes = [3, 7, 10, 15];           // C5 E5 G5 C6
      notes.forEach((n, i) => {
        tone({ freq: hz(n), type: 'sine',     at: i * 0.075, dur: 0.3, gain: 0.34 });
        tone({ freq: hz(n + 12), type: 'triangle', at: i * 0.075, dur: 0.18, gain: 0.12 });
      });
      tone({ freq: hz(27), to: hz(34), type: 'sine', at: 0.24, dur: 0.3, gain: 0.14 });
      noise({ at: 0.24, dur: 0.22, gain: 0.07, filter: { type: 'highpass', freq: 5000 } });
    },

    /** 答错：方波下滑 + 低频轰鸣 */
    wrong() {
      if (playOverride('wrong')) return;
      tone({ freq: 233, to: 82,  type: 'square',   dur: 0.42, gain: 0.26, filter: { type: 'lowpass', freq: 1200 } });
      tone({ freq: 116, to: 55,  type: 'sawtooth', dur: 0.48, gain: 0.18, filter: { type: 'lowpass', freq: 600 } });
      noise({ dur: 0.16, gain: 0.08, filter: { type: 'lowpass', freq: 900 } });
    },

    /** 连对：等级越高音越高、越亮 */
    combo(level) {
      if (playOverride('combo')) return;
      const L = Math.max(1, Math.min(8, level || 1));
      const base = 3 + (L - 1) * 2;           // 每级 +2 半音
      tone({ freq: hz(base - 12), to: hz(base + 12), type: 'sawtooth', dur: 0.34, gain: 0.2,
             filter: { type: 'lowpass', freq: 900, to: 6000 } });
      [0, 4, 7].forEach((iv, i) => {
        tone({ freq: hz(base + iv), type: 'triangle', at: 0.14 + i * 0.05, dur: 0.26, gain: 0.22 });
      });
      noise({ at: 0.1, dur: 0.3, gain: 0.06, filter: { type: 'highpass', freq: 3000, to: 9000 } });
    },

    /** 倒计时滴答，urgent=最后 5 秒 */
    tick(urgent) {
      if (playOverride(urgent ? 'tick_urgent' : 'tick')) return;
      tone({ freq: urgent ? 1180 : 820, type: 'square', dur: urgent ? 0.07 : 0.05,
             gain: urgent ? 0.2 : 0.1, filter: { type: 'bandpass', freq: urgent ? 1600 : 1000, Q: 3 } });
    },

    /** 超时：低音锣 */
    timeout() {
      if (playOverride('timeout')) return;
      tone({ freq: 96, to: 62, type: 'sine',     dur: 1.5, gain: 0.34 });
      tone({ freq: 143, to: 88, type: 'triangle', dur: 1.2, gain: 0.14 });
      noise({ dur: 1.1, gain: 0.12, filter: { type: 'lowpass', freq: 2200, to: 300 } });
    },

    /** 转盘鼓点，返回停止函数 */
    drumroll() {
      if (drumTimer) clearInterval(drumTimer);
      let gap = 55;
      const beat = () => {
        noise({ dur: 0.06, gain: 0.2, filter: { type: 'bandpass', freq: 180, Q: 1.4 } });
        tone({ freq: 90, to: 60, type: 'sine', dur: 0.07, gain: 0.14 });
      };
      beat();
      drumTimer = setInterval(beat, gap);
      return S.drumStop;
    },

    drumStop() {
      if (drumTimer) { clearInterval(drumTimer); drumTimer = null; }
    },

    /** 转盘定格：镲 + "铛" */
    wheelStop() {
      S.drumStop();
      if (playOverride('wheel_stop')) return;
      noise({ dur: 0.9, gain: 0.26, filter: { type: 'highpass', freq: 3500 } });
      [0, 7, 12, 16].forEach((iv, i) => {
        tone({ freq: hz(3 + iv), type: 'triangle', at: i * 0.012, dur: 0.85, gain: 0.2 });
      });
      tone({ freq: 160, to: 90, type: 'sine', dur: 0.5, gain: 0.18 });
    },

    /** 掌声：一堆随机的窄带噪声爆 */
    applause(ms) {
      if (playOverride('applause')) return;
      const total = (ms || 1800) / 1000;
      const claps = Math.floor(total * 46);
      for (let i = 0; i < claps; i++) {
        const at = Math.random() * total;
        // 开头密集、后面渐稀，像真实的鼓掌
        const fade = 1 - (at / total) * 0.55;
        noise({
          at, dur: 0.035 + Math.random() * 0.03,
          gain: (0.05 + Math.random() * 0.07) * fade,
          filter: { type: 'bandpass', freq: 1100 + Math.random() * 2200, Q: 0.9 },
        });
      }
    },

    /** 欢呼：掌声 + 一群上扬的"哇" */
    cheer(ms) {
      S.applause(ms || 2000);
      if (playOverride('cheer')) return;
      for (let i = 0; i < 7; i++) {
        const f = 300 + Math.random() * 280;
        tone({ freq: f, to: f * (1.5 + Math.random() * 0.5), type: 'sawtooth',
               at: Math.random() * 0.35, dur: 0.8 + Math.random() * 0.5, gain: 0.05,
               filter: { type: 'bandpass', freq: 900 + Math.random() * 600, Q: 2 } });
      }
    },

    /** 号角：铜管味大三和弦上行 */
    fanfare() {
      if (playOverride('fanfare')) return;
      const seq = [[3, 0], [7, 0.13], [10, 0.26], [15, 0.39]];
      seq.forEach(([n, at]) => {
        tone({ freq: hz(n), type: 'sawtooth', at, dur: at === 0.39 ? 0.85 : 0.2, gain: 0.22,
               filter: { type: 'lowpass', freq: 2600, Q: 1 } });
        tone({ freq: hz(n - 12), type: 'square', at, dur: at === 0.39 ? 0.85 : 0.2, gain: 0.08,
               filter: { type: 'lowpass', freq: 1200 } });
      });
    },

    /** 破纪录：长号角 + 连串礼花爆响 */
    record() {
      S.fanfare();
      if (playOverride('record')) return;
      for (let i = 0; i < 6; i++) {
        const at = 0.45 + i * 0.16 + Math.random() * 0.06;
        noise({ at, dur: 0.3, gain: 0.16, filter: { type: 'bandpass', freq: 500 + Math.random() * 1800, Q: 0.7 } });
        tone({ freq: 1400 + Math.random() * 900, to: 2600, type: 'sine', at: at + 0.02, dur: 0.24, gain: 0.08 });
      }
      S.cheer(2400);
    },

    /** 胜利（分组赛） */
    victory() {
      if (playOverride('victory')) return;
      const seq = [[3, 0], [7, 0.12], [10, 0.24], [15, 0.36], [12, 0.52], [15, 0.64]];
      seq.forEach(([n, at], i) => {
        tone({ freq: hz(n), type: 'sawtooth', at, dur: i === seq.length - 1 ? 1.0 : 0.18, gain: 0.24,
               filter: { type: 'lowpass', freq: 3000 } });
      });
      S.cheer(2600);
    },

    /** 开始游戏 */
    start() {
      if (playOverride('start')) return;
      tone({ freq: hz(-9), to: hz(3), type: 'sawtooth', dur: 0.5, gain: 0.2,
             filter: { type: 'lowpass', freq: 700, to: 4500 } });
      tone({ freq: hz(15), type: 'triangle', at: 0.42, dur: 0.35, gain: 0.22 });
      noise({ at: 0.3, dur: 0.35, gain: 0.08, filter: { type: 'highpass', freq: 2500, to: 8000 } });
    },

    /** UI 点击 */
    click() {
      if (playOverride('click')) return;
      tone({ freq: 620, type: 'square', dur: 0.045, gain: 0.08, filter: { type: 'bandpass', freq: 1400, Q: 2 } });
    },

    /** 选中/切换 */
    select() {
      if (playOverride('select')) return;
      tone({ freq: hz(10), to: hz(15), type: 'triangle', dur: 0.12, gain: 0.14 });
    },

    /** 抢答机会（分组赛） */
    steal() {
      if (playOverride('steal')) return;
      tone({ freq: hz(-2), to: hz(10), type: 'square', dur: 0.28, gain: 0.18,
             filter: { type: 'bandpass', freq: 1200, Q: 2 } });
      noise({ at: 0.2, dur: 0.18, gain: 0.08, filter: { type: 'highpass', freq: 4000 } });
    },
  };

  // ── 对外接口 ─────────────────────────────────────────────────────
  global.SFX = Object.assign(S, {
    unlock,
    isUnlocked: () => unlocked,
    setEnabled(v) { enabled = !!v; if (!enabled) S.drumStop(); },
    isEnabled: () => enabled,
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (master) master.gain.setTargetAtTime(volume, now(), 0.01);
    },
    getVolume: () => volume,
    loadOverrides,
  });

  loadOverrides();
})(window);

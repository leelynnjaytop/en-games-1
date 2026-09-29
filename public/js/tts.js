/*!
 * tts.js —— 英文朗读（浏览器自带语音合成，无需联网、无需 API key）
 * 英语课的重点：比较级 -er 的弱读、最高级 -est 的读音，让学生听见。
 */
(function (global) {
  'use strict';

  const synth = global.speechSynthesis;
  let enabled = true;
  let rate = 0.9;
  let voice = null;
  let voicesReady = false;

  /** 优先挑英式/美式的自然音色 */
  function pickVoice() {
    if (!synth) return null;
    const all = synth.getVoices();
    if (!all.length) return null;
    voicesReady = true;
    const en = all.filter((v) => /^en(-|_|$)/i.test(v.lang));
    if (!en.length) return null;
    const prefer = [
      /Samantha/i, /Karen/i, /Daniel/i, /Moira/i,     // macOS 自带的自然音
      /Google US English/i, /Google UK English/i,      // Chrome
      /Microsoft (Aria|Guy|Sonia|Ryan)/i,              // Edge/Windows
    ];
    for (const re of prefer) {
      const hit = en.find((v) => re.test(v.name));
      if (hit) return hit;
    }
    return en.find((v) => /en-US/i.test(v.lang)) || en[0];
  }

  function refresh() {
    const v = pickVoice();
    if (v) voice = v;
  }

  if (synth) {
    refresh();
    synth.addEventListener?.('voiceschanged', refresh);
    // Safari 有时不触发 voiceschanged，兜底轮询几次
    let tries = 0;
    const t = setInterval(() => {
      if (voicesReady || tries++ > 10) return clearInterval(t);
      refresh();
    }, 300);
  }

  const TTS = {
    available: () => !!synth,
    isEnabled: () => enabled && !!synth,
    setEnabled(v) { enabled = !!v; if (!enabled) TTS.cancel(); },
    setRate(r) { rate = Math.max(0.4, Math.min(1.6, Number(r) || 0.9)); },
    getRate: () => rate,
    voiceName: () => (voice ? `${voice.name} (${voice.lang})` : '系统默认'),
    cancel() { try { synth && synth.cancel(); } catch {} },

    /**
     * 朗读一段英文
     * @param {string} text
     * @param {{rate?:number, onend?:Function, interrupt?:boolean}} opts
     */
    speak(text, opts) {
      const o = opts || {};
      if (!synth || !enabled || !text) { o.onend && o.onend(); return; }
      // 题干里的 ___ 读成短停顿，(tall) 这类提示词不读
      const clean = String(text)
        .replace(/_{2,}/g, ' , ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!clean) { o.onend && o.onend(); return; }

      if (o.interrupt !== false) TTS.cancel();
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = (voice && voice.lang) || 'en-US';
      if (voice) u.voice = voice;
      u.rate = o.rate || rate;
      u.pitch = 1;
      u.volume = 1;
      if (o.onend) {
        u.addEventListener('end', o.onend, { once: true });
        u.addEventListener('error', o.onend, { once: true });
      }
      try { synth.speak(u); } catch { o.onend && o.onend(); }
    },
  };

  global.TTS = TTS;
})(window);

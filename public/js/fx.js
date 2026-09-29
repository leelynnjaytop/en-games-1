/*!
 * fx.js —— 视觉特效：礼花、大拇指、飘分、震动、火焰
 * 一块全屏 canvas 跑粒子，其余用 DOM + CSS 动画。
 */
(function (global) {
  'use strict';

  let cv = null, cx = null, parts = [], raf = null, dpr = 1;

  function canvas() {
    if (cv) return cv;
    cv = document.createElement('canvas');
    cv.id = 'fx-canvas';
    Object.assign(cv.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '9000',
    });
    document.body.appendChild(cv);
    cx = cv.getContext('2d');
    resize();
    global.addEventListener('resize', resize);
    return cv;
  }

  function resize() {
    if (!cv) return;
    dpr = Math.min(2, global.devicePixelRatio || 1);
    cv.width = Math.floor(global.innerWidth * dpr);
    cv.height = Math.floor(global.innerHeight * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const PALETTE = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#c77dff', '#ffffff'];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function tick() {
    const W = global.innerWidth, H = global.innerHeight;
    cx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vy += p.g;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 1;
      if (p.life <= 0 || p.y > H + 60) { parts.splice(i, 1); continue; }

      const alpha = Math.min(1, p.life / p.fade);
      cx.save();
      cx.globalAlpha = alpha;
      cx.translate(p.x, p.y);
      cx.rotate(p.rot);
      cx.fillStyle = p.color;
      if (p.shape === 'circle') {
        cx.beginPath(); cx.arc(0, 0, p.size / 2, 0, Math.PI * 2); cx.fill();
      } else if (p.shape === 'star') {
        cx.font = `${p.size * 2}px serif`;
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(p.glyph || '✦', 0, 0);
      } else {
        cx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      cx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(tick);
    else { raf = null; cx.clearRect(0, 0, W, H); }
  }

  function push(list) {
    canvas();
    parts.push(...list);
    if (parts.length > 1200) parts.splice(0, parts.length - 1200);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function makeParts(n, opts) {
    const o = opts || {};
    const out = [];
    for (let i = 0; i < n; i++) {
      const ang = o.angle != null ? o.angle + rnd(-o.spread, o.spread) : rnd(0, Math.PI * 2);
      const sp = rnd(o.speedMin || 3, o.speedMax || 11);
      out.push({
        x: o.x, y: o.y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        g: o.gravity == null ? 0.22 : o.gravity,
        drag: o.drag || 0.985,
        rot: rnd(0, Math.PI * 2),
        vr: rnd(-0.3, 0.3),
        size: rnd(o.sizeMin || 7, o.sizeMax || 15),
        color: (o.colors || PALETTE)[Math.floor(Math.random() * (o.colors || PALETTE).length)],
        shape: o.shape || (Math.random() < 0.22 ? 'circle' : 'rect'),
        glyph: o.glyph,
        life: rnd(o.lifeMin || 70, o.lifeMax || 130),
        fade: 35,
      });
    }
    return out;
  }

  const FX = {
    /** 从某点炸开 */
    burst(x, y, n, opts) {
      push(makeParts(n || 60, Object.assign({ x, y }, opts)));
    },

    /** 从屏幕两侧向中间喷（答对时用） */
    confetti(n) {
      const W = global.innerWidth, H = global.innerHeight;
      push(makeParts(Math.floor((n || 90) / 2), {
        x: 0, y: H * 0.72, angle: -Math.PI / 3.2, spread: 0.45, speedMin: 12, speedMax: 24, gravity: 0.3,
      }));
      push(makeParts(Math.floor((n || 90) / 2), {
        x: W, y: H * 0.72, angle: -Math.PI + Math.PI / 3.2, spread: 0.45, speedMin: 12, speedMax: 24, gravity: 0.3,
      }));
    },

    /** 顶部落下彩纸（结算页） */
    rain(n, ms) {
      const W = global.innerWidth;
      const total = n || 160;
      const dur = ms || 1600;
      let done = 0;
      const step = () => {
        push(makeParts(6, {
          x: rnd(0, W), y: -20, angle: Math.PI / 2, spread: 0.5,
          speedMin: 1, speedMax: 4, gravity: 0.13, lifeMin: 180, lifeMax: 300,
        }));
        done += 6;
        if (done < total) setTimeout(step, dur / (total / 6));
      };
      step();
    },

    /** 礼花：多点连续爆开 */
    fireworks(rounds, ms) {
      const W = global.innerWidth, H = global.innerHeight;
      const R = rounds || 6;
      for (let i = 0; i < R; i++) {
        setTimeout(() => {
          const x = rnd(W * 0.12, W * 0.88);
          const y = rnd(H * 0.12, H * 0.5);
          const hue = Math.floor(rnd(0, 360));
          FX.burst(x, y, 70, {
            speedMin: 4, speedMax: 13, gravity: 0.1, drag: 0.972,
            sizeMin: 5, sizeMax: 11, lifeMin: 60, lifeMax: 110,
            colors: [`hsl(${hue} 95% 62%)`, `hsl(${(hue + 35) % 360} 95% 70%)`, '#fff'],
          });
        }, (i * (ms || 1800)) / R);
      }
    },

    /** 屏幕中央弹出一个大 emoji / 文字 */
    pop(glyph, opts) {
      const o = opts || {};
      const el = document.createElement('div');
      el.className = 'fx-pop' + (o.className ? ' ' + o.className : '');
      el.textContent = glyph;
      if (o.sub) {
        const s = document.createElement('div');
        s.className = 'fx-pop-sub';
        s.textContent = o.sub;
        el.appendChild(s);
      }
      document.body.appendChild(el);
      setTimeout(() => el.remove(), o.duration || 1400);
      return el;
    },

    /** 加分数字往上飘 */
    floatScore(text, x, y, cls) {
      const el = document.createElement('div');
      el.className = 'fx-float' + (cls ? ' ' + cls : '');
      el.textContent = text;
      el.style.left = (x || global.innerWidth / 2) + 'px';
      el.style.top = (y || global.innerHeight / 2) + 'px';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    },

    /** 屏幕震动（答错） */
    shake(el, strength) {
      const t = el || document.body;
      t.classList.remove('fx-shake', 'fx-shake-hard');
      void t.offsetWidth;                       // 强制重排，让动画能重复触发
      t.classList.add(strength === 'hard' ? 'fx-shake-hard' : 'fx-shake');
      setTimeout(() => t.classList.remove('fx-shake', 'fx-shake-hard'), 600);
    },

    /** 全屏闪一下颜色 */
    flash(color, ms) {
      const el = document.createElement('div');
      el.className = 'fx-flash';
      el.style.background = color || 'rgba(255,255,255,.55)';
      document.body.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = '0'; });
      setTimeout(() => el.remove(), ms || 420);
    },

    clear() {
      parts = [];
      if (cx) cx.clearRect(0, 0, global.innerWidth, global.innerHeight);
    },
  };

  global.FX = FX;
})(window);

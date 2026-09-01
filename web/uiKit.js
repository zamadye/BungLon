/* =============================================================================
 * uiKit.js — komponen UI kecil, vanilla, tanpa dependency.
 * -----------------------------------------------------------------------------
 * Blueprint menyebut hud-gamepad / @toolcase/game-components; karena project ini
 * harus tetap 1-file-HTML-jalanan (tanpa npm, tanpa build), komponen yang sama
 * ditulis ulang di sini:
 *   • Joystick    — pad 120px, deadzone, vektor ternormalisasi (pengganti hud-gamepad)
 *   • SkillButton — tombol bundar + cincin cooldown conic (pengganti gc-* buttons)
 *   • Screens     — manajer layar (splash → menu → lobby → game → result) + ESC/pause
 *   • Fx          — damage number & flash layar di atas canvas
 *   • Viewport    — safe-area inset, orientasi, keyboard-visibility
 *   • Haptics     — navigator.vibrate (kalau ada)
 * Semua API aman dipanggil tanpa DOM (dipakai test headless): konstruktor boleh
 * diberi elemen `null`, maka hanya logika matematika yang aktif.
 * ========================================================================== */
'use strict';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------- Haptics ---------------------------------- */
/** Getar pendek utk konfirmasi aksi (mobile). Diam total bila API tidak ada. */
const Haptics = {
  enabled: true,
  _v: (ms) => { try { if (Haptics.enabled && typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* unsupported */ } },
  tap() { this._v(10); },
  skill() { this._v(14); },
  hit() { this._v([16, 30, 24]); },
  catchHit() { this._v([24, 40, 60]); },
  win() { this._v([18, 60, 18, 60, 40]); },
  lose() { this._v([70, 60, 30]); },
};

/* ------------------------------- Joystick --------------------------------- */
/**
 * Virtual joystick. Kontrak sama seperti hud-gamepad: keluaran vektor -1..1
 * dengan deadzone supaya jari yang diam tidak menggerakkan pemain.
 */
class Joystick {
  /**
   * @param {Element|null} el  elemen pad (ukuran dari CSS)
   * @param {object} opt {knob, deadzone=0.16, sensitivity=1, onChange(dx,dy,active), onTap()}
   *   sensitivity (0.7..1.5) = "seberapa cepat joystick mencapai kecepatan penuh":
   *   makin besar, makin sedikit jari harus digeser untuk sampai ke vektor 1.0.
   */
  constructor(el, opt = {}) {
    this.el = el || null;
    this.knob = opt.knob || null;
    this.deadzone = opt.deadzone === undefined ? 0.16 : opt.deadzone;
    this.sensitivity = clamp(Number(opt.sensitivity) || 1, 0.5, 2);
    this.onChange = opt.onChange || (() => {});
    this.dx = 0; this.dy = 0; this.active = false; this.pointerId = null;
    this._handlers = [];
    if (this.el) this.attach();
  }
  /**
   * Inti matematika: posisi jari + rect pad -> vektor gerak (murni, bisa diuji).
   * @returns {{dx:number,dy:number,mag:number,active:boolean}}
   */
  static computeVector(clientX, clientY, rect, deadzone = 0.16, sensitivity = 1) {
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const vx = clientX - cx, vy = clientY - cy;
    const lim = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const m = Math.hypot(vx, vy) || 1;
    const mag = clamp(m / lim, 0, 1);
    const sens = clamp(Number(sensitivity) || 1, 0.5, 2);            // blueprint: slider sensitivitas
    const out = clamp((mag - deadzone) / (1 - deadzone) * sens, 0, 1);   // remap deadzone -> 0..1
    return { dx: (vx / m) * out, dy: -(vy / m) * out, mag, active: out > 0 };
  }
  _setKnob(vx, vy, lim) {
    if (!this.knob || !this.knob.style) return;
    this.knob.style.transform = `translate(calc(-50% + ${vx * lim}px), calc(-50% + ${vy * lim}px))`;
  }
  attach() {
    const el = this.el;
    const onDown = (e) => {
      e.preventDefault && e.preventDefault();
      try { el.setPointerCapture && el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      this.active = true; this.pointerId = e.pointerId;
      el.className = (el.className || '').replace(/\s+active/, '') + ' active';
      this._move(e);
    };
    const onMove = (e) => { if (this.active && (this.pointerId === null || e.pointerId === this.pointerId)) this._move(e); };
    const onUp = (e) => {
      if (this.pointerId !== null && e && e.pointerId !== undefined && e.pointerId !== this.pointerId) return;
      this.active = false; this.pointerId = null; this.dx = this.dy = 0;
      el.className = (el.className || '').replace(/\s+active/, '');
      this._setKnob(0, 0, 0);
      this.onChange(0, 0, false);
    };
    this._on = { pointerdown: onDown, pointermove: onMove, pointerup: onUp, pointercancel: onUp };
    for (const k in this._on) el.addEventListener(k, this._on[k]);
  }
  detach() { if (!this.el) return; for (const k in (this._on || {})) this.el.removeEventListener(k, this._on[k]); }
  _move(e) {
    const rect = this.el.getBoundingClientRect();
    const lim = Math.max(1, Math.min(rect.width, rect.height) / 2);
    const v = Joystick.computeVector(e.clientX, e.clientY, rect, this.deadzone, this.sensitivity);
    this.dx = v.dx; this.dy = v.dy;
    const ang = Math.atan2(e.clientY - (rect.top + rect.height / 2), e.clientX - (rect.left + rect.width / 2));
    const r = Math.min(v.mag, 1) * lim * 0.5;
    this._setKnob(Math.cos(ang) * r, Math.sin(ang) * r, 1);
    this.onChange(this.dx, this.dy, true);
  }
  /** Reset paksa (mis. saat pause / ganti layar). */
  reset() { this.active = false; this.dx = this.dy = 0; this._setKnob(0, 0, 0); this.onChange(0, 0, false); }
}

/* ------------------------------ SkillButton -------------------------------- */
/** Tombol skill bundar dengan cincin cooldown konik + status ready/cool. */
class SkillButton {
  /** Fraksi cooldown (0 = siap, 1 = penuh) -> derajat conic-gradient. */
  static cooldownDeg(left, total) {
    const k = total > 0 ? clamp(left / total, 0, 1) : 0;
    return k * 360;
  }
  static cooldownStyle(left, total) {
    const d = SkillButton.cooldownDeg(left, total);
    return `conic-gradient(rgba(0,0,0,.78) ${d}deg, transparent ${d}deg)`;
  }
  constructor(el, opt = {}) {
    this.el = el || null; this.cdEl = opt.cd || null;
    this.field = opt.field || 'skill1'; this.onPress = opt.onPress || (() => {});
    this.state = '';
    if (this.el && this.el.addEventListener) {
      const fire = (e) => { if (e.preventDefault) e.preventDefault(); SkillButton.pressFx(this.el); this.onPress(this.field); };
      this.el.addEventListener('pointerdown', fire);
      this.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fire(e); });
      if (!this.el.getAttribute || !this.el.getAttribute('role')) { try { this.el.setAttribute('role', 'button'); this.el.setAttribute('tabindex', '0'); } catch (err) { } }
    }
  }
  static pressFx(el) { if (el && el.className !== undefined) { el.className = String(el.className).replace(/\s*flash/, '') + ' flash'; } }
  /** Perbarui cincin cooldown + kelas state (pakai className string: aman di DOM tiruan). */
  render(left, total) {
    const k = clamp(left / (total || 1), 0, 1);
    if (this.cdEl && this.cdEl.style) this.cdEl.style.background = SkillButton.cooldownStyle(left, total);
    const st = k <= 0.001 ? 'ready' : 'cool';
    if (st !== this.state && this.el) {
      this.state = st;
      this.el.className = String(this.el.className || 'skill').replace(/\s*(ready|cool|flash)/g, '') + ' ' + st;
    }
    return k;
  }
}

/* -------------------------------- Screens ---------------------------------- */
/**
 * Manajer layar sederhana. game.js menulis .className langsung pada #lobby/#result
 * ('panel' / 'panel hidden'), jadi state disimpan sebagai className string saja
 * (bukan classList) supaya kedua gaya itu tetap kompatibel.
 */
class Screens {
  constructor(names = [], opt = {}) {
    this.names = names.slice();
    this.get = opt.getElementById || ((typeof document !== 'undefined' ? (id) => document.getElementById(id) : () => null));
    this.on = opt.onChange || (() => {});
    this.current = null;
    this.history = [];
    this.escapeTo = opt.escapeTo || null;          // mis. 'menu' saat ESC di layar 'game'
    this.locked = false;                            // true saat modal/ads membuka (input game off)
  }
  /** Layar mana pun yang sedang "on" (untuk debug/test). */
  static isOn(el) { return !!el && /\b(on|panel)\b/.test(String(el.className || '')) && !/\bhidden\b/.test(String(el.className || '')); }
  static setOn(el, v) {
    if (!el) return;
    const base = String(el.className || '').replace(/\s*\bon\b/g, '').replace(/\s*\bhidden\b/g, '');
    el.className = v ? (/\bpanel\b/.test(base) ? base : (base + ' on').trim()) : (base + ' hidden').trim();
  }
  show(name) {
    const prev = this.current;
    for (const n of this.names) { const el = this.get(n); if (el) Screens.setOn(el, n === name); }
    this.current = name;
    if (prev !== name) { if (prev) this.history.push(prev); this.on(name, prev); }
    return name;
  }
  hide(name) { const el = this.get(name || this.current); Screens.setOn(el, false); if (this.current === name) this.current = null; }
  is(name) { return this.current === name; }
  /** ESC / tombol back: kembali ke layar sebelumnya (atau pause bila di 'game'). */
  back() {
    if (this.current === 'game' && this.escapeToPause) { const f = this.escapeToPause; return f(); }
    const prev = this.history.pop();
    return this.show(prev || this.escapeTo || 'menu');
  }
  bindEscape() {
    if (typeof window === 'undefined' || !window.addEventListener) return () => {};
    const fn = (e) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      const t = e.target;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName || '')) { t.blur && t.blur(); return; }
      e.preventDefault && e.preventDefault();
      this.back();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }
}

/* ----------------------------------- Fx ------------------------------------ */
/** Damage number + flash layar. `project(wx, wy)` memetakan unit dunia -> px CSS. */
class Fx {
  constructor(layer, opt = {}) {
    this.layer = layer || null;
    this.project = opt.project || ((wx, wy) => ({ x: wx, y: wy }));
    this.max = opt.max || 14;
    this.lifeMs = opt.lifeMs || 950;
    this.items = 0;
  }
  _mk(text, cls, x, y) {
    if (!this.layer || typeof document === 'undefined' || !document.createElement) return null;
    const kids = this.layer.children || [];
    while (this.items >= this.max && kids.length) {
      const victim = this.layer.firstChild || kids[0];
      try { this.layer.removeChild(victim); } catch (e) { if (victim && victim.remove) victim.remove(); else break; }
      this.items = Math.max(0, this.items - 1);
      if (kids.length && kids.indexOf(victim) >= 0) break;
    }
    const d = document.createElement('div');
    d.className = 'dmg ' + (cls || '');
    d.textContent = text;
    if (d.style) { d.style.left = Math.round(x) + 'px'; d.style.top = Math.round(y) + 'px'; }
    try { this.layer.appendChild(d); this.items++; } catch (e) { return null; }
    setTimeout(() => { try { this.layer.removeChild(d); } catch (e) { d.remove && d.remove(); } this.items = Math.max(0, this.items - 1); }, this.lifeMs);
    return d;
  }
  /** Angka damage/heal/koin melayang di posisi dunia (wx, wy). */
  damage(wx, wy, text, cls) { const p = this.project(wx, wy); return this._mk(String(text), cls, p.x, p.y); }
  /** Kilatan fullscreen: 'hit' (merah) / 'camo' (hijau). */
  flash(host, kind) {
    if (!host || host.className === undefined) return false;
    const c = 'flash-' + (kind === 'camo' ? 'camo' : 'hit');
    host.className = String(host.className).replace(new RegExp('\\s*' + c, 'g'), '') + ' ' + c;
    setTimeout(() => { host.className = String(host.className).replace(new RegExp('\\s*' + c, 'g'), ''); }, 320);
    return true;
  }
}

/* -------------------------------- Viewport --------------------------------- */
/** Safe-area + orientasi + tinggi keyboard (mobile browser menyembunyikan UI di balik keyboard). */
const Viewport = {
  /** True bila peramban menyatakan pointer kasar (layar sentuh). Aman tanpa matchMedia. */
  isCoarse() { try { return !!(typeof matchMedia === 'function' && matchMedia('(hover:none)').matches); } catch (e) { return false; } },
  init() {
    if (typeof document === 'undefined' || !document.documentElement) return null;
    const root = document.documentElement;
    const set = () => {
      const h = (typeof window !== 'undefined' && window.visualViewport && window.visualViewport.height) || (typeof innerHeight === 'number' ? innerHeight : 0);
      if (h && root.style && root.style.setProperty) root.style.setProperty('--vh', h + 'px');
      const w = typeof innerWidth === 'number' ? innerWidth : 0, hh = typeof innerHeight === 'number' ? innerHeight : 0;
      if (root.dataset) root.dataset.orientation = (w && hh && w > hh) ? 'landscape' : 'portrait';
      if (root.className !== undefined) root.className = String(root.className || '').replace(/\s*touch\b/, '') + (Viewport.isCoarse() ? ' touch' : '');
    };
    set();
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', set);
      window.addEventListener('orientationchange', () => setTimeout(set, 120));
      if (window.visualViewport) window.visualViewport.addEventListener('resize', set);
    }
    return set;
  },
  isPortrait() {
    const w = typeof innerWidth === 'number' ? innerWidth : 0, h = typeof innerHeight === 'number' ? innerHeight : 0;
    return w && h ? w <= h : true;
  },
  /** Minta orientasi tertentu; di banyak browser desktop ini no-op (aman). */
  lock(orientation) {
    try {
      const so = typeof screen !== 'undefined' && screen.orientation;
      if (so && so.lock) return so.lock(orientation).catch(() => false);
    } catch (e) { /* ditolak browser */ }
    return Promise.resolve(false);
  },
  /** Info untuk panel "Cara Main" / diagnostics. */
  info() {
    const d = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return { w: typeof innerWidth === 'number' ? innerWidth : 0, h: typeof innerHeight === 'number' ? innerHeight : 0, dpr: d, portrait: Viewport.isPortrait(), coarse: Viewport.isCoarse() };
  },
};

/* ------------------------------ komponen lain ------------------------------ */
/** Toast dengan batas antrian (HUD minimum: jangan menutupi arena). */
function makeToaster(hostEl, opt = {}) {
  const max = opt.max || 4, ms = opt.ms || 1900;
  return function toast(text, life) {
    if (!hostEl || typeof document === 'undefined' || !document.createElement) return null;
    while (hostEl.children && hostEl.children.length >= max) { try { hostEl.removeChild(hostEl.children[0]); } catch (e) { break; } }
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = String(text);
    hostEl.appendChild(d);
    const t = life || ms;
    setTimeout(() => { d.className = 'toast out'; setTimeout(() => { try { hostEl.removeChild(d); } catch (e) { d.remove && d.remove(); } }, 260); }, t);
    return d;
  };
}

/** Baris "1 warna = 1 makna": rolepill hijau/ungu mengikuti peran. */
function roleClass(p) { return !p ? '' : (p.isHider || p.role === 0 ? 'hider' : 'seeker'); }

const BungUI = { clamp, Joystick, SkillButton, Screens, Fx, Viewport, Haptics, makeToaster, roleClass, version: '2.0.0' };

/* dual export: browser (window) + node (test) */
if (typeof module !== 'undefined' && module.exports) module.exports = BungUI;
if (typeof window !== 'undefined') window.BungUI = BungUI;

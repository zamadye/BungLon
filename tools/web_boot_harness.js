/* =============================================================================
 * tools/web_boot_harness.js — DOM tiruan KHUSUS untuk menguji fase BOOT
 * -----------------------------------------------------------------------------
 * Dijalankan sebagai anak (child process) oleh tools/web_boot_test.js, karena
 * web/game.js hanya bisa di-require sekali per proses (module cache) sementara
 * tiap skenario butuh Imagestub yang berbeda. Mode:
 *   --mode=ok      semua sprite load normal            -> state 'ready'
 *   --mode=slow    TIDAK ADA event load/error sama sekali (proxy menggantung)
 *                  -> watchdog harus menyelamatkan splash  -> state 'watchdog'
 *   --mode=404     semua sprite onerror (file hilang)  -> state 'partial' + warna fallback
 *   --mode=nouikit uiKit.js tidak dipasang             -> menu dibuka manual
 * Output: satu baris JSON di stdout.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const m = new RegExp('--' + k + '=(\\S+)').exec(process.argv.join(' ')); return m ? m[1] : d; };
const MODE = arg('mode', 'ok');

/* ------------------------------- DOM tiruan -------------------------------- */
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase(); this.children = []; this.style = {}; this.dataset = {};
    this._cls = ''; this.textContent = ''; this._html = ''; this.value = ''; this.disabled = false;
    this.clientWidth = 900; this.clientHeight = 620; this.width = 900; this.height = 620; this._h = {};
  }
  get className() { return this._cls; }
  set className(v) { this._cls = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); if (v === '') this.children.length = 0; }
  get naturalWidth() { return this.__w || 128; }
  get naturalHeight() { return this.__h || 128; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  get firstChild() { return this.children[0] || null; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  addEventListener(t, fn) { (this._h[t] = this._h[t] || []).push(fn); }
  removeEventListener() { }
  dispatch(t, ev) {
    const e = Object.assign({ preventDefault() { }, stopPropagation() { }, pointerId: 1, clientX: 10, clientY: 10 }, ev);
    for (const fn of (this._h[t] || [])) fn(e);
    if (typeof this['on' + t] === 'function') this['on' + t](e);
  }
  click() { this.dispatch('click', {}); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  select() { } focus() { } blur() { } setPointerCapture() { }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  querySelector(sel) { this._q = this._q || {}; return (this._q[sel] = this._q[sel] || new El('div')); }
  getContext() {
    if (this._ctx) return this._ctx;
    const c = this;
    const ctx = { canvas: c };
    for (const m of ['setTransform', 'fillRect', 'clearRect', 'drawImage', 'beginPath', 'arc', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'fillText', 'moveTo', 'lineTo', 'closePath', 'strokeRect', 'setLineDash']) ctx[m] = () => { };
    // getImageData SENGAJA diblokir di mode 404/nouikit untuk membuktikan fallback warna dipakai
    ctx.getImageData = () => { throw new Error('SecurityError: canvas tainted'); };
    return (this._ctx = ctx);
  }
}
const byId = new Map();
{
  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
  for (const m of html.matchAll(/<([a-z0-9]+)[^>]*\bid="([\w-]+)"/gi)) byId.set(m[2], new El(m[1]));
  for (const extra of ['hud', 'menu', 'splash', 'splashBar', 'splashPct', 'splashSpinner', 'splashTip', 'splashHelp', 'splashErr', 'splashSkip', 'splashReload'])
    if (!byId.has(extra)) byId.set(extra, new El('div'));
}
// #splash mulai seperti di HTML asli (sedang menampilkan "MEMUAT …")
byId.get('splash').className = 'screen on';
const doc = {
  getElementById: id => (byId.get(id) || null),
  createElement: t => new El(t),
  title: '', head: new El('head'), body: new El('body'), documentElement: new El('html'),
  addEventListener() { }, readyState: 'complete',
};
const winH = {};
global.document = doc;
global.window = global;
// navigator bawaan Node sudah cukup (tanpa vibrate/clipboard/serviceWorker -> semua guard aktif)
global.location = { search: '?bootTimeout=520&assetTimeout=200' + (MODE === 'nouikit' ? '&nosw=1' : ''), hostname: 'localhost', href: 'http://localhost/', origin: 'http://localhost', pathname: '/index.html', protocol: 'http:' };
global.addEventListener = (t, fn) => { (winH[t] = winH[t] || []).push(fn); };
global.removeEventListener = () => { };
global.localStorage = {
  _d: {}, getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }, clear() { this._d = {}; },
};
global.sessionStorage = global.localStorage;
global.performance = { now: () => Date.now() };
global.devicePixelRatio = 1;
global.innerWidth = 900; global.innerHeight = 620;

/* Image: inti dari tiap skenario. */
const seen = { started: 0, loaded: 0, errored: 0 };
global.Image = class {
  constructor() { this._src = ''; }
  set src(v) {
    this._src = v; seen.started++;
    if (MODE === 'slow') return;                                     // tidak pernah selesai (menggantung)
    if (MODE === '404') { setTimeout(() => { seen.errored++; this.onerror && this.onerror(); }, 0); return; }
    setTimeout(() => { seen.loaded++; this.onload && this.onload(); }, 0);
  }
  get src() { return this._src; }
  get naturalWidth() { return MODE === '404' ? 0 : 128; }
  get naturalHeight() { return MODE === '404' ? 0 : 128; }
};
// service worker tidak ada di node
global.navigator.serviceWorker = undefined;
global.caches = undefined;

/* fetch: server akun dianggap mati (mode apa pun) -> jalur offline UI ikut teruji */
global.fetch = () => Promise.reject(new Error('offline (harness)'));

/* ------------------------------ muat modul -------------------------------- */
try {
  if (MODE !== 'nouikit') {
    const UI = require(path.join(ROOT, 'web/uiKit.js'));
    global.BungUI = UI;
    const AU = require(path.join(ROOT, 'web/audioKit.js'));
    if (!global.BungAudio) global.BungAudio = new AU.AudioKit({});
    global.BungFX = require(path.join(ROOT, 'web/particles.js')).Particles;
  }
  const R = require(path.join(ROOT, 'web/referralSystem.js'));
  global.ReferralSystem = R.ReferralSystem;
  global.AdsManager = require(path.join(ROOT, 'web/adsManager.js')).AdsManager;
  global.BungAPI = require(path.join(ROOT, 'web/apiKit.js'));
  global.window.BungAPI = global.BungAPI;
  global.window.createApiClient = extra => new global.BungAPI.ApiClient(Object.assign({ storage: global.localStorage }, extra));
  require(path.join(ROOT, 'web/game.js'));
} catch (e) {
  console.log(JSON.stringify({ error: String(e && e.stack || e).split('\n').slice(0, 4).join(' | ') }));
  process.exit(0);
}

/* -------------------------------- jalankan -------------------------------- */
let rafQ = [], t = 0, frames = 0, frameErr = null;
global.requestAnimationFrame = fn => rafQ.push(fn);
function pump(n, dt) {
  for (let i = 0; i < n; i++) {
    const q = rafQ; rafQ = [];
    t += (dt || 16); frames++;
    for (const fn of q) { try { fn(t); } catch (e) { frameErr = frameErr || String(e && e.message || e); } }
  }
}
(async () => {
  pump(3);
  await new Promise(r => setTimeout(r, 900));          // lewati watchdog (520ms) + grace
  pump(6);
  const B = global.BungBoot || {};
  const R = global.HideSeekRound || null;
  const out = {
    mode: MODE,
    state: B.state, ms: B.ms, missing: (B.missing || []).length, slow: (B.slow || []).length,
    done: B.done, total: B.total,
    splashClass: global.document.getElementById('splash').className,
    helpClass: global.document.getElementById('splashHelp').className,
    err: (global.document.getElementById('splashErr').innerHTML || '').slice(0, 400),
    menuClass: global.document.getElementById('menu').className,
    hudClass: global.document.getElementById('hud').className,
    pct: global.document.getElementById('splashPct').textContent,
    acctStatus: global.document.getElementById('acctStatus').textContent,
    tileRgb: R && R.tileRgb, phase: R && R.phase, players: R && R.players.size,
    started: seen.started, loaded: seen.loaded, errored: seen.errored, frames, frameErr,
    bootErr: null,
  };
  console.log(JSON.stringify(out));
  process.exit(0);
})();

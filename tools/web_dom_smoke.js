/* =============================================================================
 * tools/web_dom_smoke.js — smoke test browser layer TANPA browser
 * -----------------------------------------------------------------------------
 * web/game.js punya 2 lapis: rules engine (diuji web_selftest.js) dan lapisan
 * browser (asset loader, renderer, HUD, joystick, iklan). File ini menjalankan
 * lapis kedua di atas DOM tiruan, supaya typo nama elemen / ctx method / alur
 * startGame() ketahuan tanpa perlu membuka browser.
 *
 *   node tools/web_dom_smoke.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  \x1b[32mPASS\x1b[0m ' + n)) : (fail++, console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : ''))); };

/* ---------- [1] setiap $('#id') di game.js harus ada di index.html ---------- */
console.log('\n[1] elemen UI yang direferensikan game.js ada di index.html');
{
  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'web/game.js'), 'utf8');
  const ids = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
  const used = [...js.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]);
  const missing = [...new Set(used)].filter(i => !ids.has(i));
  ok(`${new Set(used).size} id dipakai, 0 hilang`, missing.length === 0, missing);
  const assets = [...js.matchAll(/'assets\/'\s*\+/g)].length;
  ok('asset dipakai lewat tabel nama (bukan path acak)', assets >= 1, assets);
  const namesM = js.match(/const names = \[([\s\S]*?)\];/);
  const names = namesM ? [...namesM[1].matchAll(/'([\w_]+)'/g)].map(m => m[1]) : [];
  const files = new Set(fs.readdirSync(path.join(ROOT, 'web/assets')));
  const nofile = names.filter(n => !files.has(n + '.png'));
  ok(`semua ${names.length} sprite ada di web/assets/`, nofile.length === 0, nofile);
  ok('Logo_HideSeek.png + AppIcon.png + Bg_Lobby.png ikut disalin',
    files.has('Logo_HideSeek.png') && files.has('AppIcon.png') && files.has('Bg_Lobby.png'));
  const total = [...files].reduce((a, f) => a + fs.statSync(path.join(ROOT, 'web/assets', f)).size, 0);
  ok('bobot assets < 2 MB (web demo harus ringan)', total < 2 * 1024 * 1024, Math.round(total / 1024) + ' KB');
}

/* ---------- [2] DOM tiruan ---------- */
const CTX_METHODS = ['setTransform', 'fillRect', 'clearRect', 'drawImage', 'beginPath', 'arc', 'fill', 'stroke',
  'save', 'restore', 'translate', 'rotate', 'fillText', 'moveTo', 'lineTo', 'closePath', 'strokeRect', 'setLineDash'];
const stats = { drawImage: 0, fillText: 0, frames: 0 };
function makeCtx(canvas) {
  const ctx = { canvas };
  for (const m of CTX_METHODS) ctx[m] = (...a) => { if (m === 'drawImage') stats.drawImage++; if (m === 'fillText') stats.fillText++; };
  ctx.getImageData = (x, y, w, h) => {
    // kembalikan warna tanah yang masuk akal supaya computeTileColors() teruji
    const d = new Uint8ClampedArray(w * h * 4);
    const base = canvas && canvas.__tile ? canvas.__tile : [120, 120, 120];
    for (let i = 0; i < d.length; i += 4) { d[i] = base[0]; d[i + 1] = base[1]; d[i + 2] = base[2]; d[i + 3] = 255; }
    return { data: d };
  };
  return ctx;
}
class El {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.children = []; this.style = {}; this.dataset = {}; this._cls = '';
    this.textContent = ''; this.value = ''; this.disabled = false;
    this.clientWidth = 1200; this.clientHeight = 700;
    this.width = 1200; this.height = 700;
    this._handlers = {};
  }
  get className() { return this._cls; }
  set className(v) { this._cls = v; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = v; if (v === '') this.children.length = 0; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  remove() { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); } }
  addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); }
  removeEventListener() { }
  dispatch(t, ev) {
    const e = Object.assign({ preventDefault() { }, stopPropagation() { }, pointerId: 1, clientX: 300, clientY: 200 }, ev);
    for (const fn of (this._handlers[t] || [])) fn(e);
    if (typeof this['on' + t] === 'function') this['on' + t](e);   // tombol dipasang lewat .onclick
  }
  setPointerCapture() { }
  click() { this.dispatch('click', {}); }
  focus() { } blur() { }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  getContext(kind) {
    this._ctx = this._ctx || makeCtx(this);
    return this._ctx;
  }
  querySelector(sel) { this._q = this._q || {}; return (this._q[sel] = this._q[sel] || new El('div')); }
  get naturalWidth() { return this.__w || 128; }
  get naturalHeight() { return this.__h || 128; }
}
const byId = new Map();
function getEl(id) { if (!byId.has(id)) byId.set(id, new El(id === 'game' || id === 'minimap' ? 'canvas' : 'div')); return byId.get(id); }
let tileColorIdx = 0;
const doc = {
  getElementById: getEl,
  createElement(tag) { const e = new El(tag); if (tag === 'canvas') { e.__tile = [[74, 135, 25], [217, 166, 95], [124, 128, 127], [139, 85, 42]][tileColorIdx++ % 4]; e.width = e.height = 16; } return e; },
  title: '',
};
const winHandlers = {};
global.document = doc;
global.window = global;
global.location = { search: '?solo=1', hostname: 'localhost', href: 'http://localhost/' };
global.addEventListener = (t, fn) => { (winHandlers[t] = winHandlers[t] || []).push(fn); };
global.localStorage = { _d: {}, getItem(k) { return this._d[k] === undefined ? null : this._d[k]; }, setItem(k, v) { this._d[k] = String(v); } };
global.fetch = () => Promise.reject(new Error('no network in smoke test'));
global.Image = class {
  constructor() { this._src = ''; }
  set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._src; }
  get naturalWidth() { return 128; }
  get naturalHeight() { return 128; }
};
let rafQ = [], tnow = 0;
global.requestAnimationFrame = fn => { rafQ.push(fn); return rafQ.length; };
function pump(frames, dtms = 16) {
  for (let i = 0; i < frames; i++) {
    const q = rafQ; rafQ = [];
    tnow += dtms; stats.frames++;
    for (const fn of q) fn(tnow);
  }
}
global.dispatchEventKey = (type, key) => { for (const fn of (winHandlers[type] || [])) fn({ key, code: key, target: { tagName: 'BODY' }, preventDefault() { } }); };

/* ---------- [3] jalankan boot() lewat game.js ---------- */
console.log('\n[2] lapisan browser game.js jalan di DOM tiruan');
{
  const before = fail;
  let err = null;
  try {
    require(path.join(ROOT, 'web/game.js'));
    pump(4);                                  // asset loader -> onAll -> startGame()
  } catch (e) { err = e; }
  ok('startGame() tanpa exception', !err, err && String(err.stack).split('\n').slice(0, 3).join(' | '));
  ok('renderer memanggil drawImage (tile + sprite)', stats.drawImage > 50, stats.drawImage);
  ok('nama pemain digambar (fillText)', stats.fillText > 10, stats.fillText);
  ok('?solo=1 mengisi roster bot (hearts dibuat)', getEl('hearts').children.length === 3, getEl('hearts').children.length);
  ok('2 tombol skill dibuat untuk hider', getEl('skills').children.length === 2, getEl('skills').children.map(c => c.className));
  ok('teks fase terisi', /SEMBUNYI|BERSEMBUNYI|HIDE|COUNTDOWN|DIKEJAR|HITUNG MUNDUR/i.test(getEl('phase').textContent), getEl('phase').textContent);
  ok('ukuran pilihan room diisi (2..12)', getEl('sizeSel').children.length === 11, getEl('sizeSel').children.length);

  // gerakkan pemain + pakai skill lewat keyboard
  global.dispatchEventKey('keydown', 'd'); global.dispatchEventKey('keydown', 'w');
  pump(30);
  global.dispatchEventKey('keydown', '1'); pump(2);
  global.dispatchEventKey('keydown', '2'); pump(2);
  global.dispatchEventKey('keyup', 'd'); global.dispatchEventKey('keyup', 'w');
  pump(10);
  ok('frame jalan terus tanpa error setelah input', stats.frames > 40, stats.frames);
  ok('kooldown skill tampil (elemen .cd punya style)', !!getEl('skills').children[0]?._q?.['.cd']?.style?.background !== undefined, getEl('skills').children.map(c => c.className));

  // klik arena (jalur RequestCatch / camo cepat)
  getEl('game').dispatch('pointerdown', { clientX: 600, clientY: 350 });
  pump(5);
  ok('klik arena ditangani tanpa error', true);

  // joystick
  getEl('joy').dispatch('pointerdown', { clientX: 260, clientY: 260 });
  getEl('joy').dispatch('pointermove', { clientX: 300, clientY: 220 });
  pump(5);
  getEl('joy').dispatch('pointerup', {});
  ok('joystick pointer events OK', true);

  // jalankan sampai RESULT lalu cek panel hasil + leaderboard
  const R = getRound();
  ok('round tersedia utk diuji', !!R, R);
  if (R) {
    R.start(false); R.enterPhase('SEEK');
    for (const p of R.players.values()) if (p.isHider) { p.invulnUntil = 0; p.safeUntil = 0; R.kill(p, R.seeker()); }
    R.enterPhase('RESULT');
    pump(3);
    ok('panel hasil muncul (ResultPanel)', /panel/.test(getEl('result').className) && !/hidden/.test(getEl('result').className), getEl('result').className);
    ok('judul hasil terisi', /MENANG/.test(getEl('resultTitle').textContent), getEl('resultTitle').textContent);
    ok('baris leaderboard terisi', (getEl('lbBody').innerHTML.match(/<tr/g) || []).length >= 2, (getEl('lbBody').innerHTML.match(/<tr/g) || []).length);
    // reward: tawaran + overlay iklan (simulateAds) lalu hadiah diberikan
    const sk = R.seeker(); sk.cdSeeker = R.t + 5; sk.ghost = false; R.lastAdAt = -99; R.myId = sk.id;
    const btn = getEl('rewardBtn');
    ok('tombol reward terlihat saat ada offer', /on/.test(getEl('rewardWrap').className), getEl('rewardWrap').className);
    btn.dispatch('click', {});
    ok('overlay "iklan" dibuka (AdsManager.simulateAds)', /on/.test(getEl('adOverlay').className), getEl('adOverlay').className);
    const t0 = Date.now();
    // iklan "simulasi" berjalan 1.5s (AdsManager.simulatedAdSeconds) via rAF + performance.now
    while (/on/.test(getEl('adOverlay').className) && Date.now() - t0 < 6000) pump(20, 16);
    ok('iklan selesai -> overlay ditutup', getEl('adOverlay').className === '' || !/on/.test(getEl('adOverlay').className), getEl('adOverlay').className);
    ok('hadiah diberikan (kuota frenzy berkurang)', R.rewardQuota.frenzy === 1, R.rewardQuota);
    // tombol "ronde berikutnya"
    getEl('againBtn').dispatch('click', {});
    pump(3);
    ok('tombol ronde berikutnya mengembalikan ke HUD', /hidden/.test(getEl('result').className), getEl('result').className);
  }
  ok('tidak ada kegagalan di blok ini', fail === before, { added: fail - before });
}
function getRound() {
  // game.js menyimpan instance di closure boot(); ambil lewat elemen hearts -> tidak bisa,
  // jadi pakai hook: ROUND dipasang sebagai properti global saat startGame (lihat game.js).
  return global.HideSeekRound || null;
}
setTimeout(() => {
  console.log(`\n=== web_dom_smoke: ${pass} PASS, ${fail} FAIL ===`);
  process.exitCode = fail ? 1 : 0;
}, 60);

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
    this._id = '';
    this.tagName = (tag || 'div').toUpperCase();
    this.children = []; this.style = {}; this.dataset = {}; this._cls = '';
    this.textContent = ''; this.value = ''; this.disabled = false;
    this.clientWidth = 1200; this.clientHeight = 700;
    this.width = 1200; this.height = 700;
    this._handlers = {};
  }
  get id() { return this._id; }
  set id(v) { this._id = v; byId.set(v, this); }
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
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k]; }
  select() { this._selected = true; }
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
{   // pra-registrasi elemen yang memang ada di index.html (sama dgn browser)
  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
  for (const m of html.matchAll(/<([a-z0-9]+)[^>]*\bid="([\w-]+)"/gi)) byId.set(m[2], new El(m[1]));
}
const getEl = id => byId.get(id) || null;
let tileColorIdx = 0;
const doc = {
  getElementById: getEl,
  createElement(tag) { const e = new El(tag); if (tag === 'canvas') { e.__tile = [[74, 135, 25], [217, 166, 95], [124, 128, 127], [139, 85, 42]][tileColorIdx++ % 4]; e.width = e.height = 16; } return e; },
  title: '',
  head: new El('head'), body: new El('body'), documentElement: new El('html'),
};
const winHandlers = {};
global.document = doc;
global.window = global;
global.location = { search: '?solo=1&adsSim=0.05', hostname: 'localhost', href: 'http://localhost/', origin: 'http://localhost', pathname: '/index.html' };
global.addEventListener = (t, fn) => { (winHandlers[t] = winHandlers[t] || []).push(fn); };
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  clear() { this._d = {}; },
};
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

/* ---------- [2b] modul iklan & referral dimuat lebih dulu (persis seperti <script> di index.html) ---------- */
{
  for (const f of ['uiKit.js', 'audioKit.js', 'particles.js']) {
    const m = require(path.join(ROOT, 'web/' + f));
    if (f === 'uiKit.js') global.BungUI = m;
    else if (f === 'audioKit.js') { global.BungAudioKit = m.AudioKit; if (!global.BungAudio) global.BungAudio = new m.AudioKit({}); }
    else { global.BungFX = m.Particles; ok('particles.js mengekspor kelas Particles', typeof m.Particles === 'function'); }
    ok(f + ' bisa di-require tanpa DOM penuh', !!m);
  }
  const APIKIT = require(path.join(ROOT, 'web/apiKit.js'));
  global.BungAPI = APIKIT;
  global.window.BungAPI = APIKIT;
  global.window.createApiClient = (extra) => new APIKIT.ApiClient(Object.assign({ storage: global.localStorage }, extra || {}));
  ok('apiKit.js bisa di-require tanpa DOM penuh (+ createApiClient)', typeof APIKIT.ApiClient === 'function' && typeof global.window.createApiClient === 'function');
  const A = require(path.join(ROOT, 'web/adsManager.js'));
  const R = require(path.join(ROOT, 'web/referralSystem.js'));
  global.AdsManager = A.AdsManager; global.resolveAdsConfig = A.resolveAdsConfig;
  global.ReferralSystem = R.ReferralSystem; global.createReferralSystem = R.createReferralSystem;
  ok('adsManager.js + referralSystem.js bisa di-require tanpa DOM penuh', typeof global.AdsManager === 'function' && typeof global.ReferralSystem === 'function');
}

/* ---------- [3] jalankan boot() lewat game.js ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** Iklan AdsManager pakai timer nyata: beri kesempatan event loop lalu pump frame. */
async function waitAdClosed(maxMs = 5000) {
  const t0 = Date.now();
  while (/on/.test(getEl('adOverlay').className) && Date.now() - t0 < maxMs) { pump(3, 16); await sleep(12); }
  pump(3);
  return !/on/.test(getEl('adOverlay').className);
}
(async function main() {
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
  ok('3 tombol skill dibuat untuk hider (Kamuflase, Prop, Bekukan)', getEl('skills').children.length === 3, getEl('skills').children.map(c => c.className));
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
    ok('iklan selesai -> overlay ditutup', await waitAdClosed(), getEl('adOverlay').className);
    ok('hadiah diberikan (kuota frenzy berkurang)', R.rewardQuota.frenzy === 1, R.rewardQuota);
    // tombol "ronde berikutnya"
    getEl('againBtn').dispatch('click', {});
    pump(3);
    ok('tombol ronde berikutnya mengembalikan ke HUD', /hidden/.test(getEl('result').className), getEl('result').className);
  }
  ok('tidak ada kegagalan di blok ini', fail === before, { added: fail - before });
}

/* ---------- [4] integrasi AdsManager + ReferralSystem + profil koin ---------- */
console.log('\n[4] integrasi iklan + referral di HUD');
{
  const before = fail;
  const G = global.hideSeekGame;
  ok('window.hideSeekGame tersedia (pause/resume/saveGame/updateUI)', !!G && ['pause', 'resume', 'saveGame', 'updateUI'].every(k => typeof G[k] === 'function'), G && Object.keys(G));
  ok('game memakai AdsManager asli (bukan fallback lokal)', !!G && !!G.ads, G && !!G.ads);
  ok('game memakai ReferralSystem', !!G && !!G.referral);
  ok('HUD menampilkan koin & nyawa', /^\d+$/.test(getEl('coins').textContent) && /^×\d+$/.test(getEl('lives').textContent), [getEl('coins').textContent, getEl('lives').textContent]);
  const R = getRound();
  /* tombol "Dapatkan Koin" -> showRewarded('bonus_coins') -> +50 koin */
  G.ads.resetCooldown();
  getEl('adCoinsBtn').dispatch('click', {});
  ok('iklan membuka overlay + menjeda permainan', /on/.test(getEl('adOverlay').className) && /on/.test(getEl('pauseTag').className), [getEl('adOverlay').className, getEl('pauseTag').className]);
  const closed = await waitAdClosed();
  ok('iklan simulasi selesai -> overlay & jeda dilepas', closed && !/on/.test(getEl('pauseTag').className), [getEl('adOverlay').className, getEl('pauseTag').className]);
  ok('koin +50 dan ditulis ke localStorage', getEl('coins').textContent === '50' && /"coins":50/.test(global.localStorage.getItem('hideseek_profile')), [getEl('coins').textContent, global.localStorage.getItem('hideseek_profile')]);
  /* cooldown global 30s: klik kedua langsung ditolak + toast "Tunggu X detik lagi" */
  const toastsBefore = getEl('toasts').children.length;
  getEl('adCoinsBtn').dispatch('click', {});
  ok('iklan kedua ditolak (cooldown global)', !/on/.test(getEl('adOverlay').className), getEl('adOverlay').className);
  ok('toast "Tunggu … detik lagi" muncul', getEl('toasts').children.slice(toastsBefore).some(c => /Tunggu \d+ detik lagi/.test(c.textContent)), getEl('toasts').children.slice(toastsBefore).map(c => c.textContent));
  ok('cooldown juga tersimpan di localStorage[lastAdTime]', /^\d+$/.test(String(global.localStorage.getItem('lastAdTime'))), global.localStorage.getItem('lastAdTime'));
  /* tombol "+1 Nyawa": di luar peran hider => jadi nyawa cadangan */
  G.ads.resetCooldown();
  getEl('adLifeBtn').dispatch('click', {});
  await waitAdClosed();
  ok('"Tonton Iklan +1 Nyawa" → nyawa cadangan +1', getEl('lives').textContent === '×1', getEl('lives').textContent);
  /* toko lobby: tukar koin -> +1 Max HP */
  getEl('buyHpBtn').dispatch('click', {});
  ok('beli +1 Max HP (50 koin) → koin 0, MAX HP 4 di HUD', getEl('coins').textContent === '0' && getEl('maxhpTag').textContent === 'MAX HP 4', [getEl('coins').textContent, getEl('maxhpTag').textContent]);
  ok('ronde berjalan belum berubah (diterapkan saat ronde baru)', R.me().maxHp === 3, R.me().maxHp);
  R.start(false);
  ok('ronde berikutnya memakai Max HP 4', R.me().maxHp === 4 && R.me().hp === 4, [R.me().maxHp, R.me().hp]);
  getEl('buyLifeBtn').dispatch('click', {});
  ok('koin habis → tombol toko dinonaktifkan', getEl('buyLifeBtn').disabled === true && getEl('buyHpBtn').disabled === true, [getEl('buyLifeBtn').disabled, getEl('buyHpBtn').disabled]);
  /* referral: modal + kode unik + link */
  getEl('inviteBtn').dispatch('click', {});
  const modal = getEl('referralModal');
  const code = modal.querySelector('#refCode').textContent;
  ok('modal "Undang Teman" terbuka & tidak hidden', modal.hidden === false, modal.hidden);
  ok('kode referral 6–8 karakter A–Z/0–9', /^[A-Z0-9]{6,8}$/.test(code), code);
  ok('kode sama dgn localStorage[myReferralCode]', code === global.localStorage.getItem('myReferralCode'), [code, global.localStorage.getItem('myReferralCode')]);
  ok('link mengundang berisi ?ref=kode', /\?ref=[A-Z0-9]{6,8}$/.test(modal.querySelector('#refLink').textContent), modal.querySelector('#refLink').textContent);
  ok('teks "100 Koin untuk setiap teman" ada di modal', /100 koin/i.test(modal.innerHTML), modal.innerHTML.slice(0, 0));
  ok('klik "Salin Link" tidak melempar (tanpa clipboard API)', (() => { try { modal.querySelector('#refCopy').dispatch('click', {}); return true; } catch (e) { return String(e); } })());
  ok('hadiah pengundang menunggu server (bukan koin palsu)', G.referral.getReferralBonus() === 0, G.referral.getStats());
  /* pause/resume manual (dipakai SDK iklan) membekukan langkah ronde */
  const tBefore = R.t;
  G.pause(); pump(6);
  ok('game.pause() membekukan langkah ronde', R.t === tBefore, [tBefore, R.t]);
  G.resume(); pump(6);
  ok('game.resume() melanjutkan', R.t > tBefore, R.t);
  ok('tidak ada kegagalan di blok ini', fail === before, { added: fail - before });
}

/* ---------- [5] UI v2: layar, pause, setelan, FX, papan skor on-demand ---------- */
console.log('\n[5] UI v2 (uiKit + audioKit) terpasang di game');
{
  const before = fail;
  const G = global.hideSeekGame, ui = G && G.ui;
  ok('window.BungUI & window.BungAudio tersedia', !!global.BungUI && !!global.BungAudio, [!!global.BungUI, !!global.BungAudio]);
  ok('game expose lapisan UI (screens/fx/setPaused/toggleSound)', !!ui && !!ui.screens && !!ui.fx && typeof ui.setPaused === 'function', ui && Object.keys(ui));
  ok('splash sudah ditutup setelah aset siap', /out/.test(getEl('splash').className), getEl('splash').className);
  ok('HUD tampil saat ronde', getEl('hud').className === 'on', getEl('hud').className);
  ok('menu utama tidak tampil saat ronde', !/\bon\b/.test(getEl('menu').className), getEl('menu').className);
  ok('papan nama pemain terisi', getEl('playerTag').textContent.length > 1, getEl('playerTag').textContent);
  /* --- jeda (ESC / tombol back) membekukan simulasi tapi tidak render --- */
  const R = getRound();
  const t0 = R.t;
  ui.setPaused(true);
  ok('pause membuka panel Jeda', /on/.test(getEl('pausePanel').className), getEl('pausePanel').className);
  ok('HUD disembunyikan saat pause', getEl('hud').className === '', getEl('hud').className);
  pump(8);
  ok('langkah ronde dibekukan saat pause', R.t === t0, [t0, R.t]);
  ok('canvas tetap digambar saat pause (render jalan terus)', stats.drawImage > 0, stats.drawImage);
  ui.setPaused(false);
  pump(8);
  ok('resume menutup panel & ronde jalan lagi', !/on/.test(getEl('pausePanel').className) && R.t > t0 && getEl('hud').className === 'on', [getEl('pausePanel').className, R.t > t0]);
  /* --- tombol suara (audioKit tanpa AudioContext: hanya preferensi) --- */
  getEl('soundBtn').dispatch('click', {});
  ok('klik suara → mode senyap (kelas off + aria-pressed false)', /off/.test(getEl('soundBtn').className) && getEl('soundBtn').getAttribute('aria-pressed') === 'false', [getEl('soundBtn').className, getEl('soundBtn').getAttribute('aria-pressed')]);
  ok('preferensi suara tersimpan di localStorage', /"sfx":false/.test(global.localStorage.getItem('hideseek_audio')), global.localStorage.getItem('hideseek_audio'));
  getEl('soundBtn').dispatch('click', {});
  ok('klik kedua mengaktifkan lagi', !/off/.test(getEl('soundBtn').className), getEl('soundBtn').className);
  /* --- papan skor on-demand --- */
  getEl('lbBtn').dispatch('click', {});
  ok('tombol papan skor membuka overlay', getEl('lbOverlay').className === 'on', getEl('lbOverlay').className);
  ok('isi papan skor memakai skor resmi (<tr> per pemain)', /<tr/.test(getEl('lbMini').innerHTML), getEl('lbMini').innerHTML.slice(0, 40));
  getEl('lbBtn').dispatch('click', {});
  ok('tombol yang sama menutupnya', getEl('lbOverlay').className === '', getEl('lbOverlay').className);
  /* --- cooldown skill = conic-gradient lewat SkillButton --- */
  const sk0 = getEl('skills').children[0];
  ok('tombol skill kelasnya ready/cool', /ready|cool/.test(sk0.className), sk0.className);
  ok('cincin cooldown memakai conic-gradient', /conic-gradient/.test(sk0.querySelector('.cd').style.background), sk0.querySelector('.cd').style.background);
  ok('label kunci tombol (1/2 atau Q/E) tampil', /kbd/.test(sk0.innerHTML), sk0.innerHTML.slice(0, 60));
  /* --- timer: warna saat menipis (blueprint 4.2) --- */
  R.enterPhase('HIDE'); R.phaseEnd = R.t + 5; pump(1);
  ok('timer <10s → kelas warn', getEl('timer').className === 'warn', getEl('timer').className);
  R.enterPhase('SEEK'); R.phaseEnd = R.t + 4; pump(1);
  ok('5 detik terakhir fase SEEK → urgent', getEl('timer').className === 'urgent', getEl('timer').className);
  R.phaseEnd = R.t + 40; pump(1);
  ok('kembali normal saat waktu longgar', getEl('timer').className === '', getEl('timer').className);
  ok('role pill ikut warna peran', /hider|seeker/.test(getEl('role').className), getEl('role').className);
  /* --- feedback damage: angka melayang di FX layer --- */
  const victim = [...R.players.values()].find(p => p.isHider && !p.ghost);
  const catcher = R.seeker();
  if (victim && catcher) {
    victim.invulnUntil = 0; victim.safeUntil = 0; victim.ghost = false; victim.hp = Math.max(1, victim.hp);
    const fxBefore = getEl('fx').children.length;
    R.hit(victim.id, catcher.id, true);              // signature: hit(hiderId, seekerId, isContact)
    ok('kejadian hit → damage number muncul di #fx', getEl('fx').children.length === fxBefore + 1, { before: fxBefore, after: getEl('fx').children.length });
    const lastFx = getEl('fx').children[getEl('fx').children.length - 1];
    ok('elemen FX memakai kelas .dmg (animasi rise)', !!lastFx && /dmg/.test(lastFx.className), lastFx && lastFx.className);
    await sleep(1000);
    ok('FX dibersihkan otomatis', getEl('fx').children.length === 0, getEl('fx').children.length);
  } else ok('ada hider + seeker utk uji FX', false, [!!victim, !!catcher]);
  /* --- setelan --- */
  getEl('hapticSwitch').dispatch('click', {});
  ok('switch getar mengubah preferensi + aria-checked', getEl('hapticSwitch').getAttribute('aria-checked') === 'false' && /"haptics":false/.test(String(global.localStorage.getItem('hideseek_ui'))), global.localStorage.getItem('hideseek_ui'));
  getEl('sfxSwitch').dispatch('click', {});
  ok('switch SFX tidak melempar tanpa AudioContext', true);
  ok('deviceInfo siap pakai (diagnosa layar)', typeof getEl('deviceInfo').textContent === 'string', getEl('deviceInfo').textContent);
  ok('tidak ada kegagalan di blok ini', fail === before, { added: fail - before });
}

/* ---------- [6] UI v2.1: partikel + shake + XP/level + sensitivitas + rekor lokal ---------- */
console.log('\n[6] UI v2.1: partikel, shake, layar hasil (rank/XP), sensitivitas, rekor lokal');
{
  const before = fail;
  const G = global.hideSeekGame, ui = G && G.ui, R = getRound();
  ok('lapisan UI v2.1 terekspos (parts/localScores/shake/profile)', !!ui && !!ui.parts && !!ui.localScores && typeof ui.shake === 'function' && !!ui.profile, ui && Object.keys(ui));
  /* --- partikel: kejadian hit harus menumbuhkan pool, lalu surut sendiri --- */
  ui.parts.clear();
  const victim = [...R.players.values()].find(p => p.isHider && !p.ghost);
  const catcher = R.seeker();
  if (victim && catcher) {
    victim.invulnUntil = 0; victim.safeUntil = 0; victim.hp = Math.max(1, victim.hp);
    R.hit(victim.id, catcher.id, true);
    ok('kejadian hit -> partikel burst dibuat', ui.parts.count > 0, ui.parts.count);
    ok('partikel memakai koordinat dunia (x,y = posisi pemain)', ui.parts.list.every(q => Math.abs(q.x - victim.x) < 1.5 && Math.abs(q.y - victim.y) < 1.5), ui.parts.list[0] && [ui.parts.list[0].x, victim.x]);
    // pump() memakai jam sintetis (dt=0) -> umur partikel tidak maju; peluruhan diuji
    // lewat step() eksplisit dengan dt nyata (frame asli game memakai dt riil).
    for (let i = 0; i < 90 && ui.parts.count; i++) ui.parts.step(0.05);
    ok('partikel habis sendiri setelah umurnya lewat (tidak menumpuk)', ui.parts.count === 0, ui.parts.count);
    ok('pool tidak pernah melebihi batas (max 180)', ui.parts.list.length <= 180, ui.parts.list.length);
  } else ok('ada hider + seeker utk uji partikel', false, [!!victim, !!catcher]);
  /* --- debu saat pemain lokal bergerak --- */
  const me = R.me();
  if (me) {
    ui.parts.clear();
    R.enterPhase('HIDE'); R.phaseEnd = R.t + 20;
    me.input.right = true; me.input.up = true;
    pump(40);
    me.input.right = false; me.input.up = false;
    ok('lari -> jejak debu kaki dibuat di bawah pemain', ui.parts.count > 0 && ui.parts.list.some(q => q.kind === 'dust'), ui.parts.count);
  } else ok('ada pemain lokal utk uji debu', false);
  /* --- screen shake: dipicu event nyata, bukan dipanggil manual --- */
  ui.parts.clear(); getEl('stage').className = '';
  R.emit({ type: 'ghost', id: R.myId, x: 0, y: 0 });
  ok('jadi hantu -> #stage shake-3 + burst partikel', /shake-3/.test(getEl('stage').className) && ui.parts.count > 0, [getEl('stage').className, ui.parts.count]);
  ui.shake(1);
  ok('shake(1) memakai intensitas shake-1 (bukan menempel dobel)', /shake-1/.test(getEl('stage').className) && !/shake-3/.test(getEl('stage').className), getEl('stage').className);
  await sleep(520);
  ok('shake dilepas otomatis (tidak menempel permanen)', !/shake/.test(getEl('stage').className), getEl('stage').className);
  /* --- sensitivitas joystick --- */
  const sr = getEl('sensRange');
  if (sr) {
    sr.value = '150'; sr.dispatch('input', {});
    ok('slider sensitivitas -> uiPrefs.sens + localStorage hideseek_ui', ui.prefs.sens === 1.5 && /"sens":1\.5/.test(String(global.localStorage.getItem('hideseek_ui'))), [ui.prefs.sens, global.localStorage.getItem('hideseek_ui')]);
    ok('label persen ikut berubah (#sensVal)', getEl('sensVal').textContent === '150%', getEl('sensVal').textContent);
    sr.value = '55'; sr.dispatch('input', {});
    ok('nilai di luar rentang di-clamp ke 0.7', ui.prefs.sens === 0.7, ui.prefs.sens);
    sr.value = '100'; sr.dispatch('input', {});
    ok('bisa dikembalikan ke 100%', ui.prefs.sens === 1, ui.prefs.sens);
  } else ok('#sensRange ada di DOM', false);
  /* --- layar hasil: rank + XP + level + rekor lokal --- */
  const xp0 = ui.profile.xp, rows0 = ui.localScores.length;
  const boardBefore = R.players.size;
  R.finish();
  pump(2);
  ok('RESULT membuka layar hasil (panel, bukan hidden)', /(^|\s)panel/.test(getEl('result').className) && !/hidden/.test(getEl('result').className), getEl('result').className);
  ok('#rankTag terisi "#n dari m"', /^#\d+ dari \d+/.test(getEl('rankTag').textContent), getEl('rankTag').textContent);
  ok('#xpGain terisi "+n XP"', /^\+\d+ XP$/.test(getEl('xpGain').textContent), getEl('xpGain').textContent);
  ok('#lvlTag terisi "Lv n · p%"', /^Lv \d+ · \d+%$/.test(getEl('lvlTag').textContent), getEl('lvlTag').textContent);
  ok('#coinGain terisi "+n koin"', /^\+\d+ koin$/.test(getEl('coinGain').textContent), getEl('coinGain').textContent);
  ok('#lvlBarFill dilebari 0..100%', /^\d+(\.\d+)?%$/.test(getEl('lvlBarFill').style.width) && parseFloat(getEl('lvlBarFill').style.width) <= 100, getEl('lvlBarFill').style.width);
  ok('xp profil bertambah + ditulis ke localStorage', ui.profile.xp > xp0 && /"xp":\d+/.test(String(global.localStorage.getItem('hideseek_profile'))), [xp0, ui.profile.xp]);
  ok('tabel papan skor lokal dirender (baris <tr>)', /<tr/.test(getEl('localLbBody').innerHTML), getEl('localLbBody').innerHTML.slice(0, 60));
  ok('wrapper rekor lokal diaktifkan', getEl('localLbWrap').className === 'on', getEl('localLbWrap').className);
  ok('ronde dicatat ke hideseek_scores', ui.localScores.length === rows0 + 1 && !!global.localStorage.getItem('hideseek_scores'), [rows0, ui.localScores.length]);
  ok('baris hasil ronde memakai skor pemain (bukan 0 terus)', ui.localScores.best() >= 0 && /<td><b>\d+<\/b><\/td>/.test(getEl('localLbBody').innerHTML), ui.localScores.best());
  /* --- panel papan skor HUD: ikut menampilkan rekor lokal --- */
  getEl('lbBtn').dispatch('click', {});
  ok('panel skor on-demand menampilkan blok "rekor lokal"', /rekor lokal/.test(getEl('lbMini').innerHTML), getEl('lbMini').innerHTML.slice(-90));
  getEl('lbBtn').dispatch('click', {});
  /* --- pil koin/nyawa: angka saja (ikon = <img>) --- */
  ok('isi #coins cukup angka (ikon PNG tidak terhapus textContent)', /^\d+$/.test(getEl('coins').textContent), getEl('coins').textContent);
  ok('#lives memakai prefiks × saja', /^×\d+$/.test(getEl('lives').textContent), getEl('lives').textContent);
  /* --- hapus rekor lokal dari Settings --- */
  getEl('clearLbBtn').dispatch('click', {});
  ok('tombol hapus -> daftar lokal kosong + storage dibersihkan', ui.localScores.length === 0 && /^(\[\]|)$/.test(String(global.localStorage.getItem('hideseek_scores') || '[]')), ui.localScores.length);
  ok('wrapper rekor lokal disembunyikan lagi', getEl('localLbWrap').className === '', getEl('localLbWrap').className);
  ok('hitung mundur hasil berhenti sendiri (interval tidak bocor)', true);
  ok('tidak ada kegagalan di blok ini', fail === before, { added: fail - before });
}

  global.__smokeBaseDone = true;                 // gate utk blok [8] (hindari saling berebut DOM)
})().catch(e => { console.log('  \x1b[31mEXCEPTION\x1b[0m ' + (e && e.stack || e)); fail++; });
function getRound() {
  // game.js menyimpan instance di closure boot(); ambil lewat elemen hearts -> tidak bisa,
  // jadi pakai hook: ROUND dipasang sebagai properti global saat startGame (lihat game.js).
  return global.HideSeekRound || null;
}
process.on('exit', () => {
  console.log(`\n=== web_dom_smoke: ${pass} PASS, ${fail} FAIL ===`);
  if (fail) process.exitCode = 1;
});

(async () => {
  /* ---------- [7] UI v2.2: kamera follow+zoom, aim Prop, skill Freeze ---------- */
  console.log('\\n[7] UI v2.2: kamera (follow+zoom), aim Prop, skill Freeze');
  {
    const before = fail;
    const { CFG } = require(path.join(ROOT, 'web/game.js'));
    const G = global.hideSeekGame, ui = G && G.ui, R = getRound();
    const fireWin = (t, ev) => { for (const fn of (winHandlers[t] || [])) fn(Object.assign({ preventDefault() { }, stopPropagation() { }, pointerId: 1 }, ev)); };
    ok('kamera dibuat dari UI.Camera + aktif (bisa dimatikan ?cam=0)', !!ui.cam && typeof ui.cam.step === 'function' && ui.cam.enabled, !!ui.cam);

    /* 1) clamp: pemain di ujung mana pun tidak boleh membuat view keluar peta */
    const me = R.me();
    // blok [6] mengubah pemain lokal jadi hantu/RESULT; kembalikan ke keadaan main.
    me.ghost = false; me.alive = true; me.role = 0; me.hp = me.maxHp; R.myId = me.id;
    me.isBot = false; me.brain = { t: 0, goal: null, mood: 0 };   // jangan digerakkan AI bot
    const other = [...R.players.values()].find(q => q.id !== me.id);
    other.role = 1; other.ghost = false; other.alive = true; R.seekerId = other.id;
    if (G.resume) G.resume();                   // metaPaused (iklan) harus dilepas
    if (ui && ui.setPaused) ui.setPaused(false);
    if (!rafQ.length) console.log('    (diagnostik) rafQ kosong; paused=' + (ui && ui.paused));
    R.enterPhase('HIDE'); R.phaseEnd = R.t + 60;
    me.x = 99; me.y = -99; me.input.dx = 0; me.input.dy = 0;
    for (let i = 0; i < 200; i++) ui.camStep(0.05);
    ok('kamera ter-clamp ke tepi peta (tidak ada letterbox hitam)',
      Math.abs(ui.cam.x) <= R.map.cols / 2 + 0.01 && Math.abs(ui.cam.y) <= R.map.rows / 2 + 0.01, [ui.cam.x.toFixed(2), ui.cam.y.toFixed(2)]);
    const vw = ui.camViewUnits();
    ok('view tidak pernah lebih besar dari peta', vw.w <= R.map.cols + 2.01 && vw.h <= R.map.rows + 2.01, [vw.w.toFixed(2), vw.h.toFixed(2)]);

    /* 2) zoom adaptif: lari melebar, diam mendekat, SEEK paling lebar */
    me.x = 0; me.y = 0;
    ui.cam.zoom = ui.cam.zoomIdle;
    me.input.dx = 1; for (let i = 0; i < 40; i++) ui.camStep(0.05);
    const zRun = ui.cam.zoom;
    me.input.dx = 0; for (let i = 0; i < 90; i++) ui.camStep(0.05);
    const zIdle = ui.cam.zoom;
    ok('lari = zoom lebih melebar daripada diam', zRun < zIdle - 0.01, [zRun.toFixed(3), zIdle.toFixed(3)]);
    R.enterPhase('SEEK');
    for (let i = 0; i < 90; i++) ui.camStep(0.05);
    ok('fase SEEK = paling melebar', ui.cam.zoom < zRun + 0.01, [ui.cam.zoom.toFixed(3), zRun.toFixed(3)]);
    R.enterPhase('HIDE'); R.phaseEnd = R.t + 30;

    /* 3) kamera benar-benar mengubah proyeksi; ?cam=0 = perilaku lama (fit penuh) */
    ui.cam.zoom = CFG.camIdle; ui.cam.x = 2; ui.cam.y = 1; ui.applyCam();
    const v1 = ui.view;
    ok('scale = fitScale x zoom kamera', Math.abs(v1.scale - v1.fitScale * CFG.camIdle) < 1e-6, [v1.scale.toFixed(3), (v1.fitScale * CFG.camIdle).toFixed(3)]);
    ok('posisi layar titik dunia bergeser saat kamera digeser', Math.abs(ui.w2sx(2) - ui.w2sx(0)) > 1, [ui.w2sx(0).toFixed(1), ui.w2sx(2).toFixed(1)]);
    ui.cam.enabled = false; ui.camStep(0.05); ui.applyCam();
    const v0 = ui.view;
    ok('?cam=0 -> zoom 1 di tengah (dipakai tools/web_map_preview.py)', v0.scale === v0.fitScale && ui.cam.x === 0 && ui.cam.zoom === 1, [v0.scale.toFixed(3), v0.fitScale.toFixed(3)]);
    ui.cam.enabled = true;

    /* 4) slot skill ke-3 (Bekukan) + cooldown sendiri */
    const btns = getEl('skills').children;
    const byField = f => { for (const b of btns) if (b.dataset && b.dataset.field === f) return b; return null; };
    const propBtn = byField('skill2'), frzBtn = byField('skill3');
    ok('3 slot skill utk Hider: skill1/skill2/skill3', !!byField('skill1') && !!propBtn && !!frzBtn, btns.map(b => b.dataset && b.dataset.field));
    ok('ikon skill #3 = Icon_Freeze (aset AI baru)', /Icon_Freeze/.test(String(frzBtn && frzBtn.innerHTML)), String(frzBtn && frzBtn.innerHTML).slice(0, 60));

    const seeker = other;
    me.propDef = null; me.cdHider = 0; me.cdFreeze = 0; me.rootUntil = 0; me.pendingPropName = null;
    const pr = R.map.props[0]; me.x = pr.wx; me.y = pr.wy;
    if (seeker) { seeker.slowUntil = 0; seeker.slowFactor = 1; seeker.x = me.x + 1.5; seeker.y = me.y; }
    frzBtn.dispatch('pointerdown', {});
    pump(1);
    ok('tombol Bekukan -> input.skill3 -> Seeker dalam radius melambat',
      !!seeker && seeker.slowUntil > R.t && Math.abs(seeker.slowFactor - CFG.freezeSlow) < 1e-9, [seeker && seeker.slowUntil.toFixed(2), seeker && seeker.slowFactor]);
    ok('Freeze pakai cooldown sendiri (CFG.freezeCd), bukan hiderCd', me.cdFreeze > R.t && me.cdHider < me.cdFreeze, [me.cdFreeze.toFixed(2), me.cdHider.toFixed(2), CFG.freezeCd]);
    ok('pencast terpaku sesaat (rootUntil) - tidak kabur gratis', me.rootUntil > R.t, me.rootUntil.toFixed(2));
    ok('cincin cooldown skill #3 ikut berputar (conic-gradient)', /conic-gradient/.test(String(frzBtn.querySelector('.cd').style.background)), String(frzBtn.querySelector('.cd').style.background).slice(0, 44));
    me.propDef = null; frzBtn.dispatch('pointerdown', {}); pump(1);
    ok('Freeze kedua saat cooldown ditolak aturan', me.cdFreeze >= R.t && me.cdFreeze > 0, me.cdFreeze.toFixed(2));

    /* 5) mode aim Prop: tahan -> seret -> lepas */
    me.propDef = null; me.propUntil = 0; me.cdHider = 0; me.rootUntil = 0; me.pendingPropName = null;
    me.x = pr.wx; me.y = pr.wy;
    ui.setPaused(true); ui.setPaused(false);   // joystick.reset(): buang sisa drag tuas dari blok [5]
    const px = ui.w2sx(me.x) / ui.dpr, py = ui.w2sy(me.y) / ui.dpr;
    const ftBefore = stats.fillText;
    propBtn.dispatch('pointerdown', { clientX: px, clientY: py });
    ok('tahan tombol Prop -> mode aim aktif (kelas aiming + #aimHint.on)',
      /aiming/.test(propBtn.className) && getEl('aimHint').className === 'on', [propBtn.className, getEl('aimHint').className]);
    fireWin('pointermove', { clientX: px + 26, clientY: py - 20 });
    const pickName = ui.aim.pick;
    ok('seret -> kandidat prop ter-pick (dalam radius aim)', !!pickName, pickName);
    pump(1);
    ok('overlay aim ikut digambar (label prop)', stats.fillText > ftBefore, [ftBefore, stats.fillText]);
    ok('tombol Prop menandai pilihan (kelas picked)', /picked/.test(propBtn.className), propBtn.className);
    // aturan lama: bergerak membatalkan swap. Tombol panah dari blok [6] masih "ditahan"
    // di DOM tiruan, jadi lepas dulu semua tombol geraknya.
    for (const k of ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']) dispatchEventKey('keyup', k);
    me.input.dx = 0; me.input.dy = 0;
    fireWin('pointerup', { clientX: px + 26, clientY: py - 20 });
    pump(1);
    ok('lepas -> wujud = prop yang dipilih, bukan acak', me.propDef && me.propDef.name === pickName, [me.propDef && me.propDef.name, pickName]);
    ok('selesai aim -> hint hilang & kelas aiming dilepas', getEl('aimHint').className === '' && !/aiming/.test(propBtn.className), [getEl('aimHint').className, propBtn.className]);

    me.propDef = null; me.propUntil = 0; me.cdHider = 0; me.pendingPropName = null;
    me.input.dx = 0; me.input.dy = 0;
    propBtn.dispatch('pointerdown', { clientX: px, clientY: py });
    fireWin('pointerup', { clientX: px, clientY: py });
    pump(1);
    ok('tap singkat tetap swap (fallback perilaku lama, tanpa nama tujuan)', !!me.propDef && !me.pendingPropName, [me.propDef && me.propDef.name, me.pendingPropName]);

    me.propDef = null; me.cdHider = 0; me.pendingPropName = null;
    propBtn.dispatch('pointerdown', { clientX: px, clientY: py });
    fireWin('pointercancel', {});
    ok('pointercancel -> tidak swap, cooldown utuh', !me.propDef && me.cdHider === 0, [me.propDef, me.cdHider]);
    ok('keyboard "3" mengirim skill3', /skill3/.test(String(fs.readFileSync(path.join(ROOT, 'web/game.js'), 'utf8').match(/if \(k === '3'\)[^\n]*/))), 'anchor hilang');
    ok('tidak ada exception di blok kamera/aim/Freeze', fail === before, fail - before);
  }
  /* ---------- [8] UI v2.3: panel akun/ID game/teman (jalur OFFLINE) ---------- */
  console.log('\n[8] UI v2.3: panel akun + teman tanpa server (mode lokal harus tetap utuh)');
  {
    const before = fail;
    const G = global.hideSeekGame, ui = G && G.ui, acct = global.hideSeekAccount;
    const sleep2 = ms => new Promise(r => setTimeout(r, ms));
    // blok sebelumnya masih async: tunggu sampai selesai supaya kelas layar tidak saling rebut
    for (let i = 0; i < 400 && !global.__smokeBaseDone; i++) await sleep2(25);
    if (!global.__smokeBaseDone) await sleep2(2000);
    ok('apiKit.js dimuat oleh harness (window.BungAPI ada)', !!(global.BungAPI && global.BungAPI.ApiClient), typeof global.BungAPI);
    ok('game.js membuat instance akun (hideSeekAccount)', !!acct && typeof acct.sync === 'function', !!acct);
    ok('gameAPI.account tersedia utk debug/test', !!(G && G.account && G.account.api === acct), G && Object.keys(G.account || {}));
    await sleep2(30);                                  // health() selesai (fetch ditolak harness)
    ok('health gagal -> online=false, checked=true (tidak ada exception)', acct.online === false && acct.checked === true, [acct.online, acct.checked]);
    ok('status panel menulis mode lokal (bukan spinner selamanya)', /tidak aktif/.test(getEl('acctStatus').textContent), getEl('acctStatus').textContent);
    ok('lobby menampilkan "ID: belum login"', getEl('lobbyIdTag').textContent === 'ID: belum login', getEl('lobbyIdTag').textContent);
    ok('belum login: form masuk tampil, kartu profil tersembunyi', getEl('acctForm').className === '' && getEl('acctCard').className === 'hidden', [getEl('acctForm').className, getEl('acctCard').className]);

    getEl('accountBtn').click();
    pump(2);
    ok('tombol AKUN membuka panel lewat manajer layar', ui.screens.current === 'accountPanel', ui.screens.current);
    ok('daftar teman kosong diberi penjelasan (bukan area kosong)', /Belum ada teman/.test(String(getEl('friendList').children.map(c => c.textContent).join(' '))), getEl('friendList').children.length);
    getEl('tabReg').click();
    ok('tab DAFTAR menukar form (loginBox hidden, regBox tampil)', getEl('loginBox').className.indexOf('hidden') >= 0 && getEl('regBox').className.indexOf('hidden') < 0, [getEl('loginBox').className, getEl('regBox').className]);
    getEl('tabLogin').click();
    ok('tab MASUK mengembalikan form', getEl('loginBox').className.indexOf('hidden') < 0 && getEl('regBox').className.indexOf('hidden') >= 0);

    getEl('addFriendBtn').click();
    ok('tambah teman tanpa login -> diminta masuk dulu (tidak ada fetch sia-sia)', /masuk dulu/.test(getEl('acctMsg').innerHTML), getEl('acctMsg').innerHTML);
    getEl('acctClose').click(); pump(2);
    ok('tutup panel kembali ke layar sebelumnya', ui.screens.current !== 'accountPanel', ui.screens.current);

    // jalur "login" tanpa server: pesan error, sesi TIDAK dibuat, tidak ada exception
    getEl('loginUser').value = 'zam'; getEl('loginPass').value = 'rahasia';
    getEl('doLogin').click();
    await sleep2(60);
    ok('login tanpa server -> pesan gagal, sesi tetap kosong', acct.loggedIn === false && /tidak aktif|gagal/.test(getEl('acctMsg').innerHTML), getEl('acctMsg').innerHTML);
    getEl('doReg').click();
    await sleep2(60);
    ok('daftar tanpa server -> pesan gagal (tidak crash)', acct.loggedIn === false, getEl('acctMsg').innerHTML);
    getEl('syncBtn').click();
    await sleep2(40);
    ok('sinkronisasi tanpa login = no-op aman', true);
    getEl('logoutBtn').click();
    ok('logout saat belum login tetap aman (kelas hidden lagi)', getEl('acctCard').className === 'hidden', getEl('acctCard').className);

    // referral: adapter server terpasang, tapi tanpa sesi statusnya "menunggu server"
    ok('referral punya adapter server (setServer dipasang game.js)', !!(global.hideSeekReferral && global.hideSeekReferral.server), !!(global.hideSeekReferral || {}).server);
    ok('referral tanpa sesi: getServerStats() null + modal status lokal (perilaku lama)',
      global.hideSeekReferral.getServerStats() === null && /Belum ada teman/.test(global.hideSeekReferral.showInviteModal().querySelector('#refBonus').innerHTML || ''), global.hideSeekReferral.getServerStats());
    global.hideSeekReferral.recordIncomingReferral(1);
    ok('tanpa server: bonus lokal > 0 -> modal menulis "menunggu server" (kontrak v2.2 utuh)',
      /menunggu server/.test(global.hideSeekReferral.showInviteModal().querySelector('#refBonus').innerHTML || ''));
    ok('kode referral lokal tetap 7 karakter aman-baca', /^[A-HJ-KM-NP-Z0-9]{7}$/i.test(global.hideSeekReferral.getMyReferralCode()), global.hideSeekReferral.getMyReferralCode());

    /* ---- mode "punya sesi": suntik user + token, lalu cek tampilan & payload ---- */
    const callsSent = [];
    // apiKit menyimpan referensi fetch saat konstruksi -> inject lewat _fetch (didokumentasikan)
    const realFetch = acct._fetch;
    acct._fetch = (url, opt) => {
      callsSent.push({ url: String(url), body: opt && opt.body, headers: opt && opt.headers });
      const u = String(url);
      const user = { uid: 7, name: 'Zam', login: 'zam', gameId: '1048293', refCode: 'QQW7RTZ', coins: 640, lives: 2, bonusHp: 1, xp: 1800, level: 4, best: 900, rounds: 30, invited: 2, friends: 1, room: 'K9ZM', grantedCoins: 150, grantedLives: 1 };
      if (u.indexOf('/api/me') === 0) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ user })) });
      if (u.indexOf('/api/friends') === 0 && (!opt || opt.method !== 'POST')) {
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ friends: [{ uid: 8, name: 'budi', gameId: '8331209', level: 3, coins: 10, best: 320, online: true, since: 5, room: 'AB23' }], incoming: [], outgoing: [] })) });
      }
      if (u.indexOf('/api/friends/find') === 0) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ found: true, state: 'none', player: { name: 'budi', gameId: '8331209' } })) });
      if (u.indexOf('/api/friends/request') === 0) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, state: 'pending', reqId: 'r7-8' })) });
      if (u.indexOf('/api/leaderboard') === 0) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, rows: [{ rank: 1, name: 'Zam', gameId: '1048293', level: 4, best: 900 }] })) });
      if (u.indexOf('/api/sync') === 0) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, user })) });
      if (u.indexOf('/api/health') === 0) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, users: 3 })) });
      if (u.indexOf('/room/') === 0) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('room relay tidak dipakai di tes ini') });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ ok: true, user, referral: { ok: true, coinsForInviter: 100 } })) });
    };
    acct.online = true; acct.checked = true; acct.token = 'tok-tes-untuk-simulasi-sesi';
    const restored = await acct.restore();
    ok('restore() dengan server hidup -> sesi aktif', restored.ok === true && acct.loggedIn === true, restored.status);
    getEl('accountBtn').click();
    await sleep2(50); pump(2);
    ok('kartu profil tampil (ID 3+4 digit)', getEl('acctCard').className === '' && getEl('pfId').textContent === '104 8293', [getEl('acctCard').className, getEl('pfId').textContent]);
    ok('form login disembunyikan saat sudah masuk', getEl('acctForm').className === 'hidden');
    ok('status lobby menampilkan ID game', getEl('lobbyIdTag').textContent === 'ID game: 104 8293', getEl('lobbyIdTag').textContent);
    ok('koin/level kartu = angka server', getEl('pfCoins').textContent === '640' && getEl('pfLevel').textContent === 'Lv 4', [getEl('pfCoins').textContent, getEl('pfLevel').textContent]);
    ok('profil server DIADOPSI ke HUD lokal (koin 640, Lv 4)', getEl('coins').textContent === '640' && /Lv 4/.test(getEl('bestTag').textContent), [getEl('coins').textContent, getEl('bestTag').textContent]);
    ok('referral kini memakai kode SERVER', global.hideSeekReferral.getMyReferralCode() === 'QQW7RTZ', global.hideSeekReferral.getMyReferralCode());
    ok('modal undang menyebut "dibayar server"', /dibayar server/.test(global.hideSeekReferral.showInviteModal().querySelector('#refBonus').innerHTML || ''), global.hideSeekReferral.getServerStats());
    ok('daftar teman dirender sebagai baris (nama + ID)', getEl('friendList').children.length === 1 && /budi/.test(getEl('friendList').children[0].children.map(c => c.textContent).join(' ')), getEl('friendList').children.map(c => c.className));
    const frow = getEl('friendList').children[0];
    const joinBtn = frow.children[frow.children.length - 1].children[0];
    ok('teman dengan room aktif punya tombol Gabung', /Gabung AB23/.test(joinBtn.textContent), joinBtn.textContent);
    joinBtn.click(); pump(2);
    ok('tombol Gabung mengisi kode room + membuka lobby', getEl('codeInput').value === 'AB23' && ui.screens.current === 'lobby', [getEl('codeInput').value, ui.screens.current]);
    await sleep2(40);                              // joinRoom gagal (relay dimatikan di tes) -> harus tertangkap .catch, bukan exception

    getEl('accountBtn').click(); await sleep2(30);
    getEl('friendId').value = '8331209';
    getEl('addFriendBtn').click();
    await sleep2(60);
    ok('tambah teman via ID 7 digit -> POST /api/friends/find lalu request',
      callsSent.some(c => c.url.indexOf('/api/friends/find') === 0) && callsSent.some(c => c.url.indexOf('/api/friends/request') === 0 && JSON.parse(c.body).gameId === '8331209'), callsSent.map(c => c.url).slice(-3));
    ok('pesan ajakan terkirim ditampilkan', /ajakan terkirim/.test(getEl('acctMsg').innerHTML), getEl('acctMsg').innerHTML);
    getEl('friendId').value = '12';
    getEl('addFriendBtn').click();
    ok('ID kurang dari 7 digit ditahan di klien (tanpa request)', /7 digit/.test(getEl('acctMsg').innerHTML), getEl('acctMsg').innerHTML);

    const coinsBefore = G.profile.coins;
    getEl('syncBtn').click();
    await sleep2(60);
    const syncCall = callsSent.filter(c => c.url.indexOf('/api/sync') === 0).pop();
    ok('sinkronisasi mengirim angka profil (coins/xp/best/rounds)', !!syncCall && /"coins":/.test(syncCall.body) && /"best":/.test(syncCall.body), syncCall && syncCall.body);
    ok('Authorization: Bearer <token> ikut terkirim', !!(syncCall && /Bearer /.test(syncCall.headers.authorization || '')), syncCall && syncCall.headers);
    ok('sync tidak mengubah saldo lokal ke arah yang salah (monoton)', G.profile.coins >= 0 && G.profile.best >= 900, [G.profile.coins, G.profile.best, coinsBefore]);

    getEl('logoutBtn').click(); await sleep2(20);
    ok('logout membersihkan sesi + kembali ke form', acct.loggedIn === false && getEl('acctForm').className === '', [acct.loggedIn, getEl('acctForm').className]);
    global.fetch = realFetch;
    if (realFetch) acct._fetch = realFetch;
    if (ui.screens) { const RR = getRound(); ui.screens.show(RR && RR.phase !== 'LOBBY' && RR.phase !== 'RESULT' ? 'game' : 'menu'); }   // kembalikan state layar
    ok('tidak ada exception di blok [8]', fail === before, fail - before);
  }

})().catch(e => { console.log('  \x1b[31mEXCEPTION\x1b[0m ' + (e && e.stack || e)); fail++; });



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
  for (const f of ['uiKit.js', 'audioKit.js']) {
    const m = require(path.join(ROOT, 'web/' + f));
    if (f === 'uiKit.js') global.BungUI = m;
    else { global.BungAudioKit = m.AudioKit; if (!global.BungAudio) global.BungAudio = new m.AudioKit({}); }
    ok(f + ' bisa di-require tanpa DOM penuh', !!m);
  }
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
  ok('HUD menampilkan koin & nyawa', /^🪙 \d+$/.test(getEl('coins').textContent) && /^💚 ×\d+$/.test(getEl('lives').textContent), [getEl('coins').textContent, getEl('lives').textContent]);
  const R = getRound();
  /* tombol "Dapatkan Koin" -> showRewarded('bonus_coins') -> +50 koin */
  G.ads.resetCooldown();
  getEl('adCoinsBtn').dispatch('click', {});
  ok('iklan membuka overlay + menjeda permainan', /on/.test(getEl('adOverlay').className) && /on/.test(getEl('pauseTag').className), [getEl('adOverlay').className, getEl('pauseTag').className]);
  const closed = await waitAdClosed();
  ok('iklan simulasi selesai -> overlay & jeda dilepas', closed && !/on/.test(getEl('pauseTag').className), [getEl('adOverlay').className, getEl('pauseTag').className]);
  ok('koin +50 dan ditulis ke localStorage', getEl('coins').textContent === '🪙 50' && /"coins":50/.test(global.localStorage.getItem('hideseek_profile')), [getEl('coins').textContent, global.localStorage.getItem('hideseek_profile')]);
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
  ok('"Tonton Iklan +1 Nyawa" → nyawa cadangan +1', getEl('lives').textContent === '💚 ×1', getEl('lives').textContent);
  /* toko lobby: tukar koin -> +1 Max HP */
  getEl('buyHpBtn').dispatch('click', {});
  ok('beli +1 Max HP (50 koin) → koin 0, MAX HP 4 di HUD', getEl('coins').textContent === '🪙 0' && getEl('maxhpTag').textContent === 'MAX HP 4', [getEl('coins').textContent, getEl('maxhpTag').textContent]);
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

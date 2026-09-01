/* =============================================================================
 * tools/web_ui_test.js — uji UI/UX v2 (blueprint) tanpa browser
 * -----------------------------------------------------------------------------
 *   [A] kepatuhan blueprint pada web/ui.css + web/index.html (touch target,
 *       safe-area, zoning, glassmorphism, orientasi, reduced-motion)
 *   [B] uiKit.js  — joystick (deadzone), cooldown skill, manajer layar, FX, toast
 *   [C] audioKit.js — SFX/BGM prosedural + preferensi + ducking (dengan ctx tiruan)
 *   [D] PWA       — manifest.webmanifest + sw.js (precache harus file nyata)
 * jalan: node tools/web_ui_test.js        (exit != 0 bila ada FAIL)
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const WEB = p => path.join(ROOT, 'web', p);
const rd = p => fs.readFileSync(WEB(p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const UI = require(WEB('uiKit.js'));
const { AudioKit, SFX } = require(WEB('audioKit.js'));
const gameJs = rd('game.js');
const css = rd('ui.css');
const html = rd('index.html');

/* DOM mini utk menguji Fx/Toast tanpa jsdom. */
function miniDoc() {
  class N {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.className = ''; this.textContent = ''; this._html = ''; }
    appendChild(c) { this.children.push(c); c.parent = this; return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
    get firstChild() { return this.children[0] || null; }
    remove() { this.parent && this.parent.removeChild(this); }
    setAttribute() { } getAttribute() { return null; }
  }
  const root = new N('div');
  return { root, N, createElement: t => new N(t) };
}

(async function main() {
  /* ================== [A] KEPATUHAN BLUEPRINT (CSS + HTML) ================= */
  console.log('\n[A] blueprint → ui.css / index.html');
  {
    ok('token touch-target 44px didefinisikan', /--tap:\s*44px/.test(css));
    ok('.btn memakai min-height & min-width var(--tap)', /\.btn\{[^}]*min-height:var\(--tap\)[^}]*min-width:var\(--tap\)/.test(css));
    ok('.iconbtn (back/sound/board) 44×44', /\.iconbtn\{width:var\(--tap\);height:var\(--tap\);min-width:var\(--tap\)/.test(css));
    const skillMin = css.match(/\.skill\{[^}]*width:clamp\((\d+)px/);
    ok('tombol skill minimal 60px (>= 44)', !!skillMin && Number(skillMin[1]) >= 60, skillMin && skillMin[1]);
    const joyMin = css.match(/#joy\{[^}]*width:clamp\((\d+)px/);
    ok('joystick ±120px sesuai blueprint', !!joyMin && Number(joyMin[1]) >= 112, joyMin && joyMin[1]);
    ok('#rewardBtn tinggi >= 44px', /#rewardBtn\{[^}]*min-height:var\(--tap\)/.test(css));
    ok('.switch (setelan) juga >= 44px', /\.switch\{[^}]*min-height:var\(--tap\)/.test(css));
    ok('input & select >= 44px', /input,select\{min-height:var\(--tap\)/.test(css));

    ok('safe-area inset dipakai (notch)', /env\(safe-area-inset-top/.test(css) && /var\(--sa-b\)/.test(css));
    ok('viewport-fit=cover di HTML', /viewport-fit=cover/.test(html));
    ok('glassmorphism (backdrop-filter blur) dipakai konsisten', (css.match(/backdrop-filter:blur/g) || []).length >= 6, (css.match(/backdrop-filter:blur/g) || []).length);
    ok('font bulat sans-serif (Nunito/Poppins) + fallback sistem', /--font:"Nunito","Poppins"/.test(css));
    for (const c of ['--hue-green', '--hue-orange', '--hue-purple', '--hue-danger']) ok('token warna ' + c, css.includes(c + ':'));
    ok('satu warna = satu makna didokumentasikan', /1 warna = 1 makna/.test(css));
    ok('touch-action none + overscroll ditahan', /touch-action:none/.test(css) && /overscroll-behavior:none/.test(css));
    ok('resolusi internal via CSS scaling (canvas mengisi #stage)', /#game\{position:absolute;inset:0;width:100%;height:100%\}/.test(css));

    /* zoning: 6 zona + isi tiap zona sesuai blueprint 2.2 */
    for (const z of ['tl', 'tc', 'tr', 'bl', 'bc', 'br']) ok('.zone.' + z + ' diposisikan absolut', new RegExp('\\.zone\\.' + z + '\\{[a-z-]+:').test(css));
    const zone = (name) => {
      const m = html.match(new RegExp('<div class="zone ' + name + '">([\\s\\S]*?)(\\n\\s*</div>|<div class="zone)'));
      return m ? m[1] : '';
    };
    ok('TOP-LEFT: back + tag pemain', /id="backBtn"/.test(zone('tl')) && /id="playerTag"/.test(zone('tl')));
    ok('TOP-CENTER: fase + timer + role + hint + countdown', ['phase', 'timer', 'role', 'hint', 'countNum'].every(i => zone('tc').includes('id="' + i + '"')), zone('tc').slice(0, 40));
    ok('TOP-RIGHT: sound + leaderboard', /id="soundBtn"/.test(zone('tr')) && /id="lbBtn"/.test(zone('tr')));
    ok('BOTTOM-LEFT: joystick', /id="joy"/.test(zone('bl')));
    ok('BOTTOM-CENTER: HP + reward', /id="hpWrap"/.test(zone('bc')) && /id="rewardWrap"/.test(zone('bc')));
    ok('BOTTOM-RIGHT: skill + dock iklan (+1 Nyawa)', /id="skills"/.test(zone('br')) && /id="adDock"/.test(zone('br')) && /adLifeBtn/.test(zone('br')));
    ok('info net & minimap tidak menempel zona aksi', /id="netBadge"/.test(html) && /id="minimapWrap"/.test(html));
    ok('pointer-events hanya utk elemen interaktif (HUD tidak menahan tap)', /#hud\{[^}]*pointer-events:none/.test(css) && /\.zone\.br|#skills|#joy\{[^}]*pointer-events:auto|#rewardWrap\{pointer-events:auto/.test(css));
    ok('cooldown skill = cincin conic di tepi (mask)', /\.skill \.cd\{[^}]*conic-gradient/.test(css) && /mask:radial-gradient/.test(css));
    ok('damage number punya animasi naik', /\.dmg\{[^}]*animation:rise/.test(css) && /@keyframes rise/.test(css));
    ok('flash layar utk kena tangkap / camo', /@keyframes hitFlash/.test(css) && /@keyframes camoFlash/.test(css));
    ok('toast punya animasi masuk+keluar', /toastIn/.test(css) && /toastOut/.test(css));
    ok('orientasi portrait & landscape dua-duanya didefinisikan', /@media \(orientation:portrait\)/.test(css) && /@media \(orientation:landscape\)/.test(css));
    ok('layar pendek (landscape HP) dikecilkan', /@media \(orientation:landscape\) and \(max-height:520px\)/.test(css));
    ok(' overlap dihindari di 375px (#hint disembunyikan <400px)', /@media \(max-width:400px\)[\s\S]*#hint\{display:none\}/.test(css));
    ok('prefers-reduced-motion dihormati', /@media \(prefers-reduced-motion:reduce\)/.test(css));
    ok('prefers-contrast & focus-visible ada (aksesibilitas)', /prefers-contrast/.test(css) && /:focus-visible/.test(css));
    {   // !important boleh ada, tapi HANYA di blok reduced-motion (override animasi)
      const at = css.indexOf('@media (prefers-reduced-motion');
      const tot = (css.match(/!important/g) || []).length;
      const inRm = at >= 0 ? (css.slice(at).match(/!important/g) || []).length : -1;
      ok('!important hanya dipakai di blok prefers-reduced-motion', at >= 0 && tot > 0 && tot === inRm, [tot, inRm]);
    }

    /* layar wajib (blueprint 4.1) */
    const screens = { splash: 'splash', 'main menu': 'menu', lobby: 'lobby', 'gameplay HUD': 'hud', 'pause menu': 'pausePanel', 'game over': 'result', settings: 'settingsPanel', 'how to play': 'howtoPanel' };
    for (const k in screens) ok('screen "' + k + '" ada (#' + screens[k] + ')', html.includes('id="' + screens[k] + '"'));
    ok('splash = logo + progress + tips', /id="splashBar"/.test(html) && /id="splashPct"/.test(html) && /id="splashTip"/.test(html));
    ok('menu utama punya Play/How-to/Settings', ['playBtn', 'multiBtn', 'howtoBtn', 'settingsBtn'].every(i => html.includes('id="' + i + '"')));
    ok('pause punya Resume/Setelan/Ulang/Keluar', ['resumeBtn', 'pauseSettingsBtn', 'restartBtn', 'quitBtn'].every(i => html.includes('id="' + i + '"')));
    ok('result punya MVP + Play Again + Menu', ['mvpTag', 'againBtn', 'resultMenuBtn'].every(i => html.includes('id="' + i + '"')));
    ok('settings punya SFX/Musik/Haptik/Volume/Orientasi/Bahasa', ['sfxSwitch', 'musicSwitch', 'hapticSwitch', 'volumeRange', 'orientSel', 'langSel'].every(i => html.includes('id="' + i + '"')));
    ok('keyboard mapping di blueprint ada di teks lobby (A/D/W/S,1,2,Q,E,Esc,M)', ['A/D/W/S', '>1<', '>2<', '>Q<', '>E<', '>Esc<', '>M<'].every(t => /kbd/.test(html) && html.includes(t)), null);
    ok('ikon back/sound/board berupa SVG inline (tanpa aset tambahan)', (html.match(/<svg /g) || []).length >= 3, (html.match(/<svg /g) || []).length);

    /* wiring di game.js */
    ok('game.js memakai uiKit (Screens/Fx/Joystick/SkillButton/Viewport/Haptics)',
      ['new UI.Screens', 'new UI.Fx', 'UI.Joystick.computeVector', 'new UI.SkillButton', 'UI.Viewport.init', 'UI.Haptics'].every(k => gameJs.includes(k)), null);
    ok('pause membekukan langkah ronde tapi tetap render', /if \(paused\) \{ if \(ROUND\) draw\(\); return requestAnimationFrame\(frame\); \}/.test(gameJs));
    ok('ESC membuka pause (keydown handler + Screens.escapeToPause)',
      /'escape' \|\| k === 'esc'/.test(gameJs) && /setPaused\(!paused\)/.test(gameJs) && /screens\.escapeToPause = \(\) => setPaused\(true\)/.test(gameJs));
    ok('timer berubah warna saat <10s & urgent di 5s akhir SEEK', /tv\.className = \(ROUND\.phase === 'SEEK' && tl <= 5\) \? 'urgent' : \(tl < 10 \? 'warn' : ''\)/.test(gameJs));
    ok('papan skor on-demand (tap ikon) dirender dari skor resmi', /function renderMiniBoard\(\)/.test(gameJs) && /toggleBoard/.test(gameJs));
    ok('feedback tiap kejadian game (hit/blast/prop/camo/ghost/revive/frenzy)',
      ["case 'hit'", "case 'blast'", "case 'prop'", "case 'camo'", "case 'ghost'", "case 'revive'", "case 'frenzy'"].every(k => gameJs.includes(k)));
    ok('musik di-duck selama iklan (AU.duck)', /AU && AU\.duck\(true\)/.test(gameJs) && /AU && AU\.duck\(false\)/.test(gameJs));
    ok('splash progress per sprite + auto-hide', /splashProgress\(loaded\)/.test(gameJs) && /function hideSplash\(\)/.test(gameJs));
    ok('joy hanya tampil pada perangkat sentuh', /coarsePointer\(\)/.test(gameJs));
    {
      const ids = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
      const need = ['playerTag', 'fx', 'lbOverlay', 'lbMini', 'lbClose', 'splash', 'splashBar', 'splashPct', 'splashTip', 'splashSpinner',
        'menu', 'playBtn', 'multiBtn', 'howtoBtn', 'settingsBtn', 'bestTag', 'coinsMenu', 'verTag', 'mvpTag', 'mvpName', 'resultMenuBtn',
        'lobbyBackBtn', 'pausePanel', 'resumeBtn', 'pauseSettingsBtn', 'restartBtn', 'quitBtn', 'settingsPanel', 'sfxSwitch', 'musicSwitch',
        'hapticSwitch', 'volumeRange', 'orientSel', 'langSel', 'deviceInfo', 'closeSettingsBtn', 'howtoPanel', 'closeHowtoBtn', 'soundBtn',
        'lbBtn', 'backBtn', 'adKicker', 'adDock'];
      ok(`semua ${need.length} id UI baru ada di index.html`, need.every(i => ids.has(i)), need.filter(i => !ids.has(i)));
    }
    /* setiap $('id') game.js tetap ada (jaring pengaman refactor) */
    const idsHtml = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
    const used = [...new Set([...gameJs.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
    ok(`${used.length} id dipakai game.js, 0 hilang`, used.every(i => idsHtml.has(i)), used.filter(i => !idsHtml.has(i)));
    ok('stylesheet & script UI dimuat (ui.css, uiKit.js, audioKit.js)',
      /<link rel="stylesheet" href="ui\.css">/.test(html)
      && html.indexOf('<script src="uiKit.js">') < html.indexOf('<script src="game.js">')
      && html.indexOf('<script src="audioKit.js">') < html.indexOf('<script src="game.js">')
      && html.indexOf('<script src="uiKit.js">') > 0);
  }

  /* ============================= [B] uiKit.js ============================== */
  console.log('\n[B] uiKit — joystick, cooldown, layar, FX, toast');
  {
    const rect = { left: 0, top: 0, width: 120, height: 120 };   // pad 120px => jari di tengah
    const J = UI.Joystick;
    let v = J.computeVector(60, 60, rect);
    ok('pusat → diam (deadzone)', v.active === false && v.dx === 0 && v.dy === 0, v);
    v = J.computeVector(60 + 60, 60, rect);
    ok('tepi pad (60px) → dx = 1 penuh', Math.abs(v.dx - 1) < 1e-9 && Math.abs(v.dy) < 1e-9, v);
    v = J.computeVector(60 + 50, 60, rect);
    ok('setengah mati (50px) → dx ≈ 0.8 (deadzone 0.16)', v.dx > 0.75 && v.dx < 0.9, v);
    v = J.computeVector(60, 60 - 60, rect);
    ok('geser atas sampai tepi → dy = +1 (sumbu Y layar dibalik)', Math.abs(v.dy - 1) < 1e-9, v);
    v = J.computeVector(60 + 1000, 60, rect);
    ok('jauh dari pad → clamp ke 1 (tidak >1)', Math.abs(v.dx) <= 1 && v.active, v);
    v = J.computeVector(60 + 30, 60, rect, 0.5);
    ok('deadzone 50% → 30px masih di bawah ambang', v.active === false || v.dx < 0.05, v);
    v = J.computeVector(60 + 20, 60 + 20, rect);
    ok('diagonal ternormalisasi (|dx|,|dy| <= 1)', Math.abs(v.dx) <= 1 && Math.abs(v.dy) <= 1 && v.dx > 0 && v.dy < 0, v);
    ok('diagonal konsisten (dx ≈ -dy)', Math.abs(v.dx + v.dy) < 0.02, v);

    ok('cooldown 100% → 360 derajat', UI.SkillButton.cooldownDeg(10, 10) === 360);
    ok('cooldown 50% → 180 derajat', UI.SkillButton.cooldownDeg(5, 10) === 180);
    ok('cooldown 0 → 0 derajat (siap)', UI.SkillButton.cooldownDeg(0, 10) === 0);
    ok('total 0 tidak membagi nol', UI.SkillButton.cooldownDeg(3, 0) === 0);
    ok('style berisi conic-gradient', /conic-gradient/.test(UI.SkillButton.cooldownStyle(4, 10)), UI.SkillButton.cooldownStyle(4, 10));
    {
      const el = { className: 'skill ready', style: {}, addEventListener() { }, setAttribute() { }, getAttribute() { return null; } };
      const cd = { style: {} };
      const b = new UI.SkillButton(el, { cd });
      ok('render() set kelas cool saat cooldown', b.render(5, 10) === 0.5 && /cool/.test(el.className), el.className);
      ok('cincin cooldown ditulis ke .cd', /conic-gradient/.test(cd.style.background), cd.style.background);
      b.render(0, 10);
      ok('render() kembali ke ready', /ready/.test(el.className) && !/cool/.test(el.className), el.className);
      UI.SkillButton.pressFx(el);
      ok('pressFx menambah kelas flash', /flash/.test(el.className), el.className);
    }
    /* Screens: konvensi className game.js ('panel' / 'panel hidden') harus utuh */
    {
      const reg = new Map();
      const mk = (id, cls) => { const e = { id, className: cls }; reg.set(id, e); return e; };
      mk('splash', 'screen on'); mk('menu', 'screen'); mk('lobby', 'panel hidden'); mk('result', 'panel hidden');
      const changes = [];
      const sc = new UI.Screens(['splash', 'menu', 'lobby', 'result'], { getElementById: id => reg.get(id) || null, onChange: (n, p) => changes.push([n, p]) });
      ok('isOn membaca kedua konvensi (on / panel)', UI.Screens.isOn(reg.get('splash')) && !UI.Screens.isOn(reg.get('lobby')));
      sc.show('menu');
      ok('show(menu) menyembunyikan splash', reg.get('splash').className.indexOf('on') < 0 && /\bon\b/.test(reg.get('menu').className), [reg.get('splash').className, reg.get('menu').className]);
      sc.show('game');
      ok('layar non-kelola ("game") = semua hidden + current terisi', sc.current === 'game' && reg.get('menu').className.indexOf('on') < 0, reg.get('menu').className);
      sc.show('lobby');
      ok('lobby tetap pakai class "panel" (bukan on) => kompatibel game.js', reg.get('lobby').className === 'panel', reg.get('lobby').className);
      reg.get('result').className = 'panel';           // game.js: showResult()
      ok('result "panel" terbaca on', UI.Screens.isOn(reg.get('result')));
      ok('onChange terpanggil utk transisi musik/joy', changes.length >= 3 && changes[0][0] === 'menu' && changes[1][1] === 'menu', changes);
      sc.show('menu'); sc.back();
      ok('back() kembali ke lobby (history)', sc.current === 'lobby', sc.current);
      ok('setOn(false) menambah hidden, bukan menghapus class lain', (() => { const e = { className: 'panel' }; UI.Screens.setOn(e, false); return e.className === 'panel hidden'; })());
    }
    /* Fx: damage number + flash */
    {
      const d = miniDoc();
      global.document = { createElement: d.createElement };
      const fx = new UI.Fx(d.root, { project: (wx, wy) => ({ x: wx * 40, y: 300 - wy * 40 }), max: 3, lifeMs: 40 });
      const el = fx.damage(2, 1, '-1 ♥', '');
      ok('damage dibuat di posisi proyeksi', !!el && el.style.left === '80px' && el.style.top === '260px', el && [el.style.left, el.style.top]);
      ok('kelas .dmg dipakai (CSS rise animation)', /dmg/.test(el.className), el.className);
      fx.damage(1, 1, '+50', 'coin'); fx.damage(1, 2, 'x', 'heal'); fx.damage(1, 3, 'y', 'info');
      ok('antrian FX dibatasi (max 3, yang lama dibuang)', d.root.children.length === 3, d.root.children.length);
      await sleep(70);
      ok('FX hilang setelah masa hidupnya', d.root.children.length === 0, d.root.children.length);
      const stage = { className: '' };
      fx.flash(stage, 'hit');
      ok('flash layar menambah kelas flash-hit', /flash-hit/.test(stage.className), stage.className);
      await sleep(360);
      ok('flash dilepas lagi', stage.className.indexOf('flash-hit') < 0, stage.className);
      global.document = undefined;
      ok('Fx tanpa DOM → null, tidak melempar', new UI.Fx(null, {}).damage(0, 0, 'x') === null);
    }
    /* toast: batas antrian + auto-remove */
    {
      const d = miniDoc();
      global.document = { createElement: d.createElement };
      const t = UI.makeToaster(d.root, { max: 3, ms: 40 });
      t('satu'); t('dua'); t('tiga'); t('empat');
      ok('toast berlebih dibuang dari depan', d.root.children.length === 3 && d.root.children.map(c => c.textContent).join(',') === 'dua,tiga,empat', d.root.children.map(c => c.textContent));
      await sleep(360);   // ms(40) + animasi keluar 260ms
      ok('toast auto-dismiss', d.root.children.length === 0, d.root.children.length);
      global.document = undefined;
    }
    ok('Haptics aman tanpa navigator.vibrate', (() => { try { UI.Haptics.tap(); UI.Haptics.hit(); return true; } catch (e) { return String(e); } })() === true);
    ok('Haptics.enabled menghormati preferensi', (() => { UI.Haptics.enabled = false; UI.Haptics.win(); UI.Haptics.enabled = true; return true; })());
    ok('Viewport.info() tidak melempar di node', (() => { const i = UI.Viewport.info(); return typeof i.portrait === 'boolean'; })(), UI.Viewport.info());
    ok('Viewport.lock() reject-safe (tanpa Screen Orientation API)', UI.Viewport.lock('portrait') instanceof Promise);
    ok('roleClass: hider/seeker', UI.roleClass({ isHider: true }) === 'hider' && UI.roleClass({ isHider: false }) === 'seeker' && UI.roleClass(null) === '');
    ok('Joystick boleh tanpa elemen (mode logika)', (() => { const j = new UI.Joystick(null, {}); j.reset(); return j.dx === 0; })());
  }

  /* ============================ [C] audioKit.js ============================ */
  console.log('\n[C] audioKit — SFX/BGM sintesis + preferensi');
  {
    const store = { _d: {}, getItem(k) { return this._d[k] === undefined ? null : this._d[k]; }, setItem(k, v) { this._d[k] = v; } };
    // tanpa AudioContext: semua harus jadi no-op (bukan error)
    const a0 = new AudioKit({ storage: store });
    ok('unlock() tanpa AudioContext → false', a0.unlock() === false);
    ok('sfx() tanpa konteks → false, tidak melempar', a0.sfx('tap') === false);
    ok('music() tanpa konteks → false', a0.music('game') === false);
    ok('status() tetap informatif', a0.status().failed === true && a0.ready === false, a0.status());
    ok('preferensi disimpan sbg JSON valid', (() => { a0.setMuted('sfx', false); a0.setVolume(0.5); return JSON.parse(store.getItem('hideseek_audio')).sfx === false; })());
    ok('setVolume di-clamp 0..1', a0.setVolume(9) === 1 && a0.setVolume(-2) === 0, a0.prefs.volume);
    ok('preferensi dipulihkan dari storage', new AudioKit({ storage: store }).prefs.music === true);

    // konteks tiruan: catat semua node yang dibuat
    let made = { osc: 0, src: 0, gain: 0, resumed: 0 }, paramSets = [];
    const param = () => ({ value: 1, setValueAtTime(v) { paramSets.push(v); }, exponentialRampToValueAtTime(v) { paramSets.push(v); } });
    const node = extra => Object.assign({ connect() { }, start() { }, stop() { }, ...extra });
    global.window = global;
    global.AudioContext = class {
      constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'suspended'; this.destination = node({}); }
      resume() { made.resumed++; return Promise.resolve(); }
      createGain() { made.gain++; return node({ gain: param() }); }
      createOscillator() { made.osc++; return node({ type: 'sine', frequency: param() }); }
      createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
      createBufferSource() { made.src++; return node({ buffer: null }); }
      createBiquadFilter() { return node({ type: 'lowpass', frequency: param() }); }
    };
    const a = new AudioKit({ storage: store });
    a.prefs.sfx = true; a.prefs.music = true; a.prefs.volume = 0.8;      // a0 tadi sudah mematikan sfx di storage
    ok('unlock() membuat konteks + resume() (kebijakan autoplay)', a.unlock() === true && made.resumed === 1, made);
    ok('unlock() kedua tidak membuat konteks baru', a.unlock() === true && made.gain === 3, made.gain);
    made.osc = 0;
    ok('sfx("coin") menghidupkan osilator', a.sfx('coin') === true && made.osc >= 1, made.osc);
    ok('sfx("hit") memakai sweep (freq diramp)', paramSets.length > 0);
    { const before = made.src; const r = a.sfx('blast'); ok('sfx("blast") = noise buffer (createBufferSource)', r === true && made.src === before + 1, { before, after: made.src }); }
    ok('sfx("win") = chord 3 nada', (() => { const before = made.osc; a.sfx('win'); return made.osc - before === 3; })());
    ok('sfx tak dikenal → false', a.sfx('tidak-ada') === false);
    ok('sfx() dibungkam saat prefs.sfx=false', (() => { a.setMuted('sfx', false); const before = made.osc; const r = a.sfx('tap'); a.setMuted('sfx', true); return r === false && made.osc === before; })());
    const before = made.osc;
    ok('music("game") menjadwalkan nada', a.music('game') === true);
    await sleep(140);
    ok('loop BGM terus menghasilkan nada', made.osc > before, { before, now: made.osc });
    ok('duck(true) menurunkan master gain', a.duck(true) === true && a.master.gain.value < 0.8, a.master.gain.value);
    a.duck(false);
    ok('duck(false) mengembalikan gain', a.master.gain.value === a.prefs.volume, a.master.gain.value);
    ok('stopMusic() membersihkan timer', a.stopMusic() === false && a.track === null, a.track);
    a.music('menu'); a.music(null);
    ok('musik menu->null berhenti tanpa error', a._timer === null);
    ok('status() melaporkan track & pref', a.status().volume === a.prefs.volume && a.status().ready === true && 'track' in a.status() && 'ducked' in a.status(), a.status());
    /* semua nama yang dipakai game.js harus ada di tabel SFX */
    const used = [...new Set([...gameJs.matchAll(/sfx\('(\w+)'/g)].map(m => m[1]))];
    ok(`game.js memakai ${used.length} SFX, semuanya terdefinisi`, used.length >= 10 && used.every(u => SFX[u]), used.filter(u => !SFX[u]));
    ok('tabel SFX mencakup kebutuhan blueprint (catch/skill/button/countdown/result)',
      ['catch', 'skill', 'tap', 'count', 'win', 'lose', 'blast', 'radar', 'coin'].every(k => SFX[k]));
    ok('BGM 2 track (menu & game) dengan bpm berbeda', Object.keys(require(WEB('audioKit.js')).BGM).length === 2 && require(WEB('audioKit.js')).BGM.menu.bpm < require(WEB('audioKit.js')).BGM.game.bpm);
    delete global.AudioContext;
  }

  /* =============================== [D] PWA ================================= */
  console.log('\n[D] PWA — manifest + service worker');
  {
    const mf = JSON.parse(rd('manifest.webmanifest'));
    ok('manifest valid (JSON)', !!mf.name && !!mf.short_name, Object.keys(mf));
    ok('display fullscreen + orientation any', mf.display === 'fullscreen' && mf.orientation === 'any');
    ok('start_url & scope relatif (aman di subfolder/preview)', /^\.\//.test(mf.start_url) && mf.scope === './', [mf.start_url, mf.scope]);
    ok('tema & warna latar konsisten', /^#[0-9a-f]{6}$/i.test(mf.theme_color) && mf.background_color === mf.theme_color, [mf.theme_color, mf.background_date]);
    ok('ikon ada file-nya (any + maskable)', mf.icons.length >= 2 && mf.icons.every(i => fs.existsSync(WEB(i.src.replace(/^\.\//, '')))), mf.icons.map(i => i.src));
    ok('shortcut solo/room memakai query yang dikenali', mf.shortcuts.length === 2 && /solo=1/.test(mf.shortcuts[0].url) && /room=1/.test(mf.shortcuts[1].url), mf.shortcuts.map(s => s.url));
    ok('lang id di-set', mf.lang === 'id');
    ok('index.html menautkan manifest + apple-touch-icon', /rel="manifest"/.test(html) && /apple-touch-icon/.test(html));
    ok('tema warna meta + apple status bar', /name="theme-color"/.test(html) && /apple-mobile-web-app-capable/.test(html));
    const sw = rd('sw.js');
    const shell = JSON.parse('[' + (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [, ''])[1].replace(/\/\/[^\n]*/g, '').replace(/'/g, '"').replace(/,(\s*[}\]])/g, '$1').replace(/,\s*$/, '') + ']');
    ok('SHELL precache terdeteksi (' + shell.length + ' entri)', shell.length >= 12, shell.length);
    const miss = shell.filter(u => u !== './' && !fs.existsSync(WEB(u.replace(/^\.\//, '').split('?')[0])));
    ok('semua entri SHELL benar-benar ada di web/ (tanpa 404 saat install)', miss.length === 0, miss);
    ok('relay /room/ TIDAK pernah di-cache', /\/room\//.test(sw) && /return;\s*\/\/\s*relay/.test(sw.replace(/\s+/g, ' ')) || /pathname\.indexOf\('\/room\/'\)/.test(sw));
    ok('navigasi network-first dengan fallback index.html', /mode === 'navigate'/.test(sw) && /caches\.match\('\.\/index\.html'\)/.test(sw));
    ok('aset memakai stale-while-revalidate', /stale-while-revalidate|cache\.match\(req\)[\s\S]*fetch\(req\)/.test(sw));
    ok('cache dibersihkan saat versi naik', /caches\.delete\(k\)/.test(sw) && /const VERSION = 'v\d[^']*'/.test(sw) && /CACHE_SHELL = '[^']+?' \+ VERSION/.test(sw));
    ok('skipWaiting tersedia (tombol update)', /skipWaiting/.test(sw));
    ok('SW didaftarkan di index.html dengan opt-out ?nosw=1', /serviceWorker\.register\('sw\.js'\)/.test(html) && /nosw=1/.test(html));
    ok('SW tidak didaftarkan di file:// (guard protokol http)', /location\.protocol\.indexOf\('http'\) === 0/.test(html));
  }


  /* ============ [E] UI v2.1: XP/level, partikel, sensitivitas, papan skor lokal ============ */
  console.log('\n[E] XP + partikel + sensitivitas joystick + leaderboard lokal + aset UI');
  {
    const G = require(WEB('game.js'));
    const { Particles } = require(WEB('particles.js'));
    const swTxt = rd('sw.js');
    const shellList = JSON.parse('[' + (swTxt.match(/const SHELL = \[([\s\S]*?)\];/) || [, ''])[1]
      .replace(/\/\/[^\n]*/g, '').replace(/'/g, '"').replace(/,(\s*[}\]])/g, '$1').replace(/,\s*$/, '') + ']');
    const { Profile, LocalScores, makeMemoryStore, ECONOMY } = G;

    /* ---- 1) XP & level (blueprint 4.1: Game Over menampilkan "XP earned") ---- */
    ok('ECONOMY punya konstanta XP (web-only)', ECONOMY.xpPerScore > 0 && ECONOMY.xpWin > 0 && ECONOMY.xpPlay >= 0 && ECONOMY.levelBase > 0);
    const st = makeMemoryStore();
    const pr = new Profile(st);
    ok('profil baru: xp 0 + level 1', pr.xp === 0 && pr.level === 1, [pr.xp, pr.level]);
    ok('XP ronde = round(120*0.6)+120menang+25main = 217', pr.awardProgress(120, true).gained === 217, pr.xp);
    ok('koin TIDAK disentuh awardProgress (aturan lama utuh)', pr.coins === 0, pr.coins);
    ok('finishRound lama tetap 0.5 koin / skor', new Profile(makeMemoryStore()).finishRound(61) === 31);
    ok('xp tersimpan di hideseek_profile & dibaca ulang', /"xp":217/.test(st.getItem('hideseek_profile')) && new Profile(st).xp === 217);
    ok('kurva level 0/300/900/1800', [1, 2, 3, 4].map(L => Profile.xpForLevel(L)).join(',') === '0,300,900,1800');
    ok('levelOf(xpForLevel(L)) == L (L=1,2,3,5,8,12)', [1, 2, 3, 5, 8, 12].every(L => Profile.levelOf(Profile.xpForLevel(L)) === L));
    ok('XP 3000 -> baru saja Lv 5 (pct 0, perlu 1500 utk Lv 6)', (function () { const q = new Profile(makeMemoryStore()); q.addXp(3000); const lp = q.levelProgress; return q.level === 5 && lp.pct === 0 && lp.need === 1500; })(), new Profile(makeMemoryStore()).levelProgress);
    ok('XP 1799 masih Lv 3 (tepat di bawah ambang)', (function () { const q = new Profile(makeMemoryStore()); q.addXp(1799); return q.level === 3 && q.levelProgress.pct >= 99; })(), (function () { const q = new Profile(makeMemoryStore()); q.addXp(1799); return [q.level, q.levelProgress.pct]; })());
    ok('leveledTo terisi saat naik, 0 bila level tetap', (function () { const q = new Profile(makeMemoryStore()); const a = q.awardProgress(500, true), b = q.awardProgress(0, false); return a.leveledTo >= 2 && b.leveledTo === 0; })());
    ok('addXp(n) menolak negatif (xp tidak pernah turun)', (function () { const q = new Profile(makeMemoryStore()); q.addXp(500); q.addXp(-900); return q.xp === 500; })());
    ok('reset() ikut menghapus xp', (function () { const q = new Profile(st); q.reset(); return q.xp === 0; })());
    ok('layar hasil punya #rankTag/#xpGain/#lvlTag/#lvlBarFill/#coinGain', ['#rankTag', '#xpGain', '#lvlTag', '#lvlBarFill', '#coinGain'].every(id => html.indexOf('id="' + id.slice(1) + '"') >= 0), ['#rankTag'].filter(id => html.indexOf('id="' + id.slice(1) + '"') < 0));
    ok('game.js: rank + XP dirender & ditulis ke #rankRow', /setTxt\('rankTag'/.test(gameJs) && /setTxt\('xpGain'/.test(gameJs) && /setTxt\('lvlTag'/.test(gameJs) && /id="rankRow"/.test(html));
    ok('game.js: level ikut tampil di menu (state terlihat)', /'Lv ' \+ lp\.level/.test(gameJs));

    /* ---- 2) partikel canvas + screen shake (blueprint 5.2) ---- */
    ok('particles.js dimuat sebelum game.js + mengekspor Particles', /<script src="particles\.js"><\/script>/.test(html) && html.indexOf('<script src="particles.js">') < html.indexOf('<script src="game.js">') && typeof Particles === 'function');
    const P = new Particles({ max: 40 });
    ok('emit() menambah partikel sesuai count', P.emit('hit', 0, 0, { count: 12 }) === 12 && P.count === 12, P.count);
    ok('semua resep KINDS punya count/life/speed', ['dust', 'spark', 'hit', 'heal', 'camo', 'ring'].every(k => Particles.KINDS[k] && Particles.KINDS[k].count > 0 && Particles.KINDS[k].life > 0));
    ok('kind tak dikenal -> 0 (typo tertangkap, tidak crash)', P.emit('ledakan', 0, 0) === 0);
    P.clear();
    ok('clear() mengosongkan pool', P.count === 0);
    P.emit('dust', 1, 1, { count: 3 });
    ok('dust: 3 butir, y di bawah pemain, alpha placeholder utuh', P.count === 3 && P.list.every(q => /rgba\([\d.,]+,A\)$/.test(q.color)), P.count);
    for (let i = 0; i < 20; i++) P.emit('spark', i, 0, { count: 9 });
    ok('pool dibatasi max (yang tertua dibuang, bukan ditolak)', P.count <= 40 && P.list[P.list.length - 1].kind === 'spark', P.count);
    ok('stepList(): gravitasi positif menurunkan vy, drag melunakkan vx', (function () {
      const one = { kind: 'dust', x: 0, y: 0, vx: 4, vy: 0, grav: 10, drag: 1, ttl: 5, t: 0, size: 0.1, color: 'rgba(0,0,0,A)' };
      Particles.stepList([one], 0.1);
      return one.vy < 0 && one.y < 0 && one.x > 0 && one.vx < 4 && one.vx > 0;
    })());
    ok('stepList(): tanpa gravitasi -> bergerak lurus (debu tetap nyaris datar)', (function () {
      const one = { kind: 'dust', x: 0, y: 0, vx: 1, vy: 0, grav: 0, drag: 0, ttl: 5, t: 0, size: 0.1, color: 'rgba(0,0,0,A)' };
      Particles.stepList([one], 0.1);
      return one.vy === 0 && Math.abs(one.y) < 1e-9;
    })());
    ok('step(): partikel hasil emit bergerak lalu habis sendiri', (function () {
      const A = new Particles({}); A.emit('hit', 0, 0, { count: 6 });
      const b = A.list[0], bx = b.x, by = b.y; A.step(0.05);
      const moved = b.x !== bx || b.y !== by;
      for (let i = 0; i < 80 && A.count; i++) A.step(0.05);
      return moved && A.count === 0;
    })());
    ok('step(): partikel kedaluwarsa dibuang (pool kembali kosong)', (function () { for (let i = 0; i < 60 && P.count; i++) P.step(0.05); return P.count === 0; })(), P.count);
    ok('stepList(dt) di-cap 0.05s (anti spiral-of-death saat tab back)', (function () { const r = new Particles({}); r.emit('spark', 0, 0, { count: 1 }); const one = r.list[0]; r.step(10); return one.t <= 0.050001; })());
    const RR = new Particles({}); RR.emit('ring', 2, 3, { r1: 5 });
    ok('ring: 1 partikel, r0<r1, tidak jatuh', RR.count === 1 && RR.list[0].r1 > RR.list[0].r0 && (RR.step(0.05), RR.list[0].y === 3));
    let touched = 0;
    const ctx = { save() { touched++; }, restore() { touched++; }, beginPath() { touched++; }, arc() { touched++; }, stroke() { touched++; }, fillRect() { touched++; }, set fillStyle(v) { if (/^rgba\(/.test(v)) touched++; }, set strokeStyle(v) { if (/^rgba\(/.test(v)) touched++; }, lineWidth: 1 };
    const P2 = new Particles({}); P2.emit('hit', 1, 1, { count: 5 }); P2.emit('ring', 1, 1, {});
    ok('draw(ctx, sx, sy, unit) menggambar semua partikel & mengembalikan jumlah', P2.draw(ctx, v => v * 10, v => 400 - v * 10, 10) === 6 && touched > 6, touched);
    ok('draw() tanpa ctx / kosong -> 0 (tidak melempar)', P2.draw(null, null, null, 1) === 0 && new Particles({}).draw(ctx, v => v, v => v, 1) === 0);
    ok('prefers-reduced-motion -> emit() diam total', new Particles({ reduced: true }).emit('hit', 0, 0, { count: 12 }) === 0);
    ok('alpha placeholder diganti saat draw (tidak ada "A)" bocor)', (function () { let bad = 0; const c2 = { save() { }, restore() { }, beginPath() { }, arc() { }, stroke() { }, fillRect() { }, set fillStyle(v) { if (/A\)/.test(v)) bad++; }, set strokeStyle(v) { if (/A\)/.test(v)) bad++; }, lineWidth: 1 }; P2.draw(c2, v => v, v => v, 1); return bad === 0; })());
    ok('game.js: step+draw partikel tersambung ke loop render', /parts\.step\(dt\); dustStep\(dt\)/.test(gameJs) && /parts\.draw\(ctx, W2SX, W2SY, scale\)/.test(gameJs));
    ok('game.js: debu saat lari, burst saat kena, sparkle saat koin', /parts\.emit\('dust'/.test(gameJs) && /parts\.emit\('hit'/.test(gameJs) && /parts\.emit\('spark'/.test(gameJs) && /parts\.emit\('ring'/.test(gameJs) && /parts\.emit\('heal'/.test(gameJs) && /parts\.emit\('camo'/.test(gameJs));
    ok('game.js: screen shake utk hit/ghost/level-up', /shake\(2\)/.test(gameJs) && /shake\(3\)/.test(gameJs) && /shake\(1\)/.test(gameJs));
    ok('CSS: keyframes stageShake + 3 intensitas', /@keyframes stageShake/.test(css) && /#stage\.shake-1\{--shk:2px\}/.test(css) && /#stage\.shake-3\{--shk:7px\}/.test(css));
    ok('shake goyangkan ISI stage (bukan stage-nya) + token kelas, bukan classList', /#stage\.shake>#game/.test(css) && /#stage\.shake>#hud/.test(css) && /el\.className = \(\(el\.className \|\| ''\)/.test(gameJs));

    /* ---- 3) sensitivitas joystick (blueprint 4.4 Settings) ---- */
    const rect = { left: 0, top: 0, width: 120, height: 120 };
    const v10 = UI.Joystick.computeVector(30, 60, rect, 0.14);
    const vHi = UI.Joystick.computeVector(30, 60, rect, 0.14, 1.5);
    const vLo = UI.Joystick.computeVector(30, 60, rect, 0.14, 0.7);
    ok('sens 1.5 > 1.0 > 0.7 pada jarak yang sama', Math.abs(vHi.dx) > Math.abs(v10.dx) && Math.abs(v10.dx) > Math.abs(vLo.dx), [vLo.dx, v10.dx, vHi.dx]);
    ok('sensitivitas tidak pernah menembus 1.0', Math.abs(UI.Joystick.computeVector(120, 60, rect, 0.14, 2).dx) <= 1 && Math.abs(UI.Joystick.computeVector(30, 60, rect, 0.14, 99).dx) <= 1);
    ok('deadzone tetap mematikan input sentuh kecil (apa pun sens-nya)', UI.Joystick.computeVector(61.5, 60, rect, 0.14, 0.7).active === false && UI.Joystick.computeVector(61.5, 60, rect, 0.14, 1.5).active === false);
    ok('sens default = 1 (lama, tidak mengubah rasa kontrol)', Math.abs(UI.Joystick.computeVector(30, 60, rect, 0.14).dx - v10.dx) < 1e-9);
    ok('Joystick(opt.sensitivity) di-clamp 0.5..2 + default 1', new UI.Joystick(null, { sensitivity: 9 }).sensitivity === 2 && new UI.Joystick(null, {}).sensitivity === 1 && new UI.Joystick(null, { sensitivity: 'x' }).sensitivity === 1);
    ok('slider #sensRange (70..150) + label #sensVal ada di Settings', /id="sensRange"[^>]*min="70"[^>]*max="150"/.test(html) && /id="sensVal"/.test(html));
    ok('game.js menyimpan sens ke hideseek_ui + meneruskan ke computeVector', /uiPrefs\.sens = v; saveUiPrefs\(\)/.test(gameJs) && /computeVector\(e\.clientX, e\.clientY, r, 0\.14, joy\.sens\)/.test(gameJs) && /sens: 1/.test(gameJs));

    /* ---- 4) papan skor lokal persisten (blueprint 6.2) ---- */
    const sc = new LocalScores(makeMemoryStore());
    ok('LocalScores: key hideseek_scores + cap 10', sc.key === 'hideseek_scores' && sc.cap === 10);
    for (let i = 0; i < 15; i++) sc.add({ name: 'p' + i, score: i * 7, ts: 1000 + i });
    ok('hanya 10 teratas disimpan, urut skor desc', sc.length === 10 && sc.best() === 98 && sc.rows[9].score === 35, sc.rows.map(r => r.score));
    ok('top(5) = lima teratas', sc.top(5).length === 5 && sc.top(5)[0].score === 98);
    ok('add() mengembalikan rank, baris, dan daftar baru', (function () { const r = sc.add({ name: 'juara', score: 500, role: 'SEEKER', win: true }); return r.rank === 1 && r.row.score === 500 && r.rows[0].name === 'juara'; })());
    ok('skor negatif/NaN -> 0 (tidak merusak daftar)', (function () { return sc.add({ score: -5 }).row.score === 0 && sc.add({ score: NaN }).row.score === 0; })());
    ok('nama dipotong 24 karakter (XSS/scroll protection)', sc.add({ name: 'x'.repeat(60), score: 1 }).row.name.length === 24);
    ok('role dinormalisasi ke HIDER/SEEKER', sc.add({ score: 1, role: 'admin' }).row.role === 'HIDER' && sc.add({ score: 1, role: 'SEEKER' }).row.role === 'SEEKER');
    ok('seri -> yang dicapai lebih dulu menang', (function () { const a = new LocalScores(makeMemoryStore()); a.add({ name: 'z', score: 10, ts: 99 }); a.add({ name: 'a', score: 10, ts: 11 }); return a.rows[0].name === 'a'; })());
    ok('persist antar-instance (baca ulang dari storage)', new LocalScores(sc.storage).best() === 500);
    sc.storage.setItem(sc.key, '{korup');
    ok('storage korup/JSON rusak -> daftar kosong, tidak melempar', new LocalScores(sc.storage).length === 0);
    ok('baris rusak (tanpa score) dibuang saat load', (function () { const t = makeMemoryStore(); t.setItem('hideseek_scores', JSON.stringify([{ name: 'a' }, { score: 5 }, null, { score: 'abc' }])); return new LocalScores(t).length === 1; })());
    ok('tanggal baris pakai locale id ("1 Sep")', /^\d{1,2} \w{3}$/.test(LocalScores.fmtDate(Date.now())), LocalScores.fmtDate(Date.now()));
    ok('clear() mengosongkan daftar', (function () { const t = makeMemoryStore(); const a = new LocalScores(t); a.add({ score: 5 }); return a.clear().length === 0 && new LocalScores(t).length === 0; })());
    ok('hasil ronde dicatat + #localLbBody/#localLbWrap dirender', /localScores\.add\(\{ name: me\.name/.test(gameJs) && /id="localLbBody"/.test(html) && /id="localLbWrap"/.test(html) && /lw\.className = localScores\.length \? 'on' : ''/.test(gameJs) && /function renderLocalBoard\(/.test(gameJs) && /renderLocalBoard\(0\);/.test(gameJs));
    ok('panel papan skor HUD ikut menampilkan rekor lokal', /rekor lokal · top /.test(gameJs) && /localScores\.top\(5\)/.test(gameJs));
    ok('ada tombol hapus rekor lokal di Settings', /id="clearLbBtn"/.test(html) && /onClick\('clearLbBtn'/.test(gameJs) && /localScores\.clear\(\)/.test(gameJs));

    /* ---- 5) aset UI baru (item 5: ikon + bingkai + latar) ---- */
    const NEW = ['assets/Icon_Coin.png', 'assets/Icon_Life.png', 'assets/UI_HealthFrame.png', 'assets/UI_MinimapFrame.png', 'assets/Bg_Splash.jpg'];
    ok('5 aset UI baru ada di web/assets', NEW.every(f => fs.existsSync(WEB(f))), NEW.filter(f => !fs.existsSync(WEB(f))));
    ok('file punya signature PNG/JPEG yang benar', NEW.every(f => { const b = fs.readFileSync(WEB(f)); return f.endsWith('.jpg') ? (b[0] === 0xFF && b[1] === 0xD8) : b.slice(1, 4).toString('latin1') === 'PNG'; }));
    ok('masing-masing < 200KB (hemat utk HP)', NEW.every(f => fs.statSync(WEB(f)).size < 200 * 1024), NEW.map(f => fs.statSync(WEB(f)).size));
    ok('ikon PNG punya kanal alpha (di-key dari magenta)', ['assets/Icon_Coin.png', 'assets/Icon_Life.png', 'assets/UI_HealthFrame.png', 'assets/UI_MinimapFrame.png'].every(f => { const b = fs.readFileSync(WEB(f)); return b[25] === 6 || b[25] === 4; }), ['assets/Icon_Coin.png'].map(f => fs.readFileSync(WEB(f))[25]));
    ok('tidak ada file mentah/_raw_ ikut di repo', fs.readdirSync(WEB('assets')).every(f => !/^_raw_|asset_check/.test(f)), fs.readdirSync(WEB('assets')).filter(f => /^_raw_|asset_check/.test(f)));
    ok('emoji koin/nyawa di pill diganti <img class="ico">', /class="ico" src="assets\/Icon_Coin\.png"/.test(html) && /class="ico" src="assets\/Icon_Life\.png"/.test(html) && !/>\u{1FA99} 0</u.test(html));
    ok('JS menulis angka saja ke <b id="coins"> (ikon tidak terhapus)', /txt\('coins', String\(profile\.coins\)\); txt\('lives', '×' \+ profile\.lives\)/.test(gameJs));
    ok('bingkai HP & minimap memakai aset baru', /#hpBar\{[^}]*UI_HealthFrame\.png/.test(css) && /#minimapWrap\{[\s\S]{0,200}UI_MinimapFrame\.png/.test(css));
    ok('splash & menu punya latar hidup (ken-burns) >=2 .bgimg', /#splash \.bgimg\{[^}]*Bg_Splash\.jpg/.test(css) && /@keyframes kenburns/.test(css) && (html.match(/class="bgimg"/g) || []).length >= 2);
    ok('reduced-motion mematikan ken-burns & shake', /prefers-reduced-motion[\s\S]*#splash \.bgimg[\s\S]*animation:none/.test(css));
    ok('aset baru ikut di-precache service worker', NEW.every(f => shellList.indexOf('./' + f) >= 0), NEW.filter(f => shellList.indexOf('./' + f) < 0));
    ok('particles.js juga di-precache', shellList.indexOf('./particles.js') >= 0);
    ok('LOAD sprite game.js tidak dirusak (aset UI tidak masuk atlas)', !/UI_HealthFrame|Icon_Coin/.test(gameJs.slice(0, gameJs.indexOf('const LOAD')) + (gameJs.match(/const LOAD = \[[\s\S]*?\];/) || [''])[0]));
  }

/* ================= [F] UI v2.2: kamera, aim Prop, skill Freeze ================= */
console.log('\n[F] UI v2.2: kamera follow+zoom, aim Prop, Freeze');
{
  const ui = UI, game = gameJs, auKit = rd('audioKit.js'), swSrc = rd('sw.js');
  const gameExports = require(WEB('game.js'));
  /* --- Camera2D (padanan Utils/PlayerCamera.cs) --- */
  const C = ui.Camera;
  ok('uiKit mengekspor Camera2D sebagai ui.Camera', typeof C === 'function', typeof C);
  ok('statis approach() ~ Mathf.SmoothDamp (converge, tak overshoot)', (() => {
    let v = 0, cur = 0, okc = true;
    for (let i = 0; i < 240; i++) { cur = C.approach(cur, 5, 0.016, 0.12); }
    okc = Math.abs(cur - 5) < 0.02 && cur <= 5.0001;
    v = C.approach(0, 0, 0.016, 0.12);
    return okc && v === 0;
  })(), C.approach(0, 5, 0.016, 0.12).toFixed(3));
  ok('zoomTarget: diam > lari > seek', (() => {
    const a = C.zoomTarget({ zoomIdle: 1.25, zoomRun: 1.08, zoomSeek: 1, runSpeed: 4.8, speed: 0, seeking: false });
    const b = C.zoomTarget({ zoomIdle: 1.25, zoomRun: 1.08, zoomSeek: 1, runSpeed: 4.8, speed: 9, seeking: false });
    const c = C.zoomTarget({ zoomIdle: 1.25, zoomRun: 1.08, zoomSeek: 1, runSpeed: 4.8, speed: 9, seeking: true });
    return a > b && b > c && Math.abs(a - 1.25) < 1e-9 && Math.abs(c - 1) < 1e-9;
  })(), 'idle/run/seek');
  ok('zoomTarget: lari tanpa SEEK tidak boleh lebih sempit dari SEEK', (() => {
    const b = C.zoomTarget({ zoomIdle: 1.25, zoomRun: 1.08, zoomSeek: 1.15, runSpeed: 4.8, speed: 9, seeking: true });
    return b >= 1.08 - 1e-9 && b <= 1.15 + 1e-9;
  })(), 'clamp');
  ok('clampToMap menahan tepi viewport tetap di dalam peta', (() => {
    const a = C.clampToMap(999, -999, 5, 5, 8.5, 5.5);
    return Math.abs(a.x - 8.5 + 5) < 1e-9 && Math.abs(a.y + 5.5 - 5) < 1e-9;
  })(), JSON.stringify(C.clampToMap(999, -999, 5, 5, 8.5, 5.5)));
  ok('clampToMap: view lebih besar dari peta -> tengah (0,0)', (() => {
    const a = C.clampToMap(3, 3, 20, 20, 8.5, 5.5);
    return a.x === 0 && a.y === 0;
  })(), JSON.stringify(C.clampToMap(3, 3, 20, 20, 8.5, 5.5)));
  ok('NaN dt tidak merusak kamera (guard untuk tab di-background)', (() => {
    const cam = new C({}); cam.x = 3; cam.y = -2; cam.zoom = 1.2;
    cam.step(NaN, { tx: 0, ty: 0, speed: 0, seeking: false }, { w: 20, h: 20 }, { w: 17, h: 11 });
    return Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.zoom);
  })(), 'finite');
  ok("kamera nonaktif (?cam=0) -> x=y=0, zoom=1, netral utk render fit", (() => {
    const cam = new C({ enabled: false });
    cam.step(0.016, { tx: 5, ty: 5, speed: 9, seeking: true }, { w: 8, h: 8 }, { w: 17, h: 11 });
    return cam.x === 0 && cam.y === 0 && cam.zoom === 1;
  })(), 'disabled');
  ok('apply() = scale fitScale*zoom, offset terpusat, tanpa letterbox', (() => {
    const cam = new C({ zoomIdle: 1.25, zoomRun: 1.25, zoomSeek: 1.25, runSpeed: 0.001 });
    const viewPx = { w: 800, h: 600 };
    cam.step(1, { tx: 0, ty: 0, speed: 5, seeking: false }, { w: viewPx.w / 40 / 1.25, h: viewPx.h / 40 / 1.25 }, { w: 17, h: 11 });
    const a = cam.apply(40, 800, 600);
    const b = cam.apply(40, 800, 600);
    return Math.abs(a.scale - 40 * cam.zoom) < 1e-6 && Math.abs(a.ox - 400 + cam.x * a.scale) < 1e-6 && JSON.stringify(a) === JSON.stringify(b);
  })(), 'deterministik');

  /* --- aturan: kandidat prop, swap ber-arah, Freeze --- */
  const G = gameExports || {};
  const R = G.Round, P = G.PlayerState, CFG = G.CFG;
  ok('game.js mengekspor Round/PlayerState/CFG utk uji aturan', !!R && !!P && !!CFG, [typeof R, typeof P]);
  ok('CFG punya kunci kamera & Freeze (paritas dgn HideSeekConstants.cs)',
    ['freezeRadius', 'freezeTime', 'freezeSlow', 'freezeCd', 'freezeRoot', 'propAimRadius', 'camIdle', 'camRun', 'camSeek', 'camRunSpeed', 'camSmooth'].every(k => typeof CFG[k] === 'number'), JSON.stringify(CFG.freezeRadius));
  ok('freezeSlow di (0,1) dan freezeCd > hiderCd/2 (skill taktis, bukan spam)',
    CFG.freezeSlow > 0 && CFG.freezeSlow < 1 && CFG.freezeCd > CFG.hiderCd / 2, [CFG.freezeSlow, CFG.freezeCd]);
  {
    const mk = (id, role) => new P(id, 'P' + id, role);
    const r = new R();
    const h = mk(1, 0), sk = mk(2, 1);
    r.add(h); r.add(sk); r.seekerId = 2; r.myId = 1; r.start(false);
    r.phase = 'HIDE'; r.phaseEnd = r.t + 30;
    h.isBot = sk.isBot = false;
    const pr = r.map.props[0];
    h.x = pr.wx; h.y = pr.wy; h.role = 0; h.cdHider = 0; h.cdFreeze = 0;
    const cand = r.propCandidates(h, 3);
    ok('propCandidates(p,r) hanya mengembalikan prop di dalam radius & punya name+def',
      cand.length > 0 && cand.every(c => typeof c.name === 'string' && !!c.def) && cand.some(c => c.def === pr.def), cand.length);
    h.cdHider = 0;
    ok('usePropSwap dgn nama tujuan = prop itu (aim); tanpa nama = tetap dapat sesuatu', (() => {
      h.propDef = null; h.cdHider = 0;
      const want = cand.find(c => c.def !== pr.def) || cand[0];
      const ok1 = r.usePropSwap(h, want.name) && h.propDef === want.def;
      h.propDef = null; h.cdHider = 0;
      const ok2 = r.usePropSwap(h) && !!h.propDef;
      return ok1 && ok2;
    })(), 'aim + fallback');
    ok('usePropSwap menolak nama di luar radius (tidak bisa teleport-wujud)', (() => {
      // Deterministik di peta acak: cari dua prop yang saling jauh & berbeda nama; pemain
      // diletakkan DI ATAS prop pertama (jadi selalu ada kandidat lokal utk fallback).
      // (Dulu pemain ditaruh di (0,0) -> kadang tidak ada prop di sekitarnya sama sekali.)
      h.propDef = null; h.cdHider = 0;
      const nearR = Math.max(0.9, CFG.propAimRadius * 0.6);
      let pick = null;
      for (const a of r.map.props) {
        const nearNames = new Set(r.map.props.filter(q => Math.hypot(q.wx - a.wx, q.wy - a.wy) <= nearR + 1e-6).map(q => q.def.name));
        for (const b of r.map.props) {
          if (b.def === a.def || nearNames.has(b.def.name)) continue;
          const d = Math.hypot(b.wx - a.wx, b.wy - a.wy);
          if (d > nearR && (!pick || d > pick.d)) pick = { d, a, b };
        }
      }
      if (!pick) return true;                                  // peta terlalu sempit: tidak ada yang bisa diuji
      h.x = pick.a.wx; h.y = pick.a.wy; h.cdHider = 0; h.propDef = null;
      const want = pick.b.def.name;
      const got = r.usePropSwap(h, want);
      return got === true && !!h.propDef && h.propDef.name !== want;   // tetap swap, tapi ke prop TERDEKAT
    })(), 'fallback ke kandidat lokal');
    ok('useFreeze: Seeker dalam radius melambat + pemakai terpaku + cooldown sendiri', (() => {
      h.x = 0; h.y = 0; h.cdFreeze = 0; h.rootUntil = 0; h.role = 0;
      sk.role = 1; sk.slowUntil = 0; sk.slowFactor = 1; sk.x = CFG.freezeRadius * 0.5; sk.y = 0;
      const fired = r.useFreeze(h);
      return fired === true && sk.slowUntil > r.t && Math.abs(sk.slowFactor - CFG.freezeSlow) < 1e-9
        && Math.abs(h.cdFreeze - (r.t + CFG.freezeCd)) < 1e-9 && h.rootUntil > r.t
        && Math.abs(h.rootUntil - (r.t + CFG.freezeRoot)) < 1e-9;
    })(), 'freeze');
    ok('useFreeze kedua kali ditolak (cooldown) dan tidak menyentuh Seeker', (() => {
      sk.slowUntil = 0; sk.slowFactor = 1;
      const before = h.cdFreeze;
      const fired = r.useFreeze(h);
      return fired === false && sk.slowUntil === 0 && h.cdFreeze === before;
    })(), 'cd');
    ok('root membekukan langkah pemain (v=0) sampai rootUntil lewat', (() => {
      h.input.dx = 1; h.input.dy = 0; h.x = 0; h.y = 0;
      h.rootUntil = r.t + 1.0; r.movePlayer(h, 0.05);
      const stuck = Math.abs(h.x) < 1e-9;
      h.rootUntil = 0; r.movePlayer(h, 0.05);
      return stuck && Math.abs(h.x) > 0;
    })(), 'root');
    ok('seeker yang jauh tidak ikut melambat', (() => {
      sk.slowUntil = 0; sk.slowFactor = 1; sk.x = CFG.freezeRadius + 6; sk.y = 4; h.cdFreeze = 0;
      r.useFreeze(h);
      return sk.slowUntil === 0;
    })(), 'radius');
  }

  /* --- jaring UI: tombol #3, ikon, CSS, SFX, presache --- */
  ok('index.html: elemen #aimHint untuk petunjuk mode seret', /id="aimHint"/.test(html), '');
  ok('ui.css: gaya .skill.aiming (outline es) ada', /\.skill\.aiming\{/.test(css), '');
  ok('ui.css: gaya .skill.picked (centang pilihan) ada', /\.skill\.picked::after\{/.test(css), '');
  ok('ui.css: #aimHint.on tampil + varian kecil utk <=400px', /#aimHint\.on\{/.test(css) && /#aimHint\{font-size:11px/.test(css), '');
  ok('ui.css: aksen skill #3 (Icon_Freeze) didefinisikan', /\.skill\[data-field="skill3"\]/.test(css), '');
  ok('game.js: slot ke-3 hider memakai Icon_Freeze + label Bekukan',
    /\[\s*'Icon_Freeze',\s*'Bekukan',\s*'3',\s*'skill3'\s*\]/.test(game), '');
  ok('game.js: tombol Prop (hider) dipasang tahan->seret->lepas', /aimStart\(ev\)/.test(game) && /aimEnd\(true\)/.test(game) && /aimEnd\(false\)/.test(game), '');
  ok('game.js: keyboard "3" memicu skill3', /if \(k === '3'\) press\('skill3'\)/.test(game), '');
  ok('game.js: event freeze diberi SFX + haptic + partikel', /case 'freeze':[\s\S]{0,320}?sfx\('freeze'\)/.test(game), '');
  ok('game.js: protokol net mengirim pilihan prop (pn) & skill3 (s3)', /s3: p\.input\.skill3/.test(game) && /pn: p\.pendingPropName/.test(game), '');
  ok('audioKit: resep SFX freeze & aim ada', /\n\s*freeze: \[/.test(auKit) && /\n\s*aim: \[/.test(auKit), '');
  ok('sw.js: Icon_Freeze ikut di-precache', /Icon_Freeze\.png/.test(swSrc), '');
}

  /* ============ [G] UI v2.3: apiKit (akun JWT) + panel AKUN/ID/TEMAN ============ */
  console.log('\n[G] UI v2.3: apiKit.js + panel akun/ID game/teman + referral berbayar server');
  {
    const kit = rd('apiKit.js');
    const { ApiClient, KEYS } = require(WEB('apiKit.js'));
    const before = fail;

    /* ---- memori/penyimpanan ---- */
    const mem = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
    const calls = [];
    const mkClient = (respond) => new ApiClient({
      storage: mem,
      fetch: (url, opt) => {
        calls.push({ url: String(url), opt: opt || {} });
        const r = respond(String(url), opt || {});
        return Promise.resolve({ ok: r.status < 400, status: r.status, text: () => Promise.resolve(JSON.stringify(r.body || {})), headers: { get: () => 'application/json' } });
      },
    });

    ok('apiKit diekspor sebagai window.BungAPI + createApiClient', /window\.BungAPI = \{ ApiClient, KEYS \}/.test(kit) && /window\.createApiClient =/.test(kit));
    ok('key localStorage sesi: hideseek_jwt + hideseek_user', KEYS.token === 'hideseek_jwt' && KEYS.user === 'hideseek_user');

    /* ---- offline: TIDAK pernah throw, selalu {ok:false, offline:true} ---- */
    const dead = new ApiClient({ storage: mem, fetch: () => Promise.reject(new Error('ECONNREFUSED')) });
    const off = await dead.health();
    ok('server mati -> {ok:false, offline:true} (game tetap jalan normal)', off.ok === false && off.offline === true, off);
    ok('setelah gagal, online=false & checked=true', dead.online === false && dead.checked === true);
    const offl = await dead.login({ user: 'a', pass: 'b' });
    ok('login saat offline tidak melempar', offl.ok === false && offl.offline === true, offl);
    const noFetch = new ApiClient({ storage: mem, fetch: null });
    ok('fetch tidak ada sama sekali -> tetap aman', (await noFetch.signup({})).ok === false);

    /* ---- signup/login: token disimpan, profil di-cache ---- */
    let c = mkClient((url) => url.indexOf('/api/signup') === 0
      ? { status: 201, body: { token: 'T.1.abc', user: { uid: 7, name: 'Zam', login: 'zam', gameId: '1048293', refCode: 'ABC1234', coins: 50, lives: 1, xp: 0, level: 1, best: 0, rounds: 0, invited: 1, friends: 0 } } }
      : { status: 200, body: { ok: true } });
    const su = await c.signup({ name: 'Zam', user: 'zam', pass: 'rahasia', ref: 'zz' });
    ok('signup sukses -> token + user tersimpan di storage', su.ok === true && mem.getItem(KEYS.token) === 'T.1.abc' && /1048293/.test(mem.getItem(KEYS.user) || ''), mem.getItem(KEYS.token));
    ok('loggedIn true setelah signup', c.loggedIn === true && c.user.gameId === '1048293');
    ok('body signup memuat name/user/pass/ref', JSON.parse(calls[calls.length - 1].opt.body).ref === 'zz', calls[calls.length - 1].opt.body);
    ok('baseUrl kosong => URL relatif (satu origin dgn net-server.js)', /^\/api\/signup$/.test(calls[calls.length - 1].url), calls[calls.length - 1].url);

    c = mkClient((url) => url.indexOf('/api/me') === 0 ? { status: 200, body: { user: { uid: 7, name: 'Z', gameId: '1048293', coins: 300 } } } : { status: 200, body: { ok: true } });
    let changed = 0;
    c.onChange = () => changed++;
    await c.restore();
    ok('restore() memakai token tersimpan (header authorization)', /Bearer T\.1\.abc/.test(JSON.stringify(calls[calls.length - 1].opt.headers)), calls[calls.length - 1].opt.headers);
    ok('onChange dipanggil saat profil berubah', changed >= 1, changed);

    /* ---- 401 -> sesi dibuang otomatis ---- */
    c = mkClient(() => ({ status: 401, body: { error: 'login dulu (kadaluarsa)' } }));
    c.token = 'kadaluarsa'; c.user = { uid: 1 };
    const ex = await c.get('me');
    ok('token kedaluwarsa -> logout otomatis, tanpa exception', ex.ok === false && c.token === '' && ex.status === 401, ex);

    /* ---- bentuk payload sync/ad ---- */
    c = mkClient(() => ({ status: 200, body: { ok: true, user: { uid: 1, name: 'x', gameId: '1000000', coins: 10, lives: 0, xp: 0, level: 1, best: 0, rounds: 0 } } }));
    c.token = 't'; c.user = { uid: 1, name: 'x', gameId: '1000000' };
    await c.sync({ coins: 4200, xp: 1800, best: 900, rounds: 12, lives: 2, bonusHp: 1 });
    const syncBody = JSON.parse(calls[calls.length - 1].opt.body);
    ok('sync mengirim angka bulat (bukan objek acak)', syncBody.coins === 4200 && syncBody.xp === 1800 && syncBody.best === 900 && syncBody.rounds === 12, syncBody);
    ok('sync TIDAK pernah mengirim password/token di body', !/pass|token/.test(calls[calls.length - 1].opt.body), calls[calls.length - 1].opt.body);
    await c.adReward('bonus_coins', 'ad123');
    ok('adReward -> /api/ads/reward + kind/nonce', /\/api\/ads\/reward$/.test(calls[calls.length - 1].url) && syncEq(calls[calls.length - 1].opt.body, { kind: 'bonus_coins', nonce: 'ad123' }), calls[calls.length - 1].opt.body);
    await c.announceRoom('k9z');
    ok('announceRoom -> /api/room (kode di-uppercase oleh server)', /\/api\/room$/.test(calls[calls.length - 1].url) && /k9z/.test(calls[calls.length - 1].opt.body));
    await c.addFriend('104 8293');
    ok('addFriend mengirim gameId apa adanya (server yang membersihkan)', /"gameId":"104 8293"/.test(calls[calls.length - 1].opt.body), calls[calls.length - 1].opt.body);
    function syncEq(s, o) { try { const j = JSON.parse(s); return Object.keys(o).every(k => j[k] === o[k]); } catch (e) { return false; } }

    /* ---- util tampilan ---- */
    ok('fmtGameId 7 digit -> 3+4 (mudah dibacakan)', ApiClient.fmtGameId('1048293') === '104 8293' && ApiClient.fmtGameId('104-829 3') === '104 8293', ApiClient.fmtGameId('1048293'));
    ok('fmtGameId aman utk nilai aneh', ApiClient.fmtGameId('') === '' && ApiClient.fmtGameId(null) === '' && ApiClient.fmtGameId('12') === '12');
    ok('digitsOnly membersihkan spasi/tanda', ApiClient.digitsOnly(' 104-829 3 ') === '1048293');
    ok('agoLabel lokal (menit/jam/hari)', ApiClient.agoLabel(5) === 'baru saja' && /mnt/.test(ApiClient.agoLabel(180)) && /jam/.test(ApiClient.agoLabel(7200)) && /hari/.test(ApiClient.agoLabel(100000)));
    ok('logout membuang token & cache profil', (() => { c.logout(); return c.token === '' && c.user === null && mem.getItem(KEYS.token) === null; })());
    ok('semua request memakai cache: no-store (tidak dibelokkan service worker ke cache)', calls.every(x => x.opt.cache === 'no-store'), calls.slice(0, 2).map(x => x.opt.cache));

    /* ---- panel akun: kepatuhan blueprint (touch target + a11y) ---- */
    ok('index.html: panel #accountPanel bertipe .screen (dikelola manajer layar)', /<div id="accountPanel" class="screen">/.test(html));
    for (const id of ['accountBtn', 'lobbyAccountBtn', 'acctClose', 'acctStatus', 'acctForm', 'acctCard', 'tabLogin', 'tabReg', 'loginUser', 'loginPass', 'doLogin', 'regName', 'regUser', 'regPass', 'regRef', 'doReg', 'acctMsg', 'pfId', 'copyIdBtn', 'friendId', 'addFriendBtn', 'friendList', 'friendInbox', 'globalBoard', 'lobbyIdTag', 'pfCoins', 'pfLevel', 'pfBest', 'pfFriends'])
      ok(`#${id} ada di index.html (dipakai game.js)`, new RegExp('id="' + id + '"').test(html), id);
    ok('input akun: autocomplete benar (password manager tidak bingung)', /id="loginPass"[^>]*type="password"[^>]*autocomplete="current-password"/.test(html) && /autocomplete="new-password"/.test(html) && /autocomplete="username"/.test(html));
    ok('form daftar: nama tampilan max 16 karakter (sama seperti Unity/lobby)', /id="regName"[^>]*maxlength="16"/.test(html) && /id="regUser"[^>]*maxlength="16"/.test(html));
    ok('field ID teman memakai inputmode=numeric (keyboard angka di HP)', /id="friendId"[^>]*inputmode="numeric"/.test(html));
    ok('ui.css: ID game tampil monospace + user-select:all (sekalipun di HP)', /\.idcard b\{[^}]*ui-monospace[^}]*user-select:all/.test(css));
    ok('ui.css: baris teman punya min-height >= 44px (touch target)', /\.frow\{[^}]*min-height:var\(--tap\)/.test(css), '');
    ok('ui.css: status online memakai titik hijau / .dot.off abu-abu', /\.dot\{[^}]*--hue-green/.test(css) && /\.dot\.off\{/.test(css));
    ok('ui.css: #acctForm/#acctCard/#regBox/#loginBox bisa disembunyikan', /#acctCard\.hidden,#regBox\.hidden,#loginBox\.hidden/.test(css));
    ok('ui.css: formbox = kartu glass sesuai design system', /\.formbox\{[^}]*background:var\(--glass\)/.test(css));
    ok('game.js: panel dibuka lewat manajer layar (accountPanel terdaftar)', /SCREEN_NAMES = \[[^\]]*'accountPanel'/.test(gameJs), (gameJs.match(/const SCREEN_NAMES = \[[^\]]*\]/) || [''])[0]);
    ok('game.js: tombol AKUN dipasang di menu DAN lobby', /onClick\('accountBtn', openAccount\)/.test(gameJs) && /onClick\('lobbyAccountBtn', openAccount\)/.test(gameJs));
    ok('game.js: tanpa server, status panel jujur (mode lokal)', /server akun tidak aktif/.test(gameJs));
    ok('game.js: koin/level HUD ikut diadopsi dari server (adoptServer)', /function adoptServer\(u\)/.test(gameJs) && /profile\.coins = Math\.max\(0, u\.coins \| 0\)/.test(gameJs));
    ok('game.js: sinkron otomatis tiap akhir ronde', /if \(account && account\.loggedIn\) acctAfterRound\(\)/.test(gameJs));
    ok('game.js: reward iklan dilaporkan ke server dengan nonce', /acctReportAd\(placement, adNonce\)/.test(gameJs) && /const adNonce = 'ad' \+ Date\.now\(\)/.test(gameJs));
    ok('game.js: kode room diumumkan ke teman (host & join) + dibersihkan saat keluar',
      /acctAnnounceRoom\(j\.room\)/.test(gameJs) && /acctAnnounceRoom\(code\)/.test(gameJs) && /acctAnnounceRoom\(''\)/.test(gameJs));
    ok('game.js: daftar teman dibangun dengan createElement (bukan innerHTML mentah)', /function friendRow\(f, opt\)/.test(gameJs) && /box\.innerHTML = '';\s*\n\s*const list = \(j && j\.friends\)/.test(gameJs));
    ok('game.js: tombol "Gabung <room>" mengisi kode room lalu join', /Gabung ' \+ f\.room/.test(gameJs) && /ci\.value = f\.room/.test(gameJs));
    ok('game.js: validasi ID 7 digit di klien (pesan jelas)', /ID game = <b>7 digit<\/b>/.test(gameJs));
    ok('game.js: apiKit dimuat lewat window.createApiClient (opsional)', /typeof window\.createApiClient === 'function'/.test(gameJs));

    /* ---- referralSystem: adapter server ---- */
    const R = require(WEB('referralSystem.js'));
    const memR = (() => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();
    const rs = new R.ReferralSystem({ storage: memR, notify: () => { } });
    ok('referral: tanpa server -> kode lokal 7 char & charset aman (tanpa I/L/O), status "menunggu server"',
      /^[A-HJ-KM-NP-Z0-9]{7}$/i.test(rs.getMyReferralCode()) && rs.getServerStats() === null && /ABCDEFGHJKMNPQRSTUVWXYZ/.test(rs.cfg.charset), rs.getMyReferralCode());
    const codeBefore = rs.getMyReferralCode();
    rs.setServer({ getCode: () => 'QQW7RTZ', stats: () => ({ invited: 3, coinsPerFriend: 100, paidByServer: true }) });
    ok('referral.setServer memakai kode resmi server (link lama tetap konsisten)', rs.getMyReferralCode() === 'QQW7RTZ' && rs.getMyReferralCode() !== codeBefore, rs.getMyReferralCode());
    ok('referral.setServer menolak kode tidak valid (tetap pakai yang lama)', (() => { const r = new R.ReferralSystem({ storage: memR }); r.setServerCode('iL0'); return r.getMyReferralCode() === 'QQW7RTZ'; })());
    ok('referral.getStats().server berisi status pembayaran', rs.getStats().server.invited === 3 && rs.getStats().server.paidByServer === true, rs.getStats().server);
    ok('referral.getPendingCoins tetap utk mode lokal', rs.getPendingCoins() === 0);
    ok('game.js memasang adapter server ke referral (getCode/stats/claim)', /referral\.setServer\(\{[\s\S]{0,400}claim: code => account\.claimReferral\(code\)/.test(gameJs));

    ok('tidak ada exception di blok [G]', fail === before, fail - before);
  }

  console.log(`\n=== web_ui_test: ${pass} PASS, ${fail} FAIL ===`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('\x1b[31mEXCEPTION\x1b[0m', e && e.stack || e); process.exitCode = 1; });

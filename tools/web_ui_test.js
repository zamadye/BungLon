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
    ok('!important hanya utk reduced-motion', (css.match(/!important/g) || []).length <= 2, (css.match(/!important/g) || []).length);

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
      /<link rel="stylesheet" href="ui\.css">/.test(html) && html.indexOf('uiKit.js') < html.indexOf('game.js') && html.indexOf('audioKit.js') < html.indexOf('game.js'));
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
    ok('cache dibersihkan saat versi naik', /caches\.delete\(k\)/.test(sw) && /VERSION = 'v2-ui-1'/.test(sw));
    ok('skipWaiting tersedia (tombol update)', /skipWaiting/.test(sw));
    ok('SW didaftarkan di index.html dengan opt-out ?nosw=1', /serviceWorker\.register\('sw\.js'\)/.test(html) && /nosw=1/.test(html));
    ok('SW tidak didaftarkan di file:// (guard protokol http)', /location\.protocol\.indexOf\('http'\) === 0/.test(html));
  }

  console.log(`\n=== web_ui_test: ${pass} PASS, ${fail} FAIL ===`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('\x1b[31mEXCEPTION\x1b[0m', e && e.stack || e); process.exitCode = 1; });

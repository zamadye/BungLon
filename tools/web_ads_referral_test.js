/* =============================================================================
 * tools/web_ads_referral_test.js — uji headless AdsManager + ReferralSystem
 *   + profil ekonomi (koin/nyawa) dan integrasinya ke web/game.js.
 * jalan: node tools/web_ads_referral_test.js     (exit != 0 bila FAIL)
 * Semua dijalankan tanpa browser: DOM/SDK di-stub seperlunya.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Storage tiruan (interface localStorage) supaya tidak menulis ke disk. */
const mem = () => { const m = new Map(); return { _m: m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };

/* Modul di-load sebagai CommonJS; bagian browser (window.*) dilewati aman. */
const { AdsManager, resolveAdsConfig, ADS_DEFAULTS } = require(path.join(ROOT, 'web/adsManager.js'));
const { ReferralSystem } = require(path.join(ROOT, 'web/referralSystem.js'));
const { Profile, ECONOMY, Round, PlayerState, buildMap, CFG } = require(path.join(ROOT, 'web/game.js'));

function captureLogs(fn) {
  const lines = [], orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  return Promise.resolve(fn()).then(v => { console.log = orig; return { value: v, lines }; }, e => { console.log = orig; throw e; });
}

(async function main() {
  /* ====================== [A] PROFIL: KOIN & NYAWA ======================== */
  console.log('\n[A] Profile (koin, nyawa cadangan, toko kecil) — localStorage tiruan');
  {
    const st = mem();
    const p = new Profile(st, { profileKey: 'hideseek_profile' });
    ok('koin awal 0', p.coins === 0, p.coins);
    ok('maxHp awal = CFG.hiderHp (3)', p.maxHp === CFG.hiderHp, p.maxHp);
    ok('addCoins(50) → 50', p.addCoins(50) === 50 && p.coins === 50, p.coins);
    ok('spendCoins(80) gagal (tidak minus)', p.spendCoins(80) === false && p.coins === 50, p.coins);
    ok('spendCoins(50) sukses → 0', p.spendCoins(50) === true && p.coins === 0, p.coins);
    ok('addCoins tidak pernah di bawah 0', p.addCoins(-999) === 0, p.coins);
    ok('tersimpan di localStorage key hideseek_profile', !!st.getItem('hideseek_profile'), st._m.size);
    p.addCoins(120);
    const again = new Profile(st, {});
    ok('profil dimuat ulang dari storage (120 koin)', again.coins === 120, again.coins);
    /* +1 Max HP seharga 50 koin */
    const r1 = again.buyMaxHp();
    ok('beli +1 Max HP: ok & koin berkurang', r1.ok === true && again.coins === 70 && again.maxHp === 4, { r1, coins: again.coins, max: again.maxHp });
    const r2 = again.buyMaxHp();          // 70-50=20, bonusHp 2 = cap
    ok('beli lagi sampai cap (2)', r2.ok === true && again.bonusHp === 2 && again.coins === 20, again.bonusHp);
    ok('melewati cap ditolak', again.buyMaxHp().ok === false, again.bonusHp);
    const r3 = again.buyMaxHp();
    ok('bonus cap → koin tidak terpotong', again.coins === 20 && /maksimum/i.test(r3.why), r3);
    /* nyawa cadangan */
    again.addCoins(30);                        // 20 + 30 = 50 cukup utk harga 25
    const b1 = again.buyLife();
    ok('beli nyawa (25 koin) → lives 1', b1.ok === true && again.lives === 1 && again.coins === 25, { lives: again.lives, coins: again.coins });
    ok('beli nyawa kedua (sisa 25 koin) masih mampu', again.buyLife().ok === true && again.lives === 2 && again.coins === 0, { lives: again.lives, coins: again.coins });
    ok('beli nyawa tanpa koin ditolak', again.buyLife().ok === false && again.lives === 2, again.coins);
    ok('consumeLife: 2× sukses lalu false', again.consumeLife() === true && again.consumeLife() === true && again.consumeLife() === false, again.lives);
    /* penyembuhan */
    let healed = 0;
    again.onHP = (n) => { healed = n; return n; };
    const a = again.addHP(1);
    ok('addHP memanggil hook game saat ronde jalan', healed === 1 && a.healed === 1, a);
    again.onHP = () => 0;                 // HP penuh / belum ronde → hook menolak
    const b = again.addHP(2);
    ok('bila HP penuh → jadi nyawa cadangan', b.healed === 0 && again.lives === 2, { b, lives: again.lives });
    /* akhir ronde */
    again.onHP = null; again.coins = 0;
    const gained = again.finishRound(61);  // 61 * 0.5 = 30.5 -> round = 31
    ok('koin akhir ronde = round(skor × coinsPerScore)', gained === 31 && again.coins === 31, { gained, coins: again.coins });
    again.finishRound(10);
    ok('rekor & jumlah ronde tercatat', again.best === 61 && again.rounds === 2, { best: again.best, rounds: again.rounds });
    again.reset();
    ok('reset membersihkan profil', again.coins === 0 && again.bonusHp === 0 && again.lives === 0, again);
    ok('JSON di storage valid (bukan "[object Object]")', /"coins":0/.test(st.getItem('hideseek_profile')), st.getItem('hideseek_profile'));
    /* storage rusak tidak boleh melempar */
    const bad = mem(); bad.setItem('hideseek_profile', '{rusak');
    ok('storage korosi → profil default, tidak crash', new Profile(bad, {}).coins === 0);
  }

  /* ================== [B] INTEGRASI MAX HP KE ROUND ====================== */
  console.log('\n[B] Round memakai bonus Max HP profil (bonusHpProvider)');
  {
    const st = mem();
    const prof = new Profile(st, {});
    prof.bonusHp = 1;
    const map = buildMap();
    const r = new Round({ map, bonusHpProvider: () => prof.bonusHp });
    r.myId = 1;
    const me = r.add(new PlayerState(1, 'saya', 0));
    const bot = r.add(new PlayerState(2, 'bot', 0));
    r.roundIndex = 0;
    r.start(true);
    ok('maxHp pemain lokal = 3 + bonus', me.maxHp === 4 && me.hp === 4, { max: me.maxHp, hp: me.hp });
    ok('maxHp pemain lain tetap 3', bot.maxHp === 3, bot.maxHp);
    ok('addHP tidak melewati maxHp', me.addHP(9) === 0, me.hp);
    me.hp = 1;
    ok('addHP(1) menyembuhkan (1→2)', me.addHP(1) === 1 && me.hp === 2, me.hp);
    me.ghost = true; me.alive = false; me.hp = 0;
    ok('addHP saat hantu = bangkit dengan 1 HP', me.addHP(1) === 1 && me.hp === 1 && me.ghost === false, { hp: me.hp, g: me.ghost });
    // bonus HP ikut saat ronde berikutnya (auto-restart memakai provider yang sama)
    prof.bonusHp = 2;
    r.start(false);
    ok('ronde baru ikut bonus terbaru', me.maxHp === 5 && bot.maxHp === 3, me.maxHp);
  }

  /* ====================== [C] ADSMANAGER ================================== */
  console.log('\n[C] AdsManager — AppLixir + AdinPlay + mode simulasi + cooldown 30s');
  {
    const cfg = resolveAdsConfig({});
    ok('default testMode = true (aman utk dev)', cfg.testMode === true, cfg.testMode);
    ok('default adCooldownSeconds = 30', cfg.adCooldownSeconds === 30, cfg.adCooldownSeconds);
    ok('key cooldown sesuai spesifikasi: lastAdTime', cfg.cooldownKey === 'lastAdTime', cfg.cooldownKey);
    ok('default placement kosong → simulasi', cfg.appLixirPlacement === '' && cfg.adinPlayPlacement === '', [cfg.appLixirPlacement, cfg.adinPlayPlacement]);
    ok('simulasi default 1.5 detik', ADS_DEFAULTS.simSeconds === 1.5 && Math.abs(cfg.simSeconds - 1.5) < 1e-9, cfg.simSeconds);
    {
      global.window = global; global.location = { search: '?adsTest=0&adsAppLixir=ca-pub-777:reward&adsCooldown=5', origin: 'http://x', pathname: '/game.html' };
      const c2 = resolveAdsConfig({});
      ok('override dari URL (?adsTest/?adsAppLixir/?adsCooldown)', c2.testMode === false && c2.appLixirPlacement === 'ca-pub-777:reward' && c2.adCooldownSeconds === 5, c2);
      global.location = { search: '', origin: 'http://x', pathname: '/game.html' };
    }
    {
      global.window.HIDESEEK_CONFIG = { ads: { appLixirPlacement: 'from_config', adUnits: { extra_life: 'slot_life' } } };
      const c3 = resolveAdsConfig({});
      ok('window.HIDESEEK_CONFIG.ads dipakai (web/config.js)', c3.appLixirPlacement === 'from_config' && c3.adUnits.extra_life === 'slot_life', c3.adUnits);
      const c4 = resolveAdsConfig({ appLixirPlacement: 'argumen' });
      ok('argumen konstruktor menang atas config', c4.appLixirPlacement === 'argumen', c4.appLixirPlacement);
      delete global.window.HIDESEEK_CONFIG;
    }
  }
  /* --- mode simulasi + log sesuai spesifikasi --- */
  {
    const st = mem();
    let pause = 0, resume = 0;
    const ads = new AdsManager({ storage: st, simSeconds: 0.03, testMode: true, game: { pause: () => pause++, resume: () => resume++ } });
    ok('isSimulating true saat testMode', ads.isSimulating === true);
    ok('SDK dianggap tidak ada saat testMode', ads.hasAppLixir() === false && ads.hasAdinPlay() === false);
    const { value: rewarded, lines } = await captureLogs(() => new Promise(res => {
      const started = ads.showRewarded('extra_life', () => res(true), () => res(false));
      if (!started) res('not-started');
    }));
    ok('showRewarded → onRewarded dipanggil (simulasi)', rewarded === true, rewarded);
    ok('log "📺 [SIMULASI] Iklan reward ditonton!" muncul', lines.some(l => l.includes('📺 [SIMULASI] Iklan reward ditonton!')), lines);
    ok('game.pause() lalu game.resume()', pause === 1 && resume === 1, { pause, resume });
    ok('lastAdTime ditulis ke storage', /^\d+$/.test(st.getItem('lastAdTime') || ''), st.getItem('lastAdTime'));
    ok('cooldownLeft ≈ 30 detik', ads.cooldownLeft() > 27 && ads.cooldownLeft() <= 30, ads.cooldownLeft());
    let err = null, reward = false;
    const started2 = ads.showRewarded('bonus_coins', () => { reward = true; }, m => { err = m; });
    ok('iklan kedua DITOLAK saat cooldown', started2 === false && reward === false, { started2, reward });
    ok('pesan "Tunggu X detik lagi"', typeof err === 'string' && /^Tunggu \d+ detik lagi$/.test(err), err);
    ads.resetCooldown();
    ok('resetCooldown() membuka kembali', ads.cooldownLeft() === 0 && ads.showRewarded('bonus_coins', () => { }, () => { }) === true);
    await sleep(40);
    /* busy guard: dua request serentak */
    const ads2 = new AdsManager({ storage: mem(), simSeconds: 0.2 });
    let e2 = null;
    ads2.showRewarded('x', () => { }, () => { });
    const second = ads2.showRewarded('y', () => { }, m => { e2 = m; });
    ok('tidak ada 2 iklan serentak (busy)', second === false && /sedang tayang/.test(String(e2)), { second, e2 });
    ads2.cancelSimulation();
    ok('batalkan simulasi → tidak ada reward', await new Promise(res => { const a3 = new AdsManager({ storage: mem(), simSeconds: 0.2 }); a3.showRewarded('z', () => res(true), () => res(false)); setTimeout(() => { a3.cancelSimulation(); setTimeout(() => res(false), 300); }, 40); }) === false);
    /* cooldown 0 = boleh spam (opsional utk test) */
    const ads3 = new AdsManager({ storage: mem(), simSeconds: 0.02, adCooldownSeconds: 0 });
    const one = await new Promise(res => ads3.showRewarded('a', () => res(true), () => res(false)));
    const two = await new Promise(res => ads3.showRewarded('b', () => res(true), () => res(false)));
    ok('adCooldownSeconds=0 → iklan berikutnya langsung boleh', one === true && two === true, { one, two });
  }
  /* --- jalur AppLixir asli (Google Ad Placement) --- */
  {
    global.window = global;
    const pushed = [];
    global.adsbygoogle = { push: o => pushed.push(o) };
    const st = mem();
    let pause = 0, resume = 0;
    const ads = new AdsManager({
      storage: st, testMode: false, appLixirPlacement: 'rewarded_video',
      adUnits: { extra_life: 'reward_life' },
      game: { pause: () => pause++, resume: () => resume++ },
    });
    ok('hasAppLixir() true bila SDK + placement ada', ads.hasAppLixir() === true);
    const p = new Promise(res => ads.showRewarded('extra_life', () => res('rewarded'), m => res('err:' + m)));
    ok('adBreak di-push dengan type reward', pushed.length === 1 && pushed[0].type === 'reward', pushed[0] && pushed[0].type);
    ok('nama placement per reward dipakai (reward_life)', pushed[0].name === 'reward_life', pushed[0].name);
    pushed[0].beforeAd();
    ok('beforeAd → game.pause()', pause === 1, pause);
    pushed[0].adViewed();
    ok('adViewed → reward diberikan', await p === 'rewarded');
    pushed[0].afterAd();
    ok('afterAd → game.resume()', resume === 1, resume);
    /* dismissed = tanpa reward */
    pushed.length = 0; ads.resetCooldown();
    const p2 = new Promise(res => ads.showRewarded('bonus_coins', () => res('rewarded'), m => res('err:' + m)));
    pushed[0].adDismissed();
    ok('adDismissed → onError, tanpa reward', await p2 === 'err:dismissed', await p2);
    /* fallback: placement default utk reward tak terdaftar */
    pushed.length = 0; ads.resetCooldown();
    const p3 = new Promise(res => ads.showRewarded('skip_cooldown', () => res('ok'), () => res('err')));
    ok('reward tanpa slot khusus → placement default', pushed[0].name === 'rewarded_video', pushed[0] && pushed[0].name);
    pushed[0].adViewed(); await p3;
    /* ID = '' walaupun testMode false → tidak ada SDK utk dipakai → simulasi */
    const ads4 = new AdsManager({ storage: mem(), testMode: false, appLixirPlacement: '', adinPlayPlacement: '', simSeconds: 0.02 });
    ok('ID kosong → tetap jalan (simulasi, tidak error)', await new Promise(res => { const s = ads4.showRewarded('x', () => res(true), () => res(false)); if (!s) res('not-started'); }) === true);
    delete global.adsbygoogle;
  }
  /* --- jalur AdinPlay + urutan fallback --- */
  {
    global.window = global;
    let shownId = null, calls = [];
    global.AdinPlay = {
      rewarded: {
        show: (id, cb) => { shownId = id; calls.push('show'); cb.onAdStarted && cb.onAdStarted(); cb.onRewarded(); cb.onAdFinished && cb.onAdFinished(); },
      },
    };
    const ads = new AdsManager({ storage: mem(), testMode: false, adinPlayPlacement: 'rewarded_placement', adUnits: { bonus_coins: 'adp_coins' } });
    ok('hasAdinPlay() true', ads.hasAdinPlay() === true);
    ok('AppLixir tidak tersedia (SDK adsbygoogle dihapus)', ads.hasAppLixir() === false);
    const got = await new Promise(res => ads.showRewarded('bonus_coins', () => res('rewarded'), m => res('err:' + m)));
    ok('AdinPlay.show dipanggil dgn placement id reward tsb', shownId === 'adp_coins' && got === 'rewarded', { shownId, got });
    ok('callback lifecycle terpanggil', calls[0] === 'show', calls);
    /* urutan bisa dibalik lewat config */
    const ads2 = new AdsManager({ storage: mem(), testMode: false, platformOrder: ['adinplay'], adinPlayPlacement: 'only_adinplay' });
    shownId = null;
    await new Promise(res => ads2.showRewarded('whatever', () => res(1), () => res(0)));
    ok('platformOrder bisa memaksa AdinPlay duluan', shownId === 'only_adinplay', shownId);
    /* onError dari SDK */
    global.AdinPlay = { rewarded: { show: (id, cb) => cb.onError({ message: 'no-fill' }) } };
    const ads3 = new AdsManager({ storage: mem(), testMode: false, adinPlayPlacement: 'x', simSeconds: 0.02 });
    const r3 = await new Promise(res => ads3.showRewarded('e', () => res('rewarded'), m => res('err:' + m)));
    ok('SDK error non-retryable (no-fill) → tanpa reward, tidak auto-farm', r3 === 'err:no-fill', r3);
    delete global.AdinPlay;
  }

  /* ====================== [D] REFERRALSYSTEM ============================== */
  console.log('\n[D] ReferralSystem — kode unik, ?ref=, hadiah, counter pengundang');
  {
    global.window = global;
    const st = mem();
    let rand = 0.5;
    const rs = new ReferralSystem({
      storage: st, baseUrl: 'https://game.com/arcade', codeLength: 7,
      random: () => rand, location: null,
      gameName: 'BUNGLON!',
    });
    const code = rs.getMyReferralCode();
    ok('kode 7 karakter A–Z/0–9', /^[A-Z0-9]{7}$/.test(code), code);
    ok('kode disimpan di localStorage[myReferralCode]', st.getItem('myReferralCode') === code, st.getItem('myReferralCode'));
    ok('kode stabil dipanggil kedua kali', rs.getMyReferralCode() === code);
    rand = 0.999;
    ok('random berbeda → kode berbeda', /^[A-Z0-9]{7}$/.test(rs.generateReferralCode()));
    ok('getReferralLink = base + ?ref=kode', rs.getReferralLink() === 'https://game.com/arcade/?ref=' + code, rs.getReferralLink());
    ok('baseUrl otomatis dari location bila kosong', new ReferralSystem({ storage: mem() }) !== null);
    ok('normalizeCode membersihkan spasi/huruf kecil', ReferralSystem.normalizeCode(' ab12 cd3!') === 'AB12CD3', ReferralSystem.normalizeCode(' ab12 cd3!'));
    ok('isValidCode menolak <6 dan >8', !ReferralSystem.isValidCode('AB12') && !ReferralSystem.isValidCode('ABCD12345') && ReferralSystem.isValidCode('AB12CD3'));
    ok('kode rusak di storage diganti baru', (() => { const s2 = mem(); s2.setItem('myReferralCode', 'xx'); return /^[A-Z0-9]{6,8}$/.test(new ReferralSystem({ storage: s2 }).getMyReferralCode()); })());

    /* hadiah utk yang diundang */
    const st2 = mem();
    const prof = new Profile(st2, {});
    global.location = { search: '?ref=AB12CD34', origin: 'https://game.com', pathname: '/index.html' };
    const rs2 = new ReferralSystem({ storage: st2, player: { addHP: n => prof.addHP(n), addCoins: n => prof.addCoins(n), save: () => prof.save() } });
    ok('getReferrerFromUrl membaca ?ref=', rs2.getReferrerFromUrl() === 'AB12CD34', rs2.getReferrerFromUrl());
    const res = rs2.checkOnLoad();
    ok('hadiah +50 koin & +1 nyawa diberikan', res && res.coins === 50 && res.hp === 1 && res.granted === true, res);
    ok('referrerCode tersimpan', rs2.getReferrerCode() === 'AB12CD34', rs2.getReferrerCode());
    ok('koin masuk profil pemain', prof.coins === 50, prof.coins);
    ok('penyembuhan tercatat (di luar ronde → nyawa cadangan)', prof.lives === 1, { lives: prof.lives, pending: prof.pendingHeal });
    ok('klaim hanya SEKALI', (() => { const r2 = rs2.checkReferralOnLoad(); return r2 === null || r2.granted === false; })());
    ok('referrerCode tidak bisa diubah', rs2.setReferrerCode('ZZZZZZ9') === false && rs2.getReferrerCode() === 'AB12CD34');
    ok('storage key referrerCode sesuai spesifikasi', st2.getItem('referrerCode') === 'AB12CD34');

    /* kode sendiri ditolak */
    const st3 = mem(); st3.setItem('myReferralCode', 'MHN0011');
    global.location = { search: '?ref=MHN0011', origin: 'https://game.com', pathname: '/' };
    const rs3 = new ReferralSystem({ storage: st3, player: null });
    ok('self-referral ditolak', rs3.checkOnLoad().reason === 'self', rs3.checkOnLoad());
    /* kode tidak valid */
    global.location = { search: '?ref=ab', origin: 'https://game.com', pathname: '/' };
    const rs4 = new ReferralSystem({ storage: mem() });
    ok('kode terlalu pendek → invalid', rs4.checkOnLoad().reason === 'invalid', rs4.checkOnLoad());
    /* tanpa parameter */
    global.location = { search: '', origin: 'https://game.com', pathname: '/' };
    ok('tanpa ?ref= → null (tidak ada efek)', new ReferralSystem({ storage: mem() }).checkOnLoad() === null);
    /* hadiah tertahan lalu di-flush */
    const st5 = mem();
    global.location = { search: '?ref=QQWERT12', origin: 'https://game.com', pathname: '/' };
    const prof5 = new Profile(st5, {});
    const rs5 = new ReferralSystem({ storage: st5 });          // player belum ada (game belum init)
    const r5 = rs5.checkOnLoad();
    ok('tanpa player → hadiah ditahan (granted false)', r5.granted === false && rs5.pendingInviteeReward.coins === 50, r5);
    rs5.player = { addHP: n => prof5.addHP(n), addCoins: n => prof5.addCoins(n), save: () => prof5.save() };
    ok('flushPendingRewards menerapkan hadiah tertunda', rs5.flushPendingRewards() === true && prof5.coins === 50, prof5.coins);
    /* counter pengundang */
    const rs6 = new ReferralSystem({ storage: mem(), coinsForInviter: 100 });
    const note = [];
    rs6.notify = m => note.push(m);
    ok('recordIncomingReferral → counter +1', rs6.recordIncomingReferral() === 1);
    rs6.recordIncomingReferral(2);
    ok('counter kumulatif = 3 & pendingCoins 300', rs6.getReferralBonus() === 3 && rs6.getPendingCoins() === 300, rs6.getStats());
    ok('notifikasi "+100 Koin"', note.some(n => /Kamu berhasil mengundang teman! \+100 Koin!/.test(n)), note);
    /* clipboard */
    let copied = null;
    const navDesc = Object.getOwnPropertyDescriptor(global, 'navigator');
    Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: t => { copied = t; return Promise.resolve(); } } }, configurable: true, writable: true });
    const okc = await rs6.copyReferralLink();
    if (navDesc) Object.defineProperty(global, 'navigator', navDesc); else delete global.navigator;
    ok('copyReferralLink memakai navigator.clipboard', okc === true && /\?ref=$/.test(copied) === false && copied.includes('?ref='), copied);
    ok('getStats lengkap', (() => { const st = rs6.getStats(); return st.code && st.link.includes('?ref=') && st.invited === 3; })(), rs6.getStats());
    /* tanpa DOM: modal & popup harus aman (tidak melempar) */
    ok('showInviteModal tanpa document → null, tidak crash', (() => { try { return new ReferralSystem({ storage: mem() }).showInviteModal() === null; } catch (e) { return 'throw:' + e.message; } })());
    /* reset */
    const st7 = mem(); const rs7 = new ReferralSystem({ storage: st7 }); rs7.getMyReferralCode(); rs7.reset();
    ok('reset() menghapus semua key referral', st7.getItem('myReferralCode') === null, [...st7._m.keys()]);
  }

  /* ====================== [E] WIRING DI GAME + HTML ======================= */
  console.log('\n[E] integrasi index.html / game.js / config');
  {
    const html = rd('web/index.html');
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
    const at = f => scripts.indexOf(f);
    ok('urutan script: config → uiKit/audio → adsManager → referralSystem → game.js',
      at('config.example.js') === 0 && at('config.js') === 1 && at('uiKit.js') === 2 && at('audioKit.js') === 3 &&
      at('adsManager.js') === 4 && at('referralSystem.js') === 5 && at('game.js') === 6, scripts);
    ok('config.js dimuat (opsional, onerror) setelah contoh template', /<script src="config\.js" onerror=/.test(html));
    for (const id of ['adLifeBtn', 'adCoinsBtn', 'inviteBtn', 'inviteLobbyBtn', 'coins', 'lives', 'maxhpTag', 'buyHpBtn', 'buyLifeBtn', 'pauseTag', 'referralModal']) {
      if (id === 'referralModal') continue;                       // dibuat runtime oleh referralSystem.js
      ok(`elemen #${id} ada di index.html`, new RegExp('id="' + id + '"').test(html), id);
    }
    const js = rd('web/game.js');
    ok('tombol "+1 Nyawa" memanggil placement extra_life', /runAd\('extra_life'/.test(js));
    ok('tombol "Dapatkan Koin" memanggil placement bonus_coins', /runAd\('bonus_coins'/.test(js) && /addCoins\(50\)/.test(js));
    ok('reward internal dipetakan ke placement iklan (revive/skip/frenzy)', /revive: \['extra_life'/.test(js) && /skip: \['skip_cooldown'/.test(js) && /frenzy: \['frenzy'/.test(js));
    ok('permainan dijeda saat iklan (frame() cek metaPaused)', /if \(metaPaused\)/.test(js) && /pause\(\) \{ metaPaused = true/.test(js));
    ok('checkOnLoad() dipanggil saat start game', /referral\.checkOnLoad\(\)/.test(js));
    ok('nyawa cadangan dipakai otomatis sebelum jadi hantu', /profile\.consumeLife\(\)/.test(js));
    ok('saveGame/updateUI tersedia utk integrasi (spec)', /saveGame\(\) \{ profile\.save\(\)/.test(js) && /function updateUI\(\)/.test(js));
    ok('window.hideSeekGame & hideSeekReferral diekspos (debug)', /window\.hideSeekGame = gameAPI/.test(js) && /window\.hideSeekReferral = referral/.test(js));
    /* semua id yang dipakai kode baru ada di HTML */
    const ids = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
    const used = [...js.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]);
    const missing = [...new Set(used)].filter(i => !ids.has(i));
    ok(`${new Set(used).size} id dipakai game.js, 0 hilang`, missing.length === 0, missing);
    const cfgEx = rd('web/config.example.js');
    ok('config.example.js menyetel window.HIDESEEK_CONFIG (ads+referral+economy)',
      /window\.HIDESEEK_CONFIG/.test(cfgEx) && /applixir/i.test(cfgEx) && /referral/.test(cfgEx) && /economy/.test(cfgEx));
    const gi = rd('.gitignore');
    ok('web/config.js di-gitignore (ID tidak masuk repo)', /^web\/config\.js$/m.test(gi), gi.match(/^web.*$/m));
    ok('.env di-gitignore', /^\.env$/m.test(gi), gi.match(/^\.env.*$/m));
    ok('.env.example dicontohkan dgn kunci lengkap', /APPLIXIR_PLACEMENT=/.test(rd('.env.example')) && /ADINPLAY_PLACEMENT=/.test(rd('.env.example')) && /ADS_TEST_MODE=/.test(rd('.env.example')));
    ok('tidak ada ID iklan asli di file yang di-commit', !/(ca-pub-[0-9]{6,}|AIza[0-9A-Za-z_-]{10,})/.test([rd('web/game.js'), rd('web/adsManager.js'), rd('web/config.example.js'), rd('web/index.html')].join('\n')));
  }

  /* ====================== [F] .env -> web/config.js ======================= */
  console.log('\n[F] tools/gen_web_config.js — kunci dari .env/config, bukan dari kode');
  {
    const tmp = path.join(ROOT, '.env.test_ads');
    fs.writeFileSync(tmp, [
      '# komentar',
      'APPLIXIR_PLACEMENT=ca-pub-1234:reward_main',
      'ADINPLAY_PLACEMENT="placement_5678"',
      'APPLIXIR_AD_UNITS=extra_life:slot_life,bonus_coins:slot_coins',
      'ADS_TEST_MODE=false   # trailing comment',
      'ADS_COOLDOWN_SECONDS=45',
      'REFERRAL_BASE_URL=https://game.com/hs',
      'REFERRAL_COINS_INVITER=150',
      '',
    ].join('\n'));
    const out = execFileSync('node', [path.join(ROOT, 'tools/gen_web_config.js'), '--env', '.env.test_ads', '--out', 'web/config.test_ads.js'], { cwd: ROOT, encoding: 'utf8' });
    const txt = rd('web/config.test_ads.js');
    const cfg = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    ok('APPLIXIR_PLACEMENT terbaca', cfg.ads.appLixirPlacement === 'ca-pub-1234:reward_main', cfg.ads.appLixirPlacement);
    ok('kutip ganda dibersihkan (AdinPlay)', cfg.ads.adinPlayPlacement === 'placement_5678', cfg.ads.adinPlayPlacement);
    ok('AD_UNITS diurai jadi map', cfg.ads.adUnits.extra_life === 'slot_life' && cfg.ads.adUnits.bonus_coins === 'slot_coins', cfg.ads.adUnits);
    ok('ADS_TEST_MODE=false + komentar akhir baris diabaikan', cfg.ads.testMode === false, cfg.ads.testMode);
    ok('ADS_COOLDOWN_SECONDS numeric', cfg.ads.adCooldownSeconds === 45, cfg.ads.adCooldownSeconds);
    ok('referral ikut ter-generate', cfg.referral.baseUrl === 'https://game.com/hs' && cfg.referral.coinsForInviter === 150, cfg.referral);
    ok('hasilnya script window.HIDESEEK_CONFIG', /^window\.HIDESEEK_CONFIG = /m.test(txt.replace(/\/\*[\s\S]*?\*\//, '').trim()));
    /* AdsManager harus benar-benar memakai config hasil generate tsb */
    global.window = global;
    global.window.HIDESEEK_CONFIG = cfg;
    const ads = new AdsManager({ storage: mem() });
    ok('AdsManager membaca config generate (testMode & cooldown & slot)',
      ads.cfg.testMode === false && ads.cfg.adCooldownSeconds === 45 && ads.resolvePlacement('extra_life').applixir === 'slot_life', ads.cfg);
    delete global.window.HIDESEEK_CONFIG;
    fs.unlinkSync(tmp); fs.unlinkSync(path.join(ROOT, 'web/config.test_ads.js'));
    ok('artefak test dibersihkan', !fs.existsSync(tmp));
    /* tanpa .env: tetap bisa dipakai (simulasi) */
    const out2 = execFileSync('node', [path.join(ROOT, 'tools/gen_web_config.js'), '--env', '.env.tidak-ada', '--print'], { cwd: ROOT, encoding: 'utf8' });
    ok('tanpa .env → preview config default (testMode true)', /"testMode": true/.test(out2), out2.split('\n').slice(0, 3));
  }

  console.log(`\n=== web_ads_referral_test: ${pass} PASS, ${fail} FAIL ===`);
  process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error('\x1b[31mEXCEPTION\x1b[0m', e && e.stack || e); process.exitCode = 1; });

/* =============================================================================
 * adsManager.js — Rewarded video untuk build web (vanilla JS, tanpa dependency)
 * -----------------------------------------------------------------------------
 * 2 platform didukung + 1 jalur simulasi:
 *   • AppLixir  = Google Ad Placement API (`adsbygoogle` / ad break `type:'reward'`)
 *   • AdinPlay  = `window.AdinPlay.rewarded.show(placementId, { onRewarded, onError })`
 *   • Simulasi  = dipakai bila ID kosong / SDK tidak ada / testMode=true (delay 1.5 dtk)
 *
 * Semua ID/placement TIDAK ditulis di file ini — diambil dari config (lihat
 * resolveAdsConfig): window.HIDESEEK_CONFIG.ads (dihasilkan web/config.js dari .env
 * oleh tools/gen_web_config.js) -> override URL (?adsAppLixir=…&adsAdinPlay=…)
 * -> default di bawah. Jadi kunci 2 platform cukup disimpan di .env / config.
 *
 * Cara pakai (singkat):
 *   const ads = new AdsManager({ game, testMode: true });
 *   ads.showRewarded('extra_life',  () => player.addHP(1));
 *   ads.showRewarded('bonus_coins', () => player.addCoins(50));
 *
 * Diuji headless oleh tools/web_ads_referral_test.js.
 * ========================================================================== */
'use strict';

/* ------------------------------- default config ---------------------------- */
const ADS_DEFAULTS = {
  // Urutan percobaan. Platform pertama gagal/tidak ada -> fallback ke berikutnya.
  platformOrder: ['applixir', 'adinplay'],
  appLixirPlacement: '',        // nama ad-break AppLixir/Google Ad Placement (mis. 'rewarded_video')
  adinPlayPlacement: '',        // placement id AdinPlay (mis. 'rewarded_placement')
  adUnits: {},                  // override per reward: { extra_life: 'slot-…', bonus_coins: 'slot-…' }
  testMode: true,               // true = selalu simulasi (aman untuk dev) ; false = pakai SDK asli
  adCooldownSeconds: 30,        // jeda minimum antar iklan (global, disimpan di localStorage)
  simSeconds: 1.5,              // durasi iklan palsu saat mode simulasi
  adTimeoutSeconds: 20,         // tidak ada callback dari SDK -> anggap no-fill, fallback
  cooldownKey: 'lastAdTime',    // key localStorage sesuai spesifikasi
  logPrefix: '📺 [ADS]',
};

/* ------------------------------- storage helper ---------------------------- */
// localStorage bisa tidak ada (node test, mode privat) -> fallback map in-memory.
function makeStorage(injected) {
  if (injected && typeof injected.getItem === 'function' && typeof injected.setItem === 'function') return injected;
  if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

/* --------------------------- config resolution ----------------------------- */
/**
 * Susun konfigurasi dengan prioritas: default < window.HIDESEEK_CONFIG.ads < URL
 * (?adsAppLixir, ?adsAdinPlay, ?adsTest, ?adsCooldown) < argumen konstruktor.
 * @param {object} override opsi dari pemanggil (game.js / index.html)
 */
function resolveAdsConfig(override) {
  const cfg = Object.assign({}, ADS_DEFAULTS);
  const fromGlobal = (typeof window !== 'undefined' && window.HIDESEEK_CONFIG && window.HIDESEEK_CONFIG.ads) || null;
  if (fromGlobal) Object.assign(cfg, fromGlobal);
  const q = readUrlOverrides();
  Object.assign(cfg, q, override || {});
  // "true"/"false" dari URL / .env berbentuk string -> dinormalkan
  cfg.testMode = normalizeBool(cfg.testMode, true);
  cfg.adCooldownSeconds = Math.max(0, Number(cfg.adCooldownSeconds) || 0);
  cfg.simSeconds = Math.max(0.05, Number(cfg.simSeconds) || ADS_DEFAULTS.simSeconds);
  cfg.adUnits = Object.assign({}, (fromGlobal && fromGlobal.adUnits) || {}, (override && override.adUnits) || {});
  cfg.platformOrder = (Array.isArray(cfg.platformOrder) && cfg.platformOrder.length ? cfg.platformOrder : ADS_DEFAULTS.platformOrder).slice();
  return cfg;
}
function normalizeBool(v, dflt) {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return dflt;
}
function readUrlOverrides() {
  const out = {};
  try {
    const usp = (typeof location !== 'undefined' && location.search) ? new URLSearchParams(location.search) : null;
    if (!usp) return out;
    if (usp.get('adsAppLixir')) out.appLixirPlacement = usp.get('adsAppLixir');
    if (usp.get('adsAdinPlay')) out.adinPlayPlacement = usp.get('adsAdinPlay');
    if (usp.has('adsTest')) out.testMode = usp.get('adsTest');
    if (usp.get('adsCooldown')) out.adCooldownSeconds = usp.get('adsCooldown');
    if (usp.get('adsSim')) out.simSeconds = usp.get('adsSim');
  } catch (e) { /* URLSearchParams tanpa query = aman */ }
  return out;
}

/* =============================================================================
 * AdsManager
 * ========================================================================== */
class AdsManager {
  /**
   * @param {object} config { appLixirPlacement, adinPlayPlacement, adUnits, testMode,
   *                          adCooldownSeconds, simSeconds, adTimeoutSeconds,
   *                          game  -> opsional { pause(), resume() } untuk jeda permainan,
   *                          overlay -> opsional { show(title), progress(k), hide(), notify(msg) },
   *                          storage -> opsional storage adapter (default: localStorage) }
   */
  constructor(config = {}) {
    this.cfg = resolveAdsConfig(config);
    this.game = config.game || null;
    this.overlay = config.overlay || null;
    this.storage = makeStorage(config.storage);
    this.busy = false;
    this.lastError = null;
    this.shownCount = 0;
    this.simTimer = null;
  }

  /* ---------------------------- small utilities ---------------------------- */
  log(msg) { try { console.log(`${this.cfg.logPrefix} ${msg}`); } catch (e) { /* tanpa console */ } }
  /** Pesan singkat ke pemain (toast game kalau ada, kalau tidak: console). */
  notify(msg) {
    if (this.overlay && typeof this.overlay.notify === 'function') this.overlay.notify(msg);
    else this.log(msg);
  }
  /** Slot iklan utk reward tertentu; fallback ke placement default. */
  /** Alasan error yang berarti "platform ini tidak bisa dipakai" -> layak fallback. */
  isUnavailable(why) { return /(no-sdk|tidak tersedia|unavailable|not +loaded|not +found|blocked|script|load fail|undefined)/i.test(String(why || '')); }

  resolvePlacement(rewardName) {
    const units = this.cfg.adUnits || {};
    const per = rewardName ? units[rewardName] : null;
    const flat = typeof per === 'string' ? per : '';     // string => dipakai kedua platform
    return {
      name: rewardName || 'rewarded_video',
      applixir: (per && per.applixir) || flat || this.cfg.appLixirPlacement || '',
      adinplay: (per && per.adinplay) || flat || this.cfg.adinPlayPlacement || '',
    };
  }
  /** Sisa cooldown global dalam detik (0 = boleh tampil). */
  cooldownLeft() {
    const raw = this.storage.getItem(this.cfg.cooldownKey);
    if (!raw) return 0;
    const last = Number(raw);
    if (!isFinite(last) || last <= 0) return 0;
    const left = (last + this.cfg.adCooldownSeconds * 1000 - Date.now()) / 1000;
    return left > 0 ? Math.ceil(left) : 0;
  }
  /** CATATAN: dicatat saat iklan DIMULAI (bukan saat selesai) supaya spam ditahan. */
  markAdShown(atMs) { try { this.storage.setItem(this.cfg.cooldownKey, String(atMs || Date.now())); } catch (e) { /* storage penuh */ } }
  resetCooldown() { try { this.storage.removeItem(this.cfg.cooldownKey); } catch (e) { /* noop */ } }
  get isSimulating() { return this.cfg.testMode || (!this.hasAppLixir() && !this.hasAdinPlay()); }

  /** SDK AppLixir (Google Ad Placement) tersedia? */
  hasAppLixir() {
    if (this.cfg.testMode) return false;
    const ag = typeof window !== 'undefined' && window.adsbygoogle;
    return !!(ag && typeof ag.push === 'function') && !!this.cfg.appLixirPlacement;
  }
  /** SDK AdinPlay tersedia? */
  hasAdinPlay() {
    if (this.cfg.testMode) return false;
    const ap = typeof window !== 'undefined' && window.AdinPlay && window.AdinPlay.rewarded;
    return !!(ap && typeof ap.show === 'function') && !!this.cfg.adinPlayPlacement;
  }

  /* ------------------------------ main entry ------------------------------- */
  /**
   * Tampilkan rewarded video. Platform utama dicoba dulu, lalu fallback.
   * @param {string}   placementName  nama reward/logical placement ('extra_life', 'bonus_coins', …)
   * @param {Function} onRewarded     dipanggil HANYA bila iklan selesai ditonton
   * @param {Function} onError        dipanggil bila ditutup / gagal / sedang cooldown; arg (message)
   * @returns {boolean} true bila tayang (atau simulasi) dimulai
   */
  showRewarded(placementName, onRewarded, onError) {
    const done = typeof onRewarded === 'function' ? onRewarded : () => { };
    const fail = typeof onError === 'function' ? onError : (m) => this.log('gagal: ' + m);

    if (this.busy) { fail('iklan sedang tayang'); return false; }
    const left = this.cooldownLeft();
    if (left > 0) {
      const msg = `Tunggu ${left} detik lagi`;
      this.notify(msg); fail(msg);
      return false;
    }

    this.busy = true;
    this.lastError = null;
    this.markAdShown();
    const slot = this.resolvePlacement(placementName);

    // urutan: applixir -> adinplay -> (kalau dua-duanya tidak ada) simulasi
    const chain = this.cfg.platformOrder.slice();
    let finished = false, tried = 0;
    const finish = (okFlag, why) => {
      if (finished) return;                       // guard: SDK kadang memanggil 2x
      finished = true;
      this.busy = false;
      if (okFlag === true || okFlag === undefined) { this.log(`${slot.name} ✔ reward diberikan`); done(); }
      else { this.lastError = why || 'dismissed'; fail(this.lastError); }
    };
    // Hanya masalah "SDK tidak bisa dipakai" yang boleh jatuh ke platform berikutnya
    // (dan berakhir ke simulasi). No-fill / ditutup pengguna = selesai tanpa reward.
    const retry = (why) => {
      if (finished) return;
      this.log(`${slot.name}: ${why || 'unavailable'} -> coba platform berikutnya`);
      next();
    };
    const grant = () => finish(true);
    const deny = (why) => (this.isUnavailable(why) && tried < chain.length + 1) ? retry(why) : finish(false, why);
    const next = () => {
      const p = chain.shift();
      if (!p) { this._simulate(slot.name, grant, (why) => finish(false, why)); return; }
      tried++;
      if (p === 'applixir' && this.hasAppLixir()) this.showRewardedAppLixir(slot.applixir, grant, deny);
      else if (p === 'adinplay' && this.hasAdinPlay()) this.showRewardedAdinPlay(slot.adinplay, grant, deny);
      else retry('sdk ' + p + ' tidak tersedia');
    };
    next();
    return true;
  }

  /**
   * AppLixir = Google Ad Placement API (ad break type 'reward').
   * Dipanggil hanya bila SDK-nya ada; kalau tidak, showRewarded() yang menangani fallback.
   */
  showRewardedAppLixir(placementName, onRewarded, onError) {
    const ok = () => onRewarded(), bad = (m) => onError(m || 'error');
    if (typeof window === 'undefined' || !window.adsbygoogle || typeof window.adsbygoogle.push !== 'function') {
      bad('no-sdk'); return false;
    }
    window.adsbygoogle = window.adsbygoogle || [];
    // Dokumentasi Google menulis `const adBreak = adConfig = (o) => …`; assignment ke
    // variabel bebas itu melempar TypeError di 'use strict', jadi dibuat eksplisit di window.
    const adBreak = (window.adConfig = (o) => { window.adsbygoogle.push(o); });
    let settled = false;
    const settle = (good, why) => { if (settled) return; settled = true; clearTimeout(timer); good ? ok() : bad(why || 'dismissed'); };
    const timer = setTimeout(() => settle(false, 'timeout'), Math.max(1, this.cfg.adTimeoutSeconds) * 1000);
    adBreak({
      type: 'reward',
      name: placementName || this.cfg.appLixirPlacement,
      beforeAd: () => { this.log('beforeAd → game.pause()'); if (this.game && this.game.pause) this.game.pause(); this._overlayShow(placementName); },
      afterAd: () => { this.log('afterAd → game.resume()'); if (this.game && this.game.resume) this.game.resume(); this._overlayHide(); },
      adViewed: () => settle(true),
      adDismissed: () => settle(false, 'dismissed'),
      adBreakDone: (info) => {
        const st = info && info.breakStatus ? String(info.breakStatus) : '';
        if (st && /no.?fill|unavailable|error/i.test(st)) settle(false, 'no-fill: ' + st);   // non-retryable by design
      },
    });
    this.shownCount++;
    return true;
  }

  /**
   * AdinPlay rewarded. Placeholder: SDK web-nya di-load host (Cocos/HTML5 wrapper)
   * dan mengekspos window.AdinPlay.rewarded.show(placementId, callbacks).
   */
  showRewardedAdinPlay(placementId, onRewarded, onError) {
    const ok = () => onRewarded(), bad = (m) => onError(m || 'error');
    if (typeof window === 'undefined' || !window.AdinPlay || !window.AdinPlay.rewarded || typeof window.AdinPlay.rewarded.show !== 'function') {
      bad('no-sdk'); return false;
    }
    let settled = false;
    const settle = (good, why) => { if (settled) return; settled = true; good ? ok() : bad(why || 'dismissed'); };
    window.AdinPlay.rewarded.show(placementId || this.cfg.adinPlayPlacement, {
      onRewarded: () => settle(true),
      onError: (e) => settle(false, (e && e.message) || 'error'),
      onClose: () => settle(false, 'closed'),
      onAdStarted: () => { this.log('AdinPlay onAdStarted → game.pause()'); if (this.game && this.game.pause) this.game.pause(); },
      onAdFinished: () => { if (this.game && this.game.resume) this.game.resume(); },
    });
    this.shownCount++;
    return true;
  }

  /* ----------------------------- simulasi (dev) ---------------------------- */
  /**
   * Jalur development: delay this.cfg.simSeconds (default 1.5 dtk) lalu beri reward.
   * Tidak butuh SDK/network sama sekali.
   */
  simulate(label, onRewarded) { this._simulate(label || 'simulasi', onRewarded, () => { }); }
  _simulate(label, onRewarded, onError) {
    const ms = Math.max(10, this.cfg.simSeconds * 1000);
    this.log(`mode simulasi (${label}) ${this.cfg.simSeconds}s — SDK iklan tidak dipakai`);
    console.log('📺 [SIMULASI] Iklan reward ditonton!');
    this._overlayShow(label, ms);
    const finish = (good, why) => {
      if (this.simTimer) { clearTimeout(this.simTimer); this.simTimer = null; }
      this._overlayHide();
      if (this.game && this.game.resume) this.game.resume();
      this.busy = false;
      good ? onRewarded(true) : onError(why || 'dismissed');
    };
    if (this.game && this.game.pause) this.game.pause();
    // Dijalankan dengan rAF bila ada (biar progress bar jalan), kalau tidak: setTimeout.
    const t0 = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      if (this.overlay && this.overlay.progress) this.overlay.progress(k);
      if (k >= 1) { finish(true); return; }
      this.simTimer = setTimeout(step, 16);
    };
    this.simTimer = setTimeout(step, 16);
    this._cancelSim = () => finish(false, 'dismissed');       // dipakai tombol "batalkan"
    this.shownCount++;
  }
  /** Batalkan simulasi/iklan yang sedang tayang (mis. pemain menekan ESC). */
  cancelSimulation() { if (this._cancelSim) { const f = this._cancelSim; this._cancelSim = null; f(); } }
  /** Alias (tombol "Lewati" di UI). Membatalkan tanpa memberi reward. */
  skipSimulation() { return this.cancelSimulation(); }

  /* --------------------------- overlay wiring ------------------------------ */
  _overlayShow(label, ms) { if (this.overlay && this.overlay.show) this.overlay.show(label, ms); }
  _overlayHide() { if (this.overlay && this.overlay.hide) this.overlay.hide(); if (this._cancelSim) this._cancelSim = null; }
}

/* ------------------------------- exports ---------------------------------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AdsManager, resolveAdsConfig, ADS_DEFAULTS };
}
if (typeof window !== 'undefined') {
  window.AdsManager = AdsManager;
  window.resolveAdsConfig = resolveAdsConfig;
  // Praktis utk konsol debugging: hideseekAdsCfg() menunjukkan config efektif.
  window.hideseekAdsCfg = () => resolveAdsConfig({});
}

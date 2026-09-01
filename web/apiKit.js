/* =============================================================================
 * apiKit.js — klien backend akun (JWT) + referral + teman, vanilla, 0 dependency
 * -----------------------------------------------------------------------------
 * Pasangannya server/api.js. Semua metode async dan TIDAK pernah melempar:
 * kalau server mati / offline, pemanggil cukup melihat `{ok:false, offline:true}`
 * sehingga game tetap bisa dimainkan (mode lokal penuh seperti sebelumnya).
 *
 *   const api = new BungAPI.Client({});          // baseUrl default: origin yang sama
 *   await api.health();                           // server ada?
 *   await api.signup({name, user, pass, ref});     -> {ok, token, user}
 *   await api.login({user, pass, migrate});        -> {ok, token, user}
 *   await api.me();                               -> {ok, user}
 *   await api.sync({coins,xp,best,rounds,lives});  -> {ok, user}
 *   await api.referral();  await api.claimReferral(code)
 *   await api.findPlayer('1048293'); await api.addFriend(id); await api.friends();
 *   await api.acceptFriend(reqId, true); await api.removeFriend(id)
 *   await api.adReward('bonus_coins', nonce); await api.announceRoom('K9ZM')
 *   await api.leaderboard(10)
 *
 * Sesi disimpan di localStorage: 'hideseek_jwt' (token) + 'hideseek_user' (cache profil).
 * ========================================================================== */
'use strict';

const KEYS = { token: 'hideseek_jwt', user: 'hideseek_user' };

/** localStorage bisa tidak ada (node test, mode privat) -> map in-memory. */
function makeStore(injected) {
  if (injected && typeof injected.getItem === 'function') return injected;
  if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

class ApiClient {
  /**
   * @param {object} cfg {baseUrl='', storage, fetch (injeksi utk test), timeoutMs=6000,
   *                       onChange(user) dipanggil tiap profil berubah, notify(msg)}
   */
  constructor(cfg = {}) {
    this.cfg = Object.assign({ baseUrl: '', timeoutMs: 6000 }, cfg || {});
    this.store = makeStore(cfg && cfg.storage);
    this._fetch = (cfg && cfg.fetch) || (typeof fetch === 'function' ? fetch.bind(typeof globalThis !== 'undefined' ? globalThis : this) : null);
    this.onChange = (cfg && cfg.onChange) || null;
    this.notify = (cfg && cfg.notify) || (() => { });
    this.online = false;             // server reachable (health)
    this.checked = false;
    this.user = this._readUser();
    this.token = this.store.getItem(KEYS.token) || '';
    this.pendingRef = '';            // ?ref= yang belum sempat dikirim ke server
  }

  /* ------------------------------ penyimpanan ------------------------------ */
  _readUser() { try { return JSON.parse(this.store.getItem(KEYS.user) || 'null') || null; } catch (e) { return null; } }
  /** Simpan token+profil; memanggil onChange supaya HUD ikut ter-update. */
  setSession(token, user) {
    if (token) { this.token = token; try { this.store.setItem(KEYS.token, token); } catch (e) { } }
    if (user) { this.user = user; try { this.store.setItem(KEYS.user, JSON.stringify(user)); } catch (e) { } }
    if (this.onChange) { try { this.onChange(this.user); } catch (e) { } }
    return this.user;
  }
  /** Keluar: token dibuang (JWT stateless -> tidak ada yang perlu di-invalidate di sini). */
  logout() {
    this.token = ''; this.user = null; this.setSession('', null);
    try { this.store.removeItem(KEYS.token); this.store.removeItem(KEYS.user); } catch (e) { }
    return true;
  }
  get loggedIn() { return !!(this.token && this.user); }

  /* --------------------------------- HTTP ---------------------------------- */
  /** Satu titik panggilan: timeout + JSON + error terbungkus (tidak pernah throw). */
  async _call(method, path, body, opt = {}) {
    if (!this._fetch) return { ok: false, offline: true, error: 'fetch tidak tersedia' };
    const url = (this.cfg.baseUrl || '') + path;
    const headers = { 'content-type': 'application/json' };
    if (this.token && opt.auth !== false) headers.authorization = 'Bearer ' + this.token;
    let timer = null;
    try {
      const p = this._fetch(url, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'omit',
      });
      const timeout = new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error('timeout')), Math.max(500, this.cfg.timeoutMs | 0));
        if (timer && timer.unref) timer.unref();
      });
      const res = await Promise.race([p, timeout]);
      clearTimeout(timer); timer = null;
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: 'respons bukan JSON (' + res.status + ')' }; }
      this.online = res.status < 500; this.checked = true;
      if (!res.ok) {
        // token kedaluwarsa/salah -> sesi dibuang supaya UI bisa minta login ulang
        if (res.status === 401 && opt.auth !== false) this.logout();
        return Object.assign({ ok: false, status: res.status }, data || {});
      }
      if (data && data.user) this.setSession(opt.keepToken ? '' : this.token, data.user);
      return Object.assign({ ok: true, status: res.status }, data || {});
    } catch (e) {
      if (timer) clearTimeout(timer);
      this.online = false; this.checked = true;
      return { ok: false, offline: true, error: String((e && e.message) || 'offline') };
    }
  }
  get(path, opt) { return this._call('GET', '/api/' + path, undefined, opt); }
  post(path, body, opt) { return this._call('POST', '/api/' + path, body || {}, opt); }

  /* --------------------------------- akun ----------------------------------- */
  /** Cek apakah server akun tersedia (dipanggil sekali saat boot; murah). */
  async health() {
    const r = await this.get('health', { auth: false });
    this.online = !!r.ok; this.checked = true;
    if (r.ok) this.info = r;
    return r;
  }
  async signup(input) {
    const b = {
      name: String((input && input.name) || '').slice(0, 16),
      user: String((input && input.user) || '').trim(),
      pass: String((input && input.pass) || ''),
      ref: (input && (input.ref || this.pendingRef)) || '',
    };
    const r = await this.post('signup', b, { auth: false });
    if (r.ok && r.token) { this.setSession(r.token, r.user); this.pendingRef = ''; }
    return r;
  }
  /**
   * Login. `migrate` = ringkasan profil lokal (coins/xp/best/rounds/lives/ref)
   * yang boleh menaikkan nilai di server, tidak pernah menurunkannya.
   */
  async login(input, migrate) {
    const r = await this.post('login', {
      user: String((input && input.user) || '').trim(),
      pass: String((input && input.pass) || ''),
      migrate: migrate || undefined,
    }, { auth: false });
    if (r.ok && r.token) this.setSession(r.token, r.user);
    return r;
  }
  /** Profil terbaru dari server (dipakai saat panel akun dibuka / auto-refresh). */
  me() { return this.get('me'); }
  /** Pulihkan sesi dari token tersimpan (dipanggil saat game mulai). */
  async restore() {
    if (!this.token) return { ok: false, error: 'belum pernah login' };
    const r = await this.get('me');
    return r.ok ? (this.setSession(this.token, r.user), r) : r;
  }
  /** Kirim progres lokal ke server (dipanggil saat selesai ronde / ganti koin). */
  sync(profile) {
    const p = profile || {};
    return this.post('sync', {
      coins: p.coins | 0, xp: p.xp | 0, lives: p.lives | 0, bonusHp: p.bonusHp | 0,
      best: p.best | 0, rounds: p.rounds | 0, name: p.name || undefined,
    });
  }

  /* ------------------------------- referral -------------------------------- */
  referral() { return this.get('referral'); }
  claimReferral(code) { return this.post('referral/claim', { ref: code }); }

  /* ------------------------------ teman / ID ------------------------------- */
  findPlayer(gameId) { return this.post('friends/find', { gameId: String(gameId || '').trim() }); }
  addFriend(gameId) { return this.post('friends/request', { gameId: String(gameId || '').trim() }); }
  friends() { return this.get('friends'); }
  acceptFriend(reqId, accept = true) { return this.post('friends/respond', { reqId, accept: !!accept }); }
  removeFriend(gameId) { return this.post('friends/remove', { gameId: String(gameId || '').trim() }); }
  announceRoom(room) { return this.post('room', { room: room || '' }); }

  /* --------------------------------- iklan ---------------------------------- */
  /**
   * Laporkan iklan yang selesai ditonton. Server memvalidasi cooldown + memberi
   * grant (koin/nyawa) sehingga tidak bisa digandakan lewat refresh.
   * @param {string} kind 'bonus_coins' | 'extra_life' | ...
   * @param {string} nonce id unik utk tayangan iklan ini
   */
  adReward(kind, nonce) { return this.post('ads/reward', { kind, nonce }); }
  adState() { return this.get('ads/state'); }

  /* ------------------------------- leaderboard ------------------------------ */
  leaderboard(limit) { return this.get('leaderboard?limit=' + (limit ? (limit | 0) : 10), { auth: false }); }

  /* --------------------------------- format --------------------------------- */
  /** '1048293' -> '104 8293' (mudah dibacakan); menerima input dengan spasi/tanda. */
  static fmtGameId(id) {
    const d = String(id || '').replace(/\D/g, '');
    return d.length === 7 ? d.slice(0, 3) + ' ' + d.slice(3) : d;
  }
  static digitsOnly(id) { return String(id || '').replace(/\D/g, ''); }
  /** Umur "terakhir terlihat" dalam teks pendek. */
  static agoLabel(sec) {
    const s = Math.max(0, sec | 0);
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    return Math.floor(s / 86400) + ' hari lalu';
  }
}

/* ------------------------------- exports ---------------------------------- */
if (typeof module !== 'undefined' && module.exports) module.exports = { ApiClient, KEYS, makeStore };
if (typeof window !== 'undefined') {
  window.BungAPI = { ApiClient, KEYS };
  /** Helper utk game.js: pakai baseUrl dari HIDESEEK_CONFIG.api.baseUrl bila ada. */
  window.createApiClient = (extra) => {
    const fromCfg = (typeof window !== 'undefined' && window.HIDESEEK_CONFIG && window.HIDESEEK_CONFIG.api) || {};
    return new ApiClient(Object.assign({}, fromCfg, extra || {}));
  };
}

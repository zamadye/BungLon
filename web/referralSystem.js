/* =============================================================================
 * referralSystem.js — "Undang Teman" (vanilla JS, tanpa backend dulu)
 * -----------------------------------------------------------------------------
 * Mekanisme:
 *   • tiap pemain punya kode unik 7 karakter A–Z/0–9 di localStorage['myReferralCode']
 *   • link = baseUrl + '/?ref=KODE'  (salin via clipboard, atau share bila didukung)
 *   • pengunjung dengan ?ref= menerima +50 Koin & +1 Nyawa (sekali, lalu dikunci)
 *   • pengundang: counter lokal 'referralBonus' untuk feedback instan, dan sejak
 *     v2.3 ada ADAPTER SERVER (setServer) -> +100 Koin dibayar backend
 *     server/api.js saat akun baru mendaftar dengan kode ini (lihat integration-guide.md)
 *
 * UI modal dibuat sendiri oleh file ini (tidak butuh HTML tambahan), jadi bisa
 * ditempel ke game lain. Diuji headless oleh tools/web_ads_referral_test.js.
 * ========================================================================== */
'use strict';

const REFERRAL_DEFAULTS = {
  gameName: 'HideSeek Online',
  baseUrl: '',                       // default: location.origin + pathname
  codeLength: 7,                     // 6–8 karakter sesuai spesifikasi
  // Karakter yang mudah tertukar (I/1, L/1, O/0) sengaja tidak dipakai.
  charset: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',   // tanpa I/L/O: sesuai isValidCode() & kode server
  coinsForInvitee: 50,               // hadiah utk yang diundang
  hpForInvitee: 1,
  coinsForInviter: 100,              // hadiah utk pengundang (dicatat, dibayar saat ada server)
  welcomeSeconds: 6,                 // popup otomatis saat pertama masuk (0 = tidak pernah)
  keys: {
    mine: 'myReferralCode',
    referrer: 'referrerCode',
    claimed: 'referralClaimed',
    bonus: 'referralBonus',
    notified: 'referralNotified',
  },
};

function refMakeStorage(injected) {
  if (injected && typeof injected.getItem === 'function') return injected;
  if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

class ReferralSystem {
  /**
   * @param {object} cfg { gameName, baseUrl, player|profile (objek dgn addCoins/addHP),
   *                       onGrant({coins,hp,kind}), notify(msg), mount (elemen utk modal),
   *                       codeLength, keys, storage, random (injeksi utk test) }
   */
  constructor(cfg = {}) {
    this.cfg = Object.assign({}, REFERRAL_DEFAULTS, cfg || {});
    this.cfg.keys = Object.assign({}, REFERRAL_DEFAULTS.keys, (cfg && cfg.keys) || {});
    this.storage = refMakeStorage(cfg && cfg.storage);
    this.player = (cfg && (cfg.player || cfg.profile)) || null;
    this.notify = (cfg && cfg.notify) || (m => this.log(m));
    this.onGrant = (cfg && cfg.onGrant) || null;
    this.mount = (cfg && cfg.mount) || (typeof document !== 'undefined' ? document.body : null);
    this._random = (cfg && cfg.random) || Math.random;
    this.server = (cfg && cfg.server) || null;   // adapter backend: {getCode,stats,claim} — lihat setServer()
    if (!this.cfg.baseUrl && typeof location !== 'undefined' && location.origin) {
      this.cfg.baseUrl = location.origin + (location.pathname || '/').replace(/\/[^/]*$/, '');
    }
    this.pendingInviteeReward = null;   // hadiah yang belum sempat diterapkan (mis. game belum init)
  }

  log(msg) { try { console.log('🎁 [REFERRAL] ' + msg); } catch (e) { /* tanpa console */ } }

  /* ------------------------------ kode sendiri ----------------------------- */
  /** Bangun kode acak (7 karakter sesuai spesifikasi). */
  generateReferralCode() {
    const chars = this.cfg.charset, n = Math.min(8, Math.max(6, this.cfg.codeLength | 0));
    let code = '';
    for (let i = 0; i < n; i++) code += chars.charAt(Math.floor(this._random() * chars.length));
    return code;
  }
  /** Kode milik pemain; dibuat otomatis pada kali pertama bermain. */
  getMyReferralCode() {
    const k = this.cfg.keys.mine;
    let code = this.storage.getItem(k);
    if (!code || !ReferralSystem.isValidCode(code)) {
      code = (this.server && this.server.getCode && this.server.getCode()) || '';
      if (!ReferralSystem.isValidCode(code)) code = this.generateReferralCode();
      this.storage.setItem(k, code);
      this.log('kode baru dibuat: ' + code);
    }
    return code;
  }
  /**
   * Pasang adapter backend (dipanggil game.js setelah apiKit siap):
   *   { getCode(): kode resmi dari server, stats(): {invited,coinsPerFriend,paidByServer},
   *     claim(ref): Promise untuk membayar referral akun lama }
   * Kode server ditampung di storage agar link yang sudah tersebar tidak berubah.
   */
  setServer(srv) {
    this.server = srv || null;
    if (this.server && this.server.getCode) this.setServerCode(this.server.getCode());
    return this.server;
  }
  /** Ganti kode lokal dengan kode resmi dari server (hanya bila formatnya valid). */
  setServerCode(code) {
    const c = ReferralSystem.normalizeCode(code);
    if (!ReferralSystem.isValidCode(c)) return false;
    this.storage.setItem(this.cfg.keys.mine, c);
    this.log('kode referral diambil dari server: ' + c);
    return true;
  }
  /** Status pembayaran dari server (null = mode lokal/pending). */
  getServerStats() { return (this.server && this.server.stats) ? (this.server.stats() || null) : null; }
  /** URL lengkap: https://game.com/?ref=KODE */
  getReferralLink(code) {
    const base = (this.cfg.baseUrl || '').replace(/[?#].*$/, '').replace(/\/$/, '');
    return base + '/?ref=' + (code || this.getMyReferralCode());
  }
  /** Salin link ke clipboard (fallback: textarea + execCommand utk browser lama). */
  async copyReferralLink(code) {
    const link = this.getReferralLink(code);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(link);
        this.notify('Link undangan disalin ✓');
        return true;
      }
    } catch (e) { /* lanjut ke fallback */ }
    try {
      if (typeof document === 'undefined' || !document.createElement) throw new Error('no-dom');
      const ta = document.createElement('textarea');
      ta.value = link; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
      const b = document.body || document.documentElement;
      if (!b) throw new Error('no-body');
      b.appendChild(ta); ta.select();
      const ok = document.execCommand ? document.execCommand('copy') : false;
      ta.remove();
      this.notify(ok ? 'Link undangan disalin ✓' : 'Salin manual: ' + link);
      return !!ok;
    } catch (e) {
      this.notify('Salin manual: ' + link);
      return false;
    }
  }

  static normalizeCode(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
  static isValidCode(code) {
    // Panjang dinilai dari input MENTAH (normalizeCode memotong > 8 karakter, jadi
    // 'ABCDEFGHI' harus INVALID, bukan dipotong lalu lolos).
    const raw = String(code == null ? '' : code).replace(/[^a-zA-Z0-9]/g, '');
    if (raw.length < 6 || raw.length > 8) return false;
    return /^[A-HJ-KM-NP-Z0-9]{6,8}$/i.test(raw);
  }

  /* ------------------------------ dari URL -------------------------------- */
  /** Baca ?ref= pada URL saat ini (juga mendukung ?referrer= dan #ref=). */
  getReferrerFromUrl() {
    try {
      if (typeof location === 'undefined') return '';
      const usp = new URLSearchParams(location.search || '');
      let raw = usp.get('ref') || usp.get('referrer') || '';
      if (!raw && location.hash) {
        const m = String(location.hash).match(/ref=([A-Za-z0-9]+)/);
        if (m) raw = m[1];
      }
      return ReferralSystem.normalizeCode(raw);
    } catch (e) { return ''; }
  }
  getReferrerCode() { return this.storage.getItem(this.cfg.keys.referrer) || ''; }
  hasClaimed() { return this.storage.getItem(this.cfg.keys.claimed) === '1'; }
  /** Kode pengundang disimpan SEKALI dan tidak boleh diubah. */
  setReferrerCode(code) {
    const k = this.cfg.keys.referrer;
    if (this.storage.getItem(k)) return false;
    this.storage.setItem(k, ReferralSystem.normalizeCode(code));
    return true;
  }
  /** Total teman yang (diklaim) bergabung lewat kode ini — counter lokal utk pengundang. */
  getReferralBonus() { return parseInt(this.storage.getItem(this.cfg.keys.bonus) || '0', 10) || 0; }
  getPendingCoins() { return this.getReferralBonus() * (this.cfg.coinsForInviter | 0); }

  /**
   * Cek parameter ?ref= saat game dimuat. Bila ada kode valid & belum pernah diklaim:
   * simpan referrerCode, beri hadiah, dan tampilkan popup selamat datang.
   * @returns {null|{code:string, coins:number, hp:number, granted:boolean}}
   */
  checkReferralOnLoad() {
    const code = this.getReferrerFromUrl();
    if (!code) return null;
    if (!ReferralSystem.isValidCode(code)) { this.notify('Kode undangan tidak valid'); return { code, coins: 0, hp: 0, granted: false, reason: 'invalid' }; }
    if (code === this.getMyReferralCode()) { this.notify('Itu kode kamu sendiri 😄'); return { code, coins: 0, hp: 0, granted: false, reason: 'self' }; }
    if (this.hasClaimed()) return { code, coins: 0, hp: 0, granted: false, reason: 'already' };

    this.setReferrerCode(code);
    const coins = this.cfg.coinsForInvitee | 0, hp = this.cfg.hpForInvitee | 0;
    const granted = this.grantInviteeReward(coins, hp);
    this.storage.setItem(this.cfg.keys.claimed, '1');
    this.stripRefFromUrl();
    this.showWelcomePopup(code, coins, hp);
    return { code, coins, hp, granted };
  }
  /** Alias sesuai contoh integrasi (spec memakai nama ini). */
  checkOnLoad() { return this.checkReferralOnLoad(); }
  /** Terapkan hadiah utk yang diundang ke state pemain (localStorage lewat profil game). */
  grantInviteeReward(coins, hp) {
    let applied = false;
    if (this.player) {
      if (coins && typeof this.player.addCoins === 'function') { this.player.addCoins(coins); applied = true; }
      if (hp && typeof this.player.addHP === 'function') { this.player.addHP(hp); applied = true; }
      if (typeof this.player.save === 'function') this.player.save();
    }
    if (this.onGrant) { this.onGrant({ kind: 'invitee', coins, hp }); applied = true; }
    if (!applied) { this.pendingInviteeReward = { coins, hp }; this.log('hadiah ditahan sampai player siap (+ ' + coins + ' koin, +' + hp + ' nyawa)'); }
    return applied;
  }
  /**
   * Dipanggil setelah state pemain siap (game.init) — mengambil hadiah yang tertahan.
   */
  flushPendingRewards() {
    if (!this.pendingInviteeReward || !this.player) return false;
    const r = this.pendingInviteeReward;
    this.pendingInviteeReward = null;
    if (r.coins && typeof this.player.addCoins === 'function') this.player.addCoins(r.coins);
    if (r.hp && typeof this.player.addHP === 'function') this.player.addHP(r.hp);
    if (typeof this.player.save === 'function') this.player.save();
    this.notify(`🎁 Hadiah undangan: +${r.coins} koin & +${r.hp} nyawa`);
    return true;
  }
  /**
   * Sisi pengundang: menaikkan counter 'referralBonus' (local). Nanti, saat ada
   * backend, nilai ini disetor ke server pengundang (coinsForInviter per referral).
   */
  recordIncomingReferral(n = 1) {
    const v = this.getReferralBonus() + n;
    this.storage.setItem(this.cfg.keys.bonus, String(v));
    this.notify(`Kamu berhasil mengundang teman! +${this.cfg.coinsForInviter} Koin!`);
    return v;
  }
  /** Hapus ?ref= dari address bar supaya refresh tidak memproses ulang. */
  stripRefFromUrl() {
    try {
      if (typeof history === 'undefined' || !history.replaceState || typeof location === 'undefined') return;
      const usp = new URLSearchParams(location.search || '');
      if (!usp.has('ref') && !usp.has('referrer')) return;
      usp.delete('ref'); usp.delete('referrer');
      const q = usp.toString();
      history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    } catch (e) { /* file:// dsb. aman diabaikan */ }
  }

  /* --------------------------------- UI ----------------------------------- */
  /** Style modal (disuntik sekali). */
  _ensureStyle(doc) {
    if (!doc || doc.getElementById('referral-style')) return;
    const st = doc.createElement('style');
    st.id = 'referral-style';
    st.textContent = `
.hs-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  background:rgba(4,10,8,.86);backdrop-filter:blur(3px);padding:18px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eaf3ec}
.hs-modal[hidden]{display:none}
.hs-card{width:min(460px,94vw);background:#0e1f19;border:1px solid #ffffff22;border-radius:18px;padding:20px;box-shadow:0 18px 60px #000a;text-align:center}
.hs-card h3{margin:2px 0 6px;font-size:20px;letter-spacing:.6px}
.hs-card p{margin:6px 0;color:#9fb3a6;font-size:13px;line-height:1.55}
.hs-code{display:flex;gap:8px;align-items:center;justify-content:center;margin:12px 0}
.hs-code b{font:900 clamp(22px,6vw,30px)/1 ui-monospace,Menlo,monospace;letter-spacing:4px;background:#ffffff10;
  border:1px dashed #ffffff33;border-radius:12px;padding:12px 16px;color:#ffd77a;user-select:all}
.hs-btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:10px}
.hs-btns button{font:inherit;border:0;border-radius:12px;padding:11px 15px;cursor:pointer;background:#2fa35b;color:#fff;font-weight:800;box-shadow:0 4px 0 #1c6b3a}
.hs-btns button:active{transform:translateY(3px);box-shadow:0 1px 0 #1c6b3a}
.hs-btns button.alt{background:#2b6ba8;box-shadow:0 4px 0 #1b4a75}
.hs-btns button.x{background:#4c5a53;box-shadow:0 4px 0 #33403a}
.hs-note{background:#ffffff10;border-radius:12px;padding:9px 12px;font-size:12px;color:#cfe9d6;margin-top:10px}
.hs-link{word-break:break-all;font-size:12px;color:#9fb3a6}
`;
    const hostS = doc.head || doc.body || doc.documentElement;
    if (hostS) hostS.appendChild(st);          // DOM minimal tanpa head/body: style diskip
  }
  _modal(doc) {
    if (!doc) return null;
    let m = doc.getElementById('referralModal');
    if (m) return m;
    this._ensureStyle(doc);
    m = doc.createElement('div');
    m.id = 'referralModal';
    m.className = 'hs-modal';
    m.hidden = true;
    m.innerHTML = `<div class="hs-card">
      <h3 id="refTitle">Undang teman, dapat koin</h3>
      <div class="hs-code"><b id="refCode">—</b></div>
      <p class="hs-link" id="refLink"></p>
      <div class="hs-btns">
        <button id="refCopy" type="button">📋 Salin Link</button>
        <button id="refShare" type="button" class="alt">📣 Bagikan</button>
        <button id="refClose" type="button" class="x">Tutup</button>
      </div>
      <p class="hs-note">🪙 Dapatkan <b>${this.cfg.coinsForInviter} koin</b> untuk setiap teman yang bergabung!</p>
      <p class="hs-note" id="refBonus">Referral tercatat: 0 · menunggu server (+${this.cfg.coinsForInviter * 0} koin)</p>
    </div>`;
    const host = this.mount || doc.body || doc.head || doc.documentElement;
    if (host) host.appendChild(m);
    m.querySelector('#refCopy').addEventListener('click', () => { this.copyReferralLink(); });
    const sh = m.querySelector('#refShare');
    if (typeof navigator === 'undefined' || !navigator.share) sh.style.display = 'none';
    else sh.addEventListener('click', () => navigator.share({ title: this.cfg.gameName, text: 'Main ' + this.cfg.gameName + ' yuk!', url: this.getReferralLink() }).catch(() => { }));
    m.querySelector('#refClose').addEventListener('click', () => { m.hidden = true; });
    m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
    return m;
  }
  /** Modal utama: kode + tombol salin + info hadiah. */
  showInviteModal() {
    if (typeof document === 'undefined') return null;
    const m = this._modal(document);
    if (!m) return null;
    const code = this.getMyReferralCode(), link = this.getReferralLink(code);
    m.querySelector('#refCode').textContent = code;
    m.querySelector('#refLink').textContent = link;
    this.updateModalStats(m);
    const ref = this.getReferrerCode();
    m.querySelector('#refTitle').textContent = ref ? `Kode pengundang kamu: ${ref}` : 'Undang teman, dapat koin';
    m.hidden = false;
    return m;
  }
  /** Segarkan baris status hadiah (dipakai saat buka modal & setelah sinkron server). */
  updateModalStats(m) {
    m = m || (typeof document !== 'undefined' ? document.getElementById('referralModal') : null);
    if (!m || !m.querySelector) return null;
    const bonus = this.getReferralBonus(), srv = this.getServerStats();
    const box = m.querySelector('#refBonus');
    if (!box) return null;
    if (srv) {
      const n = srv.invited | 0;
      box.innerHTML = n > 0
        ? `Teman bergabung: <b>${n}</b> · dibayar server: <b>+${n * (srv.coinsPerFriend || this.cfg.coinsForInviter)}</b> koin ✓`
        : `Belum ada teman yang gabung. Sebarkan link di atas — tiap teman = <b>+${this.cfg.coinsForInviter} koin</b> (dibayar server).`;
    } else {
      box.innerHTML = bonus > 0
        ? `Teman bergabung: <b>${bonus}</b> · menunggu server: +<b>${bonus * this.cfg.coinsForInviter}</b> koin`
        : `Belum ada teman yang gabung. Sebarkan link di atas!`;
    }
    return box;
  }
  /** Alias sesuai spesifikasi. */
  showReferralPopup() { return this.showInviteModal(); }
  /** Popup "selamat datang" setelah ?ref= diproses. */
  showWelcomePopup(code, coins, hp) {
    if (typeof document === 'undefined') { this.notify(`Selamat datang! Kode ${code} → +${coins} koin & +${hp} nyawa`); return null; }
    const m = this._modal(document);
    if (!m) return null;
    m.querySelector('#refTitle').textContent = 'Selamat datang! 🎉';
    m.querySelector('#refCode').textContent = code;
    m.querySelector('#refLink').textContent = `Kamu diundang lewat kode ini — hadiah langsung masuk: +${coins} koin & +${hp} nyawa.`;
    m.querySelector('#refBonus').innerHTML = `Punya kode sendiri? Tekan <b>Salin Link</b> dan dapat ${this.cfg.coinsForInviter} koin per teman.`;
    m.hidden = false;
    const secs = Math.max(0, this.cfg.welcomeSeconds | 0);
    if (secs > 0) setTimeout(() => { m.hidden = true; }, secs * 1000);
    return m;
  }
  hideModal() { if (typeof document !== 'undefined') { const m = document.getElementById('referralModal'); if (m) m.hidden = true; } }
  /** Ringkasan utk UI lain / debug. */
  getStats() {
    const srv = this.getServerStats();
    return {
      code: this.getMyReferralCode(),
      server: srv,
      link: this.getReferralLink(),
      referrer: this.getReferrerCode(),
      claimed: this.hasClaimed(),
      invited: this.getReferralBonus(),
      pendingCoins: this.getPendingCoins(),
    };
  }
  /** Reset total (test / ganti akun). */
  reset() { const k = this.cfg.keys; for (const key of Object.values(k)) this.storage.removeItem(key); this.pendingInviteeReward = null; }
}

/* ------------------------------- exports ---------------------------------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ReferralSystem, REFERRAL_DEFAULTS };
}
if (typeof window !== 'undefined') {
  window.ReferralSystem = ReferralSystem;
  /** Helper: buat instance dari window.HIDESEEK_CONFIG.referral (opsional). */
  window.createReferralSystem = (extra) => {
    const fromCfg = (window.HIDESEEK_CONFIG && window.HIDESEEK_CONFIG.referral) || {};
    return new ReferralSystem(Object.assign({}, fromCfg, extra || {}));
  };
}

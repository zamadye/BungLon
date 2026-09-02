/* ==========================================================================
 * particles.js — FX partikel canvas untuk HideSeek (blueprint §5 "visual game")
 * --------------------------------------------------------------------------
 * Yang dipenuhi di sini:
 *   • debu kecil di kaki saat lari           -> emit('dust')
 *   • burst saat pemain tertangkap / kena     -> emit('hit')
 *   • sparkle saat koin / reward / heal       -> emit('spark') / emit('heal')
 *   • cincin Sonic Blast & camo               -> emit('ring') / emit('camo')
 * Aturan desain yang dipegang:
 *   1. Nol aset gambar, nol dependency, digambar di canvas yang sama (hemat draw call).
 *   2. Pool dibatasi `max` — yang tertua dibuang, jadi tidak pernah meledak
 *      walaupun spam event (penting di HP rendah).
 *   3. `prefers-reduced-motion: reduce` -> emit() diam total (hanya flash UI yang tersisa).
 *   4. Semua matematika di fungsi statis (`stepList`) sehingga bisa diuji headless.
 * Satuan: koordinat & kecepatan dalam UNIT DUNIA (1 unit = 1 tile), sama seperti
 * PlayerState.x/.y. Saat digambar, dikalikan `unit` (px per unit) dari game.
 * ========================================================================== */
'use strict';

(function (root) {

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /**
   * Resep tiap jenis partikel. `color` memakai placeholder "A" untuk alpha,
   * diisi saat draw() supaya bisa fade-out tanpa alokasi warna baru tiap bingkai.
   */
  const KINDS = {
    dust: { count: 4, life: 0.34, speed: 0.55, spread: 0.35, grav: 1.0, drag: 2.6, size: 0.065, color: 'rgba(236,222,190,A)' },
    spark: { count: 9, life: 0.55, speed: 1.9, spread: 1.0, grav: 3.4, drag: 1.6, size: 0.06, color: 'rgba(255,214,90,A)' },
    hit: { count: 14, life: 0.46, speed: 2.6, spread: 1.0, grav: 4.2, drag: 1.4, size: 0.085, color: 'rgba(255,90,110,A)' },
    heal: { count: 8, life: 0.70, speed: 1.1, spread: 1.0, grav: -1.6, drag: 0.9, size: 0.07, color: 'rgba(120,240,160,A)' },
    camo: { count: 10, life: 0.60, speed: 1.2, spread: 1.0, grav: -0.4, drag: 1.2, size: 0.075, color: 'rgba(110,220,150,A)' },
    ring: { count: 1, life: 0.42, speed: 0, spread: 0, grav: 0, drag: 0, size: 0.30, color: 'rgba(160,225,255,A)' },
  };

  class Particles {
    /**
     * @param {object} opt {max=220, enabled=true, reduced=auto-detect}
     */
    constructor(opt) {
      const o = opt || {};
      this.max = o.max | 0 || 220;
      this.list = [];
      this.enabled = o.enabled !== false;
      this.reduced = o.reduced === undefined ? Particles.prefersReduced() : !!o.reduced;
      this.emitted = 0;                       // statistik utk debug/test
    }
    /** Menghormati aksesibilitas: kalau user minta minim gerak, FX tidak dibuat. */
    static prefersReduced() {
      try {
        return typeof matchMedia === 'function' &&
          !!matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (e) { return false; }
    }
    /** True bila jenis itu punya resep (dipakai test utk menangkap typo). */
    static has(kind) { return Object.prototype.hasOwnProperty.call(KINDS, kind); }

    /**
     * Spawn `count` partikel tipe `kind` di (x, y).
     * @param {string} kind dust|spark|hit|heal|camo|ring
     * @param {object} opt {count, dir, spread, speed, life, size, color, r1}
     * @returns {number} jumlah partikel yang benar-benar ditambahkan
     */
    emit(kind, x, y, opt) {
      if (!this.enabled || this.reduced || !Particles.has(kind)) return 0;
      const o = opt || {};
      const d = Object.assign({}, KINDS[kind], o);
      const n = Math.max(0, d.count | 0);
      const before = this.list.length;
      const spread = clamp(d.spread === undefined ? 1 : d.spread, 0, 1);
      for (let i = 0; i < n; i++) {
        if (kind === 'ring') {                     // cincin: membesar lalu pudar
          this.list.push({ kind, x, y, t: 0, ttl: d.life, r0: d.size, r1: d.r1 === undefined ? d.size * 6 : d.r1, color: d.color });
          continue;
        }
        // arah = o(pty) `dir` (radian) + sebaran acak; kecepatan sedikit divariasikan
        const a = (d.dir || 0) + (Math.random() - 0.5) * Math.PI * 2 * spread;
        const sp = (d.speed || 1) * (0.55 + Math.random() * 0.7);
        this.list.push({
          kind, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          t: 0, ttl: (d.life || 0.5) * (0.7 + Math.random() * 0.6),
          grav: d.grav || 0, drag: d.drag || 0, size: (d.size || 0.07) * (0.7 + Math.random() * 0.6),
          color: d.color,
        });
      }
      // Kapasitas pool: buang yang tertua (bukan menolak yang baru) supaya efek
      // besar seperti hit/blast tidak "kalah" oleh debu kaki.
      if (this.list.length > this.max) this.list.splice(0, this.list.length - this.max);
      const added = this.list.length - before;
      this.emitted += added < 0 ? n : added;
      return added < 0 ? n : added;
    }
    /** Satu langkah fisika (dt detik). */
    step(dt) { return Particles.stepList(this.list, dt === undefined ? 1 / 60 : dt); }
    /**
     * Fisika murni — diuji tanpa DOM. Mengubah `list` di tempat dan
     * mengembalikan panjangnya setelah partikel mati dibuang.
     */
    static stepList(list, dt) {
      const h = dt === undefined ? 1 / 60 : Math.min(0.05, Math.max(0, dt));   // clamp anti-spiral-of-death
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.t = (p.t || 0) + h;
        if (p.t >= p.ttl) { list.splice(i, 1); continue; }
        if (p.kind === 'ring') continue;                 // ring tidak bergerak, hanya membesar
        p.vy -= (p.grav || 0) * h;                       // gravitasi positif = jatuh (y dunia ke atas)
        const k = 1 / (1 + (p.drag || 0) * h);           // hambatan eksplisit -> cepat berhenti
        p.vx *= k; p.vy *= k;
        p.x += p.vx * h; p.y += p.vy * h;
      }
      return list.length;
    }
    /**
     * Gambar semua partikel. `sx`/`sy` = pemeta unit dunia -> piksel kanvas,
     * `unit` = lebar 1 unit dalam piksel (dipakai utk ukuran titik & cincin).
     * @returns {number} jumlah partikel tergambar
     */
    draw(ctx, sx, sy, unit) {
      if (!ctx || !this.list.length) return 0;
      const U = unit || 1;
      const f = typeof sx === 'function' ? sx : (v) => v;
      const g = typeof sy === 'function' ? sy : (v) => v;
      ctx.save();
      for (const p of this.list) {
        const k = clamp((p.t || 0) / (p.ttl || 1), 0, 1);
        const alpha = (1 - k).toFixed(3);
        const col = (p.color || 'rgba(255,255,255,A)').replace('A)', alpha + ')');
        if (p.kind === 'ring') {
          if (!ctx.beginPath) continue;
          const r = ((p.r0 || 0.3) + ((p.r1 || 1.8) - (p.r0 || 0.3)) * k) * U;
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(1, U * 0.05);
          ctx.beginPath(); ctx.arc(f(p.x), g(p.y), r, 0, 7); ctx.stroke();
          continue;
        }
        const s = Math.max(1, p.size * U * (1 - k * 0.45));
        ctx.fillStyle = col;
        ctx.fillRect(f(p.x) - s / 2, g(p.y) - s / 2, s, p.kind === 'dust' ? s * 0.8 : s);
      }
      ctx.restore();
      return this.list.length;
    }
    clear() { this.list.length = 0; return this; }
    get count() { return this.list.length; }
  }

  Particles.KINDS = KINDS;

  /* ekspor ganda: browser (window.BungFX) + node (require utk tools/web_ui_test.js) */
  root.BungFX = Particles;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Particles, KINDS };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

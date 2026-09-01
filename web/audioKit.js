/* =============================================================================
 * audioKit.js — SFX & BGM tanpa file audio (Web Audio API, sintesis prosedural)
 * -----------------------------------------------------------------------------
 * Kenapa sintesis? Blueprint meminta 9 aset audio; mengikat file .mp3/.ogg berarti
 * tambah berat + izin CORS. Dengan osilator: nol aset, tetap offline-able (PWA),
 * dan volume/ducking bisa diatur realtime. Semua calls aman tanpa AudioContext
 * (node/CI/peramban tua): hanya jadi no-op, TIDAK pernah melempar.
 *
 * Preferensi disimpan di localStorage['hideseek_audio'] = {sfx, music, volume}
 * ========================================================================== */
'use strict';

const AUDIO_KEY = 'hideseek_audio';

/** Resep SFX: [wave, f0, f1, durasi, gain, tipe 'sweep'|'blip'|'noise'|'chord'] */
const SFX = {
  tap: ['blip', 660, 720, 0.05, 0.14],
  back: ['blip', 420, 300, 0.07, 0.12],
  skill: ['sweep', 320, 780, 0.16, 0.16],
  camo: ['sweep', 700, 240, 0.35, 0.12],
  swap: ['sweep', 420, 1040, 0.14, 0.18],
  radar: ['blip', 1180, 1180, 0.09, 0.14],
  blast: ['noise', 240, 60, 0.34, 0.24],
  catch: ['noise', 180, 50, 0.22, 0.3],
  hit: ['sweep', 520, 90, 0.26, 0.3],
  ghost: ['sweep', 300, 70, 0.5, 0.2],
  coin: ['blip', 980, 1500, 0.1, 0.16],
  reward: ['chord', 520, 0, 0.36, 0.16],
  count: ['blip', 540, 540, 0.07, 0.16],
  go: ['blip', 900, 1200, 0.16, 0.2],
  win: ['chord', 520, 0, 0.7, 0.2],
  lose: ['chord', 200, 0, 0.7, 0.18],
  join: ['blip', 760, 980, 0.09, 0.14],
  err: ['blip', 200, 150, 0.16, 0.2],
};
/** Nada dasar (Hz) utk BGM: menu tenang, game tegang (minor + tempo naik). */
const BGM = {
  menu: { bpm: 72, root: 220, steps: [0, 7, 12, 7, 3, 10, 7, 3], wave: 'triangle' },
  game: { bpm: 112, root: 196, steps: [0, 3, 7, 10, 12, 10, 7, 3], wave: 'sawtooth' },
};

class AudioKit {
  constructor(opt = {}) {
    this.storage = opt.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    this.prefs = { sfx: true, music: true, volume: 0.8 };
    this.load();
    this.ctx = null; this.master = null; this.musicGain = null; this.sfxGain = null;
    this.track = null; this._timer = null; this._ducked = false; this._failed = false;
    this.onChange = opt.onChange || (() => { });
  }
  /* ------------------------------ preferensi ------------------------------ */
  load() {
    try {
      const raw = this.storage && this.storage.getItem(AUDIO_KEY);
      if (raw) Object.assign(this.prefs, JSON.parse(raw) || {});
    } catch (e) { /* storage korosi -> pakai default */ }
    return this.prefs;
  }
  save() { try { this.storage && this.storage.setItem(AUDIO_KEY, JSON.stringify(this.prefs)); } catch (e) { } }
  setMuted(kind, on) { this.prefs[kind] = !!on; this.save(); this.applyGains(); this.onChange(this.prefs); return this.prefs[kind]; }
  setVolume(v) { this.prefs.volume = clampNum(Number(v), 0, 1, 0.8); this.save(); this.applyGains(); this.onChange(this.prefs); return this.prefs.volume; }

  /* -------------------------------- setup --------------------------------- */
  /** Dibuat pada gesture pertama (kebijakan autoplay peramban menuntut begitu). */
  unlock() {
    if (this.ctx || this._failed) { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => { }); return !!this.ctx; }
    try {
      const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
        (typeof AudioContext !== 'undefined' ? AudioContext : null);
      if (!AC) { this._failed = true; return false; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain.connect(this.master); this.sfxGain.connect(this.master); this.master.connect(this.ctx.destination);
      this.applyGains();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { });
      if (this.prefs.music && this.track) this.music(this.track);
      return true;
    } catch (e) { this._failed = true; return false; }
  }
  get ready() { return !!this.ctx && !this._failed; }
  applyGains() {
    if (!this.ready) return;
    const v = this.prefs.volume * (this._ducked ? 0.25 : 1);
    this.master.gain.value = v;
    this.sfxGain.gain.value = this.prefs.sfx ? 1 : 0;
    this.musicGain.gain.value = this.prefs.music ? 0.5 : 0;
  }
  /** Iklan tayang / hasil -> musik mengecil (mirror AudioListener.pause di Unity). */
  duck(on) { this._ducked = !!on; this.applyGains(); return this._ducked; }

  /* --------------------------------- SFX ---------------------------------- */
  /** @param {string} name kunci tabel SFX @param {number} [gainScale] */
  sfx(name, gainScale = 1) {
    if (!this.ready || !this.prefs.sfx) return false;
    const r = SFX[name]; if (!r) return false;
    try {
      const [kind, f0, f1, dur, gain] = r;
      const t = this.ctx.currentTime;
      if (kind === 'noise') return this._noise(dur, f0, gain * gainScale);
      if (kind === 'chord') {                     // 3 nada (mayor/minor ditentukan arah f0)
        const third = f0 > 400 ? [0, 4, 7] : [0, 3, 7];
        third.forEach((semi, i) => this._tone(f0 * Math.pow(2, semi / 12), 0, dur * (1 - i * 0.12), gain * 0.7 * gainScale, t + i * 0.045, 'triangle'));
        return true;
      }
      this._tone(f0, f1, dur, gain * gainScale, t, kind === 'blip' ? 'square' : 'sine');
      return true;
    } catch (e) { return false; }
  }
  _tone(f0, f1, dur, gain, at = null, wave = 'sine') {
    const t = at === null ? this.ctx.currentTime : at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = wave; o.frequency.setValueAtTime(Math.max(30, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.02);
    return o;
  }
  _noise(dur, cutHz, gain) {
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(cutHz * 6, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, cutHz), t + dur);
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start(t); src.stop(t + dur + 0.02);
    return true;                                   // kontrak publik sfx(): boolean
  }

  /* --------------------------------- BGM ---------------------------------- */
  /** @param {'menu'|'game'|null} which */
  music(which) {
    this.track = which || null;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (!this.ready || !this.prefs.music || !this.track || !BGM[this.track]) return false;
    const cfg = BGM[this.track], stepDur = 60 / cfg.bpm / 2;
    let i = 0;
    const tick = () => {
      if (!this.ready || !this.prefs.music || this.track !== which) return;
      try {
        const semi = cfg.steps[i % cfg.steps.length];
        const f = cfg.root * Math.pow(2, semi / 12);
        const t = this.ctx.currentTime;
        this._tone(f, 0, stepDur * 1.6, 0.05, t, cfg.wave);                       // melodi
        if (i % 4 === 0) this._tone(cfg.root / 2, 0, stepDur * 3.4, 0.06, t, 'sine');  // bas
        i++;
      } catch (e) { /* ctx ditutup di tengah jalan */ }
    };
    tick();
    this._timer = setInterval(tick, Math.max(90, stepDur * 1000));
    if (this._timer.unref) this._timer.unref();          // jangan menahan proses node
    return true;
  }
  stopMusic() { return this.music(null); }
  /** Ringkasan utk panel Settings + test. */
  status() { return { ready: this.ready, failed: this._failed, track: this.track, ducked: this._ducked, ...this.prefs }; }
}
function clampNum(v, a, b, d) { return Number.isFinite(v) ? clamp2(v, a, b) : d; }
function clamp2(v, a, b) { return v < a ? a : v > b ? b : v; }

if (typeof module !== 'undefined' && module.exports) { module.exports = { AudioKit, SFX, BGM, AUDIO_KEY }; }
if (typeof window !== 'undefined') {
  window.BungAudioKit = AudioKit;
  window.BungAudio = new AudioKit({});                    // singleton; game.js memakainya
  // unlock otomatis pada gesture pertama (kebijakan autoplay)
  const unlockOnce = () => { try { window.BungAudio.unlock(); } catch (e) { } };
  for (const ev of ['pointerdown', 'touchstart', 'keydown']) {
    if (window.addEventListener) window.addEventListener(ev, unlockOnce, { once: true, passive: true });
  }
}

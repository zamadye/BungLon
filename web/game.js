/* =============================================================================
 * HideSeek Online — Web demo (tanpa Unity engine)
 * -----------------------------------------------------------------------------
 * Re-implementasi aturan dari Assets/Scripts (C#) di HTML5 canvas supaya bisa
 * dijalankan / diuji tanpa menginstal Unity. Logika sengaja dipisah dari DOM
 * agar bisa dijalankan headless (lihat tools/web_selftest.js).
 *
 * Paritas dengan kode Unity (sumber kebenaran tetap project Unity):
 *   HideSeekConstants.cs  -> CFG di bawah (nilai identik)
 *   GameManager.cs         -> class Round (phase machine, catch, ghost, skor)
 *   PlayerController.cs    -> PlayerState.move / applyPushback / SetGhost
 *   HiderSkill.cs          -> useCamouflage() / usePropSwap()
 *   SeekerSkill.cs         -> useRadar() / useSonicBlast() + sonicSlow
 *   CamouflageHelper.cs    -> sampleGroundColor() (OverPointAll + average RGB)
 *   AdsManager.cs          -> showRewardAd() (jalur "simulateAds": tanpa SDK)
 *   RewardOffers.cs        -> RewardOffers (offer + kuota + grant)
 *   HideSeekSetupTool.cs   -> buildMap() (zoning tile, ring hedge, dekor)
 *   UIManager.cs           -> hud (hearts, hp bar, cooldown radial, minimap)
 * Netcode: mode SOLO (bots) atau room relay sederhana lewat web/net-server.js
 * (host = Authority untuk phase timer, seperti GameManager).
 * ========================================================================== */
'use strict';

/* ============================ CFG (HideSeekConstants.cs) ==================== */
const CFG = {
  // Phase durasi (detik) — HideSeekConstants.CountdownSeconds dst.
  countdown: 5.0, hide: 30.0, seek: 60.0, result: 10.0,
  roomMin: 2, roomMax: 12,             // MinPlayersPerRoom / RoomHardCap
  hiderHp: 3, hiderSpeed: 6.0,         // HiderMaxHp / HiderMoveSpeed
  seekerMult: 1.15,                    // SeekerSpeedMultiplier
  hiderCd: 10.0, seekerCd: 8.0,        // HiderSkillCooldown / SeekerSkillCooldown
  propSwapTime: 8.0,                   // PropSwapDuration
  // FREEZE (skill #3 Hider) — HideSeekConstants.Freeze* ; cooldown sendiri, bukan cdHider.
  freezeRadius: 4.0, freezeTime: 2.5,  // FreezeRadius / FreezeDuration
  freezeSlow: 0.35, freezeCd: 14.0,    // FreezeSlowFactor / FreezeCooldown
  freezeRoot: 0.8,                      // FreezeSelfRoot (tradeoff: hider diam sebentar)
  propAimRadius: 2.5,                   // PropAimPickRadius (mode tahan-seret-lepas)
  camIdle: 1.25, camRun: 1.08, camSeek: 1.0, camRunSpeed: 4.8, camSmooth: 0.12, // PlayerCamera
  blastRadius: 5.0, blastRadiusSqr: 25.0,
  slowFactor: 0.5, slowTime: 2.0,      // SonicBlastSlowFactor / SlowDuration
  pushback: 3.0, pushbackTime: 0.35, invuln: 0.6,   // CatchPushback/PushbackDuration/Immunity
  catchRange: 3.0,                     // CatchRange (unit)
  catchTapInterval: 0.25, contactInterval: 0.8,    // CatchMinInterval / jarak-aman contact
  ghostAlpha: 0.3,                     // GhostAlpha
  camoLerp: 0,                         // 0 = instan (PlayerVisual.TintAll); >0 = fade halus
  timerBroadcast: 0.25, minSendRate: 0.05,         // TimerBroadcastInterval / MinNetworkSendRate
  // Reward dari iklan rewarded — bagian 8 README + HideSeekConstants (bagian Reward).
  reviveHp: 1, reviveSafeWindow: 1.6,
  maxRevives: 1, maxSkips: 2, maxFrenzies: 2,
  frenzyTime: 10.0, frenzySpeed: 1.25, frenzyRange: 1.5,
  adGap: 12.0, adSimSeconds: 1.5,       // AdMinGapSeconds / AdsManager.simulatedAdSeconds
  // Skor — GameManager.CatchScore / SurviveScorePerSecond / SurviveHpBonus
  scoreCatch: 30, scoreSurviveSec: 1, scoreHpBonus: 10,
  // Tile & ukuran arena — HideSeekSetupTool.MapWidth/Height (17x11 unit)
  mapW: 17, mapH: 11, tile: 1,         // 1 tile = 1 unit dunia (PPU 128)
};

/* ------------------ ekonomi profil (koin & nyawa) — bagian ads/referral -------------------
   Nilai bisa ditimpa dari window.HIDESEEK_CONFIG.economy (web/config.js, dari .env). */
const ECONOMY = {
  coinsPerScore: 0.5,     // koin = round(score * coinsPerScore) tiap akhir ronde
  maxHpPrice: 50, maxHpCap: 2,   // beli +1 Max HP di lobby
  lifePrice: 25,                 // beli 1 nyawa cadangan tanpa iklan
  startCoins: 0,
  profileKey: 'hideseek_profile',
  /* Progres level utk layar "Game Over: XP earned" (blueprint 4.1). Web-only:
     Unity belum punya XP, jadi angka ini TIDAK dipakai di jalur C#.
     Level L dicapai pada xpForLevel(L) = levelBase * L * (L-1) / 2. */
  xpPerScore: 0.6, xpWin: 120, xpPlay: 25, levelBase: 300,
  /* papan skor lokal (top N antar sesi) */
  scoreKey: 'hideseek_scores', scoreCap: 10,
};

/**
 * Profil pemain = state yang bertahan antar ronde/refresh (koin, bonus HP,
 * nyawa cadangan, rekor). Kelas ini sengaja TIDAK menyentuh DOM supaya bisa
 * diuji headless (tools/web_ads_referral_test.js).
 */
class Profile {
  constructor(storage, cfg) {
    this.storage = (storage && typeof storage.getItem === 'function') ? storage
      : (typeof localStorage !== 'undefined' && localStorage) ? localStorage : makeMemoryStore();
    this.cfg = Object.assign({}, ECONOMY, cfg || {});
    this.key = this.cfg.profileKey;
    this.onHP = null;              // hook dari game: terapkan penyembuhan ke pemain aktif
    this.load();
  }
  load() {
    let d = {};
    try { d = JSON.parse(this.storage.getItem(this.key) || '{}') || {}; } catch (e) { d = {}; }
    this.coins = Math.max(0, d.coins | 0 || 0) || (this.cfg.startCoins | 0) || 0;
    if (!d.coins && this.cfg.startCoins) this.coins = this.cfg.startCoins | 0;
    this.bonusHp = clamp(d.bonusHp | 0, 0, this.cfg.maxHpCap);
    this.lives = Math.max(0, d.lives | 0);
    this.rounds = Math.max(0, d.rounds | 0);
    this.best = Math.max(0, d.best | 0);
    this.totalAdRewards = Math.max(0, d.totalAdRewards | 0);
    this.xp = Math.max(0, d.xp | 0);
    return this;
  }
  save() {
    try {
      this.storage.setItem(this.key, JSON.stringify({
        coins: this.coins, bonusHp: this.bonusHp, lives: this.lives,
        rounds: this.rounds, best: this.best, totalAdRewards: this.totalAdRewards,
        xp: this.xp,
      }));
    } catch (e) { /* mode privat / storage penuh: abaikan */ }
    return this;
  }
  get maxHp() { return CFG.hiderHp + this.bonusHp; }
  /** Tambah koin (n boleh negatif; tidak pernah di bawah 0). */
  addCoins(n) { this.coins = Math.max(0, this.coins + (n | 0)); this.save(); return this.coins; }
  spendCoins(n) { n = n | 0; if (n < 0 || this.coins < n) return false; this.coins -= n; this.save(); return true; }
  /**
   * +1 nyawa. Bila ada hook onHP (ronde sedang berjalan) -> langsung sembuh;
   * kalau tidak, ditahan sebagai pendingHeal utk ronde berikutnya.
   */
  addHP(n = 1) {
    n = Math.max(0, n | 0);
    const applied = this.onHP ? (this.onHP(n) | 0) : 0;      // >0 = berhasil menyembuhkan
    if (applied > 0) { this.save(); return { healed: applied, stored: 0 }; }
    this.addLife(n);                                          // di luar ronde / HP penuh -> cadangan
    return { healed: 0, stored: n };
  }
  /** Nyawa cadangan: dipakai otomatis saat pemain jadi hantu. */
  addLife(n = 1) { this.lives = Math.min(9, this.lives + (n | 0)); this.save(); return this.lives; }
  consumeLife() { if (this.lives <= 0) return false; this.lives -= 1; this.save(); return true; }
  buyMaxHp() {
    if (this.bonusHp >= this.cfg.maxHpCap) return { ok: false, why: 'bonus Max HP sudah maksimum' };
    if (!this.spendCoins(this.cfg.maxHpPrice)) return { ok: false, why: 'koin kurang (' + this.cfg.maxHpPrice + ' dibutuhkan)' };
    this.bonusHp += 1; this.save();
    return { ok: true, maxHp: this.maxHp };
  }
  buyLife() {
    if (!this.spendCoins(this.cfg.lifePrice)) return { ok: false, why: 'koin kurang (' + this.cfg.lifePrice + ' dibutuhkan)' };
    this.addLife(1);
    return { ok: true, lives: this.lives };
  }
  /* ---------- level / XP (blueprint 4.1: "XP earned" di Game Over) ---------- */
  /** XP kumulatif yang dibutuhkan untuk mencapai `level` (L1 = 0). */
  static xpForLevel(level, base) {
    const L = Math.max(1, level | 0), b = base || ECONOMY.levelBase;
    return Math.round(b * L * (L - 1) / 2);
  }
  /** Kebalikannya: level dari total XP (kurva tumbuh ~akar kuadrat). */
  static levelOf(xp, base) {
    const b = base || ECONOMY.levelBase, x = Math.max(0, xp | 0);
    return Math.max(1, Math.floor((1 + Math.sqrt(1 + 8 * x / b)) / 2));
  }
  get level() { return Profile.levelOf(this.xp, this.cfg.levelBase); }
  /** Progres dalam level berjalan: {level, from, span, need, pct}. */
  get levelProgress() {
    const L = this.level;
    const lo = Profile.xpForLevel(L, this.cfg.levelBase), hi = Profile.xpForLevel(L + 1, this.cfg.levelBase);
    const span = Math.max(1, hi - lo), from = Math.min(span, Math.max(0, this.xp - lo));
    return { level: L, from, span, need: Math.max(0, hi - this.xp), pct: Math.round(from / span * 100) };
  }
  /** Tambah XP (n >= 0); tidak menyentuh koin/HP supaya ekonomi lama tidak berubah. */
  addXp(n) {
    n = Math.max(0, n | 0); this.xp += n; this.save();
    return { xp: this.xp, gained: n, level: this.level, progress: this.levelProgress };
  }
  /**
   * Hadiah XP akhir ronde: round(skor * xpPerScore) + bonus menang + bonus main.
   * @returns {{gained:number,xp:number,level:number,progress:object,leveledTo:number}}
   */
  awardProgress(score, win) {
    const gained = Math.max(0, Math.round(Math.max(0, score | 0) * (this.cfg.xpPerScore || 0))
      + (win ? (this.cfg.xpWin | 0) : 0) + (this.cfg.xpPlay | 0));
    const before = this.level;
    const r = this.addXp(gained);
    r.leveledTo = r.level > before ? r.level : 0;
    return r;
  }
  /** Koin hasil ronde + rekor (dipanggil GameManager saat RESULT). */
  finishRound(score) {
    const gained = Math.max(0, Math.round((score | 0) * this.cfg.coinsPerScore));
    this.coins += gained; this.rounds += 1; this.best = Math.max(this.best, score | 0);
    this.save();
    return gained;
  }
  noteAdReward() { this.totalAdRewards += 1; this.save(); }
  reset() { this.coins = 0; this.bonusHp = 0; this.lives = 0; this.rounds = 0; this.best = 0; this.totalAdRewards = 0; this.xp = 0; this.save(); }
}

/**
 * Papan skor LOKAL yang bertahan antar sesi (blueprint 6.2 "leaderboard lokal
 * di localStorage"). Murni tampilan/progress: ekonomi pemain tetap di Profile
 * (+ server, kalau backend referral dibangun).
 * Data: [{name, score, role, win, ts}] urut skor desc (seri -> ts asc), maks `cap` baris.
 */
class LocalScores {
  constructor(storage, cfg) {
    this.storage = (storage && typeof storage.getItem === 'function') ? storage
      : (typeof localStorage !== 'undefined' && localStorage) ? localStorage : makeMemoryStore();
    this.cfg = Object.assign({}, ECONOMY, cfg || {});
    this.key = this.cfg.scoreKey || 'hideseek_scores';
    this.cap = Math.max(1, this.cfg.scoreCap | 0 || 10);
    this.rows = [];
    this.lastRank = 0;
    this.load();
  }
  /** Baca + buang data rusak (file localStorage diedit manual / korup). */
  load() {
    let d = [];
    try { d = JSON.parse(this.storage.getItem(this.key) || '[]'); } catch (e) { d = []; }
    if (!Array.isArray(d)) d = [];
    this.rows = d.filter(r => r && typeof r === 'object' && isFinite(+r.score) && +r.score >= 0)
      .map(r => ({
        name: String(r.name == null ? '?' : r.name).slice(0, 24),
        score: Math.round(+r.score), role: r.role === 'SEEKER' ? 'SEEKER' : 'HIDER',
        win: !!r.win, ts: +r.ts || 0,
      }))
      .sort(LocalScores.cmp).slice(0, this.cap);
    return this;
  }
  /** Urut: skor besar dulu; seri -> yang dicapai lebih dulu (ts kecil) menang. */
  static cmp(a, b) { return (b.score - a.score) || ((a.ts || 0) - (b.ts || 0)); }
  save() {
    try { this.storage.setItem(this.key, JSON.stringify(this.rows)); } catch (e) { /* mode privat */ }
    return this;
  }
  /**
   * Catat hasil satu ronde. @returns {{rank:number, rows:Array, best:number, added:boolean}}
   * `rank` = posisi baris baru di daftar (0 bila langsung terpotong oleh `cap`).
   */
  add(entry) {
    const e = entry || {};
    const row = {
      name: String(e.name == null ? 'kamu' : e.name).slice(0, 24),
      score: Math.max(0, Math.round(+e.score || 0)),
      role: e.role === 'SEEKER' ? 'SEEKER' : 'HIDER',
      win: !!e.win, ts: +e.ts || Date.now(),
    };
    this.rows.push(row);
    this.rows.sort(LocalScores.cmp);
    const rank = this.rows.indexOf(row) + 1;
    this.rows = this.rows.slice(0, this.cap);
    this.lastRank = rank;
    this.save();
    return { rank, rows: this.rows, best: this.rows.length ? this.rows[0].score : 0, added: rank > 0 && rank <= this.cap, row };
  }
  /** n teratas (default 5 = "top 5 positions" di blueprint). */
  top(n) { return this.rows.slice(0, Math.max(1, n === undefined ? 5 : n | 0)); }
  best() { return this.rows.length ? this.rows[0].score : 0; }
  clear() { this.rows = []; this.lastRank = 0; this.save(); return this; }
  /** Tanggal pendek utk baris papan skor, mis. "1 Sep". */
  static fmtDate(ts) {
    try { return new Date(ts || Date.now()).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); }
    catch (e) { return ''; }
  }
  get length() { return this.rows.length; }
}
/** Fallback storage (node / mode privat). */
function makeMemoryStore() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
/** Ambil config global (web/config.js) — aman bila tidak ada. */
function globalCfg(section) {
  const all = (typeof window !== 'undefined' && window.HIDESEEK_CONFIG) || null;
  return all && section && all[section] ? all[section] : null;
}

/* ============================ util ============================ */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const now = () => Date.now() / 1000;
const fmtTime = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const rnd = (n) => Math.floor(Math.random() * n);
const pick = arr => arr[rnd(arr.length)];
const key = (x, y) => `${x},${y}`;

/* PropDB — isi identik dengan Assets/Resources/HideSeek/Props/PropDatabase.asset */
/* PropDatabase.props (Assets/Scripts/Skills/PropDatabase.cs:51-53) + entri ke-4
   yang ditambahkan HideSeekArtInstaller (id 3 = "Peti"). Ukuran = localScale,
   karena sprite prop 128px @ PPU 128 = 1 unit dan BoxCollider2D-nya size 1x1. */
const PROPS = [
  { id: 0, name: 'Meja',      sprite: 'Prop_Table',     w: 1.6, h: 1.0 },
  { id: 1, name: 'Kursi',     sprite: 'Prop_Chair',     w: 0.8, h: 0.9 },
  { id: 2, name: 'Pot Bunga', sprite: 'Prop_FlowerPot', w: 0.7, h: 0.7 },
  { id: 3, name: 'Peti',      sprite: 'Prop_Crate',     w: 1.0, h: 1.0 },  // web-side: installer tidak menyetel scale utk id 3
];
const TILES = ['Tile_Grass', 'Tile_Sand', 'Tile_Stone', 'Tile_Wood'];

/* =============================================================================
 * MAPA — mencerminkan HideSeekSetupTool.SetupMapForScene (zoning + hedge + dekor)
 * ============================================================================= */
function pickTileIndex(gx, gy) {
  // 1:1 dengan PickTile() di HideSeekSetupTool.cs
  if (gy === 0 && Math.abs(gx) <= 8) return 2;                              // batu: jalur tengah
  if (Math.abs(gx) <= 3 && Math.abs(gy) <= 2) return 1;                     // pasir: arena tengah
  if ((gx <= -6 && gy >= 3) || (gx >= 6 && gy <= -3)) return 3;            // kayu: 2 cottage
  return 0;                                                                  // rumput: sisanya
}

function buildMap() {
  // Grid tile 17x11 (BuildPlaceholderMap: x -8..8, y -5..5) + 4 dinding box
  const cols = CFG.mapW, rows = CFG.mapH, halfX = (cols - 1) / 2, halfY = (rows - 1) / 2;
  const tiles = new Int8Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++)
    // grid gy=0 adalah baris ATAS -> dunia y = halfY - gy (Unity: y ke atas)
    tiles[gy * cols + gx] = pickTileIndex(Math.round(gx - halfX), Math.round(halfY - gy));

  // Wall("wall_top", (0,6.2), 19x0.6) dst — persis HideSeekSetupTool.Wall()
  const walls = [
    { name: 'wall_top', cx: 0, cy: 6.2, w: 19.0, h: 0.6 },
    { name: 'wall_bottom', cx: 0, cy: -6.2, w: 19.0, h: 0.6 },
    { name: 'wall_left', cx: -9.2, cy: 0, w: 0.6, h: 13.0 },
    { name: 'wall_right', cx: 9.2, cy: 0, w: 0.6, h: 13.0 },
  ];

  const map = {
    cols, rows, halfX, halfY, tiles, walls, props: [], decor: [],
    // batas arena: dinding dalam (8.9 / 5.9) dikurangi radius pemain (0.34)
    clampX: 8.9 - 0.34, clampY: 5.9 - 0.34,
    toWorldX: gx => gx - (cols - 1) / 2, toWorldY: gy => (rows - 1) / 2 - gy,
    toGrid: (wx, wy) => [Math.round(wx + (cols - 1) / 2), (rows - 1) / 2 - Math.round(wy)],
  };

  // 6 prop statis: localPosition (-6 + i*2.4, i%2==0 ? 2.5 : -2.5), entry i % Count
  for (let i = 0; i < 6; i++) {
    const def = PROPS[i % PROPS.length];
    map.props.push({ def, wx: -6 + i * 2.4, wy: (i % 2 === 0) ? 2.5 : -2.5, id: i });
  }
  // dekorasi TANPA collider: pool { bush, rocks, shrooms, bush, shrooms, rocks }
  const spots = [[-7.2, 4.1], [6.4, 3.6], [-4.1, -4.2], [3.2, -4.4], [7.4, -1.2], [-7.4, 0.6]];
  const pool = ['Bush', 'Rocks', 'Mushrooms', 'Bush', 'Mushrooms', 'Rocks'];
  spots.forEach((p, i) => map.decor.push({ sprite: pool[i], wx: p[0], wy: p[1] }));

  // Prop solid (BoxCollider2D size 1x1 * localScale), dinding solid, dekorasi tidak.
  map.solid = (wx, wy, r) => {
    for (const w of walls)
      if (Math.abs(wx - w.cx) < w.w / 2 + r && Math.abs(wy - w.cy) < w.h / 2 + r) return true;
    for (const p of map.props)
      if (Math.abs(wx - p.wx) < p.def.w / 2 + r && Math.abs(wy - p.wy) < p.def.h / 2 + r) return true;
    return false;
  };
  return map;
}

/* Posisi spawn — NetworkManager.GetSpawnPosition(): lingkaran radius 3.5 */
function spawnFor(actorNumber, playerCount) {
  const n = Math.max(2, playerCount);
  const ang = (Math.abs(actorNumber) % n) * (Math.PI * 2 / n);
  return [Math.cos(ang) * 3.5, Math.sin(ang) * 3.5];
}

/* =============================================================================
 * PLAYER STATE — mirror PlayerController + PlayerCombat + Hider/SeekerSkill
 * ============================================================================= */
class PlayerState {
  constructor(id, name, role) {
    this.id = id; this.name = name; this.role = role;      // 0 Hider, 1 Seeker
    this.x = 0; this.y = 0; this.rot = 0;
    this.maxHp = CFG.hiderHp;                                // + bonus dari profil (Profile.maxHp)
    this.hp = this.maxHp; this.ghost = (role !== 0);         // seeker tak punya HP
    this.alive = true;
    this.camoRgb = null; this.camoTarget = null;
    this.propDef = null; this.propUntil = 0;
    this.slowUntil = 0; this.slowFactor = 1;
    this.cdFreeze = 0; this.rootUntil = 0;   // skill #3 (Freeze) + root diri sendiri
    this.boostUntil = 0; this.boostMult = 1; this.boostRange = 0;
    this.pushUntil = 0; this.pushVx = 0; this.pushVy = 0;
    this.invulnUntil = 0; this.safeUntil = 0;
    this.cdHider = 0; this.cdSeeker = 0; this.lastCatch = -9;
    this.catches = 0; this.survived = 0; this.score = 0;
    this.isBot = false; this.brain = { t: 0, goal: null, mood: 0 };
    this.input = { dx: 0, dy: 0, skill1: false, skill2: false, skill3: false, tap: false };
    this.spawnX = 0; this.spawnY = 0;
  }
  get isHider() { return this.role === 0; }
  /** +1 nyawa (reward iklan/referral) — dibatasi maxHp, sesuai spesifikasi. */
  addHP(n = 1) {
    const before = this.hp;
    if (this.ghost) { this.hp = Math.min(this.maxHp, Math.max(1, n | 0)); this.ghost = false; this.alive = true; }
    else this.hp = Math.min(this.maxHp, this.hp + Math.max(0, n | 0));
    return this.hp - before;
  }
  get speedNow() {
    // PlayerController.CurrentSpeed: pushback → 0, slow → *factor, Seeker → *1.15*boost
    const t = this.round ? this.round.t : now();
    if (t < this.pushUntil) return 0;
    // PlayerController.Move: canMove = !IsGhost && !stunned && !frozenForProp -> hantu diam
    if (this.ghost) return 0;
    let s = CFG.hiderSpeed;
    if (!this.isHider) s *= CFG.seekerMult;
    if (t < this.slowUntil) s *= this.slowFactor;
    if (t < this.boostUntil) s *= this.boostMult;
    return s;
  }
}

/* =============================================================================
 * ROUND — state machine GameManager.cs (host = Authority atas phase + catch)
 *   event: phase, hit, ghost, caught, camo, prop, blast, radar, revive, slow
 * ============================================================================= */
class Round {
  constructor(opts = {}) {
    this.map = opts.map || buildMap();
    this.players = new Map();
    this.phase = 'LOBBY';
    this.phaseEnd = 0; this.t = 0; this.roundIndex = 0;
    this.hostId = opts.hostId || 1;
    this.listeners = [];
    this.seekerId = 0;
    this.blasts = [];            // {x,y,t,dur} utk VFX (SonicBlastEffect)
    this.pings = [];             // {x,y,t}   radar 1 detik
    this.results = null;
    this.lastHiderId = 0;
    this.onAds = opts.onAds || null;           // (offer, cb) -> tunjukkan rewarded ad
    this.bonusHpProvider = opts.bonusHpProvider || null;  // () => bonus Max HP dari profil (ads/referral)
  }
  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) { try { fn(ev, this); } catch (e) { console.warn(e); } } }

  add(p) { this.players.set(p.id, p); p.round = this; this.assignSpawn(p); return p; }
  assignSpawn(p) {
    // NetworkManager.GetSpawnPosition(actorNumber, playerCount) - fallback melingkar r=3.5
    let [x, y] = spawnFor(p.id, this.players.size);
    // Di Unity Rigidbody mendorong keluar sendiri; di web digeser pelan ke arah luar
    // supaya tidak "nyangkut" di dalam prop saat spawn.
    if (this.map.solid(x, y, 0.34)) {
      const m = Math.hypot(x, y) || 1;
      for (let k = 1; k <= 12; k++) {
        const nx = x + (x / m) * 0.25 * k, ny = y + (y / m) * 0.25 * k;
        if (!this.map.solid(nx, ny, 0.34)) { x = nx; y = ny; break; }
      }
    }
    p.x = p.spawnX = clamp(x, -this.map.clampX, this.map.clampX);
    p.y = p.spawnY = clamp(y, -this.map.clampY, this.map.clampY);
  }
  humans() { return [...this.players.values()].filter(p => !p.isBot); }
  living() { return [...this.players.values()].filter(p => p.alive && !p.ghost); }
  livingHiders() { return this.living().filter(p => p.isHider); }
  seeker() { return [...this.players.values()].find(p => p.role === 1) || null; }

  /* ---- Phase machine: EnterPhase + TickPhase ---- */
  start(countdown = true) {
    this.roundIndex++;
    const ps = [...this.players.values()];
    // Role: 1 seeker, sisanya hider (GameManager: MaxSeekersPerRoom = 1)
    ps.forEach(p => { p.role = 0; });
    const seeker = ps.length > 1 ? ps[this.roundIndex % ps.length] : ps[0];
    seeker.role = 1;
    this.seekerId = seeker.id;
    for (const p of ps) {
      // Max HP lokal = CFG.hiderHp + bonus profil; penyembuhan tertunda dipakai di sini.
      const isMe = p.id === this.myId;
      p.maxHp = CFG.hiderHp + (isMe && this.bonusHpProvider ? (this.bonusHpProvider() | 0) : 0);
      p.hp = p.maxHp;
      p.ghost = false; p.alive = true;
      p.camoRgb = p.camoTarget = null; p.propDef = null; p.propUntil = 0;
      p.slowUntil = 0; p.boostUntil = 0; p.pushUntil = 0; p.invulnUntil = 0; p.safeUntil = 0;
      p.cdFreeze = 0; p.rootUntil = 0;
      p.cdHider = p.cdSeeker = 0; p.catches = 0; p.survived = 0; p.score = 0; p.lastCatch = -9;
      p.input = { dx: 0, dy: 0, skill1: false, skill2: false, skill3: false, tap: false };
      this.assignSpawn(p);
    }
    this.results = null;
    if (this.phase === 'RESULT') clearInterval(this._resultIv);
    this.enterPhase(countdown ? 'COUNTDOWN' : 'HIDE');
  }
  enterPhase(name) {
    const dur = { COUNTDOWN: CFG.countdown, HIDE: CFG.hide, SEEK: CFG.seek, RESULT: CFG.result, LOBBY: 0 }[name] || 0;
    this.phase = name; this.phaseEnd = this.t + dur;
    if (name === 'SEEK') this.hideEnd = this.t;
    if (name === 'RESULT') this.finish();
    // Kuota reward direset tiap ronde (RewardOffers.ResetRound)
    if (name === 'HIDE') this.resetRewards();
    this.emit({ type: 'phase', name, dur });
  }
  tickPhase() {
    if (this.phase === 'LOBBY') return;
    if (this.t < this.phaseEnd) return;
    switch (this.phase) {
      case 'COUNTDOWN': this.enterPhase('HIDE'); break;
      case 'HIDE': this.enterPhase('SEEK'); break;
      case 'SEEK': this.enterPhase('RESULT'); break;
      case 'RESULT': this.start(true); break;        // auto-continue (seperti AutoStartNextRound)
    }
  }
  get timeLeft() { return Math.max(0, this.phaseEnd - this.t); }

  /* ---- gerakan + tabrakan (PlayerController.Move + Ground collider) ---- */
  movePlayer(p, dt) {
    const s = p.speedNow;
    let vx = p.input.dx, vy = p.input.dy;
    // Freeze mengunci gerak pemakainya sendiri selama CFG.freezeRoot (tradeoff desain).
    if (this.t < p.rootUntil) { vx = 0; vy = 0; }
    const mag = Math.hypot(vx, vy);
    if (mag > 1) { vx /= mag; vy /= mag; }
    // Pushback (PlayerController.ApplyPushback coroutine) memakai jaraknya sendiri,
    // bukan CurrentSpeed — di Unity CurrentSpeed di-zero-kan selama pushback.
    const pushing = this.t < p.pushUntil;
    if (pushing) { vx = p.pushVx; vy = p.pushVy; }
    const step = (pushing ? CFG.pushback / CFG.pushbackTime : s) * dt;
    const r = 0.34;
    const tryAxis = (nx, ny) => !this.map.solid(nx, ny, r);
    let nx = p.x + vx * step;
    if (tryAxis(nx, p.y)) p.x = clamp(nx, -this.map.clampX, this.map.clampX);
    let ny = p.y + vy * step;
    if (tryAxis(p.x, ny)) p.y = clamp(ny, -this.map.clampY, this.map.clampY);
    p.moving = mag > 0.05;
    if (p.moving) p.rot = Math.atan2(vy, vx);          // OnPhotonSerializeView mengirim rot
    // Prop Swap dibatalkan saat pemain bergerak (HiderSkill.UsePropSwap)
    if (p.moving && p.propDef && this.t < p.propUntil) { p.propDef = null; this.emit({ type: 'propCancel', id: p.id }); }
    if (p.propDef && this.t > p.propUntil) p.propDef = null;
    // Opsional: transisi warna halus. Di Unity PlayerVisual.TintAll instan, jadi
    // CFG.camoLerp = 0 (diisi >0 hanya kalau mau efek fade di renderer).
    if (CFG.camoLerp > 0 && p.camoTarget) {
      if (!p.camoRgb) p.camoRgb = p.camoTarget.slice();
      const k = 1 - Math.exp(-dt / CFG.camoLerp);
      for (let i = 0; i < 3; i++) p.camoRgb[i] = lerp(p.camoRgb[i], p.camoTarget[i], k);
    }
    // Skor bertahan (GameManager.BuildLeaderboard: waktu hidup)
    if (p.isHider && !p.ghost && (this.phase === 'HIDE' || this.phase === 'SEEK')) p.survived += dt;
  }

  /* ---- Camo: rata2 warna tile tanah di bawah kaki (CamouflageHelper.MatchColorToGround) ---- */
  sampleGroundColor(p) {
    const [gx, gy] = this.map.toGrid(p.x, p.y);
    const i = clamp(gy, 0, this.map.rows - 1) * this.map.cols + clamp(gx, 0, this.map.cols - 1);
    return this.tileRgb ? this.tileRgb[this.map.tiles[i]] : [255, 255, 255];
  }
  useCamouflage(p) {
    if (!p.isHider || this.t < p.cdHider || p.ghost) return false;
    p.cdHider = this.t + CFG.hiderCd;
    p.camoTarget = this.sampleGroundColor(p);
    p.camoRgb = p.camoTarget.slice();     // PlayerVisual.TintAll: warna langsungApply (tanpa lerp)
    p.propDef = null;                                   // keluar dari wujud prop (CancelPropVisual)
    this.emit({ type: 'camo', id: p.id, rgb: p.camoTarget, cd: CFG.hiderCd });
    return true;
  }
  /**
   * Kandidat prop di sekitar pemain (blueprint 3.2: tombol Prop = tahan -> seret -> lepas).
   * Hanya prop yang BENAR-BENAR ada di dekatnya yang boleh dipilih, supaya mode aim tidak
   * berubah jadi "pilih sprite apa saja dari menu".
   * @returns {Array<{name:string, wx:number, wy:number, def:object}>} tanpa duplikat nama
   */
  propCandidates(p, radius) {
    const rad = radius === undefined ? CFG.propAimRadius : radius;
    const out = [];
    if (!p || !this.map || !this.map.props) return out;
    for (const pr of this.map.props) {
      if (!pr || !pr.def) continue;
      if (dist(p.x, p.y, pr.wx, pr.wy) > rad) continue;
      if (!out.some(c => c.name === pr.def.name)) out.push({ name: pr.def.name, wx: pr.wx, wy: pr.wy, def: pr.def });
    }
    return out;
  }
  /**
   * PROP SWAP. `wantName` terisi = mode aim (prop yang dipilih; harus juga ada dalam
   * radius pemain). Kosong / tidak valid = perilaku lama: prop acak yang ada di peta.
   */
  usePropSwap(p, wantName) {
    if (!p.isHider || this.t < p.cdHider || p.ghost) return false;
    p.cdHider = this.t + CFG.hiderCd;
    let def = null, aimed = false;
    if (wantName) {
      const cand = this.propCandidates(p).find(c => c.name === wantName);
      if (cand) { def = cand.def; aimed = true; }
    }
    if (!def) { const any = this.propCandidates(p, 1e6); def = any.length ? pick(any).def : pick(PROPS); }
    p.propDef = def;
    p.propUntil = this.t + CFG.propSwapTime;
    p.camoTarget = null; p.camoRgb = null;
    this.emit({ type: 'prop', id: p.id, prop: p.propDef.name, dur: CFG.propSwapTime, aimed });
    return true;
  }
  /**
   * FREEZE (skill #3 Hider): memperlambat semua Seeker dalam radius + mengunci gerak
   * pemakainya sebentar. Padanan C#: HiderSkill.CastFreeze -> EvtSlow (Net.SyncSlow).
   * Cooldown sendiri (CFG.freezeCd) supaya tidak merebut slot Camo/Prop.
   */
  useFreeze(p) {
    if (!p || !p.isHider || p.ghost || this.t < p.cdFreeze) return false;
    p.cdFreeze = this.t + CFG.freezeCd;
    p.rootUntil = this.t + CFG.freezeRoot;
    const hits = [];
    for (const q of this.players.values()) {
      if (q.isHider) continue;                                    // hanya Seeker yang ikut membeku
      if (q.ghost && q.isHider) continue;                          // (hantu hider tidak relevan)
      if (dist(p.x, p.y, q.x, q.y) > CFG.freezeRadius) continue;
      q.slowUntil = this.t + CFG.freezeTime;
      q.slowFactor = Math.min(q.slowFactor, CFG.freezeSlow);       // jangan menimpa slow yang lebih kuat
      hits.push(q.id);
    }
    this.emit({ type: 'freeze', id: p.id, x: p.x, y: p.y, r: CFG.freezeRadius, hits, dur: CFG.freezeTime });
    return true;
  }
  useRadar(p) {
    if (p.role !== 1 || this.t < p.cdSeeker) return false;
    p.cdSeeker = this.t + CFG.seekerCd;
    const tgt = this.livingHiders().sort((a, b) =>
      dist(a.x, a.y, p.x, p.y) - dist(b.x, b.y, p.x, p.y))[0];
    if (tgt) this.pings.push({ x: tgt.x, y: tgt.y, t: this.t, dur: 1.0 });  // RadarPingDuration
    this.emit({ type: 'radar', id: p.id, cd: CFG.seekerCd, target: tgt ? tgt.id : 0 });
    return true;
  }
  useSonicBlast(p) {
    if (p.role !== 1 || this.t < p.cdSeeker) return false;
    p.cdSeeker = this.t + CFG.seekerCd;
    this.blasts.push({ x: p.x, y: p.y, t: this.t, dur: 0.45 });
    const r2 = CFG.blastRadiusSqr;
    for (const h of this.livingHiders()) {
      const dx = h.x - p.x, dy = h.y - p.y;
      if (dx * dx + dy * dy > r2) continue;             // SeekerSkill.RpcSonicBlast
      h.slowUntil = this.t + CFG.slowTime; h.slowFactor = CFG.slowFactor;
      this.emit({ type: 'slow', id: h.id, dur: CFG.slowTime, factor: CFG.slowFactor });
    }
    this.emit({ type: 'blast', id: p.id, x: p.x, y: p.y, cd: CFG.seekerCd });
    return true;
  }
  /* ---- tangkap: tap (RequestCatch) + kontak seeker (RpcHitRequest) ---- */
  tryCatch(seeker, x, y) {
    if (this.phase !== 'SEEK' || seeker.role !== 1 || seeker.ghost) return;
    if (this.t - seeker.lastCatch < CFG.catchTapInterval) return;
    seeker.lastCatch = this.t;
    let best = null, bd = Infinity;
    for (const h of this.livingHiders()) {
      if (this.t < h.invulnUntil || this.t < h.safeUntil) continue;
      const d = dist(h.x, h.y, x, y);
      if (d <= CFG.catchRange && d < bd) { bd = d; best = h; }
    }
    if (!best) return;
    // Bonus jangkauan dari frenzy (RpcHitRequest: range * bonus) — di sini sudah tercakup di rangeCheck
    if (this.t < seeker.boostUntil) { /* frenzy: jangkauan +bonus, lihat boostRange */ }
    this.hit(best.id, seeker.id, false);
  }
  checkContact(dt) {
    if (this.phase !== 'SEEK') return;
    const s = this.seeker(); if (!s || s.ghost) return;
    for (const h of this.livingHiders()) {
      if (this.t < h.invulnUntil || this.t < h.safeUntil) continue;
      if (dist(h.x, h.y, s.x, s.y) > 0.85) continue;    // jarak "kontak" ketat
      this.hit(h.id, s.id, true);
    }
  }
  hit(hiderId, seekerId, isContact) {
    const h = this.players.get(hiderId), s = this.players.get(seekerId);
    if (!h || !s || h.ghost) return;
    // PlayerCombat.ApplyHit: grace period setelah kena (anti one-click-kill)
    // + jendela aman setelah revive (RewardOffers / ReviveSafeWindow).
    if (this.t < h.invulnUntil || this.t < h.safeUntil) return;
    h.hp -= 1;
    h.invulnUntil = this.t + CFG.invuln;
    // Pushback 3 unit menjauh dari seeker (PlayerCombat.ApplyHit + ClampMagnitude)
    let dx = h.x - s.x, dy = h.y - s.y;
    let m = Math.hypot(dx, dy); if (m < 1e-4) { dx = 1; dy = 0; m = 1; }
    h.pushVx = dx / m; h.pushVy = dy / m;   // arah satuan; jarak CFG.pushback dibagi selama pushbackTime
    h.pushUntil = this.t + CFG.pushbackTime;
    if (s.isHider === false) { s.catches += 1; }
    this.emit({ type: 'hit', id: h.id, by: s.id, hp: h.hp });
    if (h.hp <= 0) this.kill(h, s);
  }
  kill(h, by) {
    h.ghost = true; h.alive = false; h.hp = 0;
    h.camoRgb = h.camoTarget = null; h.propDef = null;
    this.emit({ type: 'ghost', id: h.id, by: by ? by.id : 0 });
    // "Hider terakhir yang hidup" — GameManager.NotifyDeath
    const left = this.livingHiders();
    if (left.length === 1) this.lastHiderId = left[0].id;
    if (left.length === 0 && this.phase === 'SEEK') this.enterPhase('RESULT');
  }
  skipCooldown(id) {
    const p = this.players.get(id); if (!p) return;
    if (p.isHider) p.cdHider = this.t; else p.cdSeeker = this.t;
    this.emit({ type: 'skip', id });
  }
  applyFrenzy(id) {
    const p = this.players.get(id); if (!p) return;
    p.boostUntil = this.t + CFG.frenzyTime;
    p.boostMult = CFG.frenzySpeed; p.boostRange = CFG.frenzyRange;
    this.emit({ type: 'frenzy', id, dur: CFG.frenzyTime });
  }
  revive(id) {
    const p = this.players.get(id);
    if (!p || !p.ghost || this.phase === 'RESULT' || this.phase === 'LOBBY') return false;
    p.hp = CFG.reviveHp; p.ghost = false; p.alive = true;
    p.safeUntil = this.t + CFG.reviveSafeWindow;   // GraceWindowAfterRevive
    p.x = p.spawnX; p.y = p.spawnY;
    this.emit({ type: 'revive', id, safe: CFG.reviveSafeWindow });
    return true;
  }

  /* ---- hasil + leaderboard (BuildLeaderboard) ---- */
  finish() {
    const hiders = this.livingHiders();
    const seeker = this.seeker();
    const hidersWin = hiders.length > 0;
    const rows = [...this.players.values()].map(p => {
      p.score = p.isHider
        ? Math.floor(p.survived) * CFG.scoreSurviveSec + p.hp * CFG.scoreHpBonus
        : p.catches * CFG.scoreCatch;
      return p;
    }).sort((a, b) => b.score - a.score);
    this.results = {
      hidersWin, round: this.roundIndex,
      lastHider: this.players.get(this.lastHiderId) || null,
      totalCaught: [...this.players.values()].filter(p => p.isHider && p.ghost).length,
      board: rows.map(p => ({
        id: p.id, name: p.name, role: p.isHider ? 'HIDER' : 'SEEKER', score: p.score,
        detail: p.isHider ? (p.ghost ? `tertangkap` : `HP ${p.hp} · ${p.survived.toFixed(0)}s`) : `${p.catches} tangkap`,
        me: !p.isBot, ghost: p.ghost,
      })),
    };
    if (hidersWin && this.lastHiderId) {
      const l = this.players.get(this.lastHiderId);
      if (l) this.results.board.forEach(r => { if (r.id === l.id) r.detail += ' · TERAKHIR HIDUP'; });
    }
    this.emit({ type: 'result', results: this.results });
  }

  resetRewards() {
    this.rewardQuota = { revive: CFG.maxRevives, skip: CFG.maxSkips, frenzy: CFG.maxFrenzies };
    this.lastAdAt = -99;
  }
  /* Penawaran reward — RewardOffers.RefreshButtons/OnOfferClicked */
  currentOffer(p) {
    if (!p || !this.rewardQuota) return null;
    if (p.ghost && this.rewardQuota.revive > 0) return { key: 'revive', label: `Nonton iklan → hidup lagi (${this.rewardQuota.revive}×)` };
    if (!p.isHider && this.rewardQuota.frenzy > 0) return { key: 'frenzy', label: `Iklan → Frenzy ${CFG.frenzyTime}s` };
    const cd = Math.max(0, (p.isHider ? p.cdHider : p.cdSeeker) - this.t);
    if (cd > 0.5 && this.rewardQuota.skip > 0) return { key: 'skip', label: `Iklan → reset skill (${this.rewardQuota.skip}×)` };
    return null;
  }
  redeem(key) {
    const p = this.me();
    const off = this.currentOffer(p);
    if (!p || !off || off.key !== key) return false;
    if (this.t - this.lastAdAt < CFG.adGap) { this.emit({ type: 'adNote', text: 'terlalu sering — tunggu sebentar' }); return false; }
    if (this.rewardQuota[key] <= 0) return false;
    const grant = () => {
      this.rewardQuota[key] -= 1; this.lastAdAt = this.t;
      if (key === 'revive') this.revive(p.id);
      else if (key === 'skip') this.skipCooldown(p.id);
      else this.applyFrenzy(p.id);
      this.emit({ type: 'adNote', text: 'hadiah diterima ✓' });
    };
    // SHOW_REWARD == jalur AdsManager.simulateAds (tanpa SDK / tanpa internet)
    if (this.onAds) this.onAds(off, ok => { if (ok) grant(); else this.emit({ type: 'adNote', text: 'iklan dibatalkan — hadiah tidak diberikan' }); });
    else grant();
    return true;
  }

  /* ---- bots (pengganti pemain lain saat offline test) ---- */
  botThink(dt) {
    for (const p of this.players.values()) {
      if (!p.isBot) continue;
      const b = p.brain; b.t -= dt;
      const seeker = this.seeker();
      if (p.ghost) { p.input.dx = p.input.dy = 0; continue; }
      if (p.isHider) {
        const sd = seeker && !seeker.ghost ? dist(p.x, p.y, seeker.x, seeker.y) : 999;
        // Verbose logika: during HIDE → cari spot; during SEEK → kabur / diam jadi prop
        if (this.phase === 'HIDE') {
          if (b.t <= 0 || !b.goal) { b.goal = this.pickHidingSpot(p); b.t = 3 + Math.random() * 2; }
          const g = b.goal;
          if (g && dist(p.x, p.y, g[0], g[1]) > 0.35) { p.input.dx = Math.sign(g[0] - p.x); p.input.dy = Math.sign(g[1] - p.y); }
          else { p.input.dx = p.input.dy = 0; if (Math.random() < 0.02) p.input.skill2 = true; else if (Math.random() < 0.02) p.input.skill1 = true; }
        } else if (this.phase === 'SEEK') {
          if (sd < 3.4) {                      // kabur menjauhi seeker
            p.input.dx = Math.sign(p.x - seeker.x) || (Math.random() < .5 ? 1 : -1);
            p.input.dy = Math.sign(p.y - seeker.y) || (Math.random() < .5 ? 1 : -1);
            if (sd < 2.6 && Math.random() < 0.06) p.input.skill2 = true;   // sembunyi jadi prop
            if (Math.random() < 0.03) p.input.skill1 = true;
            // mepet sekali -> bekukan Seeker (skill #3, cooldown sendiri)
            if (sd < 3.2 && this.t >= p.cdFreeze && Math.random() < 0.05) p.input.skill3 = true;
          } else if (sd < 6 && p.propDef === null && Math.random() < 0.01) { p.input.skill1 = true; p.input.dx = p.input.dy = 0; }
          else { p.input.dx = p.input.dy = 0; if (Math.random() < 0.004) { b.goal = this.pickHidingSpot(p); } else if (b.goal && Math.random() < 0.02) { p.input.dx = Math.sign(b.goal[0] - p.x) * .6; p.input.dy = Math.sign(b.goal[1] - p.y) * .6; } }
        } else { p.input.dx = p.input.dy = 0; }
      } else {                                   // seeker bot: dekati hider terdekat
        const t = this.livingHiders().sort((a, c) => dist(a.x, a.y, p.x, p.y) - dist(c.x, c.y, p.x, p.y))[0];
        p.input.skill1 = p.input.skill2 = p.input.skill3 = p.input.tap = false;
        if (!t) { p.input.dx = p.input.dy = 0; continue; }
        const d = dist(t.x, t.y, p.x, p.y);
        let ax = (t.x - p.x) / (d || 1), ay = (t.y - p.y) / (d || 1);
        // halangi dinding: coba geser tegak lurus (steer)
        if (this.map.solid(p.x + ax * .4, p.y + ay * .4, .34)) {
          const alt = [[ax, -ay], [-ax, ay], [-ay, ax], [ay, -ax]];
          for (const [bx, by] of alt) if (!this.map.solid(p.x + bx * .4, p.y + by * .4, .34)) { ax = bx; ay = by; break; }
        }
        p.input.dx = ax; p.input.dy = ay;
        if (d < 2.2 && Math.random() < 0.25) p.input.skill2 = true;         // SonicBlast
        else if (Math.random() < 0.02) p.input.skill1 = true;               // Radar
        if (d <= CFG.catchRange * 0.5) p.input.tap = true;
      }
    }
  }
  pickHidingSpot(p) {
    const near = [...this.map.props, ...this.map.decor.map(d => ({ wx: d.wx, wy: d.wy }))];
    const cand = near.map(o => [o.wx + (Math.random() - .5) * 1.6, o.wy + (Math.random() - .5) * 1.6]);
    cand.push([p.spawnX + (Math.random() - .5) * 3, p.spawnY + (Math.random() - .5) * 3]);
    cand.sort((a, b) => dist(a[0], a[1], p.x, p.y) - dist(b[0], b[1], p.x, p.y));
    for (const c of cand) if (!this.map.solid(c[0], c[1], .34)) return c;
    return [p.x, p.y];
  }

  /* ---- satu langkah simulasi (dipanggil host; client cuma applySnapshot) ---- */
  step(dt) {
    this.t += dt;
    this.botThink(dt);
    for (const p of this.players.values()) { this.consumeSkills(p); this.movePlayer(p, dt); }
    this.checkContact(dt);
    // bersihkan VFX kadaluarsa
    this.blasts = this.blasts.filter(b => this.t - b.t < b.dur + .2);
    this.pings = this.pings.filter(b => this.t - b.t < b.dur + .1);
    this.tickPhase();
  }
  consumeSkills(p) {
    if (p.ghost && p.isHider) { p.input.skill1 = p.input.skill2 = p.input.skill3 = false; return; }
    if (p.input.skill1) { p.input.skill1 = false; if (p.isHider) this.useCamouflage(p); else this.useRadar(p); }
    if (p.input.skill2) {
      p.input.skill2 = false;
      if (p.isHider) { const nm = p.pendingPropName; p.pendingPropName = null; this.usePropSwap(p, nm); }
      else this.useSonicBlast(p);
    }
    if (p.input.skill3) { p.input.skill3 = false; if (p.isHider) this.useFreeze(p); }
    if (p.input.tap) { p.input.tap = false; if (!p.isHider) this.tryCatch(p, p.x, p.y); }
  }
  me() { return this.myId ? this.players.get(this.myId) : null; }

  /* ---- serialisasi (parity OnPhotonSerializeView / RpcChangePhase) ---- */
  snapshot() {
    return {
      t: this.t, phase: this.phase, phaseEnd: this.phaseEnd, round: this.roundIndex,
      seekerId: this.seekerId, lastHider: this.lastHiderId,
      quota: this.rewardQuota, lastAdAt: this.lastAdAt,
      blast: this.blasts.map(b => [b.x, b.y, b.t]), ping: this.pings.map(b => [b.x, b.y, b.t]),
      pl: [...this.players.values()].map(p => ({
        i: p.id, n: p.name, r: p.role, x: +p.x.toFixed(3), y: +p.y.toFixed(3), rot: +p.rot.toFixed(2),
        hp: p.hp, g: p.ghost, camo: p.camoRgb, pr: p.propDef ? p.propDef.id : -1,
        cd1: +(p.cdHider - this.t).toFixed(2), cd2: +(p.cdSeeker - this.t).toFixed(2),
        ct: p.catches, sv: +p.survived.toFixed(1), bot: !!p.isBot, sl: this.t < p.slowUntil, bo: this.t < p.boostUntil,
      })),
    };
  }
  applySnapshot(s) {
    this.t = s.t; this.phase = s.phase; this.phaseEnd = s.phaseEnd; this.roundIndex = s.round;
    this.seekerId = s.seekerId; this.lastHiderId = s.lastHider; this.rewardQuota = s.quota; this.lastAdAt = s.lastAdAt;
    this.blasts = (s.blast || []).map(a => ({ x: a[0], y: a[1], t: a[2], dur: .45 }));
    this.pings = (s.ping || []).map(a => ({ x: a[0], y: a[1], t: a[2], dur: 1 }));
    for (const d of s.pl) {
      let p = this.players.get(d.i);
      if (!p) { p = new PlayerState(d.i, d.n, d.r); this.add(p); }
      p.name = d.n; p.role = d.r; p.x = d.x; p.y = d.y; p.rot = d.rot; p.hp = d.hp; p.ghost = d.g;
      p.camoRgb = d.camo; p.camoTarget = d.camo;
      p.propDef = d.pr >= 0 ? PROPS[d.pr] : null;
      p.cdHider = this.t + Math.max(0, d.cd1); p.cdSeeker = this.t + Math.max(0, d.cd2);
      p.catches = d.ct; p.survived = d.sv; p.isBot = d.bot;
      p.slowUntil = d.sl ? Math.max(p.slowUntil, this.t + .2) : p.slowUntil;
      p.boostUntil = d.bo ? Math.max(p.boostUntil, this.t + .2) : p.boostUntil;
    }
    for (const id of [...this.players.keys()]) if (!s.pl.some(d => d.i === id)) this.players.delete(id);
    this.emit({ type: 'phase', name: this.phase, dur: this.timeLeft });
  }
}

/* =============================================================================
 * BROWSER LAYER — asset, renderer, HUD, input, net client, "iklan"
 * ============================================================================= */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CFG, ECONOMY, Profile, LocalScores, Round, PlayerState, buildMap, spawnFor, PROPS, TILES, clamp, dist, fmtTime, makeMemoryStore };
}

if (typeof document !== 'undefined') (function boot() {
  /* ---------- assets ---------- */
  const names = ['Chameleon_Hider', 'Chameleon_Seeker', 'Hedge_Wall', 'Bush', 'Rocks', 'Mushrooms',
    'Prop_Table', 'Prop_Chair', 'Prop_FlowerPot', 'Prop_Crate', 'Tile_Grass', 'Tile_Sand', 'Tile_Stone',
    'Tile_Wood', 'Icon_Camouflage', 'Icon_PropSwap', 'Icon_Radar', 'Icon_SonicBlast', 'Icon_Revive', 'Bg_Lobby'];
  const SPR = {}, tintCache = new Map();
  let pending = names.length, assetsReady = false, tileRgbDone = false, loaded = 0;
  // Semua sprite (atau error) sudah datang -> warna tile boleh dihitung.
  const onAll = () => { if (--pending <= 0) { assetsReady = true; startGame(); } };
  for (const n of names) {
    const img = new Image();
    img.onload = img.onerror = () => { loaded++; splashProgress(loaded); onAll(); };
    img.src = 'assets/' + n + '.png';
    SPR[n] = img;
  }
  /** Progres loading di splash (blueprint: Splash Screen = logo + indikator). */
  const SPLASH_TIPS = [
    'Tekan <span class="kbd">1</span> untuk menyatu dengan lantai.',
    'Diam di dekat prop lalu tekan <span class="kbd">2</span> = menyamar jadi barang.',
    'Bergerak saat menyamar jadi prop = samaran batal!',
    'Seeker pakai <span class="kbd">Q</span> Radar untuk membocorkan posisi 1 detik.',
    'Sonic Blast (<span class="kbd">E</span>) memperlambat & mendorong hider.',
    'HP habis? Tonton <b>📺 +1 Nyawa</b> — sekali tiap 30 detik.',
  ];
  let splashDone = false, tipIdx = 0;
  function splashProgress(n) {
    const pct = Math.round(100 * n / names.length);
    const bar = $('splashBar'), txt = $('splashPct');
    if (bar && bar.style) bar.style.width = pct + '%';
    if (txt) txt.textContent = 'MEMUAT ' + pct + '%';
    if (pct >= 100) hideSplash();
  }
  function hideSplash() {
    if (splashDone) return; splashDone = true;
    const el = $('splash'); if (el) el.className = 'screen out';
    const sp = $('splashSpinner'); if (sp) sp.className = 'spinner done';
    splashProgress._iv && clearInterval(splashProgress._iv);
    if (screens && !started) screens.show(queryFlag('solo') === '1' ? 'game' : 'menu');
  }
  if (document.addEventListener) {   // tap = skip splash (mobile: jangan bikin orang menunggu)
    const skip = () => hideSplash();
    document.addEventListener('pointerdown', skip, { once: true, passive: true });
  }
  splashProgress._iv = setInterval(() => {
    if (splashDone) return;
    tipIdx = (tipIdx + 1) % SPLASH_TIPS.length;
    const t = $('splashTip'); if (t) t.innerHTML = 'Tips: ' + SPLASH_TIPS[tipIdx];
  }, 2600);

  function tinted(name, rgb) {
    if (!rgb) return SPR[name];
    const k = name + '|' + rgb.join(',');
    if (tintCache.has(k)) return tintCache.get(k);
    const src = SPR[name];
    const c = document.createElement('canvas');
    c.width = src.naturalWidth || 192; c.height = src.naturalHeight || 192;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    // CamouflageHelper.ApplyCamoMaterials: color = ground * 1.25f (dibolehkan >1 → putih tersaturasi)
    const f = 1.25;
    g.fillStyle = `rgb(${clamp(rgb[0] * f, 0, 255) | 0},${clamp(rgb[1] * f, 0, 255) | 0},${clamp(rgb[2] * f, 0, 255) | 0})`;
    g.fillRect(0, 0, c.width, c.height);
    tintCache.set(k, c);
    return c;
  }

  /* ---------- rata-rata warna tiap tile (sumber "Match Color") ---------- */
  let tileRgb = null;
  function computeTileColors() {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    tileRgb = TILES.map(name => {
      g.clearRect(0, 0, 16, 16);
      g.drawImage(SPR[name], 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 8) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
      return n ? [Math.round(r / n), Math.round(gg / n), Math.round(b / n)] : [255, 255, 255];
    });
  }

  const $ = id => document.getElementById(id);
  const cv = $('game'), ctx = cv.getContext('2d');
  const mm = $('minimap'), mg = mm.getContext('2d');
  let ROUND = null, map = null, DPR = 1, cssW = 0, cssH = 0, scale = 40, ox = 0, oy = 0;
  let fitScale = 40, cam = null;                // kamera (follow+zoom); fitScale = skala "seluruh peta"
  /* Mode aim utk skill Prop (blueprint 3.2: tahan -> seret -> lepas). */
  const aim = { on: false, id: null, wx: 0, wy: 0, t0: 0, moved: false, pick: null };
  let netMode = 'solo', net = null, started = false;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cssW = cv.clientWidth; cssH = cv.clientHeight;
    cv.width = Math.round(cssW * DPR); cv.height = Math.round(cssH * DPR);
    if (!map) return;
    fitScale = Math.min(cssW / (map.cols + 1), cssH / (map.rows + 1)) * DPR;
    applyCam();                                 // scale/ox/oy = f(fitScale, kamera)
    mm.width = mm.clientWidth * DPR; mm.height = mm.clientHeight * DPR;
  }
  addEventListener('resize', resize);

  const W2SX = wx => ox + wx * scale, W2SY = wy => oy - wy * scale;
  const SX2W = sx => (sx - ox) / scale, SY2W = sy => (oy - sy) / scale;

  /* ---------- UI kit (uiKit.js) + audio (audioKit.js) — keduanya opsional ---------- */
  const UI = (typeof window !== 'undefined' && window.BungUI) || null;
  const AU = (typeof window !== 'undefined' && window.BungAudio) || null;
  const queryFlag = k => { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } };
  const UI_KEY = 'hideseek_ui';
  function loadUiPrefs() {
    try { return Object.assign({ haptics: true, lang: 'id', orient: 'any', lb: false, sens: 1 }, JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}); }
    catch (e) { return { haptics: true, lang: 'id', orient: 'any', lb: false, sens: 1 }; }
  }
  const uiPrefs = loadUiPrefs();
  function saveUiPrefs() { try { localStorage.setItem(UI_KEY, JSON.stringify(uiPrefs)); } catch (e) { } }
  if (UI && UI.Haptics) UI.Haptics.enabled = uiPrefs.haptics !== false;
  /** Semua panggilan audio/getar aman: dibungkam kalau script/audio tidak ada. */
  const sfx = (n, g) => { try { if (AU) AU.sfx(n, g); } catch (e) { /* tanpa AudioContext */ } };
  const haptic = k => { try { if (UI && UI.Haptics && uiPrefs.haptics !== false) UI.Haptics[k](); } catch (e) { } };
  /** Pemasangan handler null-safe (id boleh tidak ada di DOM). */
  function onClick(id, fn) {
    const el = $(id); if (!el) return false;
    el.onclick = (e) => { sfx('tap'); haptic('tap'); return fn(e); };
    return true;
  }
  function setCls(id, cls) { const el = $(id); if (el) el.className = cls; }
  function setTxt(id, v) { const el = $(id); if (el) el.textContent = v; }

  /* layar: splash -> menu -> lobby -> (game) -> result, + modal pause/settings/howto */
  const SCREEN_NAMES = ['splash', 'menu', 'lobby', 'result', 'pausePanel', 'settingsPanel', 'howtoPanel'];
  const screens = UI ? new UI.Screens(SCREEN_NAMES, { getElementById: id => $(id), onChange: onScreenChange }) : null;
  let paused = false;
  const fx = UI ? new UI.Fx($('fx'), { project: (wx, wy) => ({ x: W2SX(wx) / (DPR || 1), y: W2SY(wy) / (DPR || 1) }) }) : null;
  /* Partikel canvas (web/particles.js) — opsional; kalau scriptnya hilang game tetap jalan. */
  const FXp = (typeof window !== 'undefined' && window.BungFX) || null;
  const parts = FXp ? new FXp({ max: 180 }) : null;
  let dustAt = 0;
  /**
   * Goyang layar singkat = padanan "camera shake saat caught" (blueprint 5.2).
   * power 1..3 (durasinya ikut naik). Kelas `shake-N` menggerakkan #stage, jadi
   * kanvas + HUD ikut bergoyang; dihormati juga oleh prefers-reduced-motion.
   */
  function shake(power) {
    const el = $('stage'); if (!el) return;
    if (parts && parts.reduced) return;
    const pw = clamp(Math.round(power || 1), 1, 3);
    el.className = ((el.className || '').replace(/\s*shake(-[123])?/g, '')) + ' shake shake-' + pw;
    clearTimeout(shake._t);
    shake._t = setTimeout(() => { el.className = (el.className || '').replace(/\s*shake(-[123])?/g, ''); }, 240 + pw * 70);
  }
  /** Debu kaki saat pemain lokal berlari (dibatasi ~7 semburan/detik). */
  function dustStep(dt) {
    if (!parts || !ROUND || paused) return;
    const p = ROUND.me(); if (!p || p.ghost) return;
    const ph = ROUND.phase; if (ph !== 'HIDE' && ph !== 'SEEK') return;
    dustAt -= dt;
    if (dustAt > 0 || !(p.speedNow > 1.2)) return;
    dustAt = 0.14;
    parts.emit('dust', p.x, p.y - 0.4, { count: 3, dir: Math.PI, spread: 0.5, speed: 0.45 + p.speedNow * 0.12 });
  }
  if (UI && UI.Viewport) UI.Viewport.init();

  /* ---------- kamera: padanan web dari Utils/PlayerCamera.cs ----------
     zoom 1.0 = seluruh peta terlihat -> zoom > 1 hanya MEMOTONG peta, jadi tidak
     pernah ada tepi hitam. Diam = dekat (camIdle), lari = melebar (camRun),
     fase SEEK = paling lebar (camSeek). Matikan dengan ?cam=0. */
  cam = UI && UI.Camera ? new UI.Camera({
    enabled: queryFlag('cam') !== '0',
    zoomIdle: CFG.camIdle, zoomRun: CFG.camRun, zoomSeek: CFG.camSeek,
    runSpeed: CFG.camRunSpeed, smooth: CFG.camSmooth,
  }) : null;
  /** Ukuran view dalam unit dunia (dipakai clamp kamera). */
  function camViewUnits() {
    const z = cam ? Math.max(0.2, cam.zoom) : 1;
    return { w: (cssW * DPR) / (fitScale * z), h: (cssH * DPR) / (fitScale * z) };
  }
  /** Tulis hasil kamera ke variabel proyeksi (W2SX/SX2W & FX memakai ini). */
  function applyCam() {
    if (!map) return;
    if (!cam) { scale = fitScale; ox = cssW * DPR / 2; oy = cssH * DPR / 2; return; }
    const a = cam.apply(fitScale, cssW * DPR, cssH * DPR);
    scale = a.scale; ox = a.ox; oy = a.oy;
  }
  /** Satu langkah follow+zoom per frame (dibekukan saat pause agar tidak melayang). */
  /* ---------- mode aim utk skill Prop (blueprint 3.2: tahan -> seret -> lepas) ----------
     Lepas tanpa seret = perilaku lama (prop acak terdekat). Menyeret lalu melepas di atas
     sebuah prop di dalam CFG.propAimRadius = menukar wujud ke prop ITU. Hanya visual & pilihan target;
     aturan swap tetap di Round.usePropSwap supaya Host-authoritative tetap berlaku. */
  const AIM_MOVE_PX = 10;                    // jarak seret minimum supaya dianggap "memilih" (bukan tap)
  function aimBtnEl() {
    const box = $('skills'), kids = box && box.children;
    if (!kids) return null;
    for (let i = 0; i < kids.length; i++) { const el = kids[i]; if (el && el.dataset && el.dataset.field === 'skill2') return el; }
    return null;
  }
  /** Kandidat terdekat dari titik seret; tetap harus berada dalam radius pemain. */
  function aimPickName(wx, wy) {
    const p = ROUND ? ROUND.me() : null;
    if (!p) return null;
    const list = ROUND.propCandidates(p);
    if (!list.length) return null;
    let best = null, bd = 1e9;
    for (const c of list) { const d = dist(c.wx, c.wy, wx, wy); if (d < bd) { bd = d; best = c; } }
    return best && bd <= Math.max(0.9, CFG.propAimRadius * 0.6) ? best.name : null;
  }
  function aimMove(clientX, clientY) {
    if (!aim.on) return;
    const r = cv.getBoundingClientRect();
    aim.wx = SX2W((clientX - r.left) * DPR); aim.wy = SY2W((clientY - r.top) * DPR);
    if (Math.hypot(clientX - aim.x0, clientY - aim.y0) > AIM_MOVE_PX) aim.moved = true;
    aim.pick = aimPickName(aim.wx, aim.wy);
  }
  function aimStart(ev) {
    const p = ROUND ? ROUND.me() : null;
    if (!p || !p.isHider || p.ghost) return false;
    if (ROUND.t < p.cdHider) { toast('cooldown Prop: ' + Math.max(0, p.cdHider - ROUND.t).toFixed(1) + 's'); return false; }
    aim.on = true; aim.id = ev && ev.pointerId != null ? ev.pointerId : null;
    aim.x0 = ev ? ev.clientX : 0; aim.y0 = ev ? ev.clientY : 0;
    aim.t0 = performance.now(); aim.moved = false; aim.pick = null;
    if (ev) aimMove(ev.clientX, ev.clientY);
    sfx('aim'); haptic('skill');
    const b = aimBtnEl(); if (b) b.className = (b.className || 'skill ready') + ' aiming';
    setTxt('aimHint', 'seret ke prop tujuan lalu lepas — tap singkat = prop acak terdekat');
    setCls('aimHint', 'on');
    return true;
  }
  /** commit=false -> batal (pointercancel): tidak ada swap, cooldown utuh. */
  function aimEnd(commit) {
    if (!aim.on) return false;
    aim.on = false;
    const b = aimBtnEl(); if (b) b.className = (b.className || 'skill ready').replace(/\s*(aiming|picked)/g, '');
    setCls('aimHint', '');
    const p = ROUND ? ROUND.me() : null;
    if (!p || !commit) return false;
    // yang menentukan hanyalah: ada seretan DAN ada kandidat di bawah jari.
    const chosen = aim.moved ? (aim.pick || null) : null;
    p.pendingPropName = chosen;
    p.input.skill2 = true;
    if (chosen) toast('menyamar jadi ' + chosen);
    return true;
  }
  function camStep(dt) {
    if (!cam || !map) return;
    const p = ROUND ? ROUND.me() : null;
    const mag = p ? Math.min(1, Math.hypot(p.input.dx || 0, p.input.dy || 0)) : 0;
    cam.step(dt, {
      tx: p ? p.x : 0, ty: p ? p.y : 0,
      speed: p ? mag * (p.speedNow || 0) : 0,
      seeking: !!ROUND && ROUND.phase === 'SEEK',
    }, camViewUnits(), { w: map.cols + 1, h: map.rows + 1 });
    applyCam();
  }
  function showScreen(name) { if (screens) screens.show(name); }
  /** Musik & visibilitas joystick mengikuti layar aktif. */
  function onScreenChange(next) {
    try {
      if (AU) {
        if (next === 'game' && !paused) AU.music('game');
        else if (next === 'menu' || next === 'lobby' || next === 'result') AU.music('menu');
        else if (next === 'settingsPanel' || next === 'howtoPanel' || next === 'pausePanel') { /* musik jalan terus */ }
        else AU.stopMusic && AU.stopMusic();
      }
      setCls('hud', next === 'game' ? 'on' : '');
      const j = $('joy'); if (j) j.className = (next === 'game' && coarsePointer()) ? 'on' : '';
      const back = $('backBtn'); if (back) back.style.visibility = next === 'game' ? '' : 'hidden';
      const mm = $('minimapWrap'); if (mm) mm.style.visibility = next === 'game' ? '' : 'hidden';
    } catch (e) { /* UI = progressive enhancement */ }
  }
  function coarsePointer() { try { return !!(UI && UI.Viewport && UI.Viewport.info().coarse); } catch (e) { return false; } }
  /** Jeda manual (ESC / tombol back) — membekukan langkah ronde, bukan rendering. */
  function setPaused(on) {
    paused = !!on;
    if (screens) { paused ? screens.show('pausePanel') : showScreen(ROUND && ROUND.phase !== 'LOBBY' && ROUND.phase !== 'RESULT' ? 'game' : 'menu'); }
    setCls('hud', paused ? '' : (ROUND ? 'on' : ''));
    if (AU) { paused ? AU.stopMusic() : (ROUND ? AU.music('game') : AU.music('menu')); }
    if (joy && joy.reset) joy.reset();
    if (aim.on) aimEnd(false);                           // jangan biarkan mode aim menggantung
    return paused;
  }

  /* ---------- toast / HUD ---------- */
  function toast(text, ms = 2200) {
    const host = $('toasts'); if (!host) return;
    while (host.children && host.children.length >= 4) { try { host.removeChild(host.children[0]); } catch (e) { break; } }
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = text;
    host.appendChild(d);
    setTimeout(() => { d.className = 'toast out'; setTimeout(() => { try { host.removeChild(d); } catch (e) { d.remove && d.remove(); } }, 240); }, ms);
  }
  const EV_TOAST = {
    camo: e => `${name(e.id)} menyatu dengan lantai`,
    prop: e => `${name(e.id)} menyamar jadi ${e.prop}`,
    propCancel: e => `${name(e.id)} membatalkan samaran`,
    blast: e => `${name(e.id)} melepaskan Sonic Blast!`,
    freeze: e => `${name(e.id)} membekukan sekitarnya (${(e.hits || []).length} Seeker ❄)`,
    radar: e => `${name(e.id)} memakai Radar${e.target ? ' → ' + name(e.target) : ''}`,
    slow: e => `${name(e.id)} melambat kena blast`,
    hit: e => `${name(e.by)} mengenai ${name(e.id)} (HP ${e.hp})`,
    ghost: e => `${name(e.id)} jadi hantu`,
    revive: e => `${name(e.id)} hidup lagi — aman ${e.safe}s`,
    skip: e => `skill ${name(e.id)} siap lagi (reward iklan)`,
    frenzy: e => `${name(e.id)} FRENZY ${e.dur}s!`,
    adNote: e => '📣 ' + e.text,
  };
  const name = id => (ROUND && ROUND.players.get(id) ? ROUND.players.get(id).name : '#' + id);

  /* ---------- skill buttons (HUD UIManager.CreateSkillButton + radial cooldown) ---------- */
  const skillBtns = [];
  function buildSkills() {
    const p = ROUND.me();
    // Blueprint: 4 skill ada, tapi hanya 2 yang relevan per role (HUD minimum).
    const defs = p && !p.isHider
      ? [['Icon_Radar', 'Radar', 'Q', 'skill1'], ['Icon_SonicBlast', 'Blast', 'E', 'skill2']]
      : [['Icon_Camouflage', 'Kamuflase', '1', 'skill1'], ['Icon_PropSwap', 'Prop', '2', 'skill2'], ['Icon_Freeze', 'Bekukan', '3', 'skill3']];
    const box = $('skills');
    if (box.dataset.defs === defs.map(d => d[1]).join(',')) return;
    box.dataset.defs = defs.map(d => d[1]).join(',');
    box.innerHTML = '';
    skillBtns.length = 0;
    for (const [icon, lbl, hot, field] of defs) {
      const b = document.createElement('div');
      b.className = 'skill ready'; b.dataset.field = field; b.dataset.key = hot;
      b.setAttribute('aria-label', lbl + ' (tombol ' + hot + ')');
      b.innerHTML = `<img src="assets/${icon}.png" alt=""><div class="cd"></div><div class="lbl">${lbl}<br><span class="kbd">${hot}</span></div>`;
      const use = () => {
        const me = ROUND.me(); if (!me || me.ghost) return;
        me.input[field] = true;
        sfx(field === 'skill1' ? (p && !p.isHider ? 'radar' : 'camo') : field === 'skill3' ? 'freeze' : (p && !p.isHider ? 'blast' : 'swap'));
        haptic('skill');
        if (UI) UI.SkillButton.pressFx(b);
        if (ROUND.phase === 'LOBBY' || ROUND.phase === 'RESULT') toast('skill aktif saat ronde berjalan');
      };
      if (field === 'skill2' && !(p && !p.isHider)) {          // Prop utk Hider = mode aim
        b.addEventListener('pointerdown', ev => { ev.preventDefault(); if (!aimStart(ev)) use(); });
        b.addEventListener('contextmenu', ev => ev.preventDefault());
      } else {
        b.addEventListener('pointerdown', ev => { ev.preventDefault(); use(); });
      }
      box.appendChild(b);
      skillBtns.push(UI ? new UI.SkillButton(b, { cd: b.querySelector('.cd'), field }) : { el: b, cd: b.querySelector('.cd'), render() { } });
    }
  }
  function SkillStyle(left, total) {
    if (UI) return UI.SkillButton.cooldownStyle(left, total);
    const k = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
    return `conic-gradient(rgba(0,0,0,.78) ${k * 360}deg, transparent ${k * 360}deg)`;
  }
  /** Papan skor on-demand (tap ikon di pojok) — versi ringkas dari leaderboard hasil. */
  function renderMiniBoard() {
    const el = $('lbMini'); if (!el || !ROUND) return;
    const rows = [...ROUND.players.values()].sort((a, b) => scoreOf(b) - scoreOf(a));
    const loc = localScores.top(5);
    el.innerHTML = rows.map((p, i) => `<tr class="${p.id === ROUND.myId ? 'me' : ''}"><td>${i + 1}</td><td>${p.name}</td>` +
      `<td>${p.ghost ? '👻' : (p.isHider ? '🦎' : '👁')}${p.isHider ? ' ' + p.hp + 'HP' : ' ' + p.catches + '✋'}</td>` +
      `<td><b>${scoreOf(p)}</b></td></tr>`).join('') +
      (loc.length ? `<tr class="sep"><td colspan="4">rekor lokal · top ${loc.length}</td></tr>` +
        loc.map((x, i) => `<tr class="dim"><td>${i + 1}</td><td>${x.name}</td><td>${x.win ? '🏆' : (x.role === 'HIDER' ? '🦎' : '👁')}</td><td><b>${x.score}</b></td></tr>`).join('') : '');
  }
  function scoreOf(p) {
    if (!p) return 0;
    return p.isHider ? Math.round(p.survived + p.hp * 10) : p.catches * 30;   // sama dgn GameManager.cs
  }
  function hud() {
    const p = ROUND.me(), seeker = ROUND.seeker();
    $('phase').textContent = ROUND.phase === 'HIDE' ? 'FASE BERSEMBUNYI' :
      ROUND.phase === 'SEEK' ? 'FASE DIKEJAR' : ROUND.phase.replace('COUNTDOWN', 'HITUNG MUNDUR');
    $('timer').textContent = ROUND.phase === 'LOBBY' ? '0:00' : fmtTime(ROUND.timeLeft);
    $('role').textContent = !p ? '' : (p.isHider ? `HIDER · HP ${p.hp}/${CFG.hiderHp}` : `SEEKER · ${p.catches} tangkap`);
    $('hint').textContent = !p ? '' : p.ghost ? 'kamu hantu — tekan tombol iklan untuk hidup lagi' :
      ROUND.phase === 'HIDE' ? 'gerak → cari spot → pakai skill 1 ( kamuflase ) / 2 ( prop )' :
        p.isHider ? 'jangan tersentuh! klik/tap dekat seeker = kabur' : 'klik / tap di dekat hider untuk menangkap';
    // hearts + bar
    const hv = $('hearts'); const hp = p ? (p.isHider ? p.hp : 0) : 0;
    const want = p && p.isHider ? CFG.hiderHp : 0;
    if (hv.children.length !== want) { hv.innerHTML = ''; for (let i = 0; i < want; i++) hv.appendChild(Object.assign(document.createElement('i'), { className: 'heart' })); }
    [...hv.children].forEach((el, i) => el.className = 'heart' + (i < hp ? '' : ' off'));
    $('hpFill').style.width = (want ? (hp / want) * 100 : 0) + '%';
    $('hpFill').style.background = hp > 1 ? '#46c06a' : '#ff5d5d';
    // cooldown radial (SkillButton merapikan cincin + kelas ready/cool)
    const left0 = p ? Math.max(0, (p.isHider ? p.cdHider : p.cdSeeker) - ROUND.t) : 0;
    const total0 = p && p.isHider ? CFG.hiderCd : CFG.seekerCd;
    for (let i = 0; i < $('skills').children.length; i++) {
      const b = $('skills').children[i];
      const btn = skillBtns[i];
      const fld = (b && b.dataset && b.dataset.field) || (btn && btn.field) || 'skill1';
      const isAimSkill = fld === 'skill2' && p && p.isHider;
      const left = fld === 'skill3' ? (p ? Math.max(0, p.cdFreeze - ROUND.t) : 0) : left0;
      const total = fld === 'skill3' ? CFG.freezeCd : total0;
      if (btn && btn.render && btn.el === b) btn.render(left, total);
      else if (b && b.querySelector) {
        const cd = b.querySelector('.cd'); if (cd && cd.style) cd.style.background = SkillStyle(left, total);
        b.className = 'skill ' + (left > 0.02 ? 'cool' : 'ready');
      }
      if (b) {                       // kelas mode aim: ditulis ulang tiap frame supaya tidak menumpuk
        const cn = (b.className || 'skill ready').replace(/\s*(aiming|picked)/g, '');
        b.className = cn + (aim.on && isAimSkill ? ' aiming' : '') + (aim.on && isAimSkill && aim.pick ? ' picked' : '');
      }
    }
    /* --- konteks & feedback (blueprint 4.2) --- */
    const tl = ROUND.timeLeft;
    const tv = $('timer'); if (tv) tv.className = (ROUND.phase === 'SEEK' && tl <= 5) ? 'urgent' : (tl < 10 ? 'warn' : '');
    const rv = $('role'); if (rv) rv.className = UI ? UI.roleClass(p) : '';
    setTxt('playerTag', (p ? p.name : '—') + (netMode === 'solo' ? '' : ' · ' + netMode));
    const hitS = ROUND.phase === 'COUNTDOWN' ? Math.ceil(tl) : -1;
    if (hitS !== hud._sec) {
      if (hitS >= 0 && hud._sec !== undefined && ROUND.phase === 'COUNTDOWN') { sfx('count'); haptic('tap'); }
      hud._sec = hitS;
    }
    const lbo = $('lbOverlay'); if (lbo && lbo.className === 'on') renderMiniBoard();
    // reward button (RewardOffers.RefreshButtons)
    const off = ROUND.currentOffer(p);
    $('rewardWrap').className = (p && off && !p.isBot) ? 'on' : '';
    if (off) { $('rewardLabel').textContent = off.label; $('rewardIcon').src = 'assets/Icon_Revive.png'; }
    if (off && ROUND.rewardQuota) $('rewardQuota').textContent =
      `sisa: revive ${ROUND.rewardQuota.revive} · skip ${ROUND.rewardQuota.skip} · frenzy ${ROUND.rewardQuota.frenzy}`;
    $('countNum').textContent = ROUND.phase === 'COUNTDOWN' ? Math.ceil(ROUND.timeLeft) : '';
    $('count').className = ROUND.phase === 'COUNTDOWN' ? 'on' : '';
    document.title = (ROUND.phase === 'LOBBY' ? '' : `${fmtTime(ROUND.timeLeft)} · `) + 'HideSeek (web)';
  }

  /* ---------- render ---------- */
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#08110d'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!map) return;
    // lantai: tile sprite 1x1 unit (Tile* 128px @128 PPU → 1 unit, sama seperti Unity)
    for (let gy = 0; gy < map.rows; gy++) for (let gx = 0; gx < map.cols; gx++) {
      const idx = gy * map.cols + gx;
      const img = SPR[TILES[map.tiles[idx]]];
      const sx = W2SX(map.toWorldX(gx)) - scale / 2, sy = W2SY(map.toWorldY(gy)) - scale / 2;
      if (sx > cv.width || sy > cv.height || sx + scale < 0 || sy + scale < 0) continue;
      if (img && img.naturalWidth) ctx.drawImage(img, sx, sy, scale + 1, scale + 1);
      else { ctx.fillStyle = `rgb(${(tileRgb && tileRgb[map.tiles[idx]] || [80, 80, 80]).join(',')})`; ctx.fillRect(sx, sy, scale + 1, scale + 1); }
    }
    // 4 dinding hedge (di-stretch seperti localScale pada Wall(); tint 0.85,0.9,0.8 seperti installer)
    const wallImg = SPR['Hedge_Wall'];
    for (const w of map.walls) {
      const sx = W2SX(w.cx) - w.w * scale / 2, sy = W2SY(w.cy) - w.h * scale / 2;
      const ww = w.w * scale, wh = w.h * scale;
      if (wallImg && wallImg.naturalWidth) {
        ctx.drawImage(wallImg, sx, sy, ww, wh);
        ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .18;
        ctx.fillStyle = '#e6f0cc'; ctx.fillRect(sx, sy, ww, wh); ctx.restore();
      } else { ctx.fillStyle = '#2c5133'; ctx.fillRect(sx, sy, ww, wh); }
    }
    // dekor (tanpa collider)
    for (const d of map.decor) drawSprite(d.sprite, d.wx, d.wy, 1.5);
    // props
    for (const pr of map.props) drawSprite(pr.def.sprite, pr.wx, pr.wy, pr.def.w, pr.def.h);
    // Sonic Blast ring — SonicBlastEffect (grow + fade)
    for (const b of ROUND.blasts) {
      const k = (ROUND.t - b.t) / b.dur;
      ctx.strokeStyle = `rgba(150,220,255,${(1 - k) * .85})`;
      ctx.lineWidth = 4 * DPR;
      ctx.beginPath();
      ctx.arc(W2SX(b.x), W2SY(b.y), k * CFG.blastRadius * scale, 0, 7);
      ctx.stroke();
    }
    // mode aim Prop: garis + kandidat + radius (blueprint 3.2 "tahan -> seret -> lepas")
    if (aim.on && ROUND) {
      const pa = ROUND.me();
      if (pa) {
        ctx.save();
        if (ctx.setLineDash) ctx.setLineDash([6 * DPR, 5 * DPR]);
        ctx.strokeStyle = 'rgba(143,226,159,.9)'; ctx.lineWidth = 2 * DPR;
        ctx.beginPath(); ctx.moveTo(W2SX(pa.x), W2SY(pa.y)); ctx.lineTo(W2SX(aim.wx), W2SY(aim.wy)); ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = DPR;
        ctx.beginPath(); ctx.arc(W2SX(pa.x), W2SY(pa.y), CFG.propAimRadius * scale, 0, 7); ctx.stroke();
        for (const c of ROUND.propCandidates(pa)) {
          const hot = aim.pick === c.name;
          ctx.strokeStyle = hot ? '#ffe27a' : 'rgba(255,255,255,.5)';
          ctx.lineWidth = (hot ? 3 : 1.5) * DPR;
          ctx.beginPath(); ctx.arc(W2SX(c.wx), W2SY(c.wy), (hot ? 0.62 : 0.5) * scale, 0, 7); ctx.stroke();
          ctx.font = `${(hot ? 12 : 10) * DPR}px system-ui`; ctx.textAlign = 'center';
          ctx.fillStyle = hot ? '#ffe27a' : '#eaf3ec';
          ctx.fillText(c.name, W2SX(c.wx), W2SY(c.wy) - 0.72 * scale);
        }
        ctx.restore();
      }
    }
    // pemain (diurutkan y supaya tumpukan terlihat rapi)
    const list = [...ROUND.players.values()].sort((a, b) => a.y - b.y);
    for (const p of list) {
      const isMe = ROUND.myId === p.id;
      let img;
      if (p.propDef) img = SPR[PROPS[p.propDef.id].sprite];
      else img = tinted(p.isHider ? 'Chameleon_Hider' : 'Chameleon_Seeker', p.camoRgb);
      const size = p.propDef ? Math.max(p.propDef.w, p.propDef.h) * scale : scale * 1.5;
      ctx.save();
      ctx.globalAlpha = p.ghost ? CFG.ghostAlpha : 1;
      const sx = W2SX(p.x), sy = W2SY(p.y);
      if (img && img.naturalWidth) {
        if (!p.propDef) { ctx.translate(sx, sy); ctx.rotate(p.rot + Math.PI / 2); ctx.drawImage(img, -size / 2, -size / 2, size, size); }
        else ctx.drawImage(img, sx - size / 2, sy - size / 2, size, size * (p.propDef.h / p.propDef.w));
      } else {
        ctx.fillStyle = p.isHider ? '#6fd489' : '#ff8b6a';
        ctx.beginPath(); ctx.arc(sx, sy, size / 2.4, 0, 7); ctx.fill();
      }
      ctx.restore();
      if (ROUND.t < p.slowUntil) { ctx.fillStyle = 'rgba(140,210,255,.75)'; ctx.beginPath(); ctx.arc(sx, sy, size * .1, 0, 7); ctx.fill(); }
      if (isMe) { ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 3 * DPR; ctx.beginPath(); ctx.arc(sx, sy, size * .58, 0, 7); ctx.stroke(); }
      if (p.role === 1 && !p.ghost) { ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 2 * DPR; ctx.beginPath(); ctx.arc(sx, sy, size * .66, 0, 7); ctx.stroke(); }
      // nama + HP pip
      ctx.font = `${11 * DPR}px system-ui`; ctx.textAlign = 'center'; ctx.fillStyle = '#eaf3ec';
      ctx.fillText(p.name + (p.ghost ? ' 👻' : ''), sx, sy - size * .62);
      if (p.isHider && !p.ghost) {
        ctx.fillStyle = '#ff5d5d';
        for (let i = 0; i < p.hp; i++) ctx.fillRect(sx - 9 * DPR + i * 7 * DPR, sy - size * .5 - 4 * DPR, 5 * DPR, 3 * DPR);
      }
    }
    // partikel FX (debu/burst/sparkle/cincin) -- digambar paling atas, sebelum minimap
    if (parts) parts.draw(ctx, W2SX, W2SY, scale);
    // radar ping di minimap digambar di drawMinimap
    drawMinimap();
  }
  function drawSprite(nameKey, wx, wy, ww, wh) {
    const img = SPR[nameKey]; const sx = W2SX(wx), sy = W2SY(wy);
    const w = ww * scale, h = (wh || ww) * scale;
    if (img && img.naturalWidth) ctx.drawImage(img, sx - w / 2, sy - h / 2, w + 1, h + 1);
    else { ctx.fillStyle = '#5a4a3a'; ctx.fillRect(sx - w / 2, sy - h / 2, w, h); }
  }
  function drawMinimap() {
    if (!mm.clientWidth) return;
    const s = Math.min(mm.width / map.cols, mm.height / map.rows);
    const cx = mm.width / 2, cy = mm.height / 2;
    mg.clearRect(0, 0, mm.width, mm.height);
    mg.globalAlpha = .55;
    for (let gy = 0; gy < map.rows; gy++) for (let gx = 0; gx < map.cols; gx++) {
      const rgb = tileRgb ? tileRgb[map.tiles[gy * map.cols + gx]] : [90, 90, 90];
      mg.fillStyle = `rgb(${rgb.join(',')})`;
      mg.fillRect(cx + (map.toWorldX(gx) - .5) * s, cy - (map.toWorldY(gy) + .5) * s, s, s);
    }
    mg.globalAlpha = 1;
    for (const p of ROUND.players.values()) {
      if (p.ghost && ROUND.myId !== p.id) continue;
      mg.fillStyle = p.role === 1 ? '#ff5d5d' : (ROUND.myId === p.id ? '#ffe27a' : '#8de29f');
      mg.beginPath(); mg.arc(cx + p.x * s, cy - p.y * s, Math.max(1.8, s * .18), 0, 7); mg.fill();
    }
    // ping radar (SeekerSkill.RpcRadarHit → RadarPing 1 detik)
    for (const b of ROUND.pings) {
      const k = (ROUND.t - b.t) / b.dur; if (k > 1) continue;
      mg.strokeStyle = `rgba(255,80,80,${1 - k})`; mg.lineWidth = 2 * DPR;
      mg.beginPath(); mg.arc(cx + b.x * s, cy - b.y * s, s * (1 + k * 2.2), 0, 7); mg.stroke();
    }
  }

  /* ---------- input: keyboard + joystick + tap ---------- */
  const keys = {};
  addEventListener('keydown', e => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); return; }
    const k = (e.key || '').toLowerCase();
    keys[k] = true;
    // Peta tombol (blueprint 3.3): hider 1/2, seeker Q/E — keduanya selalu diterima.
    if (k === '1' || k === 'q') press('skill1');
    if (k === '2' || k === 'e') press('skill2');
    if (k === '3') press('skill3');                     // Freeze (Hider)
    if (k === 'm') { toggleSound(); return; }
    if (k === 'l') { toggleBoard(); return; }
    if (k === 'escape' || k === 'esc') { e.preventDefault(); setPaused(!paused); return; }
    if (e.code === 'Space') { e.preventDefault(); $('soloBtn').click(); }
  });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  function press(f) { const p = ROUND && ROUND.me(); if (p && !p.ghost) p.input[f] = true; }

  function keyInput() {
    const p = ROUND.me(); if (!p || p.ghost) return;
    let dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    let dy = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0);
    if (joy.active) { dx = joy.dx; dy = joy.dy; }
    p.input.dx = dx; p.input.dy = dy;
  }
  const joy = { active: false, dx: 0, dy: 0, id: null, cx: 0, cy: 0, sens: clamp(Number(uiPrefs.sens) || 1, 0.7, 1.5) };
  (function setupJoy() {
    const el = $('joy'), knob = $('joyKnob');
    const R = () => el.clientWidth / 2;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      let vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
      // deadzone + vektor ternormalisasi dari uiKit (sama seperti hud-gamepad)
      const v = UI ? UI.Joystick.computeVector(e.clientX, e.clientY, r, 0.14, joy.sens)
        : (() => { const m = Math.hypot(vx, vy) || 1, lim = Math.max(1, r.width / 2), k = Math.min(1, m / lim); return { dx: vx / m * k, dy: -vy / m * k, mag: m }; })();
      joy.dx = v.dx; joy.dy = v.dy;
      const lim = r.width / 2, ang = Math.atan2(vy, vx), rr = Math.min(1, v.mag || 0) * lim * 0.5;
      knob.style.transform = `translate(calc(-50% + ${Math.cos(ang) * rr}px), calc(-50% + ${Math.sin(ang) * rr}px))`;
      if (!joy.moved && (Math.abs(v.dx) > 0.05 || Math.abs(v.dy) > 0.05)) { joy.moved = true; haptic('tap'); }
    };
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); joy.active = true; joy.id = e.pointerId; joy.moved = false; el.className = 'on active'; set(e); });
    el.addEventListener('pointermove', e => { if (joy.active && e.pointerId === joy.id) set(e); });
    const end = e => { if (e.pointerId !== joy.id) return; joy.active = false; joy.dx = joy.dy = 0; knob.style.transform = 'translate(-50%,-50%)'; el.className = 'on'; };
    joy.reset = () => { joy.active = false; joy.dx = joy.dy = 0; if (knob && knob.style) knob.style.transform = 'translate(-50%,-50%)'; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  })();

  // klik/tap di arena → catcher (RequestCatch) untuk seeker
  addEventListener('pointermove', e => { if (aim.on && (aim.id === null || e.pointerId === aim.id)) aimMove(e.clientX, e.clientY); }, { passive: true });
  addEventListener('pointerup', e => { if (aim.on && (aim.id === null || e.pointerId === aim.id)) aimEnd(true); }, { passive: true });
  addEventListener('pointercancel', () => { if (aim.on) aimEnd(false); });

  cv.addEventListener('pointerdown', e => {
    const p = ROUND.me(); if (!p) return;
    const r = cv.getBoundingClientRect();
    const wx = SX2W((e.clientX - r.left) * DPR), wy = SY2W((e.clientY - r.top) * DPR);
    if (netMode === 'client') {                     // keputusan hit ada di host (Authority)
      const ev = !p.isHider ? { t: 'catch', x: +wx.toFixed(2), y: +wy.toFixed(2) } :
        ROUND.phase === 'HIDE' ? { t: 'in', x: p.input.dx, y: p.input.dy, s1: true } : null;
      if (ev) api('/room/send', { room: net.room, token: net.token, ev }).catch(() => {});
      return;
    }
    if (!p.isHider) ROUND.tryCatch(p, wx, wy);
    else if (ROUND.phase === 'HIDE') ROUND.useCamouflage(p);   // tap = cepat camo saat bersembunyi
  });

  /* ============================================================================
   * META — AdsManager (AppLixir/AdinPlay/simulasi) + ReferralSystem + profil
   * ========================================================================== */
  const profile = new Profile(typeof localStorage !== 'undefined' ? localStorage : null, globalCfg('economy') || {});
  /** Top-10 skor lokal (localStorage['hideseek_scores']) — lihat kelas LocalScores di atas. */
  const localScores = new LocalScores(profile.storage, profile.cfg);
  let metaPaused = false;                        // True selama iklan tayang -> step() ditahan
  /** Facade "player" sesuai contoh di integration-guide.md. */
  const playerAPI = {
    get hp() { const p = ROUND && ROUND.me(); return p ? p.hp : profile.maxHp; },
    get maxHp() { return profile.maxHp; },
    get coins() { return profile.coins; },
    /** player.addHP(1) -> player.hp = min(hp+1, maxHp); di luar ronde jadi nyawa cadangan. */
    addHP(n) { const r = profile.addHP(n); updateUI(); return r.healed || r.stored; },
    addCoins(n) { const v = profile.addCoins(n); updateUI(); return v; },
    save() { profile.save(); },
  };
  const gameAPI = {
    player: playerAPI, profile,
    pause() { metaPaused = true; $('pauseTag').className = 'on'; try { AU && AU.duck(true); } catch (e) { } },
    resume() { metaPaused = false; $('pauseTag').className = ''; try { AU && AU.duck(false); } catch (e) { } },
    saveGame() { profile.save(); },
    updateUI() { updateUI(); },
    ads: null, referral: null,          // diisi setelah keduanya dibuat (debug + test)
    /* lapisan UI v2 — juga dipakai tools/web_dom_smoke.js (grup [5]) */
    ui: {
      get screens() { return screens; }, get fx() { return fx; }, get UI() { return UI; }, get audio() { return AU; },
      get paused() { return paused; }, setPaused, toggleSound, toggleBoard, showScreen, renderMiniBoard,
      get parts() { return parts; }, get localScores() { return localScores; }, get profile() { return profile; },
      get cam() { return cam; }, get aim() { return aim; }, camStep, applyCam, camViewUnits,
      get dpr() { return DPR; }, w2sx: (v) => W2SX(v), w2sy: (v) => W2SY(v),
      get view() { return { scale, ox, oy, fitScale }; },
      shake, renderLocalBoard,
      prefs: uiPrefs, savePrefs: saveUiPrefs,
    },
  };
  window.hideSeekGame = gameAPI;                 // debugging: hideSeekGame.player.addCoins(999)

  /* ----- overlay iklan (dipakai AdsManager lewat hook, dan fallback lokal) ----- */
  const adOverlay = {
    show(label) {
      $('adText').textContent = label || 'Iklan…';
      $('adBar').style.width = '0%';
      $('adOverlay').className = 'on';
    },
    progress(k) { $('adBar').style.width = Math.round(clamp(k, 0, 1) * 100) + '%'; },
    hide() { $('adOverlay').className = ''; },
    notify(msg) { toast(msg, 3200); },
  };
  const ads = (typeof window.AdsManager === 'function')
    ? new window.AdsManager({ game: gameAPI, overlay: adOverlay, storage: (typeof localStorage !== 'undefined' ? localStorage : null) })
    : null;
  /** Placement utk tiap reward internal game (rewarded video). */
  const OFFER_ADS = {
    revive: ['extra_life', 'Hidup lagi +1 HP …'],
    skip: ['skip_cooldown', 'Cooldown skill direset…'],
    frenzy: ['frenzy', `Frenzy ${CFG.frenzyTime}s: +25% speed, jangkauan tangkap +${CFG.frenzyRange}`],
    extra_life: ['extra_life', '+1 Nyawa …'],
    bonus_coins: ['bonus_coins', '+50 Koin …'],
  };
  let adBusy = false;
  /**
   * Satu pintu utk semua rewarded video.
   * @returns {boolean} false bila ditolak (sedang tayang / cooldown global 30s)
   */
  function runAd(offerKey, onReward) {
    const [placement, label] = OFFER_ADS[offerKey] || [offerKey || 'rewarded_video', 'Iklan…'];
    if (adBusy) return false;
    adBusy = true;
    let settled = false;
    const finish = (okFlag) => {
      if (settled) return; settled = true; adBusy = false;
      if (okFlag === true) { profile.noteAdReward(); sfx('reward'); haptic('win'); if (onReward) onReward(); }
      updateUI();
    };
    if (ads) {
      if (!ads.showRewarded(placement, () => finish(true), () => finish(false))) { adBusy = false; return false; }
      return true;
    }
    return simulateAdLocal(label, finish);      // SDK/config tidak ada -> simulasi internal
  }
  /** Fallback simulasi (sama seperti AdsManager.simulateAds di Unity) 1.5 detik. */
  function simulateAdLocal(label, finish) {
    const ms = Math.max(10, (ads ? ads.cfg.simSeconds : CFG.adSimSeconds) * 1000);
    console.log('📺 [SIMULASI] Iklan reward ditonton!');
    adOverlay.show(label);
    const t0 = performance.now();
    let done = false;
    const stop = (okFlag) => { if (done) return; done = true; adOverlay.hide(); adOverlay.progress(1); finish(okFlag); };
    simulateAdLocal.cancel = () => stop(false);
    (function loop() {
      const k = Math.min(1, (performance.now() - t0) / ms);
      adOverlay.progress(k);
      if (k < 1 && !done) requestAnimationFrame(loop); else stop(true);
    })();
    return true;
  }
  $('adSkipBtn').onclick = () => { if (ads) ads.cancelSimulation(); if (simulateAdLocal.cancel) simulateAdLocal.cancel(); };

  /* ----- referral (Undang Teman) ----- */
  const referral = (typeof window.createReferralSystem === 'function') ? window.createReferralSystem({ player: playerAPI, notify: m => toast(m, 4200) })
    : (typeof window.ReferralSystem === 'function') ? new window.ReferralSystem({ player: playerAPI, notify: m => toast(m, 4200) })
      : null;
  if (referral) {
    const res = referral.checkOnLoad ? referral.checkOnLoad() : null;   // baca ?ref= SEKALI
    if (res && res.granted) console.log('🎁 referral diterima dari kode ' + res.code);
    referral.flushPendingRewards && referral.flushPendingRewards();
  }
  gameAPI.ads = ads; gameAPI.referral = referral;
  window.hideSeekReferral = referral;            // konsol: hideSeekReferral.getStats()

  /* ----- HUD meta: koin, nyawa cadangan, tombol iklan & undang teman ----- */
  function updateUI() {
    const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    txt('coins', String(profile.coins)); txt('lives', '×' + profile.lives);
    txt('coinsLobby', profile.coins); txt('livesLobby', profile.lives);
    txt('maxhpTag', 'MAX HP ' + profile.maxHp);
    const c = profile.coins;
    $('buyHpBtn').textContent = `+1 Max HP — ${profile.cfg.maxHpPrice} 🪙`;
    $('buyHpBtn').disabled = c < profile.cfg.maxHpPrice || profile.bonusHp >= profile.cfg.maxHpCap;
    $('buyLifeBtn').textContent = `+1 Nyawa — ${profile.cfg.lifePrice} 🪙`;
    $('buyLifeBtn').disabled = c < profile.cfg.lifePrice;
    $('adLifeBtn').disabled = adBusy; $('adCoinsBtn').disabled = adBusy; $('inviteBtn').disabled = !referral;
    // menu utama: ringkasan progres (biar "state selalu terlihat" juga di luar ronde)
    setTxt('coinsMenu', String(profile.coins));
    // "state selalu terlihat" (blueprint 1.1): level + progres XP ikut di menu
    const lp = profile.levelProgress;
    setTxt('bestTag', 'Lv ' + lp.level + ' · ' + lp.pct + '% · rekor ' + profile.best + ' · ronde ' + profile.rounds);
    const sb = $('soundBtn');
    if (sb) { const muted = AU && AU.prefs && (!AU.prefs.sfx && !AU.prefs.music); sb.className = 'iconbtn' + (muted ? ' off' : ''); sb.setAttribute('aria-pressed', muted ? 'false' : 'true'); }
    if (ROUND) hud();
  }
  /* Tombol "Tonton Iklan +1 Nyawa" / "Dapatkan Koin" (sesuai spesifikasi adsManager). */
  $('adLifeBtn').onclick = () => runAd('extra_life', () => { playerAPI.addHP(1); toast('💚 +1 nyawa'); });
  $('adCoinsBtn').onclick = () => runAd('bonus_coins', () => { playerAPI.addCoins(50); toast('🪙 +50 koin'); });
  $('inviteBtn').onclick = () => { if (referral) referral.showInviteModal(); else toast('referralSystem.js belum dimuat'); };
  $('inviteLobbyBtn').onclick = () => { if (referral) referral.showInviteModal(); else toast('referralSystem.js belum dimuat'); };
  $('buyHpBtn').onclick = () => {
    const r = profile.buyMaxHp();
    toast(r.ok ? `⬆ Max HP jadi ${profile.maxHp}` : '⚠ ' + r.why);
    updateUI();
  };
  $('buyLifeBtn').onclick = () => {
    const r = profile.buyLife();
    toast(r.ok ? `💚 Nyawa cadangan: ${profile.lives}` : '⚠ ' + r.why);
    updateUI();
  };
  updateUI();

  /* ============================================================================
   * UI v2 — layar, pause, setelan, suara, papan skor on-demand
   * ========================================================================== */
  /** Suara on/off (tombol di pojok kanan-atas + tombol M). */
  function toggleSound(force) {
    if (!AU) { toast('audioKit.js belum dimuat'); return false; }
    try { AU.unlock(); } catch (e) { }
    const on = force === undefined ? !(AU.prefs.sfx || AU.prefs.music) : !!force;
    AU.setMuted('sfx', on); AU.setMuted('music', on);
    toast(on ? '🔊 suara aktif' : '🔇 suara dimatikan');
    updateUI();
    return on;
  }
  /** Papan skor on-demand (ikon batang di kanan-atas / tombol L). */
  function toggleBoard(force) {
    const el = $('lbOverlay'); if (!el) return false;
    const on = force === undefined ? el.className !== 'on' : !!force;
    el.className = on ? 'on' : '';
    if (on) renderMiniBoard();
    return on;
  }
  onClick('soundBtn', () => toggleSound());
  onClick('lbBtn', () => toggleBoard());
  onClick('lbClose', () => toggleBoard(false));
  onClick('backBtn', () => { if (ROUND && ROUND.phase !== 'LOBBY') setPaused(true); else showScreen('menu'); });

  /* ---- menu utama ---- */
  onClick('playBtn', () => { startGameSoft(); $('soloBtn').click(); if (screens) screens.show('game'); hideSplash(); });
  onClick('multiBtn', () => { startGameSoft(); showScreen('lobby'); const n = $('nameInput'); n && n.focus && n.focus(); });
  onClick('howtoBtn', () => screens && screens.show('howtoPanel'));
  onClick('settingsBtn', () => screens && screens.show('settingsPanel'));
  onClick('lobbyBackBtn', () => { showScreen('menu'); if (AU) AU.music('menu'); });
  onClick('resultMenuBtn', () => { $('result').className = 'panel hidden'; showScreen('menu'); });
  onClick('closeHowtoBtn', () => showScreen(paused ? 'pausePanel' : (screens && screens.current === 'game' ? 'game' : 'menu')));
  onClick('closeSettingsBtn', () => showScreen(paused ? 'pausePanel' : (screens && screens.current === 'game' ? 'game' : 'menu')));

  /* ---- pause (ESC / tombol back) ---- */
  onClick('resumeBtn', () => setPaused(false));
  onClick('pauseSettingsBtn', () => screens && screens.show('settingsPanel'));
  onClick('restartBtn', () => { setPaused(false); ROUND && ROUND.start(true); });
  onClick('quitBtn', () => { setPaused(false); net = null; netMode = 'solo'; setCls('netMode', ''); setTxt('netMode', 'SOLO (bots)'); $('result').className = 'panel hidden'; setCls('hud', ''); showScreen('menu'); });
  if (screens) screens.escapeToPause = () => setPaused(true);   // Screens.back() dari layar game = pause

  /* ---- setelan: switch, volume, orientasi, bahasa ---- */
  function bindSwitch(id, get, set) {
    const el = $(id); if (!el) return;
    const paint = () => el.setAttribute('aria-checked', get() ? 'true' : 'false');
    const flip = () => { set(!get()); paint(); sfx('tap'); haptic('tap'); updateUI(); };
    el.onclick = flip;
    el.addEventListener && el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    paint(); bindSwitch._paint = (bindSwitch._paint || []).concat(paint);
  }
  bindSwitch('sfxSwitch', () => !AU || AU.prefs.sfx, v => { try { AU && AU.unlock(); AU && AU.setMuted('sfx', v); } catch (e) { } });
  bindSwitch('musicSwitch', () => !AU || AU.prefs.music, v => {
    try {
      if (!AU) return; AU.unlock(); AU.setMuted('music', v);
      v ? AU.music(paused ? 'menu' : (screens && screens.current === 'game' ? 'game' : 'menu')) : AU.stopMusic();
    } catch (e) { }
  });
  bindSwitch('hapticSwitch', () => uiPrefs.haptics !== false, v => { uiPrefs.haptics = v; if (UI && UI.Haptics) UI.Haptics.enabled = v; saveUiPrefs(); if (v) haptic('tap'); });
  /* Sensitivitas joystick (blueprint 4.4 Settings): 70%..150%, disimpan di hideseek_ui. */
  (function bindSens() {
    const r = $('sensRange'); if (!r) return;
    const lab = $('sensVal');
    const put = v => { if (lab) lab.textContent = Math.round(v * 100) + '%'; joy.sens = v; };
    const v0 = clamp(Number(uiPrefs.sens) || 1, 0.7, 1.5);
    r.value = String(Math.round(v0 * 100)); put(v0);
    const on = () => {
      const v = clamp((Number(r.value) || 100) / 100, 0.7, 1.5);
      if (v === uiPrefs.sens) return;
      uiPrefs.sens = v; saveUiPrefs(); put(v);
    };
    r.oninput = r.onchange = on;
  })();
  onClick('clearLbBtn', () => {
    const n = localScores.length; localScores.clear();
    const lbo = $('lbOverlay'); if (lbo && lbo.className === 'on') renderMiniBoard();
    renderLocalBoard(0);                    // layar hasil ikut disinkronkan (wrapper -> off)
    toast(n ? 'rekor lokal dihapus (' + n + ' baris)' : 'belum ada rekor lokal');
    sfx('err');
  });
  (function bindVolume() {
    const r = $('volumeRange'); if (!r) return;
    r.value = String(Math.round(((AU && AU.prefs.volume) || 0.8) * 100));
    const on = () => { try { AU && AU.unlock(); AU && AU.setVolume(Number(r.value) / 100); } catch (e) { } };
    r.oninput = r.onchange = on; on();
  })();
  onClick('orientBtn', () => { });
  (function bindOrientLang() {
    const o = $('orientSel');
    if (o) {
      o.value = uiPrefs.orient || 'any';
      o.onchange = () => {
        uiPrefs.orient = o.value; saveUiPrefs();
        if (UI && UI.Viewport && o.value !== 'any') UI.Viewport.lock(o.value);
        toast('orientasi: ' + o.value + (o.value === 'any' ? ' (ikuti perangkat)' : ' — tidak semua browser mengizinkan'));
        resize();
      };
    }
    const l = $('langSel');
    if (l) {
      l.value = uiPrefs.lang || 'id';
      l.onchange = () => { uiPrefs.lang = l.value; saveUiPrefs(); toast(l.value === 'en' ? 'UI English label belum lengkap — game tetap bahasa Indonesia' : 'bahasa: Indonesia'); };
    }
    const d = $('deviceInfo');
    if (d && UI && UI.Viewport) { const i = UI.Viewport.info(); d.textContent = `layar ${i.w}×${i.h} · dpr ${i.dpr} · ${i.portrait ? 'portrait' : 'landscape'}${i.coarse ? ' · sentuh' : ' · mouse'}`; }
  })();
  if (screens && screens.names) screens.show(queryFlag('solo') === '1' ? 'game' : (queryFlag('room') === '1' ? 'lobby' : 'menu'));

  /* ---------- loop utama ---------- */
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (metaPaused) { return requestAnimationFrame(frame); }        // iklan tayang -> beku
    if (paused) { if (ROUND) draw(); return requestAnimationFrame(frame); }   // menu jeda -> bekukan simulasi
    if (ROUND && netMode !== 'client') { keyInput(); ROUND.step(dt); }
    else if (ROUND) { keyInput(); ROUND.t += dt; ROUND.tickPhaseClient?.(); }
    if (parts) { parts.step(dt); dustStep(dt); }
    if (ROUND) { buildSkills(); hud(); if (!paused) camStep(dt); draw(); }
    requestAnimationFrame(frame);
  }

  /* ---------- lobby / net ---------- */
  function startGame() {
    // Panggilan kedua biasanya dari loader sprite: hitung warna tile sekali saja,
    // karena ?solo=1 / klik cepat bisa datang sebelum PNG selesai dimuat.
    if (started) { if (assetsReady && !tileRgbDone) { computeTileColors(); tileRgbDone = true; if (ROUND) ROUND.tileRgb = tileRgb; } return; }
    started = true;
    map = buildMap();
    if (assetsReady) { computeTileColors(); tileRgbDone = true; }
    resize();
    $('sizeSel').innerHTML = '';
    for (let n = CFG.roomMin; n <= 12; n++) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n + ' pemain' + (n < CFG.roomMin ? ' (min ' + CFG.roomMin + ')' : '');
      if (n === 6) o.selected = true;
      $('sizeSel').appendChild(o);
    }
    $('nameInput').value = localStorage.getItem('hs_name') || ('pemain' + (100 + rnd(899)));
    ROUND = new Round({
      map,
      // Reward internal (revive/skip/frenzy) juga lewat AdsManager -> cooldown 30s + platform choice.
      onAds: (offer, cb) => { if (!runAd(offer.key, () => cb(true))) cb(false); },
      bonusHpProvider: () => profile.bonusHp,
    });
    ROUND.tileRgb = tileRgb;      // null selama sprite belum siap -> fallback warna tiles
    window.HideSeekRound = ROUND;      // pegangan debug (console) + smoke test node
    let lastPhase = '';
    ROUND.on(e => {
      if (e.type === 'result') {
        const me = ROUND.me();
        let prog = null;
        if (me) {
          const win = isOnMySide(e.results);
          const gained = profile.finishRound(me.score | 0);              // koin: aturan lama (0.5/skor)
          const xp = profile.awardProgress(me.score | 0, win);            // XP utk layar Game Over
          const local = localScores.add({ name: me.name, score: me.score | 0, role: me.isHider ? 'HIDER' : 'SEEKER', win });
          prog = { gained, xp: xp.gained, leveledTo: xp.leveledTo, level: xp.level, progress: xp.progress, local };
          if (gained > 0) {
            toast(`🪙 +${gained} koin (skor ${me.score})`, 3200); sfx('coin');
            if (fx) fx.damage(me.x, me.y, '+' + gained + ' 🪙', 'coin');
            if (parts) parts.emit('spark', me.x, me.y, { count: 12 });
          }
          if (xp.leveledTo) { toast('⬆ NAIK LEVEL → Lv ' + xp.leveledTo, 3600); sfx('reward'); haptic('win'); shake(1); }
          updateUI();
        }
        showResult(e.results, prog);
      }
      // Nyawa cadangan hasil iklan/referral dipakai otomatis sebelum jadi hantu.
      if (e.type === 'ghost' && e.id === ROUND.myId && profile.lives > 0 && (ROUND.phase === 'HIDE' || ROUND.phase === 'SEEK')) {
        if (profile.consumeLife()) { ROUND.revive(e.id); toast('💚 Nyawa cadangan dipakai — hidup lagi!', 3000); updateUI(); }
      }
      if (e.type === 'phase' && e.name !== lastPhase) {
        lastPhase = e.name;
        if (e.name === 'COUNTDOWN') { $('result').className = 'panel hidden'; clearInterval(showResult._iv); if (screens) screens.show('game'); }
        else if (e.name === 'SEEK') toast('SEEKER MASUK — jangan tersentuh!', 2600);
        else if (e.name === 'HIDE') toast('FASE BERSEMBUNYI (' + CFG.hide + 's)', 2200);
      }
      const f = EV_TOAST[e.type]; if (f) toast(f(e), e.type === 'blast' ? 1400 : 1800);
      /* --- feedback instan: suara + angka melayang + kilat layar (blueprint 1.1) --- */
      const at = e.id != null ? ROUND.players.get(e.id) : null;
      switch (e.type) {
        case 'hit':
          sfx('hit'); haptic('catchHit');
          if (fx && at) fx.damage(at.x, at.y, '-1 ♥', '');
          if (at && parts) parts.emit('hit', at.x, at.y, { count: e.id === ROUND.myId ? 16 : 10 });
          if (e.id === ROUND.myId) { if (fx) fx.flash($('stage'), 'hit'); shake(2); }
          break;
        case 'freeze':
          sfx('freeze'); haptic('skill');
          if (fx) fx.damage(e.x || 0, e.y || 0, '❄ ' + (e.dur || CFG.freezeTime) + 's', 'info');
          if (parts) {
            parts.emit('ring', e.x || 0, e.y || 0, { r1: e.r || CFG.freezeRadius, color: 'rgba(150,225,255,A)' });
            parts.emit('spark', e.x || 0, e.y || 0, { count: 14, color: 'rgba(190,240,255,A)' });
          }
          if (e.id === ROUND.myId && fx) fx.flash($('stage'), 'camo');
          break;
        case 'blast':
          sfx('blast'); haptic('hit');
          if (parts) parts.emit('ring', e.x || 0, e.y || 0, { r1: CFG.blastRadius });
          shake(1); break;
        case 'radar': sfx('radar'); if (at && parts) parts.emit('ring', at.x, at.y, { r1: 3.2, color: 'rgba(255,120,120,A)' }); break;
        case 'prop': sfx('swap'); if (fx && at) fx.damage(at.x, at.y, 'prop!', 'info');
          if (at && parts) parts.emit('dust', at.x, at.y - 0.3, { count: 6, spread: 1 }); break;
        case 'propCancel': sfx('skill'); break;
        case 'camo': sfx('camo'); if (fx && at) fx.damage(at.x, at.y, 'camo', 'info');
          if (at && parts) parts.emit('camo', at.x, at.y);
          if (e.id === ROUND.myId && fx) fx.flash($('stage'), 'camo'); break;
        case 'ghost': sfx('ghost'); haptic('lose'); if (fx && at) fx.damage(at.x, at.y, '💀', '');
          if (at && parts) parts.emit('hit', at.x, at.y, { count: 18, color: 'rgba(190,190,215,A)' });
          if (e.id === ROUND.myId) shake(3); break;
        case 'revive': sfx('reward'); if (fx && at) fx.damage(at.x, at.y, '+1 ♥', 'heal');
          if (at && parts) parts.emit('heal', at.x, at.y); break;
        case 'slow': sfx('hit', 0.6); if (at && parts) parts.emit('dust', at.x, at.y - 0.3, { count: 4, color: 'rgba(140,210,255,A)' }); break;
        case 'frenzy': sfx('go'); if (fx && at) fx.damage(at.x, at.y, 'FRENZY', 'coin');
          if (at && parts) parts.emit('spark', at.x, at.y, { count: 12 }); break;
      }
      if (e.type === 'phase' && (e.name === 'HIDE' || e.name === 'SEEK')) sfx('go');
    });
    /* Jangan buka HUD dulu: loader sprite memanggil startGame() sebelum ada ronde.
       Layar 'game' aktif lewat event fase (COUNTDOWN/HIDE) di bawah. */
    if (screens) onScreenChange(screens.current); else hideSplash();
    requestAnimationFrame(frame);
  }

  function fillWithBots(total) {
    const names = ['agaL', 'ubi', 'nino', 'sari', 'rizki', 'dewi', 'yoga', 'putri', 'ari', 'tia', 'bagas'];
    let id = 1;
    ROUND.myId = id;
    const me = new PlayerState(id, $('nameInput').value.trim() || 'kamu', 0);
    ROUND.add(me); id++;
    while (ROUND.players.size < Math.max(CFG.roomMin, total)) {
      const b = new PlayerState(id, names[rnd(names.length)] + id, 0);
      b.isBot = true; ROUND.add(b); id++;
    }
  }

  /** True bila baris hasil yang menandai kita menang (dipakai utk warna judul + SFX). */
  function isOnMySide(r) {
    const me = r && r.board && r.board.find(b => b.me);
    if (!me) return !!r && r.hidersWin;
    return r.hidersWin ? me.role === 'HIDER' : me.role === 'SEEKER';
  }
  /**
   * Layar hasil. `prog` (opsional) = {gained, xp, leveledTo, progress, local}
   * dari handler 'result'; kalau tidak ada (mis. ronde client-only) display
   * tetap jalan dengan placeholder.
   */
  /**
   * Baris "papan skor lokal" di layar hasil + status wrapper-nya. Dipisahkan supaya
   * tombol hapus di Settings bisa menyegarkan tampilan tanpa harus menunggu ronde baru.
   */
  function renderLocalBoard(mineTs) {
    const el = $('localLbBody');
    if (el) el.innerHTML = localScores.top(5).map((x, i) =>
      `<tr class="${x.ts && x.ts === mineTs ? 'me' : ''}"><td>${i + 1}</td><td>${x.name}</td>` +
      `<td>${x.win ? '🏆' : (x.role === 'HIDER' ? '🦎' : '👁')}</td><td><b>${x.score}</b></td><td>${LocalScores.fmtDate(x.ts)}</td></tr>`).join('');
    const lw = $('localLbWrap'); if (lw) lw.className = localScores.length ? 'on' : '';
  }
  function showResult(r, prog) {
    $('result').className = 'panel';
    const win = isOnMySide(r);
    $('resultTitle').textContent = r.hidersWin ? 'HIDERS MENANG' : 'SEEKER MENANG';
    $('resultTitle').className = win ? 'win' : 'lose';
    sfx(win ? 'win' : 'lose'); haptic(win ? 'win' : 'lose');
    if (AU) { try { AU.music('menu'); } catch (e) { } }
    if (screens) screens.show('result');
    const mvp = r.lastHider || (r.board && r.board[0]);
    setTxt('mvpName', mvp ? (`MVP: ${mvp.name || mvp.name_ || ''} — ${mvp.score != null ? mvp.score + ' poin' : 'bertahan paling lama'}`) : '—');
    $('resultDetail').innerHTML = r.hidersWin
      ? `Semua hider tertangkap? tidak — ${r.board.filter(b => b.role === 'HIDER' && !b.ghost).length} hider selamat. ${r.lastHider ? '<b>Hider terakhir yang hidup: ' + r.lastHider.name + '</b> (pemenang)' : ''}`
      : `Semua hider tertangkap (${r.totalCaught}) oleh ${name(ROUND.seekerId)}.`;
    $('lbBody').innerHTML = r.board.map((b, i) =>
      `<tr class="${b.me ? 'me' : ''}"><td>${i + 1}</td><td>${b.name}</td><td>${b.role}</td><td>${b.detail}</td><td><b>${b.score}</b></td></tr>`).join('');
    /* --- rank + XP + papan skor lokal (blueprint 4.1 "Game Over: skor, #rank, XP earned") --- */
    const setHtml = (id, h) => { const el = $(id); if (el) el.innerHTML = h; };
    const board = r.board || [];
    const meRow = board.find(b => b.me);
    const rank = meRow ? board.indexOf(meRow) + 1 : 0;
    const lp = (prog && prog.progress) || profile.levelProgress;
    const isRecord = !!meRow && meRow.score > 0 && meRow.score >= profile.best;
    setTxt('rankTag', rank ? ('#' + rank + ' dari ' + board.length + (isRecord ? ' · REKOR BARU' : '')) : '—');
    setTxt('xpGain', '+' + ((prog && prog.xp) || 0) + ' XP');
    setTxt('lvlTag', 'Lv ' + lp.level + ' · ' + lp.pct + '%');
    const bf = $('lvlBarFill'); if (bf && bf.style) bf.style.width = clamp(lp.pct, 0, 100) + '%';
    setTxt('coinGain', '+' + ((prog && prog.gained) || 0) + ' koin');
    if (prog && prog.leveledTo) { setCls('lvlTag', 'lvl up'); toast('⬆ level ' + prog.leveledTo, 3000); }
    else setCls('lvlTag', 'lvl');
    renderLocalBoard(prog && prog.local && prog.local.row ? prog.local.row.ts : 0);
    let left = CFG.result;
    clearInterval(showResult._iv);
    $('nextRoundIn').textContent = 'ronde berikutnya dalam ' + left.toFixed(0) + 's';
    showResult._iv = setInterval(() => {
      left -= 0.5;
      if (left <= 0) { clearInterval(showResult._iv); $('nextRoundIn').textContent = 'mulai…'; return; }
      $('nextRoundIn').textContent = 'ronde berikutnya dalam ' + left.toFixed(0) + 's';
    }, 500);
  }

  $('againBtn').onclick = () => { $('result').className = 'panel hidden'; if (screens) screens.show('game'); ROUND.start(true); sfx('go'); };
  $('lobbyBtn').onclick = () => { $('result').className = 'panel hidden'; showScreen('lobby'); if (AU) { try { AU.music('menu'); } catch (e) { } } };
  $('rewardBtn').onclick = () => { const p = ROUND.me(), o = ROUND.currentOffer(p); if (o) ROUND.redeem(o.key); };

  $('soloBtn').onclick = () => {
    startGameSoft();
    localStorage.setItem('hs_name', $('nameInput').value);
    netMode = 'solo'; $('netMode').textContent = 'SOLO (bots)';
    $('lobby').className = 'panel hidden';
    if (screens) screens.show('game');
    hideSplash();
    fillWithBots(parseInt($('sizeSel').value, 10) || 6);
    ROUND.start(true);
    sfx('go');
    toast('fase HIDE 30 detik — pakai skill Kamuflase / Prop Swap');
  };
  function startGameSoft() { startGame(); $('titleFallback').style.display = 'none'; }

  /* ---------- online: room relay tanpa dependency (web/net-server.js) ---------- */
  const api = async (path, body) => {
    const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + await r.text());
    return r.json();
  };
  async function hostRoom() {
    startGameSoft();
    const j = await api('/room/create', { name: $('nameInput').value });
    net = { room: j.room, token: j.token, host: true, seq: 0, players: new Map([[j.you, { name: $('nameInput').value }]]) };
    netMode = 'host'; $('netMode').textContent = 'ONLINE (host) — room ' + j.room;
    $('roomRow').style.display = 'flex'; $('roomCode').textContent = j.room;
    $('lobby').className = 'panel hidden';
    fillWithBots(0);
    ROUND.myId = j.you;
    poll();
    setInterval(async () => {
      if (!net || netMode !== 'host' || ROUND.phase === 'LOBBY') return;
      await api('/room/send', { room: net.room, token: net.token, ev: { t: 'snap', s: ROUND.snapshot() } }).catch(() => {});
    }, 200);
    toast('kode room: ' + j.room + ' — bagikan ke teman');
  }
  async function joinRoom() {
    startGameSoft();
    const code = $('codeInput').value.trim().toUpperCase();
    if (!code) { toast('isi kode room dulu'); return; }
    const j = await api('/room/join', { room: code, name: $('nameInput').value });
    net = { room: j.room, token: j.token, host: false, seq: j.seq || 0 };
    netMode = 'client'; $('netMode').textContent = 'ONLINE (client) — room ' + code;
    $('lobby').className = 'panel hidden';
    ROUND.myId = j.you;
    toast('menunggu host memulai ronde…');
    poll();
    setInterval(async () => {
      if (!net || netMode !== 'client' || !ROUND.me()) return;
      const p = ROUND.me();
      await api('/room/send', { room: net.room, token: net.token, ev: { t: 'in', x: p.input.dx, y: p.input.dy, s1: p.input.skill1, s2: p.input.skill2, s3: p.input.skill3, tap: p.input.tap, pn: p.pendingPropName || null } }).catch(() => {});
      p.input.skill1 = p.input.skill2 = p.input.skill3 = p.input.tap = false; p.pendingPropName = null;
    }, Math.max(CFG.minSendRate, 0.08) * 1000);
  }
  async function poll() {
    while (net) {
      let j;
      try { j = await api('/room/poll?room=' + net.room + '&token=' + net.token + '&after=' + net.seq); }
      catch (e) { toast('koneksi room hilang: ' + e.message); net = null; return; }
      net.seq = j.seq;
      if (j.kicked) { toast('keluar dari room'); net = null; $('lobby').className = 'panel'; return; }
      for (const ev of (j.ev || [])) {
        if (ev.t === 'snap' && netMode === 'client') ROUND.applySnapshot(ev.s);
        else if (ev.t === 'in' && netMode === 'host') {
          const p = ROUND.players.get(ev.from);
          if (p) { p.input.dx = ev.x; p.input.dy = ev.y; if (ev.s1) p.input.skill1 = true; if (ev.s2) p.input.skill2 = true; if (ev.s3) p.input.skill3 = true; if (ev.tap) p.input.tap = true; if (ev.pn) p.pendingPropName = ev.pn; }
        }
        else if (ev.t === 'catch' && netMode === 'host') {
          const p = ROUND.players.get(ev.from); if (p) ROUND.tryCatch(p, ev.x, ev.y);
        } else if (ev.t === 'roster') {
          net.players = new Map(ev.list.map(([id, n]) => [id, { name: n }]));
          if (netMode === 'host') syncRoster();
        }
      }
    }
  }
  function syncRoster() {
    // host yang membuat/menghapus PlayerState + memilih role (Authority)
    for (const [id, info] of net.players) if (!ROUND.players.has(id)) {
      const p = new PlayerState(id, info.name, 0); ROUND.add(p);
      if (id === ROUND.myId) p.isBot = false;
    }
    for (const [id, p] of [...ROUND.players]) if (!p.isBot && !net.players.has(id)) ROUND.players.delete(id);
    // sisa slot diisi bot supaya ronde tetap seru (min 2 pemain)
    let id = 100;
    while (ROUND.players.size < CFG.roomMin) {
      const b = new PlayerState(id, 'bot' + (id - 99), 0); b.isBot = true; ROUND.add(b); id++;
    }
    $('startBtn').disabled = ROUND.players.size < CFG.roomMin;
  }
  $('hostBtn').onclick = () => hostRoom().catch(e => toast('gagal buat room: ' + e.message + ' (jalankan: node web/net-server.js)'));
  $('joinBtn').onclick = () => joinRoom().catch(e => toast('gagal gabung: ' + e.message));
  $('startBtn').onclick = () => { if (netMode === 'host') { syncRoster(); ROUND.start(true); } };
  $('leaveBtn').onclick = () => { net = null; netMode = 'solo'; $('roomRow').style.display = 'none'; $('lobby').className = 'panel'; showScreen('lobby'); };
  if (location.hostname) resize();
  // auto-start saat ?solo=1 (dipakai juga oleh pengecekan visual)
  if (new URLSearchParams(location.search).get('solo') === '1') $('soloBtn').click();
})();

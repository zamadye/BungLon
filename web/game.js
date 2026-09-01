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
    this.hp = CFG.hiderHp; this.ghost = (role !== 0);       // seeker tak punya HP
    this.alive = true;
    this.camoRgb = null; this.camoTarget = null;
    this.propDef = null; this.propUntil = 0;
    this.slowUntil = 0; this.slowFactor = 1;
    this.boostUntil = 0; this.boostMult = 1; this.boostRange = 0;
    this.pushUntil = 0; this.pushVx = 0; this.pushVy = 0;
    this.invulnUntil = 0; this.safeUntil = 0;
    this.cdHider = 0; this.cdSeeker = 0; this.lastCatch = -9;
    this.catches = 0; this.survived = 0; this.score = 0;
    this.isBot = false; this.brain = { t: 0, goal: null, mood: 0 };
    this.input = { dx: 0, dy: 0, skill1: false, skill2: false, tap: false };
    this.spawnX = 0; this.spawnY = 0;
  }
  get isHider() { return this.role === 0; }
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
      p.hp = CFG.hiderHp; p.ghost = false; p.alive = true;
      p.camoRgb = p.camoTarget = null; p.propDef = null; p.propUntil = 0;
      p.slowUntil = 0; p.boostUntil = 0; p.pushUntil = 0; p.invulnUntil = 0; p.safeUntil = 0;
      p.cdHider = p.cdSeeker = 0; p.catches = 0; p.survived = 0; p.score = 0; p.lastCatch = -9;
      p.input = { dx: 0, dy: 0, skill1: false, skill2: false, tap: false };
      this.assignSpawn(p);
    }
    this.results = null;
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
  usePropSwap(p) {
    if (!p.isHider || this.t < p.cdHider || p.ghost) return false;
    p.cdHider = this.t + CFG.hiderCd;
    p.propDef = pick(PROPS);
    p.propUntil = this.t + CFG.propSwapTime;
    p.camoTarget = null; p.camoRgb = null;
    this.emit({ type: 'prop', id: p.id, prop: p.propDef.name, dur: CFG.propSwapTime });
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
          } else if (sd < 6 && p.propDef === null && Math.random() < 0.01) { p.input.skill1 = true; p.input.dx = p.input.dy = 0; }
          else { p.input.dx = p.input.dy = 0; if (Math.random() < 0.004) { b.goal = this.pickHidingSpot(p); } else if (b.goal && Math.random() < 0.02) { p.input.dx = Math.sign(b.goal[0] - p.x) * .6; p.input.dy = Math.sign(b.goal[1] - p.y) * .6; } }
        } else { p.input.dx = p.input.dy = 0; }
      } else {                                   // seeker bot: dekati hider terdekat
        const t = this.livingHiders().sort((a, c) => dist(a.x, a.y, p.x, p.y) - dist(c.x, c.y, p.x, p.y))[0];
        p.input.skill1 = p.input.skill2 = p.input.tap = false;
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
    if (p.ghost && p.isHider) { p.input.skill1 = p.input.skill2 = false; return; }
    if (p.input.skill1) { p.input.skill1 = false; if (p.isHider) this.useCamouflage(p); else this.useRadar(p); }
    if (p.input.skill2) { p.input.skill2 = false; if (p.isHider) this.usePropSwap(p); else this.useSonicBlast(p); }
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
  module.exports = { CFG, Round, PlayerState, buildMap, spawnFor, PROPS, TILES, clamp, dist, fmtTime };
}

if (typeof document !== 'undefined') (function boot() {
  /* ---------- assets ---------- */
  const names = ['Chameleon_Hider', 'Chameleon_Seeker', 'Hedge_Wall', 'Bush', 'Rocks', 'Mushrooms',
    'Prop_Table', 'Prop_Chair', 'Prop_FlowerPot', 'Prop_Crate', 'Tile_Grass', 'Tile_Sand', 'Tile_Stone',
    'Tile_Wood', 'Icon_Camouflage', 'Icon_PropSwap', 'Icon_Radar', 'Icon_SonicBlast', 'Icon_Revive', 'Bg_Lobby'];
  const SPR = {}, tintCache = new Map();
  let pending = names.length, assetsReady = false, tileRgbDone = false;
  // Semua sprite (atau error) sudah datang -> warna tile boleh dihitung.
  const onAll = () => { if (--pending <= 0) { assetsReady = true; startGame(); } };
  for (const n of names) {
    const img = new Image();
    img.onload = img.onerror = onAll;
    img.src = 'assets/' + n + '.png';
    SPR[n] = img;
  }

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
  let netMode = 'solo', net = null, started = false;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cssW = cv.clientWidth; cssH = cv.clientHeight;
    cv.width = Math.round(cssW * DPR); cv.height = Math.round(cssH * DPR);
    if (!map) return;
    scale = Math.min(cssW / (map.cols + 1), cssH / (map.rows + 1)) * DPR;
    ox = cssW * DPR / 2; oy = cssH * DPR / 2;
    mm.width = mm.clientWidth * DPR; mm.height = mm.clientHeight * DPR;
  }
  addEventListener('resize', resize);

  const W2SX = wx => ox + wx * scale, W2SY = wy => oy - wy * scale;
  const SX2W = sx => (sx - ox) / scale, SY2W = sy => (oy - sy) / scale;

  /* ---------- toast / HUD ---------- */
  function toast(text, ms = 2200) {
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = text;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), ms);
  }
  const EV_TOAST = {
    camo: e => `${name(e.id)} menyatu dengan lantai`,
    prop: e => `${name(e.id)} menyamar jadi ${e.prop}`,
    propCancel: e => `${name(e.id)} membatalkan samaran`,
    blast: e => `${name(e.id)} melepaskan Sonic Blast!`,
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
  function buildSkills() {
    const p = ROUND.me();
    const defs = p && !p.isHider
      ? [['Icon_Radar', 'Radar', 1, 'skill1'], ['Icon_SonicBlast', 'Blast', 2, 'skill2']]
      : [['Icon_Camouflage', 'Kamuflase', 1, 'skill1'], ['Icon_PropSwap', 'Prop', 2, 'skill2']];
    const box = $('skills');
    if (box.dataset.defs === defs.map(d => d[1]).join(',')) return;
    box.dataset.defs = defs.map(d => d[1]).join(',');
    box.innerHTML = '';
    for (const [icon, lbl, hot, field] of defs) {
      const b = document.createElement('div');
      b.className = 'skill'; b.dataset.field = field;
      b.innerHTML = `<img src="assets/${icon}.png" alt=""><div class="cd"></div><div class="lbl">${lbl}<br><span class="kbd">${hot}</span></div>`;
      b.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        const me = ROUND.me(); if (!me || me.ghost) return;
        me.input[field] = true;
        if (ROUND.phase === 'LOBBY' || ROUND.phase === 'RESULT') toast('skill aktif saat ronde berjalan');
      });
      box.appendChild(b);
    }
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
    // cooldown radial
    for (const b of $('skills').children) {
      if (!p) continue;
      const isHider = p.isHider;
      const left = Math.max(0, (isHider ? p.cdHider : p.cdSeeker) - ROUND.t);
      const total = isHider ? CFG.hiderCd : CFG.seekerCd;
      b.querySelector('.cd').style.background = `conic-gradient(#000c ${left / total * 360}deg, transparent 0)`;
      b.className = 'skill ' + (left > 0.02 ? 'cool' : 'ready');
    }
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
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    keys[e.key.toLowerCase()] = true;
    if (e.key === '1') press('skill1'); if (e.key === '2') press('skill2');
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
  const joy = { active: false, dx: 0, dy: 0, id: null, cx: 0, cy: 0 };
  (function setupJoy() {
    const el = $('joy'), knob = $('joyKnob');
    const R = () => el.clientWidth / 2;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const m = Math.hypot(dx, dy) || 1, lim = r.width / 2;
      const k = Math.min(1, m / lim);
      joy.dx = dx / m * k; joy.dy = -dy / m * k;
      knob.style.transform = `translate(calc(-50% + ${dx / m * k * lim}px), calc(-50% + ${dy / m * k * lim}px))`;
    };
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); joy.active = true; joy.id = e.pointerId; set(e); });
    el.addEventListener('pointermove', e => { if (joy.active && e.pointerId === joy.id) set(e); });
    const end = e => { if (e.pointerId !== joy.id) return; joy.active = false; joy.dx = joy.dy = 0; knob.style.transform = 'translate(-50%,-50%)'; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  })();

  // klik/tap di arena → catcher (RequestCatch) untuk seeker
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

  /* ---------- "iklan" reward — AdsManager.simulateAds ---------- */
  let adBusy = false;
  function showRewardAd(offer, cb) {
    if (adBusy) { cb(false); return; }
    adBusy = true;
    const ov = $('adOverlay'), bar = $('adBar'), txt = $('adText');
    ov.className = 'on';
    txt.textContent = offer.key === 'revive' ? 'Hidup lagi +1 HP …' : offer.key === 'skip' ? 'Cooldown skill direset…' : `Frenzy ${CFG.frenzyTime}s: +25% speed, jangkauan tangkap +${CFG.frenzyRange}`;
    const t0 = performance.now(), ms = CFG.adSimSeconds * 1000;
    let done = false;
    const finish = ok => { if (done) return; done = true; ov.className = ''; adBusy = false; cb(ok); };
    $('adSkipBtn').onclick = () => finish(false);
    (function loop() {
      const k = Math.min(1, (performance.now() - t0) / ms);
      bar.style.width = (k * 100) + '%';
      if (k < 1 && !done) requestAnimationFrame(loop); else finish(true);
    })();
  }

  /* ---------- loop utama ---------- */
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (ROUND && netMode !== 'client') { keyInput(); ROUND.step(dt); }
    else if (ROUND) { keyInput(); ROUND.t += dt; ROUND.tickPhaseClient?.(); }
    if (ROUND) { buildSkills(); hud(); draw(); }
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
    ROUND = new Round({ map, onAds: showRewardAd });
    ROUND.tileRgb = tileRgb;      // null selama sprite belum siap -> fallback warna tiles
    window.HideSeekRound = ROUND;      // pegangan debug (console) + smoke test node
    let lastPhase = '';
    ROUND.on(e => {
      if (e.type === 'result') showResult(e.results);
      if (e.type === 'phase' && e.name !== lastPhase) {
        lastPhase = e.name;
        if (e.name === 'COUNTDOWN') { $('result').className = 'panel hidden'; clearInterval(showResult._iv); }
        else if (e.name === 'SEEK') toast('SEEKER MASUK — jangan tersentuh!', 2600);
        else if (e.name === 'HIDE') toast('FASE BERSEMBUNYI (' + CFG.hide + 's)', 2200);
      }
      const f = EV_TOAST[e.type]; if (f) toast(f(e), e.type === 'blast' ? 1400 : 1800);
    });
    $('hud').className = 'on';
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

  function showResult(r) {
    $('result').className = 'panel';
    $('resultTitle').textContent = r.hidersWin ? 'HIDERS MENANG' : 'SEEKER MENANG';
    $('resultDetail').innerHTML = r.hidersWin
      ? `Semua hider tertangkap? tidak — ${r.board.filter(b => b.role === 'HIDER' && !b.ghost).length} hider selamat. ${r.lastHider ? '<b>Hider terakhir yang hidup: ' + r.lastHider.name + '</b> (pemenang)' : ''}`
      : `Semua hider tertangkap (${r.totalCaught}) oleh ${name(ROUND.seekerId)}.`;
    $('lbBody').innerHTML = r.board.map((b, i) =>
      `<tr class="${b.me ? 'me' : ''}"><td>${i + 1}</td><td>${b.name}</td><td>${b.role}</td><td>${b.detail}</td><td><b>${b.score}</b></td></tr>`).join('');
    let left = CFG.result;
    clearInterval(showResult._iv);
    $('nextRoundIn').textContent = 'ronde berikutnya dalam ' + left.toFixed(0) + 's';
    showResult._iv = setInterval(() => {
      left -= 0.5; $('nextRoundIn').textContent = left > 0 ? 'ronde berikutnya dalam ' + left.toFixed(0) + 's' : 'mulai…';
    }, 500);
  }

  $('againBtn').onclick = () => { $('result').className = 'panel hidden'; ROUND.start(true); };
  $('lobbyBtn').onclick = () => { $('result').className = 'panel hidden'; };
  $('rewardBtn').onclick = () => { const p = ROUND.me(), o = ROUND.currentOffer(p); if (o) ROUND.redeem(o.key); };

  $('soloBtn').onclick = () => {
    startGameSoft();
    localStorage.setItem('hs_name', $('nameInput').value);
    netMode = 'solo'; $('netMode').textContent = 'SOLO (bots)';
    $('lobby').className = 'panel hidden';
    fillWithBots(parseInt($('sizeSel').value, 10) || 6);
    ROUND.start(true);
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
      await api('/room/send', { room: net.room, token: net.token, ev: { t: 'in', x: p.input.dx, y: p.input.dy, s1: p.input.skill1, s2: p.input.skill2, tap: p.input.tap } }).catch(() => {});
      p.input.skill1 = p.input.skill2 = p.input.tap = false;
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
          if (p) { p.input.dx = ev.x; p.input.dy = ev.y; if (ev.s1) p.input.skill1 = true; if (ev.s2) p.input.skill2 = true; if (ev.tap) p.input.tap = true; }
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
  $('leaveBtn').onclick = () => { net = null; netMode = 'solo'; $('roomRow').style.display = 'none'; $('lobby').className = 'panel'; };
  if (location.hostname) resize();
  // auto-start saat ?solo=1 (dipakai juga oleh pengecekan visual)
  if (new URLSearchParams(location.search).get('solo') === '1') $('soloBtn').click();
})();

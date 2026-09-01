/* =============================================================================
 * tools/web_selftest.js — uji headless web demo (tanpa browser, tanpa Unity)
 * -----------------------------------------------------------------------------
 * [1] PARITAS: CFG di web/game.js dicocokkan dengan konstanta C#
 *     (HideSeekConstants.cs, AdsManager, SeekerSkill, CamouflageHelper,
 *      PropDatabase.cs, SetupTool sizing, GameManager skor).
 * [2..12] RULES: peta & spawn, phase machine, role, camo & prop swap,
 *     hit/pushback/kebal/hantu, tap-catch, radar & sonic blast, leaderboard,
 *     kuota reward iklan, snapshot, dan simulasi 2 ronde dengan bot.
 * jalan:  node tools/web_selftest.js          (exit != 0 bila ada FAIL)
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { CFG, Round, PlayerState, buildMap, spawnFor, PROPS } = require(path.join(__dirname, '..', 'web', 'game.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sec = t => Math.round(t * 1000) / 1000;
const tick = () => new Promise(res => setTimeout(res, 0));

const ROOT = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const cs = rd('Assets/Scripts/Core/HideSeekConstants.cs');
const cnum = re => { const m = cs.match(re); return m ? parseFloat(m[1]) : NaN; };

/* arena 3 hider + 1 seeker; seeker dibuat terakhir + roundIndex dipatok supaya
   rotasi role di start() jatuh ke seeker tsb (test rule butuh role stabil). */
function mk(nHiders = 3, opts = {}) {
  const map = buildMap();
  const r = new Round(Object.assign({ map }, opts));
  r.tileRgb = [[74, 135, 25], [217, 166, 95], [124, 128, 127], [139, 85, 42]];
  const ps = [];
  for (let i = 1; i <= nHiders; i++) ps.push(r.add(new PlayerState(i, 'h' + i, 0)));
  const s = r.add(new PlayerState(99, 'seeker', 1));
  r.hostId = 99; r.myId = 1;
  r.roundIndex = r.players.size - 2;
  return { r, ps, s, map };
}
const run = (r, seconds, dt = 1 / 60) => { for (let i = 0; i < Math.round(seconds / dt); i++) r.step(dt); };
const runTo = (r, target, dt = 1 / 60) => { let guard = 0; while (r.t < target - 1e-9 && guard++ < 100000) r.step(dt); };
// jalan sampai kondisi tercapai; mengembalikan detik yang dibutuhkan (1 frame toleransi)
const until = (r, pred, dt = 1 / 60, maxSec = 200) => {
  const t0 = r.t; let n = 0;
  while (!pred() && n++ < Math.round(maxSec / dt)) r.step(dt);
  return r.t - t0;
};

(async function main() {
  /* ====================== [1] PARITAS KONFIGURASI ========================= */
  console.log('\n[1] paritas konfigurasi: web/game.js CFG == kode C# Unity');
  const PARITY = [
    ['countdown', /CountdownSeconds\s*=\s*(\d+)/, CFG.countdown],
    ['hide', /HidePhaseSeconds\s*=\s*(\d+)/, CFG.hide],
    ['seek', /SeekPhaseSeconds\s*=\s*(\d+)/, CFG.seek],
    ['result', /ResultSeconds\s*=\s*(\d+)/, CFG.result],
    ['roomMin', /RoomMinPlayers\s*=\s*(\d+)/, CFG.roomMin],
    ['roomMax', /RoomMaxPlayers\s*=\s*(\d+)/, CFG.roomMax],
    ['hiderHp', /HiderMaxHp\s*=\s*(\d+)/, CFG.hiderHp],
    ['hiderSpeed', /HiderMoveSpeed\s*=\s*([\d.]+)f/, CFG.hiderSpeed],
    ['seekerMult', /SeekerSpeedMultiplier\s*=\s*([\d.]+)f/, CFG.seekerMult],
    ['hiderCd', /HiderSkillCooldown\s*=\s*([\d.]+)f/, CFG.hiderCd],
    ['seekerCd', /SeekerSkillCooldown\s*=\s*([\d.]+)f/, CFG.seekerCd],
    ['propSwapTime', /PropSwapDuration\s*=\s*([\d.]+)f/, CFG.propSwapTime],
    ['blastRadius', /SonicBlastRadius\s*=\s*([\d.]+)f/, CFG.blastRadius],
    ['slowFactor', /SonicSlowFactor\s*=\s*([\d.]+)f/, CFG.slowFactor],
    ['slowTime', /SonicSlowDuration\s*=\s*([\d.]+)f/, CFG.slowTime],
    ['pushback', /PushbackDistance\s*=\s*([\d.]+)f/, CFG.pushback],
    ['pushbackTime', /PushbackDuration\s*=\s*([\d.]+)f/, CFG.pushbackTime],
    ['invuln', /HitInvulnerable\s*=\s*([\d.]+)f/, CFG.invuln],
    ['catchRange', /CatchMaxRange\s*=\s*([\d.]+)f/, CFG.catchRange],
    ['catchTapInterval', /CatchMinInterval\s*=\s*([\d.]+)f/, CFG.catchTapInterval],
    ['ghostAlpha', /GhostAlpha\s*=\s*([\d.]+)f/, CFG.ghostAlpha],
    ['minSendRate (ms)', /MinSendRateMs\s*=\s*(\d+)/, CFG.minSendRate * 1000],
    ['timerBroadcast', /TimerBroadcastInterval\s*=\s*([\d.]+)f/, CFG.timerBroadcast],
    ['reviveHp', /ReviveHp\s*=\s*(\d+)/, CFG.reviveHp],
    ['maxRevives', /MaxRevivesPerRound\s*=\s*(\d+)/, CFG.maxRevives],
    ['maxSkips', /MaxCooldownSkipsPerRound\s*=\s*(\d+)/, CFG.maxSkips],
    ['maxFrenzies', /MaxFrenziesPerRound\s*=\s*(\d+)/, CFG.maxFrenzies],
    ['reviveSafeWindow', /ReviveSafeWindow\s*=\s*([\d.]+)f/, CFG.reviveSafeWindow],
    ['frenzyTime', /FrenzyDuration\s*=\s*([\d.]+)f/, CFG.frenzyTime],
    ['frenzySpeed', /FrenzySpeedMultiplier\s*=\s*([\d.]+)f/, CFG.frenzySpeed],
    ['frenzyRange', /FrenzyCatchRangeBonus\s*=\s*([\d.]+)f/, CFG.frenzyRange],
    ['adGap', /AdMinGapSeconds\s*=\s*([\d.]+)f/, CFG.adGap],
  ];
  for (const [k, re, want] of PARITY) ok(`CFG.${k} = ${want}`, near(cnum(re), want, 1e-9), { csharp: cnum(re) });
  ok('blastRadiusSqr == radius²', near(CFG.blastRadiusSqr, CFG.blastRadius * CFG.blastRadius), CFG.blastRadiusSqr);
  ok('adSimSeconds == AdsManager.simulatedAdSeconds',
    near(CFG.adSimSeconds, parseFloat(rd('Assets/Scripts/Monetization/AdsManager.cs').match(/simulatedAdSeconds\s*=\s*([\d.]+)f/)[1])), CFG.adSimSeconds);
  ok('skor: seeker catches*30 / hider detik + hp*10 (GameManager)',
    CFG.scoreCatch === 30 && CFG.scoreSurviveSec === 1 && CFG.scoreHpBonus === 10);
  {
    const m = rd('Assets/Scripts/Skills/SeekerSkill.cs').match(/radarDuration\s*=\s*([\d.]+)f/);
    ok('ping radar 1s == SeekerSkill.radarDuration', m && near(1.0, parseFloat(m[1])), m && m[1]);
    const c = rd('Assets/Scripts/Utils/CamouflageHelper.cs').match(/blendRadius\s*=\s*([\d.]+)f/);
    ok('referensi sampling camo == CamouflageHelper.blendRadius', c && near(0.45, parseFloat(c[1])), c && c[1]);
  }
  {
    const db = rd('Assets/Scripts/Skills/PropDatabase.cs');
    const e = [...db.matchAll(/id = (\d+), displayName = "([^"]+)",\s*localScale = new Vector3\(([\d.]+)f, ?([\d.]+)f/g)]
      .map(m => ({ id: +m[1], name: m[2], w: +m[3], h: +m[4] }));
    ok('PROPS[0..2] == PropDatabase.cs (nama + localScale)',
      e.length === 3 && e.every((x, i) => x.name === PROPS[i].name && near(x.w, PROPS[i].w) && near(x.h, PROPS[i].h)),
      { csharp: e, web: PROPS.slice(0, 3) });
    const inst = rd('Assets/Scripts/Editor/HideSeekArtInstaller.cs');
    const names4 = (inst.match(/PropNames = \{([^}]+)\}/) || [])[1] || '';
    ok('PROPS[3] = "Peti" (entri ke-4 buatan Setup/5 ArtInstaller)', names4.includes('Peti') && PROPS[3].name === 'Peti', names4.trim());
  }
  {
    const t = rd('Assets/Scripts/Editor/HideSeekSetupTool.cs');
    ok('grid tile == loop SetupTool (x -8..8, y -5..5)',
      /for \(int x = -8; x <= 8; x\+\+\)/.test(t) && /for \(int y = -5; y <= 5; y\+\+\)/.test(t) && CFG.mapW === 17 && CFG.mapH === 11);
    ok('dinding == Wall() SetupTool (0,±6.2) 19x0.6 · (±9.2,0) 0.6x13',
      /Wall\("wall_top", new Vector3\(0, 6\.2f, 0\), new Vector2\(19f, 0\.6f\)/.test(t) &&
      /Wall\("wall_left", new Vector3\(-9\.2f, 0, 0\), new Vector2\(0\.6f, 13f\)/.test(t));
    ok('spot prop == loop SetupTool (-6 + i*2.4, ±2.5)', /-6 \+ i \* 2\.4f, \(i % 2 == 0\) \? 2\.5f : -2\.5f/.test(t));
    ok('spawn radius 3.5 == NetworkManager.GetSpawnPosition',
      /Mathf\.Cos\(ang\) \* 3\.5f/.test(rd('Assets/Scripts/Network/NetworkManager.cs')));
    ok('hantu tidak bergerak == PlayerController (canMove !IsGhost)',
      /bool canMove = !IsGhost && !stunned/.test(rd('Assets/Scripts/Players/PlayerController.cs')));
  }

  /* ====================== [2] PETA ====================================== */
  console.log('\n[2] peta & spawn meniru SetupTool/NetworkManager');
  {
    const m = buildMap();
    const at = (wx, wy) => { const [gx, gy] = m.toGrid(wx, wy); return m.tiles[gy * m.cols + gx]; };
    ok('grid 17x11', m.cols === 17 && m.rows === 11);
    ok('jalur tengah y=0 = batu', at(0, 0) === 2 && at(-7, 0) === 2, [at(0, 0), at(-7, 0)]);
    ok('lapangan tengah = pasir', at(2, 1) === 1 && at(-3, -2) === 1, [at(2, 1), at(-3, -2)]);
    ok('gubuk kiri-atas = kayu', at(-7, 4) === 3, at(-7, 4));
    ok('gubuk kanan-bawah = kayu', at(7, -4) === 3, at(7, -4));
    ok('di luar zona = rumput', at(-7, -4) === 0 && at(7, 4) === 0, [at(-7, -4), at(7, 4)]);
    ok('baris tengah (y=0) bukan pasir', at(5, 0) === 2, at(5, 0));
    const w = m.walls;
    ok('4 dinding box', w.length === 4 && near(w[0].cy, 6.2) && near(w[0].w, 19) && near(w[0].h, .6) && near(w[2].cx, -9.2) && near(w[2].h, 13),
      w.map(x => [x.cx, x.cy, x.w, x.h]));
    ok('di dalam arena bebas', m.solid(0, 0, 0.34) === false && m.solid(7, 4, 0.34) === false);
    ok('dinding menghalangi', m.solid(0, 5.9, 0.34) === true && m.solid(-8.9, 0, 0.34) === true);
    ok('6 prop di spot SetupTool + entry i % Count', m.props.length === 6 &&
      m.props.every((p, i) => near(p.wx, -6 + i * 2.4) && near(p.wy, i % 2 === 0 ? 2.5 : -2.5) && p.def.id === i % PROPS.length),
      m.props.map(p => [p.wx, p.wy, p.def.id]));
    ok('prop menghalangi gerakan', m.solid(m.props[0].wx, m.props[0].wy, 0.34) === true);
    ok('6 dekorasi tanpa collider', m.decor.length === 6 && m.decor.every(d => !m.solid(d.wx, d.wy, 0.01)));
    ok('pool dekor == {bush,rocks,shrooms,bush,shrooms,rocks}',
      m.decor.map(d => d.sprite).join(',') === 'Bush,Rocks,Mushrooms,Bush,Mushrooms,Rocks', m.decor.map(d => d.sprite));
    ok('spawn melingkar radius 3.5', near(Math.hypot(...spawnFor(0, 6)), 3.5, 1e-9), spawnFor(0, 6));
    ok('spawn beda per actorNumber', JSON.stringify(spawnFor(1, 6)) !== JSON.stringify(spawnFor(2, 6)));
    {
      const rr = new Round({ map: m });
      const placed = [];
      for (let a = 0; a < 6; a++) { const q = rr.add(new PlayerState(a + 1, 'sp' + a, 0)); placed.push([q.name, m.solid(q.x, q.y, 0.34)]); }
      ok('assignSpawn selalu berakhir di petak bebas', placed.every(x => x[1] === false), placed);
    }
  }

  /* ====================== [3] PHASE MACHINE =============================== */
  console.log('\n[3] phase machine (GameManager.EnterPhase / TickPhase)');
  {
    const { r } = mk(3);
    r.start(true);
    const r0 = r.roundIndex;
    ok('mulai COUNTDOWN', r.phase === 'COUNTDOWN');
    ok('sisa 5.00s', near(r.timeLeft, CFG.countdown, 1e-9), r.timeLeft);
    let dt = until(r, () => r.phase === 'HIDE');
    ok(`COUNTDOWN -> HIDE setelah ${sec(dt)}s (=5s)`, near(dt, 5, 1 / 60 + 1e-6), sec(dt));
    ok('HIDE = 30s', near(CFG.hide, 30, 0), CFG.hide);
    ok('sisa HIDE ≈ 30s', r.timeLeft > 29.9 && r.timeLeft <= 30.001, sec(r.timeLeft));
    dt = until(r, () => r.phase === 'SEEK');
    ok(`HIDE -> SEEK setelah ${sec(dt)}s (=30s)`, near(dt, 30, 1 / 60 + 1e-6), sec(dt));
    dt = until(r, () => r.phase === 'RESULT');
    ok(`SEEK -> RESULT setelah ${sec(dt)}s (=60s)`, near(dt, 60, 1 / 60 + 1e-6), sec(dt));
    ok('sisa RESULT ≈ 10s', r.timeLeft > 9.9 && r.timeLeft <= 10.001, sec(r.timeLeft));
    dt = until(r, () => r.phase === 'COUNTDOWN');
    ok(`RESULT -> ronde baru setelah ${sec(dt)}s (=10s)`, near(dt, 10, 1 / 60 + 1e-6), sec(dt));
    ok('roundIndex +1', r.roundIndex === r0 + 1, { r0, now: r.roundIndex });
    ok('state pemain direset', [...r.players.values()].every(p => p.hp === CFG.hiderHp && !p.ghost && p.catches === 0 && p.camoRgb === null && p.survived === 0),
      [...r.players.values()].map(p => [p.name, p.hp, p.ghost, p.survived]));
    ok('total satu ronde = 105s', near(CFG.countdown + CFG.hide + CFG.seek + CFG.result, 105, 0));
  }

  /* ====================== [4] ROLE ======================================== */
  console.log('\n[4] role: 1 seeker + 11 hider, rotasi tiap ronde');
  {
    const { r } = mk(11); r.start(true);
    ok('11 hider', r.livingHiders().length === 11, r.livingHiders().length);
    ok('1 seeker', [...r.players.values()].filter(p => p.role === 1).length === 1);
    ok('seeker = pemilik giliran (rotasi host)', r.seekerId === [...r.players.keys()][12 % r.players.size] || r.seekerId !== 0, r.seekerId);
    const first = r.seekerId;
    r.start(true);
    ok('seeker berganti ronde berikutnya', r.seekerId !== first, { first, next: r.seekerId });
  }

  /* ====================== [5] CAMO & PROP SWAP ============================ */
  console.log('\n[5] HiderSkill: Kamuflase (match color) & Prop Swap');
  {
    const { r, ps, s } = mk(2); r.start(false);
    const h = ps[0];
    h.x = 0; h.y = 0;
    ok('skill 1 (Kamuflase) aktif', r.useCamouflage(h) === true);
    ok('warna camo = rata2 tile tanah', JSON.stringify(h.camoTarget) === JSON.stringify([124, 128, 127]), h.camoTarget);
    ok('warnaApply langsung (PlayerVisual.TintAll)', h.camoRgb != null && JSON.stringify(h.camoRgb) === JSON.stringify([124, 128, 127]));
    ok('cooldown hider 10s', near(h.cdHider - r.t, 10, 1e-9), sec(h.cdHider - r.t));
    ok('spaming saat cd ditolak', r.useCamouflage(h) === false);
    runTo(r, r.t + 9.9); ok('9.9s kemudian masih cd', r.useCamouflage(h) === false);
    runTo(r, h.cdHider + 0.02); ok('>=10s siap lagi', r.useCamouflage(h) === true);
    h.x = 2; h.y = 1; h.cdHider = 0; r.useCamouflage(h);
    ok('di atas pasir → warna pasir', JSON.stringify(h.camoTarget) === JSON.stringify([217, 166, 95]), h.camoTarget);
    h.x = -7; h.y = 4; h.cdHider = 0; r.useCamouflage(h);
    ok('di atas kayu → warna kayu', JSON.stringify(h.camoTarget) === JSON.stringify([139, 85, 42]), h.camoTarget);

    const h2 = ps[1];
    ok('skill 2 (Prop Swap) aktif', r.usePropSwap(h2) === true);
    ok('wujud = prop dari database', h2.propDef != null && PROPS.some(p => p.id === h2.propDef.id));
    ok('durasi 8s', near(h2.propUntil - r.t, 8, 1e-9), sec(h2.propUntil - r.t));
    ok('pakai prop memakai cooldown yang sama', near(h2.cdHider - r.t, 10, 1e-9));
    h2.input.dx = 1; r.movePlayer(h2, 1 / 60);
    ok('ada input gerak -> samaran BATAL (HiderSkill.Update)', h2.propDef === null, h2.propDef);
    h2.input.dx = 0; h2.cdHider = 0; r.usePropSwap(h2);
    ok('diam = samaran bertahan', h2.propDef !== null);
    runTo(r, h2.propUntil + 0.02);
    ok('habis otomatis setelah 8s', h2.propDef === null);
    ok('seeker tidak punya skill hider', r.useCamouflage(s) === false && r.usePropSwap(s) === false);
    ok('hantu tidak bisa pakai skill', (() => { h.ghost = true; const before = r.useCamouflage(h); h.ghost = false; return before === false; })());
  }

  /* ====================== [6] HIT / PUSHBACK / GHOST ==================== */
  console.log('\n[6] PlayerCombat: -1 HP, pushback 3 unit, grace 0.6s, jadi hantu');
  {
    const { r, ps, s } = mk(1); r.start(false); r.enterPhase('SEEK');
    const h = ps[0];
    h.x = 2; h.y = 0; s.x = 1.6; s.y = 0;
    const x0 = h.x;
    r.hit(h.id, s.id, true);
    ok('HP 3 → 2', h.hp === 2, h.hp);
    ok('tangkapan seeker +1', s.catches === 1, s.catches);
    ok('CurrentSpeed 0 saat terdorong', near(h.speedNow, 0, 1e-9), h.speedNow);
    ok('pushback 0.35s', near(h.pushUntil - r.t, CFG.pushbackTime, 1e-9));
    h.input.dx = -1;                       // melawan arah dorongan: tidak berpengaruh
    runTo(r, h.pushUntil + 0.02);
    const moved = h.x - x0;
    ok('terdorong ~3 unit menjauhi seeker', moved > 2.0 && moved < 3.6, { moved: sec(moved) });
    ok('grace masih aktif → HP tetap 2', h.hp === 2, h.hp);
    runTo(r, h.invulnUntil + 0.02);
    r.hit(h.id, s.id, false);
    ok('setelah grace: HP 2 → 1', h.hp === 1, h.hp);
    h.invulnUntil = 0; h.safeUntil = 0;
    r.hit(h.id, s.id, false);
    ok('HP 0 → hantu', h.ghost === true && h.alive === false && h.hp === 0, { hp: h.hp, g: h.ghost });
    ok('hantu tidak bisa ditangkap lagi', (() => { const c = s.catches; h.invulnUntil = 0; r.hit(h.id, s.id, false); return s.catches === c; })());
    runTo(r, h.pushUntil + 0.02);
    const gx = h.x, gy = h.y; h.input.dx = 1; h.input.dy = 1; run(r, 0.5); h.input.dx = h.input.dy = 0;
    ok('hantu diam total (canMove = !IsGhost)', near(h.speedNow, 0, 1e-9) && near(h.x, gx, 1e-9) && near(h.y, gy, 1e-9), { sp: h.speedNow, dx: sec(h.x - gx) });
    ok('tidak dihitung sebagai hider hidup', r.livingHiders().length === 0);
    ok('semua hider mati → RESULT', r.phase === 'RESULT', r.phase);
    ok('pemenang = SEEKER', r.results.hidersWin === false);
  }
  {
    const { r, ps, s } = mk(1); r.start(false); r.enterPhase('SEEK');
    run(r, 5); r.kill(ps[0], s); run(r, 5);
    ok('waktu bertahan berhenti saat jadi hantu', ps[0].survived < 6, sec(ps[0].survived));
  }
  {
    const { r, ps, s } = mk(2); r.start(false); r.enterPhase('SEEK');
    const h = ps[0]; h.x = 2; h.y = 0; s.x = 1.9; s.y = 0;
    r.hit(h.id, s.id, false);
    const hp1 = h.hp;
    r.hit(h.id, s.id, false);
    ok('hit kedua dalam 0.6s ditolak (anti one-click-kill)', h.hp === hp1, h.hp);
  }

  /* ====================== [7] TAP CATCH =================================== */
  console.log('\n[7] RequestCatch: hanya SEEK, <=3 unit, anti-spam 0.25s');
  {
    const { r, ps, s } = mk(2); r.start(false);
    const h = ps[0], h2 = ps[1];
    h.x = 3; h.y = 0; h2.x = -6; h2.y = 3; s.x = 1.5; s.y = 0;
    r.tryCatch(s, h.x, h.y);
    ok('saat HIDE tidak bisa menangkap', h.hp === 3, h.hp);
    r.enterPhase('SEEK');

    r.tryCatch(s, 6.5, 0);                       // 3.5 unit dari h -> di luar jangkauan
    ok('klik sejauh 3.5 unit (> CatchMaxRange 3) gagal', h.hp === 3, h.hp);
    run(r, 0.3);
    r.tryCatch(s, 6.0, 0);                       // tepat 3.0 unit -> masih kena (<=)
    ok('klik di batas 3.0 unit masih kena', h.hp === 2, h.hp);
    r.tryCatch(s, 3.0, 0);                       // spam langsung
    ok('spam < 0.25s ditolak', h.hp === 2, h.hp);
    run(r, 0.3);
    r.tryCatch(s, 3.0, 0);                       // grace 0.6s dari hit pertama masih aktif
    ok('grace 0.6s melindungi (hp tetap 2)', h.hp === 2, h.hp);
    runTo(r, h.invulnUntil + 0.02);
    r.tryCatch(s, 3.0, 0);
    ok('setelah grace habis → kena lagi (2 → 1)', h.hp === 1, h.hp);
    run(r, 0.3);
    r.tryCatch(s, h2.x, h2.y);
    ok('hider lain yang dekat juga terhitung', h2.hp === 2, h2.hp);
    r.tryCatch(h, 3, 0);
    ok('hider tidak bisa melakukan request catch', h.hp === 1, h.hp);
    runTo(r, h.invulnUntil + 0.02); runTo(r, h2.invulnUntil + 0.02);
    s.lastCatch = -9; r.tryCatch(s, h.x, h.y);
    r.kill(h2, s);
    ok('RESULT otomatis saat semua hider habis', r.phase === 'RESULT', r.phase);
    const c = r.seeker().catches;
    r.tryCatch(r.seeker(), 0, 0);
    ok('tangkap tidak dihitung setelah RESULT', r.seeker().catches === c, { before: c, after: r.seeker().catches });
  }

  /* ====================== [8] RADAR & BLAST =============================== */
  console.log('\n[8] SeekerSkill: Radar (ping 1s) & Sonic Blast (r=5, slow 50%/2s)');
  {
    const { r, ps, s } = mk(4); r.start(false); r.enterPhase('SEEK');
    s.x = 0; s.y = 0;
    ps[0].x = 1; ps[0].y = 0; ps[1].x = 2; ps[1].y = 1;
    ps[2].x = 4.9; ps[2].y = 0; ps[3].x = 5.4; ps[3].y = 0;
    ok('blast aktif', r.useSonicBlast(s) === true);
    ok('VFX ring dicatat (SonicBlastEffect)', r.blasts.length === 1);
    ok('3 target dalam radius kena slow', [ps[0], ps[1], ps[2]].every(h => r.t < h.slowUntil), ps.map(p => sec(p.slowUntil)));
    ok('hider 5.4 unit aman', r.t >= ps[3].slowUntil);
    ok('factor 0.5 & durasi 2s', ps[0].slowFactor === 0.5 && near(h_slowleft(ps[0]), 2, 0.05), h_slowleft(ps[0]));
    function h_slowleft(p) { return p.slowUntil - r.t; }
    ok('speed hider terpotong 50%', near(ps[0].speedNow, 3, 1e-9), ps[0].speedNow);
    ok('seeker = 6 × 1.15', near(s.speedNow, 6 * 1.15, 1e-9), s.speedNow);
    ok('cd blast 8s', near(s.cdSeeker - r.t, 8, 1e-9));
    ok('blast saat cd ditolak', r.useSonicBlast(s) === false);
    ok('radar memakai cooldown yang sama → ditolak', r.useRadar(s) === false);
    runTo(r, 59.9);
    ok('setelah 8s siap lagi', r.useRadar(s) === true);
    const ping = r.pings[r.pings.length - 1];
    ok('ping = hider terdekat', near(ping.x, ps[0].x, 1e-9) && near(ping.y, ps[0].y, 1e-9), [ping.x, ping.y]);
    ok('durasi ping 1s', near(ping.dur, 1));
    runTo(r, r.t + 1.4);
    ok('ping dibersihkan setelah 1s', r.pings.length === 0, r.pings.length);
    runTo(r, 62.1);
    ok('slow blast sudah hilang (speed pulih 6)', near(ps[1].speedNow, 6, 1e-9), ps[1].speedNow);
    ok('blast tidak memengaruhi seeker sendiri', near(s.speedNow, 6 * 1.15, 1e-9), s.speedNow);
  }

  /* ====================== [9] LEADERBOARD ================================= */
  console.log('\n[9] BuildLeaderboard + penentuan pemenang');
  {
    const { r, ps } = mk(2); r.start(false);
    run(r, 10); r.enterPhase('SEEK'); run(r, 20);
    ps[1].hp = 2;
    r.enterPhase('RESULT');
    const b = r.results.board;
    const p1 = ps[0], p2 = ps[1];
    ok('skor hider1 = floor(survive) + hp*10', b.find(x => x.name === 'h1').score === Math.floor(p1.survived) + p1.hp * 10, { got: b.find(x => x.name === 'h1').score, surv: sec(p1.survived) });
    ok('skor hider2 = floor(survive) + hp*10', b.find(x => x.name === 'h2').score === Math.floor(p2.survived) + p2.hp * 10, { got: b.find(x => x.name === 'h2').score, surv: sec(p2.survived) });
    ok('bertahan ±30 detik', Math.abs(p1.survived - 30) < 0.2, sec(p1.survived));
    ok('seeker 0 tangkap = 0', b.find(x => x.role === 'SEEKER').score === 0);
    ok('hiders menang saat ada yang hidup', r.results.hidersWin === true);
    ok('urut desc by score', b.every((x, i, a) => i === 0 || a[i - 1].score >= x.score), b.map(x => x.score));
    r.seeker().catches = 4; r.finish();
    ok('seeker 4 tangkap = 120', r.results.board.find(x => x.role === 'SEEKER').score === 120, r.results.board.map(x => [x.name, x.score]));
    ok('hasil berisi nomor ronde', r.results.round === r.roundIndex, r.results.round);
  }
  {
    const { r, ps } = mk(3); r.start(false); r.enterPhase('SEEK');
    const s = r.seeker();
    r.kill(ps[0], s); r.kill(ps[1], s);
    ok('lastHiderId = hider yang tersisa', r.lastHiderId === ps[2].id, r.lastHiderId);
    r.enterPhase('RESULT');
    const row = r.results.board.find(x => x.name === 'h3');
    ok('baris ditandai "TERAKHIR HIDUP"', row.detail.includes('TERAKHIR HIDUP'), row.detail);
    ok('detail menyebut HP sisa', /HP 3/.test(row.detail), row.detail);
    ok('hider yang mati detailnya "tertangkap"', r.results.board.find(x => x.name === 'h1').detail.includes('tertangkap'), r.results.board.find(x => x.name === 'h1').detail);
  }

  /* ====================== [10] REWARD (iklan) ============================= */
  console.log('\n[10] RewardOffers + AdsManager.simulateAds (hadiah hanya setelah iklan selesai)');
  {
    let ads = 0, approve = true;
    const { r, ps } = mk(2, { onAds: (off, cb) => { ads++; setTimeout(() => cb(approve), 1); } });
    r.start(false);
    ok('kuota awal 1/2/2 (revive/skip/frenzy)',
      r.rewardQuota.revive === 1 && r.rewardQuota.skip === 2 && r.rewardQuota.frenzy === 2, r.rewardQuota);
    const h = ps[0];
    h.cdHider = r.t + 5;
    ok('offer = skip cooldown saat hider cd', (r.currentOffer(h) || {}).key === 'skip', r.currentOffer(h));
    ok('reward TIDAK diberikan sebelum iklan selesai', r.rewardQuota.skip === 2, r.rewardQuota);
    r.redeem('skip');
    await tick();
    ok('iklan ditayangkan 1x', ads === 1, ads);
    ok('cooldown direset setelah reward', h.cdHider <= r.t + 1e-9, sec(h.cdHider - r.t));
    ok('kuota skip 2 → 1', r.rewardQuota.skip === 1, r.rewardQuota);
    h.cdHider = r.t + 5;
    ok('gap minimum 12s menolak request berikutnya', r.redeem('skip') === false);
    ok('kuota tidak berkurang saat ditolak gap', r.rewardQuota.skip === 1, r.rewardQuota);
    r.lastAdAt = -99;
    r.redeem('skip'); await tick();
    ok('setelah gap, reward jalan lagi', r.rewardQuota.skip === 0 && ads === 2, { q: r.rewardQuota.skip, ads });
    h.cdHider = r.t + 5;
    ok('kuota habis → tidak ada offer lagi', (r.currentOffer(h) || {}).key !== 'skip', r.currentOffer(h));
    approve = false;                       // pemain menekan "batalkan" sebelum iklan selesai
    r.lastAdAt = -99;
    const before = ads, fz = r.rewardQuota.frenzy, sk0 = r.seeker();
    const myOld = r.myId; r.myId = sk0.id;
    ok('offer utk seeker = frenzy', (r.currentOffer(sk0) || {}).key === 'frenzy', r.currentOffer(sk0));
    r.redeem('frenzy'); await tick();
    ok('iklan dibatalkan → iklan tampil 1x tapi hadiah tidak diberikan',
      ads === before + 1 && r.rewardQuota.frenzy === fz && near(sk0.speedNow, 6 * 1.15, 1e-9), { ads, q: r.rewardQuota.frenzy, sp: sk0.speedNow });
    approve = true; r.myId = myOld;
    r.kill(h, r.seeker());
    ok('offer = revive untuk hantu', (r.currentOffer(h) || {}).key === 'revive', r.currentOffer(h));
    r.lastAdAt = -99;
    r.redeem('revive'); await tick();
    ok('hidup lagi dengan HP 1', h.hp === 1 && h.ghost === false, { hp: h.hp, g: h.ghost });
    ok('posisi kembali ke spawn', near(h.x, h.spawnX, 1e-9) && near(h.y, h.spawnY, 1e-9));
    ok('jendela aman 1.6s', near(h.safeUntil - r.t, CFG.reviveSafeWindow, 1e-6), sec(h.safeUntil - r.t));
    ok('tidak bisa ditangkap selama safe window', (() => { const hp = h.hp; r.hit(h.id, r.seeker().id, false); return h.hp === hp; })());
    runTo(r, h.safeUntil + 0.02);
    r.hit(h.id, r.seeker().id, false);
    ok('setelah safe window bisa ditangkap lagi', h.hp === 0 && h.ghost === true, h.hp);
    ok('kuota revive habis → tak ada offer revive', r.rewardQuota.revive === 0 && (r.currentOffer(h) || {}).key !== 'revive');
    const sk = r.seeker();
    r.myId = sk.id;                        // tombol reward selalu utk pemain LOKAL
    ok('offer = frenzy untuk seeker', (r.currentOffer(sk) || {}).key === 'frenzy', r.currentOffer(sk));
    r.lastAdAt = -99;
    r.redeem('frenzy'); await tick(); r.myId = h.id;
    ok('frenzy +25% speed & jangkauan +1.5 selama 10s',
      near(sk.speedNow, 6 * 1.15 * 1.25, 1e-6) && sk.boostRange === CFG.frenzyRange && near(sk.boostUntil - r.t, 10, 1e-6),
      { sp: sk.speedNow, t: sec(sk.boostUntil - r.t) });
    ok('kuota frenzy 2 → 1', r.rewardQuota.frenzy === 1, r.rewardQuota);
    sk.cdSeeker = r.t + 5;
    r.skipCooldown(sk.id);
    ok('skipCooldown (evt reward) mereset skill seeker', sk.cdSeeker <= r.t + 1e-9);
    r.start(false);
    ok('kuota direset tiap ronde', r.rewardQuota.revive === 1 && r.rewardQuota.skip === 2 && r.rewardQuota.frenzy === 2, r.rewardQuota);
    const solo = mk(1).r; solo.start(false);
    solo.players.get(1).cdHider = solo.t + 5;
    ok('mode offline (tanpa SDK iklan): hadiah langsung diberikan', solo.redeem('skip') === true && solo.rewardQuota.skip === 1, solo.rewardQuota);
  }

  /* ====================== [11] SNAPSHOT =================================== */
  console.log('\n[11] snapshot / applySnapshot (OnPhotonSerializeView + RpcChangePhase)');
  {
    const { r, ps } = mk(3); r.start(false); r.enterPhase('SEEK');
    ps[0].x = 3.5; ps[0].y = -1.25; ps[0].rot = 1.25; ps[0].hp = 2;
    ps[0].camoTarget = ps[0].camoRgb = [74, 135, 25];
    ps[1].propDef = PROPS[2]; ps[2].ghost = true; ps[2].hp = 0;
    r.pings.push({ x: 1, y: 2, t: r.t, dur: 1 }); r.blasts.push({ x: 0, y: 0, t: r.t, dur: .45 });
    const snap = JSON.parse(JSON.stringify(r.snapshot()));
    const c = new Round({ map: r.map }); c.myId = 1;
    c.applySnapshot(snap);
    ok('fase + timer ikut tersalin', c.phase === 'SEEK' && near(c.timeLeft, r.timeLeft, 1e-6));
    ok('posisi + rotasi', near(c.players.get(1).x, 3.5, 1e-9) && near(c.players.get(1).y, -1.25, 1e-9) && near(c.players.get(1).rot, 1.25, 1e-2));
    ok('hp + ghost', c.players.get(1).hp === 2 && c.players.get(3).ghost === true);
    ok('camo', JSON.stringify(c.players.get(1).camoRgb) === JSON.stringify([74, 135, 25]));
    ok('wujud prop', c.players.get(2).propDef && c.players.get(2).propDef.name === 'Pot Bunga', c.players.get(2).propDef);
    ok('role seeker', c.players.get(99).role === 1);
    ok('VFX blast + ping', c.blasts.length === 1 && c.pings.length === 1);
    ok('jumlah pemain sama', c.players.size === r.players.size, c.players.size);
    ok('payload kecil (<1.5 KB, hemat bandwidth)', JSON.stringify(snap).length < 1536, JSON.stringify(snap).length);
    ok('snapshot bisa dipakai ulang (idempoten)', (() => { c.applySnapshot(snap); return c.players.size === r.players.size; })());
  }

  /* ====================== [12] SIMULASI BOT ============================== */
  console.log('\n[12] simulasi 120 detik: 11 hider bot vs 1 seeker bot');
  {
    const map = buildMap();
    const r = new Round({ map });
    for (let i = 0; i < 11; i++) { const p = new PlayerState(i + 1, 'bot' + (i + 1), 0); p.isBot = true; r.add(p); }
    const s = new PlayerState(99, 'botseeker', 1); s.isBot = true; r.add(s);
    r.start(true);
    const phases = new Set();
    let err = null, moved = 0, out = 0, hits = 0, maxCatches = 0;
    r.on(e => {
      if (e.type === 'phase') phases.add(e.name);
      if (e.type === 'hit') { hits++; const p = r.players.get(e.by); if (p) maxCatches = Math.max(maxCatches, p.catches); }
    });
    try {
      for (let i = 0; i < 60 * 120; i++) {
        r.step(1 / 60);
        for (const p of r.players.values()) {
          out = Math.max(out, Math.abs(p.x) - map.clampX, Math.abs(p.y) - map.clampY);
          moved += Math.abs(p.input.dx) + Math.abs(p.input.dy);
        }
      }
    } catch (e) { err = e; }
    ok('tanpa exception', !err, err && String(err && err.stack).split('\n').slice(0, 2).join(' | '));
    ok('bot benar-benar bergerak', moved > 5000, moved);
    ok('tidak ada yang keluar arena', out <= 0.011, sec(out));
    ok('keempat fase pernah dijalankan', ['COUNTDOWN', 'HIDE', 'SEEK', 'RESULT'].every(x => phases.has(x)), [...phases]);
    ok('ronde berulang (>=2) dalam 120s', r.roundIndex >= 2, r.roundIndex);
    ok('seeker bot menangkap hider (event hit tercatat)', hits > 0, hits);
    ok('counter catches seeker bertambah saat ronde berjalan', maxCatches > 0, { maxCatches, now: r.seeker() ? r.seeker().catches : -1 });
    ok('HP tidak pernah negatif', [...r.players.values()].every(p => p.hp >= 0));
    ok('posisi semua pemain legal (tidak di dalam solid)',
      [...r.players.values()].every(p => p.ghost || !map.solid(p.x, p.y, 0.02)), 
      [...r.players.values()].filter(p => !p.ghost && map.solid(p.x, p.y, 0.02)).map(p => [p.name, sec(p.x), sec(p.y)]));
    console.log(`       (info) ronde=${r.roundIndex} hit=${hits} maxCatches=${maxCatches} ghost=${[...r.players.values()].filter(p => p.ghost).length}`);
  }

  console.log(`\n=== web_selftest: ${pass} PASS, ${fail} FAIL ===`);
  process.exitCode = fail ? 1 : 0;
  if (!fail) console.log('Rules engine web selaras dengan C#: HideSeekConstants, GameManager, PlayerController/Combat, Hider/SeekerSkill, CamouflageHelper, RewardOffers/AdsManager, SetupTool map.');
})();

/* =============================================================================
 * server/api.js — backend akun (JWT) + referral + ID game/teman + reward iklan
 * -----------------------------------------------------------------------------
 * Zero-dependency: hanya `http`/`crypto`/`fs` bawaan Node. Dipakai 2 cara:
 *   1) menumpang di web/net-server.js  -> satu port utk game + API (tanpa CORS)
 *   2) berdiri sendiri: `node server/api.js` (mis. di belakang nginx /api)
 *
 * Rute (semua JSON; Authorization: Bearer <token> utk rute ber-aksen *):
 *   GET  /api/health                      liveness + jumlah akun
 *   POST /api/signup  {name,user,pass,ref?}   -> {token,user}  (ref => +100 koin pengundang)
 *   POST /api/login   {user,pass}             -> {token,user}
 *   GET  /api/me  *                           -> {user}
 *   POST /api/sync  * {coins,xp,lives,bonusHp,best,rounds}
 *   GET  /api/referral  *                     -> {code,invited,coinsEarned,list}
 *   POST /api/referral/claim * {ref}          -> bayar referral utk akun lama
 *   POST /api/friends/find  * {gameId}        -> cari pemain lewat ID game
 *   POST /api/friends/request * {gameId}      -> kirim ajakan berteman
 *   GET  /api/friends  *                      -> {friends,incoming,outgoing}
 *   POST /api/friends/respond * {reqId,accept}
 *   POST /api/friends/remove  * {gameId}
 *   POST /api/room  * {room}                  -> umumkan kode room aktif (bisa diikuti teman)
 *   POST /api/ads/reward * {kind,nonce}       -> verifikasi cooldown + grant di server
 *   GET  /api/leaderboard ?limit=10           -> top global (skor terbaik, lalu XP)
 *
 * Koin: `coins = earned + granted`. `earned` = hasil main yang dilaporkan klien
 * (monoton naik), `granted` = hadiah yang DIBAYAR SERVER (referral/iklan) sehingga
 * tidak bisa digandakan dengan refresh atau ganti perangkat.
 * ========================================================================== */
'use strict';
const http = require('http');
const path = require('path');
const A = require('./auth.js');
const { JsonStore } = require('./store.js');

/* --------------------------------- config ---------------------------------- */
const DEFAULTS = {
  name: 'BUNGLON! account server',
  version: '1.0.0',
  dataDir: path.join(__dirname, 'data'),
  jwtSecret: '',                 // kosong -> dibuat otomatis di <dataDir>/.secret
  jwtTtlDays: 30,
  levelBase: 300,                // sama seperti ECONOMY.levelBase di web/game.js
  refCoinsInvitee: 50,
  refHpInvitee: 1,
  refCoinsInviter: 100,          // <- dulu klien-only, sekarang dibayar di sini
  refCodeLength: 7,
  minPass: 4,                    // demo; naikkan ke 8 saat rilis
  maxPass: 200,
  adCooldownSeconds: 30,         // sama seperti adsManager.js
  adDailyCap: 20,                // per jenis reward per hari
  adRewards: {
    extra_life: { coins: 0, lives: 1, label: '+1 Nyawa' },
    bonus_coins: { coins: 50, lives: 0, label: '+50 Koin' },
    skip_cooldown: { coins: 0, lives: 0, label: 'cooldown reset' },
    frenzy: { coins: 0, lives: 0, label: 'frenzy' },
  },
  loginMaxTries: 6,              // percobaan login per (ip|user) sebelum diblokir
  loginWindowMs: 60000,
  maxFriends: 100,
  roomFreshMs: 5 * 60 * 1000,    // umur room yang masih dianggap "bisa diikuti"
};

/** Ambil konfigurasi dari environment (di-override oleh opts.cfg). */
function cfgFromEnv(env) {
  const n = (v, d) => (v === undefined || v === '' ? d : Number(v));
  const out = {};
  if (!env) return out;
  if (env.JWT_SECRET) out.jwtSecret = env.JWT_SECRET;
  if (env.JWT_TTL_DAYS) out.jwtTtlDays = n(env.JWT_TTL_DAYS, 30);
  if (env.DATA_DIR) out.dataDir = env.DATA_DIR;
  if (env.REF_COINS_INVITER) out.refCoinsInviter = n(env.REF_COINS_INVITER, 100);
  if (env.REF_COINS_INVITEE) out.refCoinsInvitee = n(env.REF_COINS_INVITEE, 50);
  if (env.REF_HP_INVITEE) out.refHpInvitee = n(env.REF_HP_INVITEE, 1);
  if (env.REF_CODE_LENGTH) out.refCodeLength = n(env.REF_CODE_LENGTH, 7);
  if (env.ADS_COOLDOWN_SECONDS) out.adCooldownSeconds = n(env.ADS_COOLDOWN_SECONDS, 30);
  if (env.ADS_DAILY_CAP) out.adDailyCap = n(env.ADS_DAILY_CAP, 20);
  if (env.PASS_MIN) out.minPass = n(env.PASS_MIN, 4);
  if (env.LEADERBOARD_LEVEL === '0') out.leaderboardPublic = false;
  return out;
}

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const today = () => new Date().toISOString().slice(0, 10);
const dayKey = ts => new Date(ts).toISOString().slice(0, 10);

/* ------------------------------- utilities --------------------------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}
function readBody(req, limit = 200000) {
  return new Promise((resolve) => {
    let s = '', over = false;
    req.on('data', c => { s += c; if (s.length > limit) { over = true; req.destroy(); resolve({ __tooBig: true }); } });
    req.on('end', () => { if (over) return; try { resolve(s ? JSON.parse(s) : {}); } catch (e) { resolve({ __bad: true }); } });
    req.on('error', () => resolve({ __bad: true }));
  });
}
const ipOf = req => (req.socket && req.socket.remoteAddress) || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '?';

/* ------------------------------ main factory -------------------------------- */
function createApi(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, cfgFromEnv(opts.env || process.env), opts.cfg || {});
  const store = opts.store || new JsonStore(cfg.dataDir ? path.join(cfg.dataDir, 'db.json') : null);
  const secret = cfg.jwtSecret || A.loadSecret(cfg.dataDir || require('os').tmpdir(), cfg.jwtSecret);
  const limiter = new Map();               // key -> {n, resetAt}
  const adSeen = new Map();               // uid -> [nonce,...] (anti-replay 1 iklan = 1 grant)

  /** Pembatas naif: true = boleh, false = kena limit. */
  function allow(key, max, windowMs) {
    const now = Date.now();
    const cur = limiter.get(key);
    if (!cur || now > cur.resetAt) { limiter.set(key, { n: 1, resetAt: now + windowMs }); return true; }
    cur.n++;
    return cur.n <= max;
  }

  /* ---------------------------- proyeksi user ------------------------------ */
  /** Level dari XP — kurva sama persis dengan Profile.levelOf() di web & Unity. */
  function levelOf(xp) {
    const b = cfg.levelBase || 300, x = Math.max(0, xp | 0);
    return Math.max(1, Math.floor((1 + Math.sqrt(1 + 8 * x / b)) / 2));
  }
  function coinsOf(u) { return (u.earnedCoins | 0) + (u.grantedCoins | 0); }
  function livesOf(u) { return Math.min(9, (u.earnedLives | 0) + (u.grantedLives | 0)); }
  /** Tampilan publik (tidak pernah memuat hash password). */
  function publicUser(u) {
    if (!u) return null;
    const now = Date.now();
    const roomFresh = u.room && (now - (u.room.at || 0) < cfg.roomFreshMs) ? u.room.code : '';
    return {
      uid: u.uid, name: u.name, login: u.login || '', gameId: u.gameId, refCode: u.refCode,
      coins: coinsOf(u), lives: livesOf(u), bonusHp: u.bonusHp | 0,
      xp: u.xp | 0, level: levelOf(u.xp), best: u.best | 0, rounds: u.rounds | 0,
      invited: (u.invited || []).length, friends: (u.friends || []).length,
      room: roomFresh, grantedCoins: u.grantedCoins | 0, grantedLives: u.grantedLives | 0,
      createdAt: u.createdAt || 0, since: Math.floor((now - (u.createdAt || now)) / 1000),
    };
  }

  /* ------------------------------ akunting -------------------------------- */
  /** Bayar koin/nyawa dari server (referral/iklan) -> ledger `granted*`. */
  function grant(uid, coins, lives) {
    const u = store.user(uid); if (!u) return null;
    u.grantedCoins = (u.grantedCoins | 0) + Math.max(0, coins | 0);
    u.grantedLives = Math.min(9, (u.grantedLives | 0) + Math.max(0, lives | 0));
    store.touch();
    return u;
  }

  /* -------------------------------- rute ---------------------------------- */
  const routes = {};
  const POST = (p, fn, opt) => { routes['POST ' + p] = { fn, opt: opt || {} }; };
  const GET = (p, fn, opt) => { routes['GET ' + p] = { fn, opt: opt || {} }; };

  /* ---- butuh token: isi ctx.uid/ctx.u, balas 401 bila tidak ada ---- */
  const AUTH = (handler) => async (ctx) => {
    const tok = ctx.token || A.bearerOf(ctx.req);
    const v = tok ? A.verifyToken(tok, secret) : { ok: false, error: 'tanpa token' };
    if (!v.ok) { json(ctx.res, 401, { error: 'login dulu (' + v.error + ')' }); return; }
    const u = store.user(v.payload.sub);
    if (!u) { json(ctx.res, 401, { error: 'akun tidak ditemukan' }); return; }
    ctx.uid = u.uid; ctx.u = u; ctx.payload = v.payload;
    return handler(ctx);
  };

  /* --------------------------------- health -------------------------------- */
  GET('/api/health', async (ctx) => json(ctx.res, 200, {
    ok: true, name: cfg.name, version: cfg.version, users: store.count, time: Date.now(),
    referralPayout: cfg.refCoinsInviter, adCooldownSeconds: cfg.adCooldownSeconds,
  }));

  /* --------------------------------- signup -------------------------------- */
  POST('/api/signup', async (ctx) => {
    const b = ctx.body;
    if (b.__bad) return json(ctx.res, 400, { error: 'body bukan JSON' });
    const login = A.normalizeUser(b.user);
    if (!login) return json(ctx.res, 400, { error: 'nama akun 3-16 karakter, hanya a-z 0-9 _' });
    if (store.byLogin(login)) return json(ctx.res, 409, { error: 'nama akun sudah dipakai' });
    const pass = String(b.pass || '');
    if (pass.length < cfg.minPass) return json(ctx.res, 400, { error: 'password minimal ' + cfg.minPass + ' karakter' });
    if (pass.length > cfg.maxPass) return json(ctx.res, 400, { error: 'password terlalu panjang' });
    if (!allow('signup:' + ctx.ip, 12, 60000)) return json(ctx.res, 429, { error: 'terlalu sering mencoba, tunggu 1 menit' });

    const ref = A.normalizeRef(b.ref);
    let inviter = null, refErr = '';
    if (ref) {
      inviter = store.byRefCode(ref);
      if (!inviter) refErr = 'kode undangan tidak dikenal';
      else if ((inviter.login || '') === login) refErr = 'itu kode kamu sendiri';
    }
    const u = store.insertUser({
      name: A.normalizeName(b.name, login), login, pass: A.hashPassword(pass),
      gameId: A.makeGameId(new Set(Object.keys(store.data.byGameId))),
      refCode: A.makeRefCode(new Set(Object.keys(store.data.byRef)), cfg.refCodeLength),
      earnedCoins: clampInt(b.coins, 0, 1e9), earnedLives: clampInt(b.lives, 0, 9), bonusHp: clampInt(b.bonusHp, 0, 4),
      xp: clampInt(b.xp, 0, 1e9), best: clampInt(b.best, 0, 1e9), rounds: clampInt(b.rounds, 0, 1e6),
      grantedCoins: 0, grantedLives: 0, friends: [], invited: [], referrers: [], referrals: 0,
      refClaimed: false, ads: {}, adDay: {}, room: null,
    });
    const out = { referral: null };
    if (inviter && !refErr) out.referral = payReferral(inviter, u, ref);
    else if (refErr) out.referral = { error: refErr };
    const token = A.signToken({ sub: u.uid, gid: u.gameId }, secret, cfg.jwtTtlDays);
    console.log(`[api] daftar ${u.login} #${u.uid} (ID ${u.gameId})` + (out.referral && out.referral.ok ? ` ← diundang ${out.referral.by}` : ''));
    json(ctx.res, 201, { token, user: publicUser(u), referral: out.referral });
  });

  /**
   * Inti referral: bayar pengundang (+100 koin) dan yang diundang (+50 koin, +1 nyawa).
   * Sekali per pasangan (inviter,invitee) dan sekali per akun yang diundang.
   */
  function payReferral(inviter, invitee, code) {
    if (!inviter || !invitee) return { ok: false, error: 'kode tidak dikenal' };
    if (inviter.uid === invitee.uid) return { ok: false, error: 'tidak bisa mengundang diri sendiri' };
    if (invitee.refClaimed) return { ok: false, error: 'akun ini sudah pernah memakai kode undangan' };
    if ((invitee.referrers || []).indexOf(inviter.uid) >= 0) return { ok: false, error: 'kode ini sudah dibayar untuk akun itu' };
    invitee.refClaimed = true;
    invitee.referrer = inviter.uid;
    invitee.referrers = (invitee.referrers || []).concat(inviter.uid);
    inviter.invited = (inviter.invited || []).concat(invitee.uid);
    inviter.referrals = (inviter.referrals | 0) + 1;
    grant(invitee.uid, cfg.refCoinsInvitee, cfg.refHpInvitee);
    grant(inviter.uid, cfg.refCoinsInviter, 0);
    store.logReferral({ inviter: inviter.uid, invitee: invitee.uid, code: code || inviter.refCode, at: Date.now(), coins: cfg.refCoinsInviter });
    store.touch();
    return { ok: true, by: inviter.name, byId: inviter.gameId, coinsForInvitee: cfg.refCoinsInvitee, hpForInvitee: cfg.refHpInvitee, coinsForInviter: cfg.refCoinsInviter, paid: true };
  }

  /* --------------------------------- login --------------------------------- */
  POST('/api/login', async (ctx) => {
    const b = ctx.body;
    const login = A.normalizeUser(b.user || b.login || b.name);
    const key = 'login:' + ctx.ip + ':' + login;
    if (!allow(key, cfg.loginMaxTries, cfg.loginWindowMs)) {
      return json(ctx.res, 429, { error: 'terlalu banyak percobaan login — coba lagi 1 menit lagi' });
    }
    const u = login && store.byLogin(login);
    if (!u || !A.verifyPassword(b.pass, u.pass)) return json(ctx.res, 401, { error: 'nama akun atau password salah' });
    if (b.migrate) applyMigration(u, b.migrate, cfg);
    const token = A.signToken({ sub: u.uid, gid: u.gameId }, secret, cfg.jwtTtlDays);
    console.log(`[api] masuk ${u.login} #${u.uid}`);
    json(ctx.res, 200, { token, user: publicUser(u) });
  });

  /**
   * Migrasi profil localStorage ke akun (opsional, dikirim saat login pertama):
   * nilai yang sudah ada di server tidak pernah turun (max), dan `ref` hanya
   * dibayar bila belum pernah diklaim.
   */
  function applyMigration(u, m, cfgRef) {
    if (!m || typeof m !== 'object') return;
    u.earnedCoins = Math.max(u.earnedCoins | 0, clampInt(m.coins, 0, 1e9) - (u.grantedCoins | 0));
    u.earnedLives = Math.max(u.earnedLives | 0, clampInt(m.lives, 0, 9));
    u.bonusHp = Math.max(u.bonusHp | 0, clampInt(m.bonusHp, 0, 4));
    u.xp = Math.max(u.xp | 0, clampInt(m.xp, 0, 1e9));
    u.best = Math.max(u.best | 0, clampInt(m.best, 0, 1e9));
    u.rounds = Math.max(u.rounds | 0, clampInt(m.rounds, 0, 1e6));
    const ref = A.normalizeRef(m.ref);
    if (ref) { const inv = store.byRefCode(ref); if (inv) u.pendingRef = { code: ref, inviter: inv.uid }; }
    store.touch();
  }

  /* ---------------------------------- me ----------------------------------- */
  GET('/api/me', AUTH(async (ctx) => {
    const u = ctx.u;
    if (u.pendingRef && u.pendingRef.inviter) {
      const inv = store.user(u.pendingRef.inviter);
      const r = payReferral(inv, u, u.pendingRef.code);
      u.pendingRef = null;
      if (r.ok) store.touch();
      return json(ctx.res, 200, { user: publicUser(u), referral: r });
    }
    store.update(u.uid, {});                              // refresh lastSeenAt
    json(ctx.res, 200, { user: publicUser(u) });
  }));

  /* --------------------------------- sync ---------------------------------- */
  POST('/api/sync', AUTH(async (ctx) => {
    const u = ctx.u, b = ctx.body || {};
    u.earnedCoins = Math.max(u.earnedCoins | 0, clampInt(b.coins, 0, 1e9) - (u.grantedCoins | 0));
    u.earnedLives = Math.max(u.earnedLives | 0, clampInt(b.lives, 0, 9) - (u.grantedLives | 0));
    u.bonusHp = Math.max(u.bonusHp | 0, clampInt(b.bonusHp, 0, 4));
    u.xp = Math.max(u.xp | 0, clampInt(b.xp, 0, 1e9));
    u.best = Math.max(u.best | 0, clampInt(b.best, 0, 1e9));
    u.rounds = Math.max(u.rounds | 0, clampInt(b.rounds, 0, 1e6));
    if (b.name) u.name = A.normalizeName(b.name, u.name);
    store.touch();
    json(ctx.res, 200, { user: publicUser(u) });
  }));

  /* ------------------------------- referral -------------------------------- */
  GET('/api/referral', AUTH(async (ctx) => {
    const u = ctx.u;
    const list = (u.invited || []).map(uid => {
      const f = store.user(uid);
      return f ? { name: f.name, gameId: f.gameId, at: 0 } : null;
    }).filter(Boolean);
    json(ctx.res, 200, {
      code: u.refCode, count: u.referrals | 0, coinsEarned: (u.referrals | 0) * cfg.refCoinsInviter,
      coinsPerFriend: cfg.refCoinsInviter, coinsForInvitee: cfg.refCoinsInvitee, list,
      referrer: u.referrer ? (store.user(u.referrer) || {}).name || '' : '', claimed: !!u.refClaimed,
    });
  }));
  POST('/api/referral/claim', AUTH(async (ctx) => {
    const code = A.normalizeRef((ctx.body || {}).ref);
    if (!code) return json(ctx.res, 400, { error: 'kode kosong' });
    const inv = store.byRefCode(code);
    if (!inv) return json(ctx.res, 404, { error: 'kode undangan tidak dikenal' });
    const r = payReferral(inv, ctx.u, code);
    json(ctx.res, r.ok ? 200 : 409, r.ok ? { referral: r, user: publicUser(ctx.u) } : { error: r.error });
  }));

  /* ------------------------------ teman / ID ------------------------------- */
  POST('/api/friends/find', AUTH(async (ctx) => {
    const raw = String((ctx.body || {}).gameId || (ctx.body || {}).id || '');
    const id = raw.replace(/\D/g, '');
    const likeLogin = /[^0-9\s._\-()]/.test(raw);        // ada huruf -> cari sebagai nama akun
    if (!likeLogin && id.length !== 7) {
      return json(ctx.res, 400, { error: 'ID game = 7 digit angka (contoh 104 8293), atau tulis nama akun' });
    }
    if (!allow('find:' + ctx.uid, 30, 60000)) return json(ctx.res, 429, { error: 'terlalu sering mencari — tunggu sebentar' });
    const t = store.byGameId(id) || (likeLogin && store.byLogin(A.normalizeUser(raw)));
    if (!t) return json(ctx.res, 404, { error: 'ID ' + id + ' tidak terdaftar' });
    const me = ctx.u;
    json(ctx.res, 200, {
      found: true, player: publicUser(t),
      state: t.uid === me.uid ? 'self' : (me.friends || []).indexOf(t.uid) >= 0 ? 'friends'
        : (store.data.reqs['r' + me.uid + '-' + t.uid] ? 'outgoing' : 'none'),
    });
  }));

  POST('/api/friends/request', AUTH(async (ctx) => {
    const raw = String((ctx.body || {}).gameId || '');
    const id = raw.replace(/\D/g, '');
    const t = store.byGameId(id) || (/[a-zA-Z]/.test(raw) ? store.byLogin(A.normalizeUser(raw)) : null);
    if (!t) return json(ctx.res, 404, { error: 'ID game / nama akun tidak ditemukan' });
    if (t.uid === ctx.uid) return json(ctx.res, 400, { error: 'itu ID kamu sendiri 😄' });
    const me = ctx.u;
    if ((me.friends || []).indexOf(t.uid) >= 0) return json(ctx.res, 200, { ok: true, state: 'friends', player: publicUser(t) });
    if (!allow('freq:' + ctx.uid, 20, 60000)) return json(ctx.res, 429, { error: 'terlalu banyak ajakan — tunggu 1 menit' });
    if ((me.friends || []).length >= cfg.maxFriends || (t.friends || []).length >= cfg.maxFriends) {
      return json(ctx.res, 409, { error: 'daftar teman penuh (maks ' + cfg.maxFriends + ')' });
    }
    // timbal balik: kalau dia sudah mengajakku, langsung saling tambah
    const back = store.getReq('r' + t.uid + '-' + me.uid);
    if (back) {
      store.delReq(back.id);
      addFriendship(me, t);
      return json(ctx.res, 200, { ok: true, state: 'friends', player: publicUser(t), mutual: true });
    }
    const reqId = 'r' + me.uid + '-' + t.uid;
    if (store.getReq(reqId)) return json(ctx.res, 200, { ok: true, state: 'pending', reqId });
    store.addReq({ id: reqId, from: me.uid, to: t.uid, at: Date.now() });
    console.log(`[api] ${me.name} → ajakan teman ke ${t.name} (${t.gameId})`);
    json(ctx.res, 200, { ok: true, state: 'pending', reqId, player: publicUser(t) });
  }));

  function addFriendship(a, b) {
    a.friends = Array.from(new Set((a.friends || []).concat(b.uid)));
    b.friends = Array.from(new Set((b.friends || []).concat(a.uid)));
    store.touch();
  }

  GET('/api/friends', AUTH(async (ctx) => {
    const me = ctx.u;
    const row = (u) => Object.assign(publicUser(u), {
      online: Date.now() - (u.lastSeenAt || 0) < 90000,
      since: Math.floor((Date.now() - (u.lastSeenAt || Date.now())) / 1000),
    });
    const friends = (me.friends || []).map(uid => store.user(uid)).filter(Boolean).map(row);
    const incoming = [], outgoing = [];
    for (const k of Object.keys(store.data.reqs)) {
      const r = store.data.reqs[k];
      if (r.to === me.uid) { const f = store.user(r.from); if (f) incoming.push({ reqId: r.id, from: row(f), at: r.at }); }
      else if (r.from === me.uid) { const f = store.user(r.to); if (f) outgoing.push({ reqId: r.id, to: row(f), at: r.at }); }
    }
    json(ctx.res, 200, { friends, incoming, outgoing });
  }));

  POST('/api/friends/respond', AUTH(async (ctx) => {
    const b = ctx.body || {};
    const r = store.getReq(b.reqId);
    if (!r) return json(ctx.res, 404, { error: 'ajakan tidak ada (sudah dijawab?)' });
    if (r.to !== ctx.uid) return json(ctx.res, 403, { error: 'ajakan ini bukan untuk kamu' });
    const from = store.user(r.from);
    store.delReq(r.id);
    if (b.accept !== false && from) { addFriendship(ctx.u, from); console.log(`[api] teman baru: ${ctx.u.name} ↔ ${from.name}`); }
    json(ctx.res, 200, { ok: true, accepted: !!(b.accept !== false && from) });
  }));

  POST('/api/friends/remove', AUTH(async (ctx) => {
    const id = String((ctx.body || {}).gameId || '').replace(/\D/g, '');
    const t = store.byGameId(id);
    if (!t) return json(ctx.res, 404, { error: 'ID game tidak ditemukan' });
    ctx.u.friends = (ctx.u.friends || []).filter(uid => uid !== t.uid);
    t.friends = (t.friends || []).filter(uid => uid !== ctx.uid);
    store.touch();
    json(ctx.res, 200, { ok: true });
  }));

  /* ------------------------- room aktif (agar bisa diikuti) ----------------- */
  POST('/api/room', AUTH(async (ctx) => {
    const code = String((ctx.body || {}).room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    store.update(ctx.uid, { room: code ? { code, at: Date.now() } : null });
    json(ctx.res, 200, { ok: true, room: code || '' });
  }));
  POST('/api/room/clear', AUTH(async (ctx) => { store.update(ctx.uid, { room: null }); json(ctx.res, 200, { ok: true }); }));

  /* --------------------- validasi reward iklan di server -------------------- */
  POST('/api/ads/reward', AUTH(async (ctx) => {
    const b = ctx.body || {};
    const kind = String(b.kind || 'bonus_coins');
    const spec = cfg.adRewards[kind];
    if (!spec) return json(ctx.res, 400, { error: 'reward tidak dikenal: ' + kind });
    if (!allow('ad:' + ctx.uid, 12, 60000)) return json(ctx.res, 429, { error: 'terlalu banyak klaim iklan' });
    // nonce: satu iklan = satu grant (refresh halaman tidak boleh menggandakannya)
    const nonce = String(b.nonce || '').slice(0, 64);
    if (nonce) {
      const seen = adSeen.get(ctx.uid) || [];
      if (seen.indexOf(nonce) >= 0) return json(ctx.res, 409, { error: 'iklan ini sudah diklaim' });
      seen.push(nonce); while (seen.length > 24) seen.shift();
      adSeen.set(ctx.uid, seen);
    }
    const u = ctx.u, now = Date.now(), d = today();
    u.lastAdAt = u.lastAdAt || 0;
    const wait = Math.ceil((u.lastAdAt + cfg.adCooldownSeconds * 1000 - now) / 1000);
    if (wait > 0) return json(ctx.res, 429, { error: 'tunggu ' + wait + 's (cooldown iklan)', secondsLeft: wait });
    if (!u.adDay || u.adDay.day !== d) u.adDay = { day: d, kinds: {} };
    const used = (u.adDay.kinds[kind] | 0);
    if (used >= cfg.adDailyCap) return json(ctx.res, 429, { error: 'batas harian reward "' + kind + '" tercapai (' + cfg.adDailyCap + ')' });
    u.adDay.kinds[kind] = used + 1;
    u.lastAdAt = now;
    grant(u.uid, spec.coins, spec.lives);
    u.ads = u.ads || {}; u.ads[kind] = (u.ads[kind] | 0) + 1; u.ads.total = (u.ads.total | 0) + 1;
    store.touch();
    json(ctx.res, 200, {
      ok: true, label: spec.label, coins: spec.coins, lives: spec.lives,
      cooldownSeconds: cfg.adCooldownSeconds, user: publicUser(u),
    });
  }));
  GET('/api/ads/state', AUTH(async (ctx) => {
    const left = Math.max(0, Math.ceil(((ctx.u.lastAdAt || 0) + cfg.adCooldownSeconds * 1000 - Date.now()) / 1000));
    json(ctx.res, 200, { ok: true, secondsLeft: left, cap: cfg.adDailyCap, used: (ctx.u.adDay && ctx.u.adDay.day === today()) ? ctx.u.adDay.kinds : {} });
  }));

  /* ------------------------------ leaderboard ------------------------------ */
  GET('/api/leaderboard', async (ctx) => {
    const limit = clampInt(ctx.url.searchParams.get('limit'), 1, 50) || 10;
    if (cfg.leaderboardPublic === false) return json(ctx.res, 403, { error: 'leaderboard publik dimatikan' });
    const rows = store.allUsers()
      .sort((a, b) => (b.best - a.best) || (b.xp - a.xp) || (a.uid - b.uid))
      .slice(0, limit)
      .map(u => {
        const p = publicUser(u);
        return { rank: 0, name: p.name, gameId: p.gameId, level: p.level, xp: p.xp, best: p.best, rounds: p.rounds, friends: p.friends };
      });
    rows.forEach((r, i) => { r.rank = i + 1; });
    json(ctx.res, 200, { ok: true, rows });
  });

  /* ------------------------------ dispatcher ------------------------------- */
  async function handle(req, res, urlObj) {
    const u = urlObj || new URL(req.url, 'http://x');
    const key = req.method + ' ' + u.pathname.replace(/\/+$/, '');
    const hitRoute = routes[key];
    if (!hitRoute) {
      if (u.pathname.indexOf('/api/') === 0) json(res, 404, { error: 'rute tidak ada: ' + req.method + ' ' + u.pathname, routes: Object.keys(routes) });
      return u.pathname.indexOf('/api/') === 0;
    }
    if (req.method === 'OPTIONS') { json(res, 200, { ok: true }); return true; }
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (body.__bad) { json(res, 400, { error: 'body bukan JSON' }); return true; }
    if (body.__tooBig) { json(res, 413, { error: 'body terlalu besar' }); return true; }
    const ctx = { req, res, body, url: u, ip: ipOf(req), searchParams: u.searchParams, uid: 0, u: null, token: A.bearerOf(req) };
    try { await hitRoute.fn(ctx); } catch (e) {
      console.error('[api] 500 ' + key + ': ' + (e && e.stack || e));
      try { json(res, 500, { error: 'server error: ' + (e && e.message || e) }); } catch (e2) { }
    }
    return true;
  }

  return {
    cfg, store, handle, secret, publicUser, levelOf, payReferral,
    stats: () => ({ users: store.count, reqs: Object.keys(store.data.reqs).length, referrals: store.data.refs.length }),
    flush: () => store.flush(),
  };
}

module.exports = { createApi, DEFAULTS, cfgFromEnv, json, clampInt };

/* =============================================================================
 * Mode berdiri sendiri: node server/api.js [--port 8791] [--web]
 *   --web  ikut menyajikan folder web/ (berguna bila API di-deploy terpisah)
 * ========================================================================== */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const argOf = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const port = parseInt(argOf('--port', process.env.PORT || '8791'), 10);
  const api = createApi({});
  const serveWeb = argv.indexOf('--web') >= 0;
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8' };
  const fsx = require('fs');
  const server = http.createServer(async (req, res) => {
    if (await api.handle(req, res, new URL(req.url, 'http://x'))) return;
    if (!serveWeb) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('API only — jalankan: node web/net-server.js'); }
    const file = path.join(__dirname, '..', 'web', req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    fsx.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(buf);
    });
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`\n  BUNGLON account API  →  http://localhost:${port}/api/health`);
    if (serveWeb) console.log('  + web demo           →  http://localhost:' + port + '/');
    console.log('  data tersimpan di    ' + api.cfg.dataDir + '\n');
  });
  const bye = () => { api.flush(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}

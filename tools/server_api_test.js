/* =============================================================================
 * tools/server_api_test.js — uji backend akun (server/) TANPA dependency
 * -----------------------------------------------------------------------------
 * Menjalankan server sungguhan (spawn `node server/api.js`) di port acak dengan
 * DATA_DIR sementara, lalu memukul setiap rute lewat fetch. Grup:
 *   [1] auth/store : scrypt + JWT + generator ID + JSON store atomik
 *   [2] boot       : health
 *   [3] signup     : validasi, index, token, ID game 7 digit
 *   [4] login/me   : sesi JWT, 401, 404/409
 *   [5] referral   : +50/+1 utk yang diundang, +100 utk pengundang (DIBAYAR SERVER)
 *   [6] friends    : ID game -> cari -> ajakan -> terima -> hapus, room aktif
 *   [7] ads        : cooldown 30s + nonce anti-replay + cap harian di server
 *   [8] sync       : ledger earned+granted, monoton, lintas perangkat
 *   [9] persist    : flush -> restart -> data & ID tetap
 *   [10] misc      : leaderboard, rute asing, CORS
 *   [11] mount     : /api menumpang di web/net-server.js (satu port)
 *   [12] parity    : konstanta server == konstanta web
 * jalan: node tools/server_api_test.js      (exit != 0 bila ada FAIL)
 * ========================================================================== */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failNames = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  else { fail++; failNames.push(n); console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const A = require(path.join(ROOT, 'server/auth.js'));
const { JsonStore } = require(path.join(ROOT, 'server/store.js'));
const { createApi, DEFAULTS } = require(path.join(ROOT, 'server/api.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bunglon-api-'));
const dataDir = path.join(tmp, 'data');
const PORT = 18000 + (process.pid % 800);
const BASE = 'http://127.0.0.1:' + PORT;
const SECRET = 'test-secret-bunglon-32-karakter!!';

/** fetch JSON + status; dipanggil tanpa asumsi apa pun soal format respons. */
async function call(method, p, { body, token, headers } = {}) {
  const h = Object.assign({ 'content-type': 'application/json' }, headers || {});
  if (token) h.authorization = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch (e) { j = { __raw: text }; }
  return { status: r.status, j, headers: r.headers, text };
}
const GET = (p, o) => call('GET', p, o || {});
const POST = (p, body, o) => call('POST', p, Object.assign({ body }, o || {}));

/** Tunggu server menjawab /api/health (maks ~8s). */
async function waitUp(proc) {
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    try { if ((await GET('/api/health')).status === 200) return true; } catch (e) { }
    if (proc && proc.exitCode !== null) return false;
    await sleep(120);
  }
  return false;
}
let child = null;
function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server/api.js'), '--port', String(PORT)], {
    cwd: ROOT, env: Object.assign({}, process.env, { DATA_DIR: dataDir, JWT_SECRET: SECRET }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  startServer.log = () => out;
  return child;
}
async function stopServer() {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(50);
  }
}

(async function main() {
  /* ======================== [1] auth.js (satuan) =========================== */
  console.log('\n[1] server/auth.js — scrypt + JWT + generator');
  {
    const h = A.hashPassword('rahasia123');
    ok('hashPassword = scrypt$N$r$p$salt$hash', /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(h), h.slice(0, 24) + '…');
    ok('verifyPassword benar -> true', A.verifyPassword('rahasia123', h) === true);
    ok('verifyPassword salah -> false', A.verifyPassword('rahasia124', h) === false);
    ok('verifyPassword hash rusak -> false (tidak pernah throw)', A.verifyPassword('x', 'scrypt$1$1$1$zz$zz') === false && A.verifyPassword('x', '') === false);
    ok('salt acak: dua hash dari password sama berbeda', A.hashPassword('a') !== A.hashPassword('a'));

    const sec = 'kunci-tes';
    const t = A.signToken({ sub: 7, gid: '1234567' }, sec, 1);
    const v = A.verifyToken(t, sec);
    ok('JWT HS256: 3 bagian base64url (tanpa + / =)', t.split('.').length === 3 && !/[+/=]/.test(t));
    ok('verifyToken menerima token sendiri', v.ok === true && v.payload.sub === 7 && v.payload.gid === '1234567', v);
    ok('verifyToken menolak secret lain', A.verifyToken(t, 'kunci-lain').ok === false);
    ok('verifyToken menolak payload yang diubah', A.verifyToken(t.split('.')[0] + '.' + A.b64u(JSON.stringify({ sub: 9, exp: 9e9 })) + '.' + t.split('.')[2], sec).ok === false);
    ok('verifyToken menolak token kadaluarsa', A.verifyToken(A.signToken({ sub: 1 }, sec, -1), sec).error === 'kadaluarsa');
    ok('verifyToken menolak bukan JWT', A.verifyToken('abc', sec).ok === false && A.verifyToken('', sec).ok === false);
    ok('bearerOf membaca header Authorization', A.bearerOf({ headers: { authorization: 'Bearer XYZ.abc' } }) === 'XYZ.abc');
    ok('bearerOf toleran huruf besar/kecil + header kosong', A.bearerOf({ headers: { Authorization: 'bearer q' } }) === 'q' && A.bearerOf({ headers: {} }) === '');

    const ids = Array.from({ length: 40 }, () => A.makeGameId(new Set()));
    ok('makeGameId = 7 digit tidak diawali 0', ids.every(s => /^[1-9][0-9]{6}$/.test(s)), ids.slice(0, 2));
    ok('makeGameId menghormati set taken', A.makeGameId(new Set(['1111111'])) !== '1111111');
    const codes = Array.from({ length: 40 }, () => A.makeRefCode(new Set()));
    ok('makeRefCode 7 char tanpa I/L/O (lolos isValidCode klien)', codes.every(s => /^[A-HJ-KM-NP-Z0-9]{7}$/.test(s)), codes.slice(0, 2));
    ok('makeNonce unik', new Set(Array.from({ length: 30 }, () => A.makeNonce('ad_'))).size === 30);
    ok('normalizeUser: lowercase [a-z0-9_] 3-16 (karakter lain dibuang)', A.normalizeUser(' Zam_9 ') === 'zam_9' && A.normalizeUser('ab') === '' && A.normalizeUser('a'.repeat(20)) === '' && A.normalizeUser('x y!z') === 'xyz');
    ok('normalizeName: max 16 char, tanpa < > \\n', A.normalizeName('  nama<>sangat\npanjang sekali  ').length <= 16 && !/[<>\n]/.test(A.normalizeName('a<b>c')) && A.normalizeName('', 'fallback') === 'fallback');
    ok('normalizeRef: uppercase alnum, max 8', A.normalizeRef(' ab-12 cd34 ef ') === 'AB12CD34');
  }
  console.log('\n[1b] server/store.js — JSON store atomik');
  {
    const f = path.join(tmp, 'unit', 'db.json');
    const s = new JsonStore(f);
    const u = s.insertUser({ name: 'a', login: 'aaa', gameId: '1111111', refCode: 'AAAAAAA' });
    ok('insertUser: uid + index byUser/byGameId/byRef', u.uid === 1 && !!s.byLogin('aaa') && !!s.byGameId('1111111') && !!s.byRefCode('AAAAAAA'));
    ok('flush() menulis db.json', s.flush() === true && fs.existsSync(f));
    ok('reload dari disk mempertahankan user', !!new JsonStore(f).byLogin('aaa'));
    fs.writeFileSync(f, '{rusak');
    const s3 = new JsonStore(f);
    ok('file rusak -> mulai kosong + salinan .corrupt (tidak throw)', s3.count === 0 && fs.readdirSync(path.dirname(f)).some(x => x.indexOf('corrupt') >= 0));
    const s4 = new JsonStore(null);
    ok('mode RAM (tanpa file) jalan', s4.insertUser({ name: 'x' }).uid === 1 && s4.flush() === false);
  }

  /* =========================== [2] server hidup =========================== */
  console.log('\n[2] node server/api.js — boot + health');
  startServer();
  ok('server siap (GET /api/health 200)', await waitUp(child), startServer.log().slice(0, 300));
  {
    const r = await GET('/api/health');
    ok('health: users 0 + payout referral 100 + cooldown iklan 30', r.j.users === 0 && r.j.referralPayout === 100 && r.j.adCooldownSeconds === 30, r.j);
  }

  /* ============================= [3] signup ================================ */
  console.log('\n[3] POST /api/signup — validasi + ID game');
  let t1 = '', u1 = null, t2 = '', u2 = null, t3 = '', u3 = null, t4 = '', u4 = null;
  {
    let r = await POST('/api/signup', { name: 'ab', user: 'x', pass: '1234' });
    ok('username < 3 karakter ditolak (400)', r.status === 400, r.j);
    r = await POST('/api/signup', { name: 'a', user: 'zam', pass: '123' });
    ok('password < minimal ditolak (400)', r.status === 400 && /minimal/.test(r.j.error), r.j);
    r = await POST('/api/signup', { name: 'Zamadye', user: 'Zam 9!', pass: 'rahasia' });
    ok('nama akun dinormalisasi lalu diterima (201)', r.status === 201 && r.j.user.login === 'zam9', r.j && r.j.error);
    ok('username hasil normalisasi TIDAK sama dengan "zam" -> tidak bentrok', r.j.user.login === 'zam9');
    u1 = r.j.user; t1 = r.j.token;
    ok('signup mengembalikan JWT 3 bagian', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t1));
    ok('ID game = 7 digit numerik (untuk tambah teman)', /^[1-9][0-9]{6}$/.test(u1.gameId), u1.gameId);
    ok('refCode 7 karakter kompatibel klien web', /^[A-HJ-KM-NP-Z0-9]{7}$/.test(u1.refCode), u1.refCode);
    ok('respons tidak pernah memuat hash password', !/"pass"|\bscrypt\$/.test(JSON.stringify(r.j)), Object.keys(u1).join(','));
    r = await POST('/api/signup', { name: 'b', user: 'zam9', pass: 'rahasia' });
    ok('username duplikat ditolak (409)', r.status === 409, r.j);
    r = await POST('/api/signup', { name: 'budi', user: 'bud1', pass: 'rahasia', coins: 40, xp: 900, best: 320, rounds: 9, lives: 2 });
    u2 = r.j.user; t2 = r.j.token;
    ok('migrasi profil lokal ikut tersimpan', u2.coins === 40 && u2.xp === 900 && u2.best === 320 && u2.lives === 2, u2);
    ok('level dari XP memakai kurva web (900 XP -> Lv 3)', u2.level === 3, u2.level);
    r = await POST('/api/signup', { name: 'cici', user: 'cici', pass: 'rahasia' });
    u3 = r.j.user; t3 = r.j.token;
    ok('3 akun terdaftar -> health.users = 3', (await GET('/api/health')).j.users === 3);
    r = await POST('/api/signup', { name: 'd', user: 'dudu' });
    ok('signup tanpa password -> 400', r.status === 400, r.j);
  }

  /* =========================== [4] login / me ============================= */
  console.log('\n[4] /api/login + /api/me — sesi JWT');
  {
    let r = await POST('/api/login', { user: 'ZAM9', pass: 'rahasia' });
    ok('login case-insensitive + token baru', r.status === 200 && r.j.user.uid === u1.uid && !!r.j.token, r.j && r.j.error);
    ok('token baru memuat klaim sub/gid yang benar', A.verifyToken(r.j.token, SECRET).payload.gid === u1.gameId);
    r = await POST('/api/login', { user: 'zam9', pass: 'salah' });
    ok('password salah -> 401', r.status === 401 && /salah/.test(r.j.error), r.j);
    r = await POST('/api/login', { user: 'tidakada', pass: 'x' });
    ok('akun tidak ada -> 401 pesan sama (tidak membocorkan)', r.status === 401 && r.j.error === 'nama akun atau password salah', r.j);
    r = await GET('/api/me', { token: t1 });
    ok('me() dengan token -> profil sendiri', r.status === 200 && r.j.user.login === 'zam9', r.j);
    r = await GET('/api/me');
    ok('me() tanpa token -> 401', r.status === 401 && /login dulu/.test(r.j.error), r.j);
    r = await GET('/api/me', { token: t1 + 'x' });
    ok('token dirusak -> 401 (signature)', r.status === 401 && /signature/.test(r.j.error), r.j);
    r = await GET('/api/me', { headers: { authorization: 'Basic abc' } });
    ok('scheme non-Bearer diabaikan -> 401', r.status === 401);
    r = await POST('/api/login', { user: 'bud1', pass: 'rahasia', migrate: { coins: 500, xp: 1800, best: 900, ref: u1.refCode } });
    ok('login + migrate: nilai lokal dinaikkan ke server', r.j.user.best === 900 && r.j.user.xp >= 1800, r.j.user);
    ok('migrate hanya menaiki nilai (earnedCoins 40 -> 500, best 320 -> 900)', r.j.user.coins === 500 && r.j.user.best === 900 && r.j.user.lives === 2, r.j.user);
    ok('migrate.ref dijadwalkan (belum dibayar saat login)', !r.j.user.grantedCoins, r.j.user);
    const after = await GET('/api/me', { token: r.j.token });
    ok('me() membayar referral tertahan: +50 koin & +1 nyawa', after.j.user.lives === 3 && after.j.user.coins === 550 && after.j.user.grantedCoins === 50, after.j.user);
    ok('respons me() memuat detail referral (by + coinsForInviter)', after.j.referral && after.j.referral.ok === true && after.j.referral.coinsForInviter === 100, after.j.referral);
  }

  /* ============================ [5] referral =============================== */
  console.log('\n[5] referral — +100 koin pengundang DIBAYAR SERVER');
  {
    let r = await POST('/api/signup', { name: 'dewi', user: 'dewi', pass: 'rahasia', ref: u1.refCode.toLowerCase() });
    ok('signup dengan ref -> referral.ok = true (dibayar server)', r.status === 201 && r.j.referral && r.j.referral.ok === true, r.j && r.j.referral);
    ok('yang diundang dapat +50 koin & +1 nyawa', r.j.user.coins === DEFAULTS.refCoinsInvitee && r.j.user.lives === 1, r.j.user);
    t4 = r.j.token; u4 = r.j.user;
    ok('hadiah tercatat sebagai grantedCoins (bukan sekadar localStorage)', r.j.user.grantedCoins === 50 && r.j.user.grantedLives === 1, r.j.user);
    r = await GET('/api/me', { token: t1 });
    ok('pengundang dapat +100 koin', r.j.user.coins >= 100 && r.j.user.invited >= 1, r.j.user);
    const coinsAfterFirst = r.j.user.coins;
    r = await GET('/api/referral', { token: t1 });
    ok('GET /api/referral: code/count/coinsEarned/list', r.j.code === u1.refCode && r.j.count >= 1 && r.j.coinsEarned >= 100 && r.j.list.length >= 1, r.j);
    ok('sisi yang diundang mengenali pengundangnya', (await GET('/api/referral', { token: t4 })).j.referrer === u1.name);
    r = await POST('/api/referral/claim', { ref: u1.refCode }, { token: t4 });
    ok('klaim ulang oleh akun yang sama -> 409', r.status === 409, r.j);
    r = await POST('/api/signup', { name: 'echo', user: 'echo5', pass: 'rahasia', ref: 'ZZZZZZZ' });
    ok('kode tidak dikenal -> akun tetap jadi, referral berisi error', r.status === 201 && r.j.referral && r.j.referral.error === 'kode undangan tidak dikenal', r.j.referral);
    const t5 = r.j.token;
    r = await POST('/api/referral/claim', { ref: (await GET('/api/me', { token: t5 })).j.user.refCode }, { token: t5 });
    ok('menggunakan kode sendiri -> ditolak', r.status === 409 || r.status === 400, r.j);
    r = await POST('/api/referral/claim', { ref: 'NOPE' }, { token: t3 });
    ok('claim kode asing -> 404', r.status === 404, r.j);
    ok('tidak ada akun yang kebobolan grant ganda', (await GET('/api/me', { token: t1 })).j.user.coins === coinsAfterFirst);
  }

  /* =========================== [6] friends + ID =========================== */
  console.log('\n[6] teman lewat ID game (7 digit) + room aktif');
  {
    let r = await POST('/api/friends/find', { gameId: u2.gameId }, { token: t1 });
    ok('find by ID -> player publik + state none', r.status === 200 && r.j.found && r.j.player.name === 'budi' && r.j.state === 'none', r.j);
    r = await POST('/api/friends/find', { gameId: '000000' }, { token: t1 });
    ok('ID terlalu pendek -> 400 dengan petunjuk', r.status === 400 && /digit/.test(r.j.error), r.j);
    ok('cari lewat nama akun juga bisa', (await POST('/api/friends/find', { gameId: 'bud1' }, { token: t1 })).j.found === true);
    r = await POST('/api/friends/find', { gameId: '9999999' }, { token: t1 });
    ok('ID tidak terdaftar -> 404', r.status === 404, r.j);
    ok('ID dengan spasi/tanda baca diterima (dibersihkan)', (await POST('/api/friends/find', { gameId: u2.gameId.split('').join('-') }, { token: t1 })).status === 200);
    r = await POST('/api/friends/find', { gameId: u1.gameId }, { token: t1 });
    ok('mencari ID sendiri -> state self', r.j.state === 'self', r.j);

    r = await POST('/api/friends/request', { gameId: u2.gameId }, { token: t1 });
    ok('kirim ajakan -> pending + reqId', r.status === 200 && r.j.state === 'pending' && /^r\d+-\d+$/.test(r.j.reqId), r.j);
    r = await POST('/api/friends/request', { gameId: u2.gameId }, { token: t1 });
    ok('ajakan ganda tidak diduplikasi', r.status === 200 && r.j.state === 'pending', r.j);
    r = await GET('/api/friends', { token: t2 });
    ok('target melihat incoming (nama + ID pengirim)', r.j.incoming.length === 1 && r.j.incoming[0].from.gameId === u1.gameId, r.j);
    ok('pengirim melihat outgoing', (await GET('/api/friends', { token: t1 })).j.outgoing.length === 1);
    const reqId = (await GET('/api/friends', { token: t2 })).j.incoming[0].reqId;
    r = await POST('/api/friends/respond', { reqId, accept: true }, { token: t1 });
    ok('menjawab ajakan orang lain -> 403', r.status === 403, r.j);
    r = await POST('/api/friends/respond', { reqId, accept: true }, { token: t2 });
    ok('terima ajakan -> accepted', r.status === 200 && r.j.accepted === true, r.j);
    const f1 = (await GET('/api/friends', { token: t1 })).j.friends;
    const f2 = (await GET('/api/friends', { token: t2 })).j.friends;
    ok('pertemanan tercatat dua arah', f1.length === 1 && f1[0].gameId === u2.gameId && f2.length === 1 && f2[0].gameId === u1.gameId, [f1, f2]);
    ok('setelah berteman, find -> state friends', (await POST('/api/friends/find', { gameId: u2.gameId }, { token: t1 })).j.state === 'friends');
    ok('respond dua kali -> 404 (request dihapus)', (await POST('/api/friends/respond', { reqId, accept: true }, { token: t2 })).status === 404);

    r = await POST('/api/friends/request', { gameId: u4.gameId }, { token: t3 });
    ok('u3 mengajak u4 -> pending', r.j.state === 'pending', r.j);
    r = await POST('/api/friends/request', { gameId: u3.gameId }, { token: t4 });
    ok('u4 membalas -> langsung friends (saling)', r.j.state === 'friends' && r.j.mutual === true, r.j);
    ok('inbox u3 kosong setelah auto-accept', (await GET('/api/friends', { token: t3 })).j.incoming.length === 0);
    ok('menolak ajakan -> accepted false, tidak jadi teman, request hilang', await (async () => {
      const a = await POST('/api/friends/request', { gameId: u1.gameId }, { token: t3 });      // cici -> zam
      const rid = a.j.reqId;
      const before = (await GET('/api/friends', { token: t3 })).j.friends.length;   // cici sudah berteman dgn dewi
      const d = await POST('/api/friends/respond', { reqId: rid, accept: false }, { token: t1 });
      const f = (await GET('/api/friends', { token: t3 })).j;
      const z = (await GET('/api/friends', { token: t1 })).j;
      return d.status === 200 && d.j.accepted === false && f.friends.length === before && f.outgoing.length === 0 && z.incoming.length === 0;
    })(), 'menolak ajakan gagal');

    r = await POST('/api/room', { room: 'k9zm' }, { token: t1 });
    ok('umumkan room aktif (uppercase, max 8)', r.status === 200 && r.j.room === 'K9ZM', r.j);
    ok('teman bisa melihat room kita (untuk tombol Gabung)', (await GET('/api/friends', { token: t2 })).j.friends[0].room === 'K9ZM');
    await POST('/api/room', { room: '' }, { token: t1 });
    ok('room kosong -> field room hilang dari daftar teman', (await GET('/api/friends', { token: t2 })).j.friends[0].room === '');
    r = await POST('/api/friends/remove', { gameId: u2.gameId }, { token: t1 });
    const fa = (await GET('/api/friends', { token: t1 })).j.friends.length;
    const fb = (await GET('/api/friends', { token: t2 })).j.friends.length;
    ok('hapus teman bersih dua arah', r.status === 200 && fa === 0 && fb === 0, [fa, fb]);
    ok('mengundang diri sendiri -> 400', (await POST('/api/friends/request', { gameId: u1.gameId }, { token: t1 })).status === 400);
    ok('mengundang ID tak dikenal -> 404', (await POST('/api/friends/request', { gameId: '1234567' }, { token: t1 })).status === 404);
  }

  /* ============================== [7] iklan ================================ */
  console.log('\n[7] POST /api/ads/reward — verifikasi di server');
  {
    let r = await POST('/api/ads/reward', { kind: 'bonus_coins', nonce: 'n1' }, { token: t3 });
    ok('grant pertama: +50 koin dari ledger server', r.status === 200 && r.j.coins === 50 && r.j.user.grantedCoins === 50, r.j);
    r = await POST('/api/ads/reward', { kind: 'bonus_coins', nonce: 'n1' }, { token: t3 });
    ok('nonce sama -> 409 (anti-replay)', r.status === 409 && /sudah diklaim/.test(r.j.error), r.j);
    r = await POST('/api/ads/reward', { kind: 'bonus_coins', nonce: 'n2' }, { token: t3 });
    ok('nonce beda tetap kena cooldown 30s -> 429 + secondsLeft', r.status === 429 && r.j.secondsLeft > 0 && r.j.secondsLeft <= 30, r.j);
    r = await POST('/api/ads/reward', { kind: 'tidak_ada', nonce: 'n9' }, { token: t3 });
    ok('reward tidak dikenal -> 400', r.status === 400, r.j);
    ok('klaim tanpa token -> 401 (reward tidak bisa dipalsukan)', (await POST('/api/ads/reward', { kind: 'extra_life', nonce: 'n0' })).status === 401);
    r = await GET('/api/ads/state', { token: t3 });
    ok('ads/state melaporkan sisa cooldown + cap harian', r.status === 200 && r.j.secondsLeft > 0 && r.j.cap === DEFAULTS.adDailyCap, r.j);
    r = await POST('/api/signup', { name: 'iklan dua', user: 'aduser2', pass: 'rahasia' });
    const tAd = r.j.token, before = r.j.user.coins;
    r = await POST('/api/ads/reward', { kind: 'extra_life', nonce: 'x1' }, { token: tAd });
    ok('extra_life -> +1 nyawa, koin tidak berubah', r.j.lives === 1 && r.j.user.grantedLives === 1 && r.j.user.coins === before, r.j);
  }

  /* =============================== [8] sync ================================ */
  console.log('\n[8] POST /api/sync — ledger earned + granted');
  {
    let r = await POST('/api/sync', { coins: 1000, xp: 2000, best: 1200, rounds: 21, lives: 3, name: 'Budi' }, { token: t2 });
    ok('sync menyimpan best/rounds/name', r.status === 200 && r.j.user.best === 1200 && r.j.user.rounds === 21 && r.j.user.name === 'Budi', r.j);
    ok('coins = hasil main (1000), bukan hasil + grant dihitung dua kali', r.j.user.coins === 1000, r.j.user);
    r = await POST('/api/sync', { coins: 10, xp: 5, best: 1, rounds: 0 }, { token: t2 });
    ok('nilai lebih kecil TIDAK menurunkan (monoton)', r.j.user.coins === 1000 && r.j.user.best === 1200 && r.j.user.xp >= 2000, r.j.user);
    ok('sync tanpa token -> 401', (await POST('/api/sync', { coins: 12 })).status === 401);
    r = await POST('/api/sync', { coins: 1e12, xp: 1e12, lives: 99, bonusHp: 99 }, { token: t3 });
    ok('nilai absurd di-clamp (tidak overflow)', r.status === 200 && r.j.user.lives <= 9 && r.j.user.bonusHp <= 4 && r.j.user.coins <= 1e9, r.j.user);
    r = await POST('/api/login', { user: 'bud1', pass: 'rahasia' });
    ok('login dari perangkat lain -> saldo server yang sama', r.j.user.best === 1200 && r.j.user.coins === 1000, r.j.user);
  }

  /* ============================ [9] persistensi ============================ */
  console.log('\n[9] restart — data & ID tetap');
  {
    const me = await GET('/api/me', { token: t1 });
    const idBefore = me.j.user.gameId, coinsBefore = me.j.user.coins, refBefore = me.j.user.refCode;
    ok('db.json ditulis di DATA_DIR', fs.existsSync(path.join(dataDir, 'db.json')), dataDir);
    await stopServer();
    startServer();
    ok('server bisa hidup lagi', await waitUp(child), startServer.log().slice(0, 200));
    const r = await POST('/api/login', { user: 'zam9', pass: 'rahasia' });
    ok('login setelah restart OK', r.status === 200, r.j);
    ok('gameId tidak berubah setelah restart', r.j.user.gameId === idBefore, [r.j.user.gameId, idBefore]);
    ok('refCode stabil (link ?ref= lama tetap valid)', r.j.user.refCode === refBefore);
    ok('koin hasil + grant bertahan', r.j.user.coins === coinsBefore, [r.j.user.coins, coinsBefore]);
    ok('pertemanan/leaderboard ikut bertahan', (await GET('/api/leaderboard')).j.rows.length > 0);
  }

  /* ============================== [10] misc ================================= */
  console.log('\n[10] leaderboard, rute asing, cache header');
  {
    const r = await GET('/api/leaderboard?limit=3');
    ok('leaderboard terurut skor terbaik desc', r.status === 200 && r.j.rows.length === 3 && r.j.rows[0].best >= r.j.rows[1].best, r.j.rows);
    ok('baris punya rank + gameId 7 digit + level', r.j.rows[0].rank === 1 && /^[0-9]{7}$/.test(r.j.rows[0].gameId) && r.j.rows[0].level >= 1, r.j.rows[0]);
    ok('leaderboard tidak memuat data sensitif', !/pass|token|secret/i.test(JSON.stringify(r.j.rows)), JSON.stringify(r.j.rows[0]));
    const bad = await GET('/api/tidak-ada');
    ok('rute /api/* asing -> 404 JSON (bukan HTML) + daftar rute', bad.status === 404 && Array.isArray(bad.j.routes), bad.j);
    ok('preflight mengizinkan header authorization', /authorization/i.test((await call('OPTIONS', '/api/login')).headers.get('access-control-allow-headers') || ''));
    ok('semua respons API = no-store (tidak kena cache service worker)', (await GET('/api/health')).headers.get('cache-control') === 'no-store');
  }

  /* =============== [11] api.js dipakai langsung (unit) + mount ============== */
  console.log('\n[11] mount /api di web/net-server.js (satu port)');
  {
    const api = createApi({ store: new JsonStore(null), cfg: { jwtSecret: 'x', dataDir: '' } });
    let wrote = false;
    const fakeRes = { writeHead() { wrote = true; }, end() { } };
    const handled = await api.handle({ method: 'GET', url: '/index.html', headers: {}, socket: {} }, fakeRes, new URL('http://x/index.html'));
    ok('path non-/api dilewatkan apa adanya (false, tanpa menulis respons)', handled === false && !wrote, handled);
    ok('levelOf() server == rumus web untuk 0/300/900/1800 XP', [0, 300, 900, 1800].every(xp =>
      api.levelOf(xp) === Math.max(1, Math.floor((1 + Math.sqrt(1 + 8 * xp / DEFAULTS.levelBase)) / 2))));

    const src = fs.readFileSync(path.join(ROOT, 'web/net-server.js'), 'utf8');
    ok('net-server require ../server/api.js dengan guard try/catch', /\.\.\/server\/api\.js/.test(src) && /catch/.test(src));
    ok('net-server memanggil api.handle() sebelum static', /api\.handle\(/.test(src));
    const nport = PORT + 1;
    const nchild = spawn(process.execPath, [path.join(ROOT, 'web/net-server.js'), String(nport)], {
      cwd: ROOT, env: Object.assign({}, process.env, { DATA_DIR: path.join(tmp, 'netdata'), JWT_SECRET: 'tes-net-mount' }), stdio: ['ignore', 'ignore', 'pipe'],
    });
    const nb = 'http://127.0.0.1:' + nport;
    let up = false;
    for (let i = 0; i < 70 && !up; i++) { try { up = (await fetch(nb + '/api/health')).ok; } catch (e) { await sleep(120); } }
    ok('server demo hidup dengan API (satu port)', up);
    if (up) {
      const s = await fetch(nb + '/assets/Icon_Freeze.png');
      ok('static tetap dilayani di port yang sama', s.status === 200 && /image\/png/.test(s.headers.get('content-type') || ''), s.status);
      const c = await fetch(nb + '/room/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'coop' }) });
      const j = await c.json();
      ok('relay room lama tidak rusak (/room/create)', c.status === 200 && !!j.room, j);
      const su = await fetch(nb + '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'net', user: 'netuser', pass: 'rahasia' }) });
      const ju = await su.json();
      ok('signup lewat port demo -> token + ID game 7 digit', su.status === 201 && /^[0-9]{7}$/.test(ju.user.gameId), ju && ju.error);
      ok('index.html tetap 200 di port yang sama', (await fetch(nb + '/')).status === 200);
      ok('/api tidak pernah di-cache: sw.js mengecualikannya', /\/api\//.test(fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8')));
    }
    nchild.kill('SIGTERM');
    for (let i = 0; i < 30 && nchild.exitCode === null; i++) await sleep(50);
  }

  /* ========================== [12] parity web ⇄ api ======================== */
  console.log('\n[12] parity konstanta server ⇄ klien web');
  {
    const game = fs.readFileSync(path.join(ROOT, 'web/game.js'), 'utf8');
    const ads = fs.readFileSync(path.join(ROOT, 'web/adsManager.js'), 'utf8');
    const ref = fs.readFileSync(path.join(ROOT, 'web/referralSystem.js'), 'utf8');
    const kit = fs.readFileSync(path.join(ROOT, 'web/apiKit.js'), 'utf8');
    const levelBase = Number((/levelBase:\s*(\d+)/.exec(game) || [])[1]);
    ok('levelBase server == ECONOMY web (' + levelBase + ')', DEFAULTS.levelBase === levelBase && levelBase > 0, [DEFAULTS.levelBase, levelBase]);
    ok('koin pengundang 100 (web referral default == server)', /coinsForInviter:\s*100/.test(ref) && DEFAULTS.refCoinsInviter === 100);
    ok('hadiah invitee web 50 koin / 1 nyawa == server', /coinsForInvitee:\s*50/.test(ref) && /hpForInvitee:\s*1/.test(ref)
      && DEFAULTS.refCoinsInvitee === 50 && DEFAULTS.refHpInvitee === 1);
    ok('panjang kode referral 7 di kedua sisi', /codeLength:\s*7/.test(ref) && DEFAULTS.refCodeLength === 7);
    ok('cooldown iklan 30s dipakai klien & server', Number((/\badCooldownSeconds:\s*(\d+)/.exec(ads) || [])[1]) === DEFAULTS.adCooldownSeconds);
    const apiSrc = fs.readFileSync(path.join(ROOT, 'server/api.js'), 'utf8');
    const serverRoutes = new Set([...apiSrc.matchAll(/(?:GET|POST)\('\/api\/([\w/-]+)'/g)].map(m => m[1]));
    const clientRoutes = new Set([...kit.matchAll(/this\.(?:get|post)\('([\w/-]+)/g)].map(m => m[1]));
    const unknown = [...clientRoutes].filter(r => !serverRoutes.has(r));
    ok('setiap rute yang dipanggil apiKit ada di server (' + clientRoutes.size + ' rute)', unknown.length === 0 && clientRoutes.size >= 10, { unknown, client: [...clientRoutes], server: [...serverRoutes] });
    ok('server mendaftarkan rute akun+referral+teman+iklan', ['signup', 'login', 'me', 'sync', 'referral', 'friends/find', 'friends/request', 'friends/respond', 'friends/remove', 'room', 'ads/reward', 'leaderboard', 'health'].every(r => serverRoutes.has(r)), [...serverRoutes]);
    ok('apiKit hanya memakai prefix /api/ (tidak menempel rute lain)', (kit.match(/['"]\/api\//g) || []).length >= 2 && !/fetch\(['"]\/(?!api)/.test(kit));
    ok('klien menyimpan token & profil di key localStorage yang documented', /hideseek_jwt/.test(kit) && /hideseek_user/.test(kit));
    ok('index.html memuat apiKit.js sebelum game.js', (() => {
      const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
      return html.indexOf('<script src="apiKit.js">') > 0
        && html.indexOf('<script src="apiKit.js">') < html.indexOf('<script src="game.js">')
        && html.indexOf('<script src="referralSystem.js">') < html.indexOf('<script src="apiKit.js">');
    })());
    ok('game.js memasang hook akun (login/signup/sync dipanggil)', /BungAPI|apiKit/.test(game) && /account\./.test(game));
    ok('README & integration-guide menyebut backend', /server\/api\.js/.test(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')));
  }
})().catch(async (e) => {
  console.error('\n\x1b[31mPELAKSANAAN GAGAL:\x1b[0m', (e && e.stack || e));
  if (startServer.log) console.error('--- log server ---\n' + startServer.log().slice(-1200));
  await stopServer();
  process.exitCode = 2;
}).then(async () => {
  await stopServer();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + pass + ' PASS / ' + fail + ' FAIL\x1b[0m' + (failNames.length ? '\n  gagal: ' + failNames.join('\n  gagal: ') : ''));
  if (fail) process.exitCode = 1;
});

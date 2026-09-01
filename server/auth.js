/* =============================================================================
 * server/auth.js — hashing password + JWT + generator ID (TANPA dependency npm)
 * -----------------------------------------------------------------------------
 * Aturan keras project ini: tidak boleh ada `npm install`. Jadi:
 *   • password  -> crypto.scrypt (memory-hard, bawaan Node >= 10)
 *   • token     -> JWT HS256 ditulis manual (header.payload.signature, base64url)
 *   • secret    -> env JWT_SECRET, atau dibuat otomatis di <dataDir>/.secret (0600)
 * Semua fungsi di file ini murni (tanpa I/O, kecuali loadSecret) supaya bisa
 * diuji satuan lewat tools/server_api_test.js.
 * ========================================================================== */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ------------------------------ password (scrypt) --------------------------- */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

/** Hash password -> string portabel "scrypt$N$r$p$saltHex$hashHex". */
function hashPassword(pass) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pass || ''), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), key.toString('hex')].join('$');
}

/** Verifikasi constant-time; false untuk hash rusak/format lain (jangan pernah throw). */
function verifyPassword(pass, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'hex');
    const want = Buffer.from(parts[5], 'hex');
    if (!salt.length || !want.length) return false;
    const got = crypto.scryptSync(String(pass || ''), salt, want.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch (e) { return false; }
}

/* ---------------------------------- JWT ------------------------------------ */
const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(t + '='.repeat((4 - (t.length % 4)) % 4), 'base64');
};
const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest();

/**
 * Buat JWT HS256.
 * @param {object} payload  klaim tambahan tanpa iat/exp (mis. {sub, gid})
 * @param {string} secret   kunci HMAC
 * @param {number} ttlDays  masa berlaku (hari)
 */
function signToken(payload, secret, ttlDays = 30) {
  const now = Math.floor(Date.now() / 1000);
  const d = Number(ttlDays);
  const ttl = (isFinite(d) ? d : 30) * 86400;      // negatif = sengaja kadaluarsa (dipakai tes)
  const body = Object.assign({}, payload, { iat: now, exp: now + ttl });
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(body));
  return h + '.' + p + '.' + b64u(sign(secret, h + '.' + p));
}

/**
 * Verifikasi JWT HS256.
 * @returns {{ok:true,payload:object}|{ok:false,error:string}}
 */
function verifyToken(token, secret) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, error: 'format' };
  const expect = b64u(sign(secret, parts[0] + '.' + parts[1]));
  const given = parts[2];
  const a = Buffer.from(expect), b = Buffer.from(given);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'signature' };
  let payload;
  try { payload = JSON.parse(unb64u(parts[1]).toString('utf8') || '{}'); } catch (e) { return { ok: false, error: 'payload' }; }
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'payload' };
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return { ok: false, error: 'kadaluarsa' };
  return { ok: true, payload };
}

/** Baca Authorization: Bearer -> token (atau '' bila tidak ada). */
function bearerOf(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^bearer\s+(.+)$/i.exec(String(h));
  return m ? m[1].trim() : '';
}

/* ------------------------------- secret file -------------------------------- */
/**
 * Ambil (atau buat) secret HMAC. Disimpan di <dir>/.secret dengan mode 0600
 * supaya token tetap valid setelah restart, tanpa menaruh kunci di repo.
 */
function loadSecret(dir, envValue) {
  if (envValue) return String(envValue);
  const file = path.join(dir, '.secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 16) return s;
  } catch (e) { /* belum ada */ }
  const s = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, s + '\n', { mode: 0o600 });
  } catch (e) { /* read-only fs -> pakai secret sementara (token hilang saat restart) */ }
  return s;
}

/* ------------------------- generator ID (aman diketik) ---------------------- */
/** ID game: 7 digit numerik, tidak diawali 0 — mudah dibacakan di voice chat. */
function makeGameId(taken) {
  for (let i = 0; i < 4000; i++) {
    const id = String(1000000 + crypto.randomInt(0, 9000000));
    if (!taken || !taken.has(id)) return id;
  }
  return String(Date.now() % 10000000).padStart(7, '0');
}

/**
 * Kode referral: 7 karakter, charset TANPA I/L/O (serupa angka yang mudah tertukar),
 * sama seperti validasi klien web (ReferralSystem.isValidCode menerima A-HJ-KM-NP-Z0-9).
 */
function makeRefCode(taken, len = 7) {
  // Tanpa I, L, O: mirip 1/1/0 bila dibaca dari screenshot/panggilan suara.
  const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const n = Math.min(8, Math.max(6, len | 0));
  for (let i = 0; i < 4000; i++) {
    let s = '';
    for (let k = 0; k < n; k++) s += CHARS[crypto.randomInt(0, CHARS.length)];
    if (!taken || !taken.has(s)) return s;
  }
  return 'HS' + String(Date.now() % 1000000).padStart(6, '0').toUpperCase();
}

/** Nonce utk klaim reward iklan (dedupe replay) + id request pertemanan. */
function makeNonce(prefix = '') { return prefix + crypto.randomBytes(6).toString('hex'); }

/** Normalisasi nama login: huruf kecil, [a-z0-9_], 3-16 karakter ('' = tidak valid). */
function normalizeUser(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  return (s.length >= 3 && s.length <= 16) ? s : '';
}
/** Normalisasi nama tampilan: boleh spasi/Unicode, dipotong 16 karakter. */
function normalizeName(raw, fallback = 'pemain') {
  let s = String(raw == null ? '' : raw).replace(/[\r\n\t<>]/g, ' ').trim();
  if (s.length > 16) s = s.slice(0, 16);
  return s || fallback;
}
/** Kode referral dari teks bebas -> uppercase, alfanumerik saja, max 8. */
function normalizeRef(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

module.exports = {
  SCRYPT, hashPassword, verifyPassword, signToken, verifyToken, bearerOf, loadSecret,
  makeGameId, makeRefCode, makeNonce, normalizeUser, normalizeName, normalizeRef, b64u, unb64u,
};

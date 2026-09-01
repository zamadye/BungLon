/* =============================================================================
 * server/store.js — penyimpanan JSON (tanpa SQLite, tanpa dependency npm)
 * -----------------------------------------------------------------------------
 * Kenapa file JSON? Aturan repo: zero-dependency + tanpa build step. Struktur:
 *   { version, nextUid, users:{uid:{...}}, byUser:{login:uid}, byGameId:{id:uid},
 *     byRef:{KODE:uid}, reqs:{reqId:{...}}, refs:[{inviter,invitee,at,coins}] }
 * Penulisan: atomic (tmp + rename) + debounce 250ms supaya request beruntun tidak
 * memicu ratusan write. Untuk produksi nyata tinggal ganti file ini dengan adapter
 * Postgres/Mongo — API publiknya (get/set/upsert/indexOf) sudah dipisahkan.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const EMPTY = () => ({ version: 1, nextUid: 1, users: {}, byUser: {}, byGameId: {}, byRef: {}, reqs: {}, refs: [] });

class JsonStore {
  /** @param {string} file  path db.json (folder dibuat otomatis bila belum ada) */
  constructor(file) {
    this.file = file || null;
    this.data = EMPTY();
    this._timer = null;
    this._dirty = false;
    this.load();
  }
  /** Baca dari disk; file rusak/disimpan setengah tidak boleh membuat server mati. */
  load() {
    if (!this.file) return this;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const j = raw.trim() ? JSON.parse(raw) : null;
      if (j && typeof j === 'object') {
        this.data = Object.assign(EMPTY(), j);
        for (const k of ['users', 'byUser', 'byGameId', 'byRef', 'reqs']) if (!this.data[k] || typeof this.data[k] !== 'object') this.data[k] = {};
        if (!Array.isArray(this.data.refs)) this.data.refs = [];
      }
    } catch (e) {
      if (e.code !== 'ENOENT') { try { fs.renameSync(this.file, this.file + '.corrupt-' + Date.now()); } catch (e2) { } }
    }
    return this;
  }
  /** Tandai berubah; tulis nanti (debounce). */
  touch() {
    this._dirty = true;
    if (this._timer || !this.file) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 250);
    if (this._timer.unref) this._timer.unref();
  }
  /** Tulis segera (dipakai test + sinyal SIGINT supaya tidak kehilangan data). */
  flush() {
    if (!this.file || !this._dirty) return false;
    this._dirty = false;
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);       // rename = atomic di hampir semua FS
    return true;
  }
  /* ------------------------------- users ---------------------------------- */
  user(uid) { return this.data.users[String(uid)] || null; }
  byLogin(login) { const uid = this.data.byUser[String(login || '').toLowerCase()]; return uid ? this.user(uid) : null; }
  byGameId(id) { const uid = this.data.byGameId[String(id || '')]; return uid ? this.user(uid) : null; }
  byRefCode(code) { const uid = this.data.byRef[String(code || '').toUpperCase()]; return uid ? this.user(uid) : null; }
  /** Buat user baru + daftarkan semua index (login, gameId, refCode). */
  insertUser(rec) {
    const uid = this.data.nextUid++;
    rec.uid = uid;
    if (!rec.createdAt) rec.createdAt = Date.now();
    rec.lastSeenAt = Date.now();
    this.data.users[uid] = rec;
    if (rec.login) this.data.byUser[rec.login] = uid;
    if (rec.gameId) this.data.byGameId[rec.gameId] = uid;
    if (rec.refCode) this.data.byRef[rec.refCode] = uid;
    this.touch();
    return rec;
  }
  update(uid, patch) {
    const u = this.user(uid); if (!u) return null;
    Object.assign(u, patch || {});
    u.lastSeenAt = Date.now();
    this.touch();
    return u;
  }
  /* ------------------------------ friend req -------------------------------- */
  addReq(req) { this.data.reqs[req.id] = req; this.touch(); return req; }
  getReq(id) { return this.data.reqs[String(id)] || null; }
  delReq(id) { delete this.data.reqs[String(id)]; this.touch(); }
  /* ------------------------------- referral --------------------------------- */
  logReferral(entry) { this.data.refs.push(entry); if (this.data.refs.length > 5000) this.data.refs.splice(0, this.data.refs.length - 5000); this.touch(); return entry; }
  /* --------------------------------- stats ---------------------------------- */
  get count() { return Object.keys(this.data.users).length; }
  allUsers() { return Object.keys(this.data.users).map(k => this.data.users[k]); }
}

module.exports = { JsonStore, EMPTY };

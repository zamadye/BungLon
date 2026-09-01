/* =============================================================================
 * HideSeek Online — dev server untuk web demo (TANPA dependency npm)
 * -----------------------------------------------------------------------------
 * Dua fungsi dalam satu port:
 *   1) static file server untuk web/  →  buka http://localhost:8790/
 *   2) room relay "mirip PUN" (HTTP long-poll) supaya 2 tab/browser bisa
 *      main bareng: host = Authority (phase timer + hit keputusan), klien
 *      cuma kirim input dan menerima snapshot.
 * Ini bukan pengganti Photon — di Unity, room/relay ditangani Photon Cloud
 * (RoomOptions + [PunRPC] + RaiseEventOptions). Server ini hanya supaya build
 * web bisa diuji multiplayer tanpa engine.
 *
 * jalankan:  node web/net-server.js [port]
 * ========================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8790', 10);
const ROOT = __dirname;                       // web/
const LONG_POLL_MS = 20000;                   // timeout tunggu event baru
const STALE_MS = 45000;                       // pemain dianggap keluar kalau diam

const rooms = new Map();                      // code -> room
const waiters = new Set();                    // {res, room, from, done}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon',
  // PWA: peramban menolak manifest bila tipenya bukan application/manifest+json
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2',
};
const code4 = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
};

function newRoom() {
  const r = { code: null, players: new Map(), seq: 0, ev: [], nextId: 1, hostId: 0, created: Date.now() };
  return r;
}
function push(r, ev) {                       // append event + bangunkan waiter
  ev.seq = ++r.seq;
  r.ev.push(ev);
  if (r.ev.length > 400) r.ev.splice(0, r.ev.length - 400);
  for (const w of waiters) if (w.room === r) wake(w);
}
function wake(w) { if (w.done) return; w.done = true; waiters.delete(w); send(w.res, w.pollBody()); }
function roster(r) {
  return [...r.players.values()].map(p => [p.id, p.name]);
}
function send(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'content-type': MIME['.json'], 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 4e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { resolve({}); } });
  });
}

/* ---- pembersih: pemain yang koneksi poll-nya mati → keluar dari room ---- */
setInterval(() => {
  const t = Date.now();
  for (const [code, r] of rooms) {
    for (const [tok, p] of r.players) {
      if (t - p.seen > STALE_MS) {
        r.players.delete(tok);
        push(r, { t: 'leave', id: p.id });
        push(r, { t: 'roster', list: roster(r) });
        console.log(`[leave] ${p.name} #${p.id} (${code})`);
        if (r.players.size === 0) { rooms.delete(code); console.log(`[room] ${code} ditutup`); continue; }
        // host pindah ke pemain berikutnya → klien baru jadi Authority
        if (p.id === r.hostId) {
          r.hostId = [...r.players.values()][0].id;
          push(r, { t: 'host', id: r.hostId });
        }
      }
    }
  }
}, 5000).unref();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' }); return res.end(); }

  /* ---------- API room ---------- */
  if (p === '/room/create' && req.method === 'POST') {
    const b = await readBody(req);
    let code; do { code = code4(); } while (rooms.has(code));
    const r = newRoom(); r.code = code; rooms.set(code, r);
    const id = r.nextId++;
    const token = code + '.' + id + '.' + Math.random().toString(36).slice(2, 8);
    r.players.set(token, { id, name: (b.name || 'pemain').slice(0, 16), seen: Date.now() });
    r.hostId = id;
    push(r, { t: 'roster', list: roster(r) });
    console.log(`[room] buat ${code} oleh ${b.name} (host #${id})`);
    return send(res, { room: code, token, you: id, host: id, seq: r.seq, ev: [] });
  }
  if (p === '/room/join' && req.method === 'POST') {
    const b = await readBody(req);
    const r = rooms.get(String(b.room || '').toUpperCase());
    if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('room tidak ditemukan'); }
    if (r.players.size >= 12) { res.writeHead(409, { 'content-type': 'text/plain' }); return res.end('room penuh (MaxPlayersPerRoom 12)'); }
    const id = r.nextId++;
    const token = r.code + '.' + id + '.' + Math.random().toString(36).slice(2, 8);
    r.players.set(token, { id, name: (b.name || 'pemain').slice(0, 16), seen: Date.now() });
    push(r, { t: 'join', id, name: b.name });
    push(r, { t: 'roster', list: roster(r) });
    console.log(`[room] gabung ${r.code} → ${b.name} #${id}`);
    return send(res, { room: r.code, token, you: id, host: r.hostId, seq: r.seq, ev: [] });
  }
  if (p === '/room/send' && req.method === 'POST') {
    const b = await readBody(req);
    const r = rooms.get(String(b.room || '')); const pl = r && r.players.get(b.token);
    if (!r || !pl) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('room/token tidak valid'); }
    pl.seen = Date.now();
    push(r, Object.assign({ from: pl.id }, b.ev || {}));
    return send(res, { ok: true, seq: r.seq });
  }
  if (p === '/room/poll') {
    const r = rooms.get(u.searchParams.get('room')); const token = u.searchParams.get('token');
    const pl = r && r.players.get(token);
    if (!r || !pl) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('room/token tidak valid'); }
    pl.seen = Date.now();
    const after = parseInt(u.searchParams.get('after') || '0', 10);
    const body = () => ({ seq: r.seq, ev: r.ev.filter(e => e.seq > after), you: pl.id, host: r.hostId, list: roster(r) });
    const have = r.ev.filter(e => e.seq > after);
    if (have.length) return send(res, body());
    const w = { res, room: r, after, pollBody: body, done: false };
    waiters.add(w);
    req.on('close', () => { if (!w.done) { w.done = true; waiters.delete(w); } });
    setTimeout(() => wake(w), LONG_POLL_MS).unref?.();
    return;
  }
  if (p === '/rooms') return send(res, { rooms: [...rooms.keys()] });

  /* ---------- static ---------- */
  let file = p === '/' ? '/index.html' : p;
  file = path.normalize(file).replace(/^([.][.][/\\])+/, '');
  const abs = path.join(ROOT, file);
  if (!abs.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(abs, (err, buf) => {
    if (err) {
      // SPA fallback: file hilang → index.html, tapi beri hint jelas utk asset
      if (/\.(png|jpg|jpeg|svg|gif|webp|css|js|json|webmanifest|ico|mp3|ogg|woff2)$/.test(abs)) {
        res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404 ' + file);
      }
      buf = fs.readFileSync(path.join(ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] }); return res.end(buf);
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  HideSeek web demo  →  http://localhost:${PORT}/
  multiplayer relay  →  /room/create · /room/join · /room/poll   (tanpa dependency)
  (untuk main sendiri: buka lalu tekan "MAIN SENDIRI (bots)" — tidak perlu server ini)
`);
});

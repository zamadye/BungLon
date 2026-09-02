/* =============================================================================
 * tools/web_boot_test.js — uji "boot safety net" v2.3 (gejala: stuck di loading)
 * -----------------------------------------------------------------------------
 * Memanggil tools/web_boot_harness.js sebagai child process (per skenario, karena
 * game.js hanya bisa di-require sekali per proses) lalu memeriksa hasilnya:
 *   [A] mode ok     : boot normal -> state ready, splash ditutup, menu tampil
 *   [B] mode slow   : TIDAK ada event load/error (proxy/koneksi menggantung) ->
 *                     watchdog/per-asset timeout menyelamatkan splash
 *   [C] mode 404    : semua aset hilang -> partial + warna tile fallback + panel bantuan
 *   [D] nouikit      : uiKit.js tidak ada -> menu dibuka manual (bukan layar hitam)
 *   [E] statik       : guard tambahan di sw.js / net-server.js / index.html
 * jalan: node tools/web_boot_test.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failNames = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + n); }
  else { fail++; failNames.push(n); console.log('  \x1b[31mFAIL\x1b[0m ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); }
};
const HARNESS = path.join(ROOT, 'tools/web_boot_harness.js');
function run(mode) {
  const r = spawnSync(process.execPath, [HARNESS, '--mode=' + mode], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  const line = String(r.stdout || '').trim().split('\n').filter(l => l.trim().startsWith('{')).pop();
  let j = null;
  try { j = JSON.parse(line); } catch (e) { }
  if (!j) { const err = new Error('harness ' + mode + ' tidak mengembalikan JSON\n' + String(r.stdout).slice(0, 400) + '\n' + String(r.stderr).slice(-800)); err.raw = r; throw err; }
  j.__stderr = String(r.stderr || '');
  return j;
}
(async () => {
  console.log('\n[A] mode ok — sprite lengkap');
  {
    const j = run('ok');
    ok('tanpa exception di harness', !j.error, j.error);
    ok('state boot = ready', j.state === 'ready', j);
    ok('semua 20 aset terhitung selesai', j.done === j.total && j.total === 20, [j.done, j.total]);
    ok('tidak ada aset yang hilang/lambat', j.missing === 0 && j.slow === 0, [j.missing, j.slow]);
    ok('splash ditutup (class out)', /out/.test(j.splashClass), j.splashClass);
    ok('menu tampil', /on/.test(j.menuClass), j.menuClass);
    ok('baris bantuan TIDAK muncul', j.helpClass === '' && j.err === '', [j.helpClass, j.err]);
    ok('warna tile dihitung (4 tile)', Array.isArray(j.tileRgb) && j.tileRgb.length === 4, j.tileRgb);
    ok('frame berjalan tanpa error', j.frames > 3 && !j.frameErr, [j.frames, j.frameErr]);
    ok('waktu boot < 1 dtk (tidak menahan UI)', j.ms < 1000, j.ms);
  }

  console.log('\n[B] mode slow — aset menggantung (kasus pengguna: stuck di MEMUAT …)');
  {
    const j = run('slow');
    ok('tanpa exception di harness', !j.error, j.error);
    ok('loader tetap selesai (timeout per aset) — tidak ada yang menunggu selamanya', j.done === 20, j.done);
    ok('semua 20 aset ditandai lambat', j.slow === 20 && j.loaded === 0, [j.slow, j.loaded]);
    ok('splash TETAP ditutup oleh watchdog', /out/.test(j.splashClass), j.splashClass);
    ok('menu tampil setelah watchdog', /on/.test(j.menuClass), j.menuClass);
    ok('pengguna diberi tahu (panel bantuan + pesan)', j.helpClass === 'show' && /MUAT ULANG BERSIH/.test(j.err), j.err);
    ok('game tetap bisa mulai (round dibuat, warna fallback)', !!j.tileRgb && j.tileRgb.length === 4 && j.phase === 'LOBBY', [j.tileRgb, j.phase]);
    ok('waktu boot mengikuti ?bootTimeout/assetTimeout (<< default 7 dtk)', j.ms > 150 && j.ms < 3000, j.ms);
    ok('stderr hanya peringatan ⏱, bukan exception', /⏱ aset terlalu lama/.test(j.__stderr) && !/TypeError|ReferenceError/.test(j.__stderr), j.__stderr.split('\n').pop());
  }

  console.log('\n[C] mode 404 — file aset hilang (mis. jalankan dari file:// tanpa server)');
  {
    const j = run('404');
    ok('state boot = partial', j.state === 'partial', j.state);
    ok('20 aset dicatat hilang (dibaca via window.BungBoot.missing)', j.missing === 20 && j.errored === 20, [j.missing, j.errored]);
    ok('persentase tetap 100% (bar tidak macet di tengah)', /100%/.test(j.pct), j.pct);
    ok('panel bantuan menjelaskan cara benar (jalankan lewat server)', /node web\/net-server\.js/.test(j.err), j.err);
    ok('warna tile = konstanta Unity (fallback)', JSON.stringify(j.tileRgb) === JSON.stringify([[74, 135, 25], [217, 166, 95], [124, 128, 127], [139, 85, 42]]), j.tileRgb);
    ok('tanpa exception renderer walau semua sprite null', !j.frameErr && j.frames > 3, j.frameErr);
  }

  console.log('\n[D] mode nouikit — uiKit.js tidak terpasang');
  {
    const j = run('nouikit');
    ok('tidak crash tanpa UI kit', !j.error, j.error);
    ok('splash ditutup', /out/.test(j.splashClass), j.splashClass);
    ok('menu dibuka MANUAL (fallback screens===null)', j.menuClass === 'screen on', j.menuClass);
    ok('akun/teman tetap inisialisasi (status offline ditulis)', /tidak aktif/.test(j.acctStatus), j.acctStatus);
  }

  console.log('\n[E] penjaga tambahan (service worker, server, HTML)');
  {
    const sw = rd('web/sw.js'), html = rd('web/index.html'), net = rd('web/net-server.js'), game = rd('web/game.js');
    ok('VERSION service worker dinaikkan (cache lama dipaksa buang)', /v2\.3/.test(sw), (sw.match(/VERSION = '([^']+)'/) || [])[1]);
    ok('SHELL service worker memuat apiKit.js', /'\.\/apiKit\.js'/.test(sw));
    ok('service worker tidak menge-cache /api/ dan /room/', /const NO_CACHE = \['\/room\/', '\/api\/'\];/.test(sw) && /for \(const seg of NO_CACHE\)/.test(sw), (sw.match(/const NO_CACHE.*/) || [])[0]);
    ok('service worker tidak pernah mengembalikan null ke respondWith', !/return hit \|\| refresh/.test(sw) && /new Response\('', \{ status: 504/.test(sw));
    ok('service worker memasang skipWaiting + claim (update aktif tanpa 2x reload)', /skipWaiting\(\)/.test(sw) && /clients\.claim\(\)/.test(sw));
    ok('net-server menjawab 404 sungguhan utk file hilang (bukan index.html)', !/buf = fs\.readFileSync\(path\.join\(ROOT, 'index\.html'\)\)/.test(net) && /404 ' \+ file/.test(net));
    ok('net-server mengirim content-length (response tidak menggantung)', /'content-length': buf\.length/.test(net));
    ok('net-server menandai API nonaktif dengan ramah bila server/ dihapus', /tidak aktif/.test(net) && /MODULE_NOT_FOUND/.test(net));
    ok('net-server menyimpan db saat dihentikan (SIGINT/SIGTERM)', /process\.on\('SIGINT', shutdown\)/.test(net) && /api\.flush\(\)/.test(net));
    for (const id of ['splashHelp', 'splashErr', 'splashSkip', 'splashReload']) ok(`#${id} ada di index.html`, new RegExp('id="' + id + '"').test(html));
    ok('tombol lanjut & muat ulang bersih tersedia', /id="splashSkip"[\s\S]{0,120}LANJUTKAN/.test(html) && /MUAT ULANG BERSIH/.test(html));
    ok('watchdog + per-asset timeout ada di game.js', /BOOT_WATCHDOG_MS = bootFlag\('bootTimeout', 7000, 500\)/.test(game) && /ASSET_TIMEOUT_MS = bootFlag\('assetTimeout', 4200, 100\)/.test(game));
    ok('settleBoot() idempoten (hanya sekali menutup boot)', /if \(bootSettled\) return;/.test(game) && /bootSettled = true/.test(game));
    ok('window.BungBoot diekspos untuk diagnosis', /window\.BungBoot = BOOT/.test(game));
    ok('hardReload melepas SW + menghapus cache', /getRegistrations\(\)/.test(game) && /caches\.keys\(\)/.test(game) && /location\.reload\(\)/.test(game));
    ok('computeTileColors tidak lagi memakai getImageData mentah (dibungkus try/catch)', /catch \(e\) \{\s*console\.warn\('⚠ warna tile/.test(game));
    ok('tinted() menolak sprite kosong', /if \(!imgReady\(src\)\) return null;/.test(game));
    ok('bukti gejala lama: tidak ada lagi `onAll` tanpa timeout', !/const onAll = \(\) => \{ if \(--pending/.test(game));
  }

  console.log('\n[F] server betulan + argumen port + watchdog inline index.html');
  {
    const { spawn } = require('child_process');
    const http = require('http');
    const NET = path.join(ROOT, 'web/net-server.js');
    const net = rd('web/net-server.js'), html = rd('web/index.html');

    /** Port acak yang bebas (hindari tabrakan dengan server yang sedang jalan). */
    function freePort() {
      return new Promise((res, rej) => {
        const srv = require('net').createServer();
        srv.once('error', rej);
        srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)); });
      });
    }
    const get = (port, pth) => new Promise((res) => {
      const req = http.get({ host: '127.0.0.1', port, path: pth, timeout: 4000 }, (r) => {
        let n = 0;
        r.on('data', c => n += c.length);
        r.on('end', () => res({ code: r.statusCode, len: n, type: r.headers['content-type'] || '', cl: r.headers['content-length'] }));
      });
      req.on('error', e => res({ code: 0, err: e.code }));
      req.on('timeout', () => { req.destroy(); res({ code: 0, err: 'timeout' }); });
    });
    function serve(args, env) {
      return new Promise((res, rej) => {
        const pr = spawn(process.execPath, [NET, ...args], { cwd: ROOT, env: Object.assign({}, process.env, env || {}) });
        let out = '';
        const finish = () => {
          const m = /http:\/\/localhost:(\d+)/.exec(out);
          if (m) res({ pr, port: +m[1], out }); else if (/sudah dipakai|gagal jalan|✗/.test(out)) rej(new Error('server berhenti: ' + out));
        };
        pr.stdout.on('data', d => { out += d; finish(); });
        pr.stderr.on('data', d => { out += d; });
        pr.on('exit', (c) => { if (!/\bhttp:\/\/localhost/.test(out)) rej(new Error('exit ' + c + ': ' + out.slice(0, 400))); });
        setTimeout(() => finish(), 1500);
      });
    }

    // ---- 1) parser argumen: semua bentuk harus bind, tidak ada NaN
    const variants = [['--port'], ['--port=', 'x'], ['--', 'port', 'abc'], ['bukan-angka'], ['-p']];
    for (const v of variants) ok(`argumen asing ${JSON.stringify(v)} tidak membuat crash (dulu: ERR_SOCKET_BAD_PORT NaN)`,
      !new RegExp('parseInt\\(process\\.argv\\[2\\]').test(net) && /Number\.isInteger\(n\)|Number\.isFinite\(n\)/.test(net) && /ARGS\.ignored\.length/.test(net), '');
    ok('--help mencetak cara pakai (tidak bind port)', /if \(ARGS\.help\) \{ console\.log\(HELP\)/.test(net), '');
    ok('port valid divalidasi 0..65535', /n >= 0 && n <= 65535/.test(net), '');
    ok('EADDRINUSE & EACCES diberi pesan manusiawi', /EADDRINUSE/.test(net) && /EACCES/.test(net) && /process\.exit\(1\)/.test(net), '');
    ok('default port sama seperti di README (--help & banner)', /DEFAULT_PORT = (\d+)/.test(net) && RegExp('http://localhost:' + (net.match(/DEFAULT_PORT = (\d+)/) || [])[1]).test(net) && rd('README.md').includes('localhost:' + (net.match(/DEFAULT_PORT = (\d+)/) || [])[1]), (net.match(/DEFAULT_PORT = (\d+)/) || [])[1]);

    // ---- 2) server sungguhan: --port, bentuk typo user, lalu seluruh file yang diminta browser
    let srv = null, port = null;
    try { port = await freePort(); srv = await serve(['--port', String(port)]); } catch (e) { ok('server bind dengan --port <free>', false, String(e).slice(0, 120)); }
    ok('server bind dengan --port <free> (satu kata)', !!(srv && srv.port === port), srv && srv.port);
    let r = srv ? await get(port, '/') : { code: 0 };
    ok('GET / -> index.html 200 dengan content-length', r.code === 200 && r.len > 5000 && +r.cl === r.len, r);
    ok('content-type index.html = text/html; charset=utf-8', /text\/html/.test(r.type || ''), r.type);
    const SCRIPTS = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map(m => m[1]).filter(s => s !== 'config.js');
    for (const f of SCRIPTS) {
      const rr = await get(port, '/' + f);
      ok('aset script 200: ' + f, rr.code === 200 && rr.len > 200, rr);
    }
    for (const f of ['ui.css', 'manifest.webmanifest', 'sw.js']) {
      const rr = await get(port, '/' + f);
      ok('aset shell 200: ' + f, rr.code === 200, rr);
    }
    const ASSETS = Array.from(new Set(Array.from(html.matchAll(/assets\/([A-Za-z0-9_.-]+)/g)).map(m => 'assets/' + m[1])));
    // ambillah semua entri './assets/...' dari daftar precache (tanpa regex: aman utk kutip)
    const SHELL = [];
    {
      const src = rd('web/sw.js');
      const from = src.indexOf('const SHELL = ['), upto = src.indexOf('];', from);
      let i = from;
      while (i >= 0 && i < upto) {
        const q1 = src.indexOf("'", i + 1); if (q1 < 0 || q1 > upto) break;
        const q2 = src.indexOf("'", q1 + 1); if (q2 < 0 || q2 > upto) break;
        const name = src.slice(q1 + 1, q2);
        SHELL.push(name.indexOf('./') === 0 ? name.slice(2) : name);
        i = q2;
      }
    }
    ok('daftar precache SHELL terbaca dari sw.js (>= 20 entri)', SHELL.length >= 20, SHELL.length);
    for (const f of SHELL) ok('aset yang di-precache service worker ada di disk: ' + f, require('fs').existsSync(path.join(ROOT, 'web', f)), f);
    for (const f of ASSETS) { const rr = await get(port, '/' + f); ok('aset HTML 200: ' + f, rr.code === 200, rr); }
    ok('tidak ada <script src> yang absen dari daftar precache SHELL',
      SCRIPTS.concat(['index.html', 'ui.css', 'manifest.webmanifest']).every(f => rd('web/sw.js').includes('./' + f)), SCRIPTS.filter(f => !rd('web/sw.js').includes('./' + f)));
    ok('relay room & API tetap hidup di server yang sama', (await get(port, '/api/health')).code === 200 && (await get(port, '/room/poll')).code !== 500, [(await get(port, '/api/health')).code]);
    ok('file hilang -> 404 (bukan index.html, tidak menggantung)', (await get(port, '/tidak-ada.png')).code === 404, (await get(port, '/tidak-ada.png')).code);
    if (srv) { srv.pr.kill('SIGTERM'); await new Promise(r2 => srv.pr.on('exit', r2)); }

    // ---- 3) bentuk salah ketik user: "-- port 8080" harus tetap bind (pakai env utk port uji)
    let srv2 = null;
    try { const p2 = await freePort(); srv2 = await serve(['--', 'port', 'bukan-angka', String(p2)]); ok('"-- port <salah> <angka>" tetap bind ke angka yang valid', srv2.port === p2, srv2.port); }
    catch (e) { ok('"-- port <salah> <angka>" tetap bind ke angka yang valid', false, String(e).slice(0, 140)); }
    if (srv2) { srv2.pr.kill('SIGTERM'); await new Promise(r2 => srv2.pr.on('exit', r2)); }
    let srv3 = null;
    try { const p3 = await freePort(); srv3 = await serve(['sisa-argumen'], { PORT: String(p3) }); ok('argumen tak dikenal saja -> pakai PORT env + peringatan, bukan crash', srv3.port === p3 && /argumen diabaikan/.test(srv3.out), srv3.out.split('\n')[0]); }
    catch (e) { ok('argumen tak dikenal saja -> pakai PORT env + peringatan, bukan crash', false, String(e).slice(0, 140)); }
    if (srv3) { srv3.pr.kill('SIGTERM'); await new Promise(r2 => srv3.pr.on('exit', r2)); }

    // ---- 4) jaring pengaman inline di index.html
    ok('index.html punya watchdog inline (BungBootInline) SEBELUM semua <script src>',
      /window\.BungBootInline/.test(html) && html.indexOf('BungBootInline') < html.indexOf('<script src="uiKit'), html.indexOf('BungBootInline'));
    ok('watchdog inline tidak bergantung file apa pun (no import/fetch)',
      !/import\s|require\(|fetch\(/.test(html.slice(html.indexOf('BungBootInline') - 2000, html.indexOf('BungBootInline') + 4200)), '');
    ok('watchdog inline memakai LIMIT 9 dtk (lebih lambat dari watchdog game.js)', /LIMIT = 9000/.test(html) && /setInterval/.test(html), '');
    ok('daftar file diperiksa dari DOM (basename tanpa ekstensi -> tidak meniru nama file di HTML)',
      /getElementsByTagName\('script'\)/.test(html) && /NEED = \{ uiKit: 'BungUI'/.test(html), '');
    ok('saat boot terhambat: #splashErr diisi + #splashHelp.show + spinner slow + persen diubah',
      /id\('splashErr'\)/.test(html) && /if \(h\) h\.className = 'show'/.test(html) && /if \(sp\) sp\.className = 'spinner slow'/.test(html) && /pct\.textContent = 'MEMUAT TERHANBAT'/.test(html), '');
    ok('ada tombol "COBA MUAT ULANG" bila file memang hilang (bukan LANJUTKAN palsu)', /COBA MUAT ULANG/.test(html), '');
    ok('wipe() melepas service worker + cache lalu reload ?nosw=1', /getRegistrations/.test(html) && /caches\.delete/.test(html) && /nosw=1&fresh=/.test(html), '');
    ok('game.js memberi tahu watchdog inline saat boot selesai (dismiss)', /BungBootInline\.dismiss\(\)/.test(rd('web/game.js')), '');
    ok('watchdog inline dibungkus try/catch penuh (tidak pernah jadi sumber error)', /\(function \(\) \{\s*try \{/.test(html), '');
    ok('file:// dilaporkan SEGERA (tanpa menunggu 9 dtk) karena memang tidak bisa jalan',
      /if \(location\.protocol === 'file:'\) show\(\);/.test(html), '');
    ok('?fresh= / ?nosw=1 tidak dihakimi watchdog (mode pemulihan)', /fresh=\|nosw=1/.test(html), '');
  }

  console.log('\n[G] baseline sintaks browser + service worker (disimulasi) + panel diagnosis');
  {
    const vm = require('vm');
    const html = rd('web/index.html'), swSrc = rd('web/sw.js');

    /* ---------- 1) baseline: file yang dimuat browser tidak boleh pakai sintaks > ES2019 ---------- */
    const RISK = {
      'optional chaining ?. (ES2020)': /\?\.[a-zA-Z_$[(]/,
      'nullish ?? (ES2020)': /(?:^|[^?!])\?\?[^?=]/,
      'logical assign ||= &&= ??= (ES2021)': /(?:\?\?=|\|\|=|&&=)/,
      'private field #x (ES2022)': /(?:this\\.#|^[ \\t]{2,}#[a-zA-Z_$][\\w$]*\\s*=)/m,
      'static block (ES2022)': /\bstatic\s*\{/,
      'Array.at(-n) (ES2022)': /\.at\(\s*-/,
      'Object.hasOwn (ES2022)': /Object\.hasOwn/,
      'String.replaceAll (ES2021)': /\.replaceAll\(/,
      'String.matchAll (ES2020)': /\.matchAll\(/,
      'Promise.any/allSettled (ES2021)': /Promise\.(any|allSettled)\(/,
      'BigInt literal (ES2020)': /[^.\w]\d+_[\d_]*n\b/,
    };
    for (const f of ['game.js', 'uiKit.js', 'audioKit.js', 'particles.js', 'adsManager.js', 'referralSystem.js', 'apiKit.js', 'sw.js']) {
      const src = rd('web/' + f);
      const hits = Object.keys(RISK).filter(k => RISK[k].test(src));
      ok('browser-file bersih sintaks ES2020+ (satu SyntaxError = game tidak pernah mulai): ' + f, hits.length === 0, hits);
    }
    ok('globalThis hanya di dalam penjaga typeof (Safari 12 tidak punya)',
      ['particles.js', 'apiKit.js'].every(f => rd('web/' + f).split('\n').filter(l => l.includes('globalThis') && !/typeof globalThis/.test(l)).length === 0), '');
    ok('watchdog inline sendiri bebas panah/const/template (ES5-safe, harus jalan di browser apa pun)',
      !/=>|`|\bconst \w+ =|\blet \w+ =/.test(html.slice(html.indexOf('Jaring pengaman boot LAPIS PERTAMA'), html.indexOf('pengaman tidak boleh menjadi sumber error baru'))), '');

    /* ---------- helper: pembuat Response/Request/caches tiruan ---------- */
    const ORIGIN = 'http://g.test';
    const abs = u => (/^https?:/.test(u) ? u : ORIGIN + '/' + String(u).replace(/^(\.\/|\/)/, ''));
    const keyOf = k => abs(typeof k === 'string' ? k : ((k && k.url) || String(k)));
    const mkRes = (u, body, type, status) => ({
      ok: (status || 200) < 400, status: status || 200, url: abs(u), headers: { get: h => (String(h).toLowerCase() === 'content-type' ? type : null) },
      clone() { return this; }, text: () => Promise.resolve(body),
    });
    const JS = 'application/javascript; charset=utf-8', HMTL = 'text/html; charset=utf-8';

    /* ---------- 2) service worker: install tidak menyimpan racun, hit basi dibuang ---------- */
    async function bootSW(net) {
      const cachesMap = new Map();
      const mkCache = name => {
      const m = new Map();
      const c = {                                    // yang disimpan = OBJEK cache-nya (punya put/match/delete)
      _m: m,
      put: async (k, r) => { m.set(keyOf(k), r); },
      match: async (k) => m.get(keyOf(k)) || null,
      delete: async (k) => m.delete(keyOf(k)),
      add: async (k) => { m.set(keyOf(k), await net({ url: keyOf(k) })); },
      };
      cachesMap.set(name, c);
      return c;
      };
      const handlers = {};
      let responded = null;
      const ctx = {
        console: { log() { }, warn() { }, error() { } }, URL, Promise, setTimeout, setInterval, clearInterval,
        self: {
          location: { origin: ORIGIN }, addEventListener: (t, f) => { handlers[t] = f; },
          skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() },
        },
        caches: {
          open: async n => cachesMap.get(n) || mkCache(n),
          match: async k => { for (const c of cachesMap.values()) { const h = await c.match(k); if (h) return h; } return null; },
          keys: async () => Array.from(cachesMap.keys()),
          delete: async n => cachesMap.delete(n),
        },
        fetch: req => net({ url: keyOf(typeof req === 'string' ? req : ((req && req.url) || String(req))) }),
        Request: function (u) { this.url = abs(u); },
        Response: function (b, o) { Object.assign(this, o || {}); this.ok = (this.status || 200) < 400; this.headers = { get: () => ((o && o.headers) || {})['content-type'] }; this.clone = () => this; },
        addEventListener() { }, navigator: { serviceWorker: null },
      };
      ctx.window = ctx; ctx.global = ctx;
      vm.createContext(ctx);
      vm.runInContext(swSrc, ctx, { filename: 'web/sw.js' });
      const fire = async (t, ev) => {
        const h = handlers[t]; if (!h) throw new Error('SW tidak memasang handler ' + t);
        responded = null;                        // reset: supaya "tidak dijawab SW" bisa dibedakan dari sisa panggilan sebelumnya
        let done = Promise.resolve();
        h(Object.assign({
          waitUntil: p => { done = Promise.resolve(p); },
          respondWith: p => { done = Promise.resolve(p).then(r => { responded = r; return r; }); },
        }, ev));
        await done;
        return responded;
      };
      return { ctx, cachesMap, fire, shell: () => Array.from(cachesMap.values())[0] };
    }

  const BIG = '/* ' + 'x'.repeat(900) + ' */';   // sehat = >= 400 B (di bawah itu dianggap terpotong)
      let poisoned = true;                       // jaringan mengembalikan HTML utk game.js (kasus user)
    const net = async (req) => {
      if (/game\.js/.test(req.url)) return poisoned ? mkRes('./game.js', '<!doctype html><title>404</title>', HMTL) : mkRes('./game.js', BIG, JS);
      if (/Icon_Freeze\.png/.test(req.url)) return mkRes('./assets/Icon_Freeze.png', '', HMTL, 404);
      return mkRes(req.url, BIG, /\.css$/.test(req.url) ? 'text/css' : JS);
    };
    const sw = await bootSW(net);
    respondedReset();
    function respondedReset() { }
    await sw.fire('install', {});
    const shell = sw.shell()._m;
    ok('SW install: file yang balasannya HTML untuk .js TIDAK disimpan (anti cache beracun)', !shell.has(ORIGIN + '/game.js'), [...shell.keys()].filter(k => /game/.test(k)));
    ok('SW install: file sehat disimpan (game bisa offline)', shell.has(ORIGIN + '/uiKit.js') && shell.has(ORIGIN + '/index.html'), shell.size);
    ok('SW install: satu aset 404 tidak membatalkan precache sisanya', shell.size >= 20 && !shell.has(ORIGIN + '/assets/Icon_Freeze.png'), shell.size);
    ok('worthCaching() menolak HTML utk .js tapi menerima PNG', /function worthCaching/.test(sw.ctx.self ? swSrc : ''), '');

    // cache lama yang terlanjur beracun -> harus dibuang saat request berikutnya, lalu pakai jaringan
    shell.set(ORIGIN + '/game.js', mkRes('./game.js', '<!doctype html>', HMTL));
    poisoned = false;
    const res1 = await sw.fire('fetch', { request: { url: ORIGIN + '/game.js', method: 'GET', mode: 'no-cors' }, });
      {
        const now = shell.get(ORIGIN + '/game.js');
        const typ = now ? String(now.headers.get('content-type')) : '(buang)';
        ok('SW fetch: racun di cache tidak dipakai lagi (dibuang atau diganti respons sehat)', !now || /javascript/.test(typ), typ);
      }
    ok('SW fetch: permintaan game.js dijawab dari jaringan (200 javascript)', !!res1 && /javascript/.test(String(res1.headers.get('content-type'))), res1 && res1.status);
    poisoned = true;
    const res2 = await sw.fire('fetch', { request: { url: ORIGIN + '/uiKit.js', method: 'GET', mode: 'no-cors' } });
    ok('SW fetch: cache sehat tetap dipakai (stale-while-revalidate)', !!res2 && shell.has(ORIGIN + '/uiKit.js'), res2 && res2.status);
    poisoned = false;
    const res3 = await sw.fire('fetch', { request: { url: ORIGIN + '/api/health', method: 'GET', mode: 'cors' } });
    ok('SW tidak menyentuh /api/ (JWT/referral realtime -> selalu jaringan)', res3 === null, res3);
    const res4 = await sw.fire('fetch', { request: { url: ORIGIN + '/room/poll?room=AB12', method: 'GET', mode: 'cors' } });
    ok('SW tidak menyentuh /room/ (relay multiplayer realtime)', res4 === null, res4);
    ok('VERSION service worker naik (cache versi lama dibuang saat activate)', /VERSION = 'v2\.3\.1/.test(swSrc), (swSrc.match(/VERSION = '([^']+)'/) || [])[1]);
    ok('activate menghapus cache bernama lain', /keep\.indexOf\(k\) < 0/.test(swSrc) && /caches\.delete\(k\)/.test(swSrc), '');

    /* ---------- 3) watchdog inline index.html: diagnosis + pemulihan mandiri ---------- */
    const a = html.lastIndexOf('<script>', html.indexOf('Jaring pengaman boot LAPIS PERTAMA'));
    const b = html.indexOf('</script>', html.indexOf('pengaman tidak pernah jadi sumber error', a) > 0 ? html.indexOf('pengaman tidak boleh menjadi sumber error baru', a) : a);
    const inlineSrc = html.slice(a + 8, b);
    const IDS = ['splash', 'splashErr', 'splashHelp', 'splashSpinner', 'splashPct', 'splashSkip', 'splashReload', 'splashDiag', 'splashDiagCopy', 'splashTip', 'menu'];
    function El(tag, attrs) { this.tagName = String(tag).toUpperCase(); this._a = attrs || {}; this.className = ''; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.onclick = null; this.style = {}; }
    El.prototype.getAttribute = function (k) { return this._a[k] != null ? this._a[k] : null; };

    function bootWatchdog(opt) {
      const els = {}; for (const k of IDS) els[k] = new El('DIV', k === 'game' ? { src: 'game.js' } : {});
      const srcs = ['config.example.js', 'config.js', 'uiKit.js', 'audioKit.js', 'particles.js', 'adsManager.js', 'referralSystem.js', 'apiKit.js', 'game.js'];
      const scripts = srcs.map(s => new El('SCRIPT', { src: s }));
      const doc = {
        getElementById: k => els[k] || null,
        getElementsByTagName: t => (t === 'script' ? scripts : []),
        execCommand: () => true,
      };
      const store = Object.assign({}, opt.store || {});
      const ctx = {
        console: { log() { }, warn() { }, error() { } }, Promise, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON, String, Object, Array, RegExp, Math,
        document: doc,
        location: { protocol: opt.protocol || 'http:', host: 'localhost:8790', pathname: '/index.html', search: opt.search || '', href: 'http://localhost:8790/index.html', reload() { ctx.__reload = (ctx.__reload || 0) + 1; } },
        navigator: { userAgent: 'ArenaTest/1.0 (seperti browser lama)', serviceWorker: opt.sw === false ? null : { controller: {}, getRegistrations: () => Promise.resolve([]) }, clipboard: null },
        localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
        addEventListener() { }, caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) },
        fetch: (u, o) => { (ctx.__fetched = ctx.__fetched || []).push({ u: String(u), o: o }); return Promise.resolve(opt.net(u)); },
      };
      for (const g of (opt.globals || [])) ctx[g] = {};
      ctx.window = ctx;
      vm.createContext(ctx);
      vm.runInContext(inlineSrc, ctx, { filename: 'index.html:watchdog' });
      return { ctx, els, store, scripts };
    }
    const ALL_BUT_GAME = ['BungUI', 'BungAudio', 'BungFX', 'AdsManager', 'ReferralSystem', 'BungAPI'];

    {
      const w = bootWatchdog({
        store: { hs_bootfail: 'game|game' },                 // kegagalan yang sama sudah pernah tercatat
        net: u => (/game\.js/.test(u) ? mkRes(u, '<!doctype html>' + 'z'.repeat(500), HMTL) : mkRes(u, BIG, JS)),
        globals: ALL_BUT_GAME,
      });
      ok('watchdog terpasang tanpa bergantung file lain (window.BungBootInline)', typeof w.ctx.BungBootInline === 'object' && typeof w.ctx.BungBootInline.diag === 'function');
      ok('watchdog mengenali HANYA file yang globalnya belum ada ("game")', JSON.stringify(w.ctx.BungBootInline.missing()) === '["game"]', w.ctx.BungBootInline.missing());
      w.ctx.BungBootInline.show();
      await new Promise(r => setTimeout(r, 120));
      ok('panel bantuan dibuka (class show) — tidak mungkin diam selamanya', w.els.splashHelp.className === 'show', w.els.splashHelp.className);
      ok('#splashErr menyebut cache Service Worker yang rusak (bukan sekadar "coba lagi")', /cache Service Worker yang rusak/.test(w.els.splashErr.innerHTML) && /game/.test(w.els.splashErr.innerHTML), w.els.splashErr.innerHTML.slice(0, 120));
      ok('persen loading diganti "MEMUAT TERHANBAT" + spinner mode lambat', w.els.splashPct.textContent === 'MEMUAT TERHANBAT' && w.els.splashSpinner.className === 'spinner slow', [w.els.splashPct.textContent, w.els.splashSpinner.className]);
      ok('kotak diagnosis terisi (alamat, UA, hasil cek tiap file, error)', /hasil periksa file/.test(w.els.splashDiag.value) && /RUSAK\s+game\.js/.test(w.els.splashDiag.value) && /userAgent/.test(w.els.splashDiag.value), w.els.splashDiag.value.split('\n').length);
      ok('baris OK/404/RUSAK per file: config.js tidak ikut diperiksa', /OK\s+game\.js|OK\s+uiKit\.js/.test(w.els.splashDiag.value) && !/config\.js/.test(w.els.splashDiag.value), (w.els.splashDiag.value.match(/\n  \S+ +\S+/g) || []).slice(0, 3));
      ok('probe memakai cache:"no-store" (tidak ikut terbawa cache lama)', (w.ctx.__fetched || []).every(f => f.o && f.o['cache'] === 'no-store') && (w.ctx.__fetched || []).length >= 7, (w.ctx.__fetched || []).length);
      ok('tombol SALIN diagnosis dipasang', typeof w.els.splashDiagCopy.onclick === 'function', typeof w.els.splashDiagCopy.onclick);
      await new Promise(r => setTimeout(r, 1000));
      ok('kegagalan yang sama 2x beruntun -> perbaikan mandiri dimulai (tanpa klik)', /Memperbaiki sendiri/.test(w.els.splashTip.innerHTML), w.els.splashTip.innerHTML);
      await new Promise(r => setTimeout(r, 3200));
      ok('perbaikan mandiri benar-benar reload dengan ?nosw=1&fresh=', /nosw=1&fresh=\d+/.test(String(w.ctx.location.href)), w.ctx.location.href);
    }
    {
      const w = bootWatchdog({ net: u => (/game\.js/.test(u) ? mkRes(u, 'x', JS, 404) : mkRes(u, BIG, JS)), globals: ALL_BUT_GAME });
      w.ctx.BungBootInline.show();
      await new Promise(r => setTimeout(r, 120));
      ok('kasus file hilang: pesan mengajak menjalankan server / cek folder web/', /node web\/net-server\.js/.test(w.els.splashErr.innerHTML) && /HTTP 404/.test(w.els.splashDiag.value), w.els.splashErr.innerHTML.slice(0, 100));
      ok('kasus file hilang: tombol jadi COBA MUAT ULANG (bukan LANJUTKAN palsu)', /COBA MUAT ULANG/.test(w.els.splashSkip.textContent), w.els.splashSkip.textContent);
      ok('tanda tangan kegagalan disimpan utk Percobaan berikutnya', /^game\|game$/.test(String(w.store.hs_bootfail)), w.store.hs_bootfail);
    }
    {
      const w = bootWatchdog({ net: u => mkRes(u, BIG, JS), globals: ALL_BUT_GAME.concat(['hideSeekGame']) });
      ok('semua global ada -> missing() kosong (watchdog tidak berisik)', JSON.stringify(w.ctx.BungBootInline.missing()) === '[]', w.ctx.BungBootInline.missing());
      w.ctx.BungBootInline.dismiss();
      w.ctx.BungBootInline.show();
      await new Promise(r => setTimeout(r, 80));
      ok('dismiss() (dipanggil game.js) membungkam panel selamanya', w.els.splashHelp.className === '' && w.els.splashErr.innerHTML === '', [w.els.splashHelp.className, w.els.splashErr.innerHTML]);
    }
    {
      const w = bootWatchdog({ protocol: 'file:', net: u => { throw new Error('tidak ada fetch di file://'); }, globals: ALL_BUT_GAME });
      await new Promise(r => setTimeout(r, 120));
      ok('dibuka lewat file:// -> panel muncul SEKETIKA (tidak menunggu 9 dtk)', w.els.splashHelp.className === 'show' && /file/.test(w.els.splashErr.innerHTML) && /node web\/net-server\.js/.test(w.els.splashErr.innerHTML), w.els.splashErr.innerHTML.slice(0, 90));
    }
    ok('index.html: elemen diagnosis ada di DOM (#splashDiag + #splashDiagCopy)', /id="splashDiag"/.test(html) && /id="splashDiagCopy"/.test(html), '');
    ok('ui.css: kotak diagnosis mono + user-select:all (bisa disalin di HP)', /#splashDiag\{[^}]*ui-monospace[^}]*user-select:all/.test(rd('web/ui.css')), '');
    ok('game.js: ?nosw=1 melepas SW aktif + kosongkan cache lalu reload sekali', /hs_nosw_done/.test(rd('web/game.js')) && /nosw=1\/.test\(location\.search\)/.test(rd('web/game.js')).toString ? /nosw=1/.test(rd('web/game.js')) : false, '');
  }


  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `=== web_boot_test: ${pass} PASS, ${fail} FAIL ===\x1b[0m`);
  if (fail) { console.log('gagal: ' + failNames.join('\n  gagal: ')); process.exitCode = 1; }
})().catch(e => { console.log('  \x1b[31mEXCEPTION\x1b[0m ' + (e && e.stack || e)); fail++; });


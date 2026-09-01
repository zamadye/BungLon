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
      /location\.protocol === 'file:'/.test(html) && /if \(location\.protocol === 'file:'\) \{ show\(\); \}/.test(html), '');
    ok('?fresh= / ?nosw=1 tidak dihakimi watchdog (mode pemulihan)', /fresh=\|nosw=1/.test(html), '');
  }

  console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `=== web_boot_test: ${pass} PASS, ${fail} FAIL ===\x1b[0m`);
  if (fail) { console.log('gagal: ' + failNames.join('\n  gagal: ')); process.exitCode = 1; }
})().catch(e => { console.log('  \x1b[31mEXCEPTION\x1b[0m ' + (e && e.stack || e)); fail++; });


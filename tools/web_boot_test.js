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

console.log('\n' + (fail ? '\x1b[31m' : '\x1b[32m') + `=== web_boot_test: ${pass} PASS, ${fail} FAIL ===\x1b[0m`);
if (fail) { console.log('gagal: ' + failNames.join('\n  gagal: ')); process.exitCode = 1; }

# Panduan Integrasi — Iklan (AdsManager) + Referral (ReferralSystem)

Versi HTML5/JS **BUNGLON! / HideSeek Online** (`web/`). Vanilla JS, nol dependency,
tanpa build step. Dua sistem di sini berdiri sendiri: boleh dipakai di project HTML5 lain
(Cocos export, Phaser, canvas custom) cukup dengan menyalin 2 file + 4 baris init. Backend opsional (akun/JWT/referral/Game ID) juga nol dependency — lihat **§9**.

| File | Isi |
|---|---|
| `web/adsManager.js` | kelas `AdsManager` — AppLixir (Google Ad Placement API) → AdinPlay → simulasi, cooldown global, persisten di `localStorage` |
| `web/referralSystem.js` | kelas `ReferralSystem` — kode unik, `?ref=`, popup selamat datang, modal undang, counter pengundang |
| `web/config.example.js` | template konfigurasi (`window.HIDESEEK_CONFIG`). **ID iklan tidak pernah ditulis di kode** |
| `tools/gen_web_config.js` | pembangkit `web/config.js` dari `.env` (di-gitignore) |
| `web/apiKit.js` | kelas `ApiClient` (`window.BungAPI`) — klien REST backend akun: JWT, signup/login, sync, referral, Game ID + teman, reward ads, leaderboard |
| `server/api.js` · `server/auth.js` · `server/store.js` | backend Node nol-dependency (di-mount `web/net-server.js` pada `/api/*`) — lihat **§9** |
| `web/game.js` | contoh pemakaian nyata: tombol HUD, koin, +1 nyawa, jeda permainan |
| `web/uiKit.js` | lapisan UI vanilla: `Joystick` (deadzone + sensitivitas), `SkillButton` (cincin cooldown), `Camera2D` (kamera follow+zoom, padanan `Utils/PlayerCamera.cs`), `Screens`, `Fx`, `Viewport`, `Haptics` — tidak dipakai `AdsManager`/`ReferralSystem`, jadi tidak wajib disalin |
| `web/audioKit.js` | SFX + BGM sintesis Web Audio, `duck()` saat iklan (dipanggil game.js, opsional) |
| `web/particles.js` | FX canvas (debu lari, burst kena, sparkle koin, cincin blast/radar); menghormati `prefers-reduced-motion` |
| `web/ui.css`, `web/index.html` | zoning + layar; **id elemen lama dipertahankan** sehingga `#coins`, `#lives`, `#maxhpTag`, `#adLifeBtn`, `#adCoinsBtn`, `#inviteBtn` tetap seperti di §3–§7 |
| `web/assets/UI_HealthFrame.png`, `UI_MinimapFrame.png`, `Icon_Coin.png`, `Icon_Life.png`, `Icon_Freeze.png`, `Bg_Splash.jpg` | aset UI (bingkai HP & minimap, ikon koin/nyawa/bekukan pengganti emoji, latar splash) — ikut di-precache `web/sw.js`; `Icon_Freeze.png` juga ada di `Assets/Art/HideSeek/Icons/` untuk build Unity |
| `Assets/Scripts/UI/Hud/*.cs` | port HUD v2 ke Unity (tema & warna, safe-area, tombol skill + popup aim Prop, damage number, rekor lokal, panel Settings sensitivitas/audio) — dibangun otomatis oleh menu **HideSeek → Setup → 6** |
| `tools/web_ads_referral_test.js` | 130 assertion headless (tanpa browser) |
| `tools/web_dom_smoke.js` | blok `[4]` integrasi iklan/referral, `[5]` UI v2, `[6]` layar hasil (rank/XP/rekor lokal), `[7]` kamera + aim Prop + skill Freeze di DOM tiruan |

---

## 1. Muat script di `<head>` (atau sebelum `game.js`)

```html
<!-- konfigurasi: ID iklan dari .env, TIDAK masuk repo -->
<script src="config.example.js"></script>
<script src="config.js" onerror="/* opsional: node tools/gen_web_config.js */"></script>
<!-- sistem iklan + referral -->
<script src="adsManager.js"></script>
<script src="referralSystem.js"></script>
<!-- opsional: klien backend akun (§9); tanpa file ini game tetap jalan (mode lokal) -->
<script src="apiKit.js"></script>
<script src="game.js"></script>
```

`adsManager.js` dan `referralSystem.js` memasang `window.AdsManager` / `window.ReferralSystem`
(+ `window.createReferralSystem`, `window.resolveAdsConfig`). Kalau project kamu pakai bundler,
file yang sama juga `module.exports` → `require('./adsManager.js')` / `import { AdsManager } from './adsManager.js'`.

> `config.example.js` hanya contoh (semua ID kosong ⇒ mode simulasi). Untuk rilis:
> `cp .env.example .env`, isi ID, `node tools/gen_web_config.js` → menulis `web/config.js`.
> `config.js` boleh absen; `onerror` di atas membuat script opsional itu tidak menimbulkan error.

## 2. Init di `game.init()`

```js
// ---- init ads & referral (lihat integration-guide.md) ----
const ads = new window.AdsManager({
  game: window.hideseekGame,                    // butuh game.pause() / game.resume()
  appLixirPlacement: 'rewarded_video',          // boleh kosong -> simulasi
  adinPlayPlacement: 'rewarded_placement',
  testMode: true                                // dev: selalu jalur simulasi
});
const referral = window.createReferralSystem({
  gameName: 'BUNGLON!',
  baseUrl: location.origin,                     // link => origin + path + '?ref=KODE'
  player: window.hideseekGame.player            // butuh addCoins(n) / addHP(n)
});
referral.checkOnLoad();                         // baca ?ref= SEKALI saat mulai
```

Kontrak object yang dibutuhkan (sudah disediakan `web/game.js` sebagai `window.hideSeekGame`):

```js
window.hideSeekGame = {
  pause() {}, resume() {},                 // dipanggil beforeAd/afterAd, dan selama simulasi
  saveGame() {}, updateUI() {},            // dipanggil tiap reward masuk
  player: {
    get hp() {}, get maxHp() {},
    addHP(n) {},        // "+1 Nyawa":  hp = min(hp + 1, maxHp)
    addCoins(n) {},     // "+50 Koin"
    save() {},
  },
};
```

Tidak ada `window.hideSeekGame`? Tidak masalah — kedua modul tidak wajib punya game;
`game`/`player` boleh `null` (reward hanya di-log, referral ditahan lalu di-flush saat `player` siap).

## 3. Tombol iklan (sudah terpasang di demo)

```html
<button id="adLifeBtn">📺 Tonton Iklan +1 Nyawa</button>
<button id="adCoinsBtn">📺 Dapatkan Koin</button>
<button id="inviteBtn">🎁 Undang Teman</button>
```

```js
$('adLifeBtn').onclick = () => ads.showRewarded('extra_life', () => {
  player.addHP(1); saveGame(); updateUI();
}, err => toast(err));
$('adCoinsBtn').onclick = () => ads.showRewarded('bonus_coins', () => {
  player.addCoins(50); saveGame(); updateUI();
}, err => toast(err));
$('inviteBtn').onclick = () => referral.showInviteModal();
```

`web/game.js` membungkusnya jadi satu `runAd(placement, onReward)` supaya cooldown/busy-guard
cukup ditulis sekali, dan memakai `runAd` yang sama untuk reward internal ronde
(`revive → extra_life`, `skip → skip_cooldown`, `frenzy → frenzy`).

## 4. API AdsManager

| Method | Arti |
|---|---|
| `showRewarded(name, onRewarded, onError)` | pintu utama. `name` = nama reward (`'extra_life'`, `'bonus_coins'`, …) yang dipetakan ke placement. Return `true` bila tayang dimulai; `false` bila busy/cooldown (pesan `Tunggu X detik lagi` lewat `onError` + toast) |
| `showRewardedAppLixir(placementName, onRewarded, onError)` | Ad Placement API: push `{type:'reward', name, beforeAd, afterAd, adViewed, adDismissed, adBreakDone}` ke `window.adsbygoogle` |
| `showRewardedAdinPlay(placementId, onRewarded, onError)` | `window.AdinPlay.rewarded.show(id, {onRewarded,onError,onAdStarted,onAdFinished})` |
| `simulate(label, onRewarded)` | jalur dev: delay `simSeconds` (default 1.5 dtk) → reward + log `📺 [SIMULASI] Iklan reward ditonton!` |
| `cancelSimulation()` / `skipSimulation()` | tombol “lewati”; TIDAK memberi reward |
| `cooldownLeft()` / `markAdShown()` / `resetCooldown()` | cooldown global, key `localStorage['lastAdTime']` |
| `hasAppLixir()` / `hasAdinPlay()` / `isSimulating` | pengecekan runtime |
| `resolvePlacement(name)` | `adUnits[name]` (per reward) → kalau kosong, placement default platform |

**Kapan mode simulasi aktif** (salah satu cukup): `testMode:true`, `appLixirPlacement` dan
`adinPlayPlacement` sama-sama kosong, atau SDK gagal dimuat. Tidak ada error yang bisa muncul
di konsol — cocok untuk pengembangan lokal dan test headless.

**Rantai fallback:** `applixir → adinplay → simulasi`, bisa diubah (`platformOrder`).
Hanya kegagalan “SDK tidak bisa dipakai” (`no-sdk`, `unavailable`, `blocked`) yang melanjutkan ke
platform berikutnya; `dismissed` / `no-fill` / `timeout` = selesai tanpa reward (anti-celah
“tutup iklan → dapat koin”).

## 5. API ReferralSystem

| Method | Arti |
|---|---|
| `getMyReferralCode()` | kode sendiri, 7 karakter `[A-Z0-9]` (tanpa I/O), dibuat otomatis saat pertama main, disimpan di `localStorage['myReferralCode']` |
| `generateReferralCode(len?)` | generator (charset anti-kode yang mirip) |
| `getReferralLink(code?)` | `baseUrl?ref=KODE` |
| `copyReferralLink()` | `navigator.clipboard`, fallback `execCommand`, lalu “salin manual” |
| `checkReferralOnLoad()` / `checkOnLoad()` | baca `?ref=` → simpan `referrerCode` (1×, tak bisa diubah, tolak kode sendiri) → popup “Selamat datang! Kamu diundang oleh kode [X]! Dapatkan +50 Koin & +1 Nyawa!” → beri hadiah (ditahan bila `player` belum ada) |
| `showReferralPopup()` | popup selamat datang (auto-hilang `welcomeSeconds`) |
| `showInviteModal()` | modal: kode besar, link, Salin / Bagikan (`navigator.share`) / Tutup, teks “Dapatkan 100 Koin untuk setiap teman yang bergabung!” |
| `recordIncomingReferral(n?)` | pemanggilan lokal (nanti dari server) → `referralBonus += n`, notifikasi `Kamu berhasil mengundang teman! +100 Koin!` |
| `getReferralBonus()` / `getPendingCoins()` / `getStats()` / `reset()` | stats & debug |

Key `localStorage`: `myReferralCode`, `referrerCode`, `referralClaimed`, `referralBonus`, `referralNotified`.

⚠️ Tanpa backend, kode pengundang hanya tercatat di browser pengundang (tidak bisa diketahui
siapa yang datang). Karena itu bonus pengundang **tidak** langsung menambah koin — hanya counter
+ teks “menunggu server”. Saat backend jadi, panggil `profile.addCoins(coinsForInviter)` dari
endpoint klaim (contoh 1 baris ada di komentar `recordIncomingReferral`).

## 6. Kunci konfigurasi (env / config)

`web/config.js` = hasil `tools/gen_web_config.js` dari `.env`. Semua boleh dikosongkan.

| Env | Config (`window.HIDESEEK_CONFIG.ads`) | Default | Arti |
|---|---|---|---|
| `APPLIXIR_PLACEMENT` | `appLixirPlacement` | `''` | nama placement/slot AppLixir (Google Ad Placement) |
| `ADINPLAY_PLACEMENT` | `adinPlayPlacement` | `''` | `placementId` AdinPlay |
| `APPLIXIR_AD_UNITS` / `AD_UNITS_JSON` | `adUnits` | `{}` | slot per reward: `extra_life:slotA,bonus_coins:slotB` |
| `ADS_TEST_MODE` | `testMode` | `true` | `false` saat rilis (pakai SDK asli) |
| `ADS_COOLDOWN_SECONDS` | `adCooldownSeconds` | `30` | jeda global antar iklan |
| `ADS_SIM_SECONDS` | `simSeconds` | `1.5` | durasi iklan simulasi (sync `AdsManager.simulatedAdSeconds` Unity) |
| `ADS_TIMEOUT_SECONDS` | `adTimeoutSeconds` | `20` | watchdog tanpa callback SDK |
| `ADS_PLATFORM_ORDER` | `platformOrder` | `applixir,adinplay` | urutan percobaan |
| `ADS_COOLDOWN_KEY` | `cooldownKey` | `lastAdTime` | key localStorage |
| `REFERRAL_BASE_URL` | `referral.baseUrl` | `location.origin+pathname` | basis link undangan |
| `REFERRAL_COINS_INVITEE` / `_HP_INVITEE` | `referral.coinsForInvitee` / `hpForInvitee` | `50` / `1` | hadiah yang diundang |
| `REFERRAL_COINS_INVITER` | `referral.coinsForInviter` | `100` | hadiah pengundang (dibayar saat ada server) |
| `REFERRAL_CODE_LENGTH` | `referral.codeLength` | `7` | 6–8 |
| `REFERRAL_WELCOME_SECONDS` | `referral.welcomeSeconds` | `6` | lama popup selamat datang |
| `ECONOMY_COINS_PER_SCORE` | `economy.coinsPerScore` | `0.5` | koin akhir ronde = `round(skor × 0.5)` |
| `ECONOMY_MAXHP_PRICE` / `_CAP` | `economy.maxHpPrice` / `maxHpCap` | `50` / `2` | harga & batas bonus Max HP |
| `ECONOMY_LIFE_PRICE` | `economy.lifePrice` | `25` | harga 1 nyawa cadangan |

Override cepat tanpa config (pakai URL, berguna untuk QA):

```
?adsTest=0&adsAppLixir=ca-pub-XXXX:reward&adsCooldown=5&adsSim=0.5
```

Prioritas: default < `web/config.js` < URL < argumen konstruktor.

## 7. Catatan integrasi SDK asli

**AppLixir (via Google Ad Placement API).** Tambahkan tag Ad Placement di `<head>` *sebelum*
`adsManager.js`, sesuai instruksi dashboard AppLixir/Google, misalnya:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-IDKAMU" crossorigin="anonymous"></script>
```

Setelah `window.adsbygoogle` tersedia dan `APPLIXIR_PLACEMENT` diisi, `showRewardedAppLixir()`
langsung memakainya — tidak ada kode yang perlu diubah. `adViewed` → reward, `adDismissed` →
`onError('dismissed')`. Catatan penting: snippet resmi Google memakai `const adBreak = adConfig = o => …`;
assignment ke variabel bebas melempar `ReferenceError` di `'use strict'`/ES-module, jadi di sini ditulis
`window.adConfig = (o) => window.adsbygoogle.push(o)` — perilaku identik.

**AdinPlay.** SDK HTML5 mereka dibagikan dari dashboard (build per-aplikasi; nama API bisa berbeda
per versi). Yang dibutuhkan `adsManager.js` hanya satu bentuk:

```js
window.AdinPlay = { rewarded: { show(placementId, cb) { /* cb.onRewarded() / cb.onError(e) */ } } };
```

Kalau build kamu memakai nama lain (mis. `AdinPlay.showRewardedAd(placementId)`), cukup sesuaikan
di **satu method** `showRewardedAdinPlay()` — sisa game tidak tahu-menahu. Jangan lupa muat script SDK
mereka dengan `async` dan biarkan `ADS_TEST_MODE=true` selama SDK belum siap: game tetap bisa diuji
(karena kegagalan load = fallback ke simulasi).

**Bedanya dengan versi Unity.** `Assets/Scripts/Monetization/AdsManager.cs` (Unity Ads/AGP) memakai
`HideSeekConstants.AdMinGapSeconds = 12`; versi web memakai `adCooldownSeconds = 30` sesuai spesifikasi
HTML5. Angka kedua sengaja tidak disamakan: jalur rilis Play Store tetap via Unity, `web/` adalah demo
parity + jalur uji. Kalau mau seragam, set `ADS_COOLDOWN_SECONDS=12` di `.env` (atau ubah konstanta C#).

**State yang ditambahkan `web/game.js`** (karena build web belum punya ekonomi): `Profile` di
`localStorage['hideseek_profile']` berisi `coins`, `bonusHp` (Max HP tambahan, dipakai saat
`Round.start()`), `lives` (nyawa cadangan — otomatis terpakai saat kamu jadi hantu), `rounds`, `best`,
`totalAdRewards`, dan `xp` (progres level layar hasil). Reward iklan dan referral masuk ke sini lewat `playerAPI`.

Sejak UI v2.1 ada dua kunci tambahan yang **tidak** berkaitan dengan ekonomi iklan: `localStorage['hideseek_ui']` (preferensi: `haptics`, `sens`, `orient`, `lang`, `lb`) dan `localStorage['hideseek_scores']` (papan skor lokal top-10, `[ {name, score, role, win, ts} ]`). Yang terakhir murni kosmetik — jangan dipakai sebagai dasar pembayaran reward; itu tetap tugas backend (§9).

## 8. Jalankan & uji

UI v2.1 (partikel canvas + guncangan layar, XP/level & peringkat di layar hasil, sensitivitas joystick, papan skor lokal top-10 di `localStorage['hideseek_scores']`) hanyalah lapisan tampilan + progres lokal: **kontrak `AdsManager` dan `ReferralSystem` tidak berubah**, jadi seluruh §1–§7 di dokumen ini tetap berlaku. Level/XP web-only — aturan skor/koin yang diparitas dengan C# tidak disentuh.

UI v2.2 menambahkan tiga hal yang **sengaja dibuat kembar dua sisi** (web + Unity) sehingga tidak bisa berbeda rasa:

| | web | Unity |
| --- | --- | --- |
| kamera `smooth follow`, `zoom out` saat lari / fase SEEK | `uiKit.js` → `BungUI.Camera` (`Camera2D`); dinonaktifkan dengan `?cam=0` | `Utils/PlayerCamera.cs` (`useConstantZoomRatio`, `zoomOutOnRun`, `smoothTime`) |
| aim Prop "tahan → seret → lepas" | `Round.propCandidates()` + `usePropSwap(p, wantName)`; lewat jaringan dikirim sebagai field `pn` di event `in` | `HiderSkill.CastPropSwap(byte propId)` + `GetPropChoices()`; routing `UIManager.UseSkill(slot, propId)`; popup = `HudV2SkillButton` |
| skill Bekukan (Freeze) — Seeker 4 unit → 35 % selama 2,5 dtk, caster terpaku 0,8 dtk, cooldown 14 dtk sendiri | `Round.useFreeze()`, tombol skill ke-3 (`Icon_Freeze`), pintasan `3`, input `skill3` → event `s3` | `HiderSkill.CastFreeze()` → `Net.RaiseAll(EvtFreeze)`; korban: `PlayerController.OnEvent` → `ApplySpeedSlow()`; root: `FreezeForProp(true)` |

Angkanya tinggal satu sumber: `tools/web_selftest.js` membandingkan `CFG.*` (web) dengan
`HideSeekConstants.cs` (Unity) untuk `freezeRadius/freezeTime/freezeSlow/freezeCd/freezeRoot`,
`propAimRadius` ↔ `PropAimPickRadius`, dan `camIdle/camRun/camSeek/camRunSpeed/camSmooth` ↔
`Cam*Zoom/CamRunSpeed/CamSmoothTime`. Port HUD v2 ke Unity memakai `UnityEngine.Text` (bukan TMP)
agar cocok dengan referensi `UIManager` yang sudah ada, dan disimpan di `PlayerPrefs` kunci
`hideseek_ui` / `hideseek_scores_unity` (padanan `localStorage` web — keduanya kosmetik, bukan
dasar pembayaran reward).

```bash
node web/net-server.js            # http://localhost:8790/  → MAIN SENDIRI (bots)
node tools/gen_web_config.js      # opsional, dari .env
node tools/web_selftest.js        # 243 PASS — rules engine 1:1 dengan C# (+ paritas Freeze/aim/HUD v2)
node tools/web_dom_smoke.js       # 143 PASS — browser tiruan + [4] iklan/referral + [5] UI v2 + [6] v2.1 + [7] v2.2
node tools/web_ads_referral_test.js  # 130 PASS — AdsManager + ReferralSystem + Profile
node tools/web_ui_test.js         # 258 PASS — uiKit (+Camera2D), audioKit, particles, XP/level, sensitivitas, LocalScores, PWA
cd web && npm test                # keempatnya sekaligus (774 assertion, 0 FAIL)
```

Verifikasi cepat di browser: buka game → tekan `?solo=1` → klik **📺 Dapatkan Koin** → overlay iklan
1.5 dtk + HUD `50` di pill berikon koin; klik lagi → toast `Tunggu 30 detik lagi`; **🎁 Undang Teman** → kode + link;
buka link itu di tab baru → popup “Selamat datang! … +50 Koin & +1 Nyawa!”. Konsol:
`hideSeekGame.profile`, `hideSeekGame.ads.cfg`, `hideSeekReferral.getStats()`.


---

## 9. Backend akun: JWT, referral, Game ID, teman (`server/api.js` + `web/apiKit.js`)

Dijalankan otomatis oleh `web/net-server.js` pada path `/api/*` (satu origin dengan game dan
relay room → tidak perlu CORS untuk Service Worker). Bisa juga berdiri sendiri:
`node server/api.js --port 3000` (atau `--data-dir <path>`). Backend ini **nol dependency**:
hanya `http`, `crypto`, `fs` bawaan Node; penyimpanan berupa JSON file atomic di
`server/data/` (di-gitignore) yang di-flush saat SIGINT/SIGTERM. **Kalau API mati, game tetap
jalan penuh** — `net-server.js` membalas 404 JSON untuk `/api/*` dan `apiKit.js` mengubahnya
menjadi `{ ok:false, offline:true }`.

### 9.1 Endpoint

| Method + path | Auth | Body / query | Balasan |
|---------------|:----:|--------------|---------|
| `GET  /api/health` | – | – | `{ ok, name, version, users }` |
| `POST /api/signup` | – | `{ name, login, password, ref?, migrate? }` | `201 { token, user, referral }` |
| `POST /api/login` | – | `{ login, password, migrate? }` | `{ token, user, referral }` |
| `GET  /api/me` | Bearer | – | `{ user, referral? }` (memo bayarkan bonus referral tertunda) |
| `POST /api/sync` | Bearer | `{ coins, xp, best, rounds, lives? }` | `{ user }` |
| `GET  /api/referral` | Bearer | – | `{ code, link?, invited, coinsPerFriend }` |
| `POST /api/referral/claim` | Bearer | `{ ref }` | `{ ok, paid, user, referral }` |
| `POST /api/friends/find` | Bearer | `{ gameId }` (ID 7 digit **atau** nama) | `{ found, state, player, reqId? }` |
| `GET  /api/friends` | Bearer | – | `{ friends, incoming, outgoing }` |
| `POST /api/friends/request` · `/respond` · `/remove` | Bearer | `{ gameId }` · `{ reqId, accept }` · `{ uid }` | `{ ok, state, ... }` |
| `POST /api/room` | Bearer | `{ room }` (kosong = keluar) | `{ ok, room }` |
| `POST /api/ads/reward` | Bearer | `{ kind, nonce }` | `{ ok, granted, user, state }` |
| `GET  /api/ads/state` | Bearer | – | `{ state, remaining, nextAt }` |
| `GET  /api/leaderboard` | – | `?limit=15` | `{ rows: [{ rank, uid, name, gameId, level, best, rounds, xp }] }` |

`user = { uid, name, login, gameId, refCode, coins, lives, bonusHp, xp, level, best, rounds,
invited, friends, room, grantedCoins, grantedLives, createdAt, since }`. Rute tak dikenal →
`404 { error, routes }`; semua error memakai format `{ error: "..." }` + status 4xx.

### 9.2 Aturan yang wajib ditaati port lain (mis. Unity)

1. **Token** = JWT HS256 (`JWT_SECRET`; TTL `JWT_TTL_DAYS` hari) dikirim sebagai
   `Authorization: Bearer <token>`; `401` = kedaluwarsa/salah → klien wajib menghapus sesi.
2. **Password** di-hash `scrypt(N=16384, r=8, p=1)` dengan salt per user dan dibandingkan
   `timingSafeEqual`; login dibatasi 6×/menit/IP, signup 12×/menit/IP (`429`).
3. **Server = sumber saldo.** `coins = earned + granted` (`earned` dari laporan main, `granted`
   dari iklan/referral yang dibayar server). Nilai `migrate`/`sync` yang lebih rendah diabaikan
   (monoton naik) sehingga ganti perangkat tidak menghapus progres.
4. **Referral** dibayar hanya saat * kedua akun ada*: claim form (`/api/referral/claim`) atau
   `migrate.ref` saat login → baris `{ from, to, coinsForInviter, coinsForInvitee, bonusHp }`
   dengan `claimedAt` per pihak (anti bayar dua kali). `refClaimed: true` di `migrate` = akun
   lokal sudah pernah menerima bonus manual → server tidak membayar ulang.
5. **Game ID** 7 digit dibuat unik saat signup; `makeRefCode` memakai alfabet tanpa `I/O/0/1`
   sehingga kode referral user selalu lolos `isValidCode()` di `referralSystem.js`.
6. **Rate limit per menit:** find 30/uid, ads 12/uid (+ cooldown `ADS_COOLDOWN_SECONDS` dan
   kuota harian `ADS_DAILY_CAP`).
7. **Nonce iklan** sekali pakai per user (`adclaims.json`) — ganti dengan verifikasi
   SSV/signature AdMob untuk produksi (§7).

### 9.3 Klien

`web/apiKit.js` → `window.BungAPI` / `window.createApiClient(extra)`; instance game ada di
`window.hideSeekAccount`. Metode: `health signup login restore me sync referral claimReferral
findPlayer addFriend friends acceptFriend removeFriend announceRoom adReward adState leaderboard`
+ helper statis `fmtGameId`, `digitsOnly`, `agoLabel`. **Kontrak: tidak ada metode yang melempar
exception** — selalu `{ ok, ... }` (+ `offline: true` saat fetch gagal/timeout `API_TIMEOUT_MS`).
Bila body balasan memuat `user`, klien otomatis `setSession` + memanggil `onChange` (game
mengadopsi `coins/lives/xp/best/rounds` + kode referral server). Port Unity cukup memakai
`UnityWebRequest` ke endpoint yang sama — tanpa SDK.

```js
const acct = window.createApiClient();                       // baseUrl dari HIDESEEK_CONFIG.api
const r = await acct.signup({ name: 'Zam', login: 'zam', password: 'rahasia', ref: 'QQW7RTZ' });
if (r.ok) await acct.sync({ coins: 640, xp: 1800, best: 900, rounds: 12 });
```

Uji regresi: `node tools/server_api_test.js` (menjalakan server betulan di port sementara,
136 assertion termasuk JWT/claim/referral/ads/teman/leaderboard/rate-limit) dan
`node tools/web_boot_test.js` (boot + Service Worker + mount `/api/*`).

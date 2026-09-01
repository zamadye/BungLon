# Panduan Integrasi — Iklan (AdsManager) + Referral (ReferralSystem)

Versi HTML5/JS **BUNGLON! / HideSeek Online** (`web/`). Vanilla JS, nol dependency,
tanpa build step. Dua sistem di sini berdiri sendiri: boleh dipakai di project HTML5 lain
(Cocos export, Phaser, canvas custom) cukup dengan menyalin 2 file + 4 baris init.

| File | Isi |
|---|---|
| `web/adsManager.js` | kelas `AdsManager` — AppLixir (Google Ad Placement API) → AdinPlay → simulasi, cooldown global, persisten di `localStorage` |
| `web/referralSystem.js` | kelas `ReferralSystem` — kode unik, `?ref=`, popup selamat datang, modal undang, counter pengundang |
| `web/config.example.js` | template konfigurasi (`window.HIDESEEK_CONFIG`). **ID iklan tidak pernah ditulis di kode** |
| `tools/gen_web_config.js` | pembangkit `web/config.js` dari `.env` (di-gitignore) |
| `web/game.js` | contoh pemakaian nyata: tombol HUD, koin, +1 nyawa, jeda permainan |
| `tools/web_ads_referral_test.js` | 130 assertion headless (tanpa browser) |
| `tools/web_dom_smoke.js` | blok `[4]` — integrasi iklan/referral di DOM tiruan |

---

## 1. Muat script di `<head>` (atau sebelum `game.js`)

```html
<!-- konfigurasi: ID iklan dari .env, TIDAK masuk repo -->
<script src="config.example.js"></script>
<script src="config.js" onerror="/* opsional: node tools/gen_web_config.js */"></script>
<!-- sistem iklan + referral -->
<script src="adsManager.js"></script>
<script src="referralSystem.js"></script>
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
`totalAdRewards`. Reward iklan dan referral masuk ke sini lewat `playerAPI`.

## 8. Jalankan & uji

```bash
node web/net-server.js            # http://localhost:8790/  → MAIN SENDIRI (bots)
node tools/gen_web_config.js      # opsional, dari .env
node tools/web_selftest.js        # 192 PASS — rules engine 1:1 dengan C#
node tools/web_dom_smoke.js       #  52 PASS — lapisan browser + integrasi iklan/referral
node tools/web_ads_referral_test.js  # 130 PASS — AdsManager + ReferralSystem + Profile
cd web && npm test                # ketiganya sekaligus
```

Verifikasi cepat di browser: buka game → tekan `?solo=1` → klik **📺 Dapatkan Koin** → overlay iklan
1.5 dtk + HUD `🪙 50`; klik lagi → toast `Tunggu 30 detik lagi`; **🎁 Undang Teman** → kode + link;
buka link itu di tab baru → popup “Selamat datang! … +50 Koin & +1 Nyawa!”. Konsol:
`hideSeekGame.profile`, `hideSeekGame.ads.cfg`, `hideSeekReferral.getStats()`.

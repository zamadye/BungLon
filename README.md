# HideSeek Online — Unity 2D Multiplayer (Photon PUN 2)

Game Hide & Seek top-down 2D untuk mobile (Android/iOS), 1 Seeker vs 5–11 Hider,
room 6–12 pemain, otoritas timer di Host. Unity **2022.3 LTS+**, **Photon PUN 2**.

```
Assets/
├── Scripts/
│   ├── Core/       HideSeekConstants.cs  (konstanta + Net helper RaiseEvent)
│   │               HideSeekPrefabs.cs    (nama/path prefab + resolver Resources)
│   │               PlayerRegistry.cs     (daftar pemain aktif di scene)
│   ├── Network/    NetworkManager.cs     (1. connect, create/join room, callback PUN2)
│   ├── Game/       GameManager.cs        (2. state machine, timer, authority, RPC state)
│   ├── Players/    PlayerController.cs   (3. input, movement, OnPhotonSerializeView)
│   │               PlayerCombat.cs       (4. HP, damage, pushback, catch detection)
│   ├── Skills/     HiderSkill.cs         (5. Match Color & Prop Swap, CD 10s)
│   │               SeekerSkill.cs        (6. Radar & Sonic Blast, CD 8s)
│   │               PropDatabase.cs       (9. ScriptableObject daftar prop)
│   ├── UI/         UIManager.cs          (7. timer, HP, cooldown, leaderboard, result)
│   │               RoomListUI.cs         (10. daftar room + tombol join)
│   │               RoomListEntryUI.cs    (baris room)
│   │               MobileJoystick.cs     (joystick virtual)
│   │               LeaderboardRow.cs     (baris leaderboard)
│   │   └── Hud/    HudV2Theme.cs · HudSafeArea.cs · HudV2SkillButton.cs · HudV2DamageText.cs ·
│   │               HudV2LocalBoard.cs · HudV2Settings.cs   (HUD v2 - dibuat lewat Setup → 6)
│   ├── Utils/      CamouflageHelper.cs   (8. rata-rata warna di bawah raycast 2D)
│   │               PlayerVisual.cs       (helper SpriteRenderer / alpha / flip)
│   │               MinimapRadarView.cs   (minimap + lingkaran radar)
│   │               SonicBlastEffect.cs   (ring blast)
│   │               PlayerCamera.cs       (kamera ortho, ikut Seeker saat jadi hantu)
│   ├── Monetization/ AdsManager.cs       (rewarded ad Unity Ads + fallback simulasi)
│   │               RewardOffers.cs      (3 penawaran reward + kuota per ronde)
│   └── Editor/     HideSeekSetupTool.cs  (menu setup otomatis 1-6 — hanya Editor, tidak ikut build)
│                 HideSeekArtInstaller.cs (Setup → 5: pasang PNG art AI ke prefab/UI)
│                 HideSeekTextureImporter.cs (import rule: Read/Write utk tile, PPU 128)
├── Prefabs/        PlayerNetworked, Props (Meja/Kursi/Pot), SonicBlastRing
├── UI/             Canvas HUD + Lobby (hasil menu setup / manual)
├── Art/HideSeek/   19 sprite + background + app icon hasil generate AI (lihat Art/prompts.md)
└── Resources/HideSeek/   fallback prefab agar project langsung bisa di-playtest

web/                BUILD TANPA UNITY (bagian 10): index.html + game.js + net-server.js + assets/
tools/              web_selftest.js (243: paritas CFG↔C# + rules), web_dom_smoke.js (143), web_ui_test.js (258),
                    web_ads_referral_test.js (130), web_map_preview.py
Tools/hideseek_art_postprocess.py   (keying/segmentasi/resize PNG art, hanya pillow)
```

---

## 0) Cara TERCEPAT menjalankan (3 menit)

1. Buat project Unity **2022.3 LTS** (2D Template).
2. Import **Photon PUN 2** dari Asset Store (`Photon Unity Networking 2`, v2.45+).
   - Saat diminta *Enable WebSockets for WebGL* → boleh **No** (target Android/iOS).
   - PUN2 membuat folder `Assets/Photon/...` (sudah di-`.gitignore`).
3. Copy folder `Assets/Scripts`, `Assets/Prefabs`, `Assets/UI`, `Assets/Resources` ke project.
4. Menu Unity: **HideSeek → Setup → 1. Generate Placeholder Assets**
   - sprite, `Prop_0..2.prefab`, `PropDatabase.asset`, `SonicBlastRing.prefab`,
     `MapPlaceholder.prefab` → `Assets/Resources/HideSeek/`
   - **`PlayerNetworked.prefab` → `Assets/Resources/` (ROOT!)** + salinan di `Assets/Prefabs/`.
     `PhotonNetwork.Instantiate("PlayerNetworked")` hanya membaca root folder Resources,
     sub-folder **tidak** terbaca (`Resources.Load(name)`), jadi file ini tidak boleh ditaruh
     di `Resources/HideSeek/`.
5. Menu Unity: **HideSeek → Setup → 2. Set Layer 6 = Ground**.
6. Menu Unity: **HideSeek → Setup → 3. Build Demo Scene (current scene)** → semua objek
   + referensi UI otomatis ter-wire di scene yang sedang dibuka.
7. Cara paling cepat (rekomendasi): **HideSeek → Setup → 4. Buat Scene Lobby + Game + Build Settings**.
   Menu ini membuat `Assets/Scenes/Lobby.unity` + `Assets/Scenes/Game.unity`, mengisi keduanya
   (NetworkManager/GameManager/Canvas/EventSystem/kamera), menyetel `lobbySceneName="Lobby"`,
   `gameSceneName="Game"`, `loadGameSceneOnStart` (hanya di Lobby), dan mendaftarkan kedua scene
   ke **Build Settings** otomatis. Setelah ini tinggal isi App ID → Play.
7b. (opsional) Punya aset AI? Taruh PNG di `Assets/Art/HideSeek/**` lalu
   **HideSeek → Setup → 5. Pasang Art AI** → sprite karakter/prop/tile/ikon/background ikut
   terpasang ke prefab + Canvas otomatis. Detail pipeline: `Assets/Art/prompts.md`.
7c. (opsional, Phase 2 blueprint) **HideSeek → Setup → 6. Bangun HUD v2** → zona TL/TC/TR/ML/BR
   + safe-area + 3 tombol skill ber-ring cooldown (slot ke-3 = Bekukan, khusus Hider) + panel
   Settings. Referensi `UIManager` diisi otomatis; ikon per role dipasang oleh langkah 7b.
   Detail: bagian *UI/UX v2.2*.
8. Isi App ID (lihat langkah 1 di bawah), lalu **Play** di scene **Lobby**. Tekan `N` = buat room,
   `J` = quick play, `Space` = Start (host). Test sendirian: centang **`offlineMode`** di
   `NetworkManager` (nama field-nya begitu, bukan `testOfflineMode`) — di mode offline minimal
   pemain otomatis jadi 1 (lihat `GameManager.allowSoloStart`).

> Tanpa menu setup pun project tetap compile; hanya field Inspector yang kosong.

> **Tidak punya Unity sekarang?** Ada build web (HTML5 canvas) yang memakai aturan & sprite yang
> sama: `node web/net-server.js` → buka `http://localhost:8790` → **MAIN SENDIRI (bots)**.
> Detail + cara uji: **bagian 10**. Build web = demo/prototipe; rilis Play Store tetap lewat Unity.
> Test otomatis: `node tools/web_selftest.js` (243 assertion: konstanta C# == aturan web) · `npm test` di `web/` menjalankan 4 suite (774 assertion, 0 FAIL).

---

## 1) Setup Photon PUN 2 (App ID)

1. Daftar di [dashboard.photonengine.com](https://dashboard.photonengine.com) →
   **Realtime** → salin **App ID** (Free tier = 20 CCU).
2. Di Unity: **Window → Photon → Photon Unity Networking → Highlight Settings**
   (atau pilih aset `Assets/Photon/PhotonUnityNetworking/Resources/PhotonServerSettings.asset`).
3. Isi field **App ID Realtime**. Sekalian atur:
   - **Region**: kosongkan = PUN otomatis memilih *Best Region*. Untuk game ini **disarankan diisi
     `asia`** (field *Fixed Region* di `PhotonServerSettings`) supaya semua pemain Indonesia masuk
     region yang sama — room yang dibuat di `asia` tidak akan terlihat oleh klien yang connect ke
     `jp`/`eu`. Setelah mengubah, tekan tombol **Reset** di PhotonServerSettings agar
     "best region preference" lama dibuang.
   - **App Version**: samakan dengan `HideSeekConstants.GameVersion` (`1.0.0`).
     Player dengan App Version berbeda tidak akan ketemu di matchmaking.
   - **Protocol**: `WebRPC`/UDP default (UDP = `Native` = paling hemat; WebSocket hanya perlu untuk WebGL).
4. Alternatif dari kode: isi `HideSeekConstants.PhotonAppId` (lihat komentar di file itu).
5. Untuk pengujian tanpa server: centang **Offline Mode** di `NetworkManager`
   (Multiplayer Editor window: *Edit → Play* 2x).

---

## 2) Scene & GameObject wajib

| Objek | Komponen | Catatan |
|---|---|---|
| `NetworkManager` | `NetworkManager` | Satu per scene (atau DontDestroyOnLoad). Assign `playerPrefab`, `spawnPoints`, `lobbySceneName`, `gameSceneName`. |
| `HideSeek_GameRoot` | `GameManager` | Otomatis dibuat oleh `NetworkManager` saat masuk room. Boleh dibuat manual agar bisa di-tuning di Inspector. |
| `Main Camera` | `Camera` + `PlayerCamera` | Camera orthographic; `PlayerCamera` mengikuti pemain lokal, dan otomatis pindah mengikuti Seeker saat pemain jadi hantu. |
| `Map` | Tilemap/SpriteRenderer + `Collider2D` di **layer Ground (6)** | Wajib, supaya `CamouflageHelper` bisa sampling warna & dinding menahan pushback. |
| `EventSystem` | `EventSystem` + `StandaloneInputModule` | Wajib untuk joystick/tombol/tap UI. |
| `Canvas` | `Canvas`, `CanvasScaler`, `GraphicRaycaster`, `UIManager`, `RoomListUI` | Lihat bagian 4. |

**Physics2D**: `Edit → Project Settings → Physics 2D → Gravity = (0, 0)`.
`PlayerController` mendukung **dua** mode Rigidbody2D:
- **Dynamic** (default Setup Tool) → ditulis lewat `body.velocity`, Collision Detection `Continuous`.
- **Kinematic** → ditulis lewat `body.MovePosition()` (velocity di Kinematic memang diabaikan Unity,
  jadi kalau checklist kamu memakai Kinematic, gerakan tetap sinkron — tidak perlu diganti).
`Awake()` `PlayerController` juga memaksa `gravityScale = 0` + `freezeRotation = true`, jadi
karakter tidak akan jatuh/berputar walau lupa disetel di prefab.
`[RequireComponent]` di `PlayerController/PlayerCombat/HiderSkill/SeekerSkill` membuat
`PhotonView`, `Rigidbody2D`, `PlayerVisual`, `CamouflageHelper` otomatis ikut ditambahkan saat
script di-drag ke GameObject.

**Layers**: `Ground` = layer 6 (dipakai raycast camo & pushback), pemain di layer `Default`
(`PlayerController.hiderLayerMask` untuk tap-to-catch).

---

## 3) Membuat prefab Player (manual)

1. `GameObject 2D Object → Sprite` → nama **`PlayerNetworked`** (nama file prefab harus sama di
   semua klien, karena `PhotonNetwork.Instantiate()` cocokkan lewat **nama**).
2. Tambahkan ke root:
   - `Rigidbody2D` — Body Type **Dynamic**, Gravity Scale **0**, Constraints **Freeze Rotation Z**,
     Collision Detection **Continuous**.
   - `BoxCollider2D` — size ~`(0.8, 0.8)`, **isTrigger = false** (badan fisik).
   - `BoxCollider2D` kedua — size ~`(1.15, 1.15)`, **isTrigger = true** (untuk damage "disentuh").
   - `PhotonView`.
   - Script: `PlayerController`, `PlayerCombat`, `HiderSkill`, `SeekerSkill`, `CamouflageHelper`, `PlayerVisual`.
3. Child `Visual` berisi `SpriteRenderer` (body sprite). Assign `PlayerVisual.root = Visual`,
   `PlayerController.visual = PlayerVisual`, `PlayerCombat.visual/bodyCollider`,
   `PlayerController.body = Rigidbody2D`, `HiderSkill.camouflage = CamouflageHelper`,
   `HiderSkill.props = PropDatabase`, `SeekerSkill.minimap = MinimapRadarView` (opsional),
   `PlayerController.joystick = MobileJoystick` (atau biarkan kosong → diambil dari `UIManager`).
4. **PENTING** — `PhotonView` → *Observed Components*: `Element 0 = PlayerController`,
   `Element 1 = PlayerCombat`. Tanpa ini `OnPhotonSerializeView()` tidak pernah dipanggil
   (posisi tidak sinkron).
5. Simpan prefab ke **`Assets/Resources/PlayerNetworked.prefab` (root Resources — wajib untuk
   Photon)** dan, bila suka rapi, salinan di `Assets/Prefabs/PlayerNetworked.prefab` untuk di-assign
   ke `NetworkManager.playerPrefab`. Nama file = nama yang dipakai `PhotonNetwork.Instantiate()`,
   jadi harus sama persis di semua klien/build. Nama `Player.prefab` juga diterima (alias), asal
   tetap berada di root `Assets/Resources/`.

Prop (Meja/Kursi/Pot) di `Assets/Prefabs/Props/`: `SpriteRenderer` + `BoxCollider2D` di layer
`Ground`, nama `Prop_0`, `Prop_1`, `Prop_2`, lalu assign ke **PropDatabase** (`id` 0/1/2 = ID yang
dikirim lewat network, **harus identik di semua build**).

---

## 4) Assign UI (semua via Inspector, tidak ada yang wajib)

Di komponen **`UIManager`** pada Canvas:

| Field | Isi |
|---|---|
| `lobbyPanel / hudPanel / resultPanel / countdownOverlay / minimapRoot` | GameObject panel masing-masing |
| `phaseText / timerText / roleText / playersText / countdownText / connectionText / phaseHintText` | `Text` (uGUI bawaan; TMP tidak dipakai agar minim dependency) |
| `hpBar` | `Image` dengan **Image Type = Filled, Method = Horizontal** |
| `hearts` | array 3 `Image` (alpha diatur otomatis: hidup = 1, habis = 0.18) |
| `skills[0..1]` | per slot: `button`, `cooldownFill` (**Image Type = Filled, Method = Radial**), `cooldownText`, `hiderLabel`, `seekerLabel` |
| `joystick` | objek dengan `MobileJoystick` (background + handle) |
| `minimap` | objek dengan `MinimapRadarView` |
| `toastRoot / toastText` | panel toast |
| `resultTitleText / resultDetailText / leaderboardRoot / leaderboardRowPrefab` | panel hasil + baris leaderboard |
| `startButton / leaveButton / nextRoundButton / quickPlayButton / createRoomButton / refreshRoomsButton` | tombol; `autoWireButtons` dicentang bila tombol **belum** di-wire manual |

Di komponen **`RoomListUI`**: `contentParent` (RectTransform + `VerticalLayoutGroup` +
`ContentSizeFitter`), `entryPrefab` (prefab dengan `RoomListEntryUI`, isi `roomNameText`,
`playersText`, `mapText`, `statusText`, `joinButton`), `emptyText`, `headerText`, `roomNameInput`,
`privateToggle`, `createButton`, `refreshButton`, `quickJoinButton`, `joinByCodeButton`.

Di **`MinimapRadarView`**: isi `worldBounds` = Rect batas peta (mis. `x=-10, y=-7, w=20, h=14`).

---

## 5) Cara main / aturan yang diimplementasikan

- **State**: `LOBBY → COUNTDOWN(5s) → HIDE(30s) → SEEK(60s) → RESULT(10s) → COUNTDOWN`.
  HANYA Host yang menjalankan timer & memutuskan transisi; hasil transisi ditulis ke
  room custom property (late joiner otomatis sinkron) dan disiarkan lewat
  `[PunRPC] RpcHostState` di view pemain Host (fallback: `RaiseEvent` reliable).
- **Role**: saat ronde mulai, Host mengacak 1 pemain menjadi Seeker, sisanya Hider
  (1 orang saja = Hider, agar bisa test skill). Tiap klien menulis custom property
  `role` miliknya sendiri (pola resmi PUN2).
- **Hider**: gerak bebas di fase HIDE & SEEK; Seeker **dikunci** saat fase HIDE.
  - Skill 1 *Kamuflase*: rata-rata warna ground di bawah kaki (`Physics2D` raycast ke bawah)
    → warna sprite di-lerp ke warna itu, di-broadcast agar Seeker melihat hasil yang sama.
  - Skill 2 *Prop Swap*: instantiate prop acak dari `PropDatabase` selama 8 detik;
    **ada input gerak = efek batal** (RPC dikirim supaya semua klien konsisten).
  - Kena Seeker: `-1 HP` + terlempar 3 m (grace period 0.6 s). HP 0 → jadi hantu:
    sprite alpha 0.3, collider mati, movement & skill dikunci.
- **Seeker**: kecepatan `+15%`; tap/klik pada Hider dalam jarak ≤ 3 unit untuk menangkap
  (sentuhan badan juga menghitung, interval 0.8 s).
  - Skill 1 *Radar*: lingkaran merah 1 detik di minimap untuk 1 Hider terdekat
    (info tidak dibagikan ke klien lain = keunggulan Seeker).
  - Skill 2 *Sonic Blast*: ring radius 5 unit; semua Hider di radius kena
    **slow 50% selama 2 detik**.
- **Menang**: Hider menang jika waktu SEEK habis dan masih ada Hider hidup (pemenang = Hider
  terakhir yang bertahan, ditampilkan di panel result). Seeker menang jika semua Hider tertangkap.
- Late join saat ronde berjalan → otomatis jadi **penonton** (kamera mengikuti Seeker).
- **Rewarded ad** (opsional, lihat bagian 8): Hider yang jadi hantu bisa *Hidup lagi*
  (1x/ronde, disahkan Host), *Skip cooldown* skill (2x/ronde), dan Seeker bisa mengambil
  *Frenzy 10 s* = +25% kecepatan + jangkauan tangkap +1.5 m (2x/ronde). Tidak ada hadiah
  yang otomatis aktif - semua harus lewat tombol di HUD.

---

## 6) Catatan jaringan (kenapa begini)

| Kebutuhan | Implementasi |
|---|---|
| Sinkron posisi/rotasi | `PlayerController.OnPhotonSerializeView` (posisi, velocity, flip). Receiver pakai lerp + ekstrapolasi (`interpolationSpeed`, `extrapolation`). |
| Event penting (skill, tangkapan, kematian, state) | `[PunRPC]` pada view pemilik objek: `RpcHostState`, `RpcHitRequest`, `RpcApplyDamage`, `RpcBecomeGhost`, `RpcSetCamo`, `RpcPropSwap`, `RpcPropEnd`, `RpcBlast`. |
| Authority | `GameManager` + `NetworkManager.IsAuthority` (= `PhotonNetwork.IsMasterClient`, override untuk test). `OnMasterClientSwitched` → timer diambil alih host baru. |
| Efisiensi | Cooldown/minimap/state-tick memakai `RaiseEvent` + `RaiseEventOptions`/`SendOptions` (`Net.RaiseAll/RaiseOthers/RaiseMaster`), frekuensi tinggi = `Reliability = false`; `MinSendRateMs` 50 ms; property lobby yang dikirim hanya `Map/Live/Private`. |
| Host transfer aman | Tidak ada objek "global" ber-PhotonView: logika state di-hosting lewat view pemain Host, dan tiap klien menulis custom property miliknya sendiri. |

Tuning bandwidth: kurangi `TimerBroadcastInterval` (0.25 s), `interpolationSpeed`, atau
jumlah `spawnPoints`. Semua ada di `HideSeekConstants.cs` + Inspector.

---

## 7) Build ke Android/iOS

1. `Assets/Scenes/Lobby.unity` dan `Game.unity` → **Add Open Scenes** (WAJIB;
   `PhotonNetwork.LoadLevel` & `AutomaticallySyncScene` butuh scene ada di build list).
2. `Player Settings`: IL2CPP, ARM64, Scripting Backend default sudah cocok untuk PUN2.
3. Testing 2 perangkat harus berada di **App ID + Region + App Version** yang sama.
4. Bila App ID salah/kosong, `NetworkManager` akan log `OnDisconnected/OnCustomAuthenticationFailed`
   dan status di HUD (`connectionText`) tetap menampilkan state koneksi.

---

## 8) Monetisasi: rewarded ad (Unity Ads)

Sudah ada di kode, **tanpa package pun project tetap compile** dan alurnya bisa dites.

### Yang dibuat
| File | Isi |
|---|---|
| `Assets/Scripts/Monetization/AdsManager.cs` | wrapper SDK (build web punya padanannya sendiri: `web/adsManager.js`, lihat §10 & `integration-guide.md`): init, `IsReady`, `ShowRewarded(callback)`, jeda antar iklan, `AudioListener.pause`, mode **simulasi** saat SDK belum ada |
| `Assets/Scripts/Monetization/RewardOffers.cs` | menentukan penawaran reward, kuota per ronde, dan mengeksekusi hadiahnya |
| `UIManager.rewardButton/rewardLabel/rewardQuotaText` | tombol HUD (dibuat otomatis oleh Setup ▸ 3), label & kuota disinkron ~5x/detik |
| `PlayerController.ApplySpeedBoost`, `HiderSkill.SkipCooldown`, `PlayerCombat.RpcRevived` | sisi gameplay dari tiap hadiah |

### Tiga penawaran (semuanya dibatasi per ronde)
| Role | Reward | Kuota/ronde | Efek |
|---|---|---|---|
| Hider (jadi hantu) | **Hidup lagi** | `MaxRevivesPerRound` = 1 | +1 HP, kebal `ReviveSafeWindow` 1.6 s, **disahkan Host** (`EvtRewardRevive` → `PlayerCombat.RpcRevived`) |
| Hider / Seeker | **Skip cooldown** | 2 | cooldown skill lokal direset + diumumkan ke room (`Net.SyncCooldown`) |
| Seeker | **Frenzy 10 s** | 2 | +25% kecepatan & +1.5 m jangkauan tangkap (`FrenzySpeedMultiplier`, `FrenzyCatchRangeBonus`) |

Aturan main: hanya **1 offer aktif** yang ditampilkan (prioritas revive → skip → frenzy);
reward hanya diberikan bila callback SDK `ShowResult.Finished`; ada jeda minimum
`HideSeekConstants.AdMinGapSeconds` antar request supaya SDK tidak menolak.

### Mengaktifkan SDK
1. `Window → Package Manager → Unity Registry → **Unity Ads**` (4.4.x) install, atau
   `Edit → Project Settings → Services → Monetization` (aktifkan Unity Services).
2. Dashboard Unity Ads → buat **game ID** (Android & iOS) → catat placement rewarded
   (default `rewardedVideo`).
3. `HideSeek_GameRoot` → komponen **AdsManager**: isi `androidGameId`, `iosGameId`,
   `rewardedPlacement`, `testMode = true`, lalu **`simulateAds = false`**.
4. `Player Settings → Scripting Define Symbols`: tambahkan `UNITY_ADS_V4`
   (untuk Ads 4.x/5.x). Package 3.x tidak perlu tambahan — kode memakai
   `ShowOptions.resultCallback`; 4.x memakai `ShowOptions.ResultCallback` + `RewardedAd`.
   Bila API versi yang kamu pakai berbeda, compiler hanya akan menandai di blok
   `#if UNITY_ADS` — mode simulasi tetap utuh.
5. Android: `Assets/Plugins/Android/AndroidManifest.xml` tambahkan
   `<uses-permission android:name="com.google.android.gms.permission.AD_ID"/>`;
   iOS: isi `SKAdNetworkItems` dari dashboard Unity Ads.

### Test & kontrol jarak jauh
- **Sebelum ada SDK**: `simulateAds = true` → tombol muncul, reward diberikan setelah
  `simulatedAdSeconds` (1.5 s). Cocok untuk menyeimbangkan kuota & UI.
- **Setelah SDK**: nyalakan `testMode` di AdsManager **dan** di dashboard; jangan pernah
  klik iklan sendiri pada build non-test (akun bisa disuspend).
- **Kill switch tanpa build ulang**: `AdsManager.enableAds = false` (sembunyikan total) atau
  `RewardOffers.offersEnabled = false` (gameplay jalan terus, tanpa tombol). Bisa juga
  diambil dari Remote Config / flag server.
- Data Safety Google Play: Unity Ads mengirim Advertising ID → wajib dideklarasikan
  di form *Data safety*. Bila target audiens mencakup anak < 13 th, nonaktifkan
  penawaran reward (`offersEnabled=false`) atau set `maxRevivesPerRound=0`.

### Catatan anti-cheat
Revive (satu-satunya reward yang mengubah state pemain lain) divalidasi Host:
`photonEvent.Sender == actor`, `Role == Hider`, `Combat.IsDead`, ronde berjalan, kuota belum
habis. Skip-cooldown & Frenzy murni memengaruhi klien pemiliknya sendiri — sama seperti PUN
yang hanya mengizinkan **owner** `PhotonView` mengirim state miliknya — jadi tidak perlu
tambahan validasi otoritas.

---

## 9) Troubleshooting

| Gejala | Penyebab umum |
|---|---|
| Pemain diam di tempat saat Remote | `PhotonView.observed` kosong → tambahkan `PlayerController` (+ `PlayerCombat`). |
| Semua jatuh ke `LOBBY` saat Start | `NetworkManager.playerPrefab` kosong → jalankan menu Setup 1, atau assign prefab. |
| `JoinRandomRoom` selalu gagal | App ID salah / region beda / room penuh. `NetworkManager` otomatis **membuat room baru** bila `OnJoinRandomFailed`. |
| Skill Match Color selalu abu-abu | Tekstur ground belum **Read/Write Enabled** atau tile tidak di layer `Ground` / tidak punya `Collider2D`. |
| Prop tidak muncul | `PropDatabase.id` tidak ada prefabnya → lihat log `Prefab prop tidak ditemukan (id=…)`. |
| Tombol iklan tidak pernah muncul | `AdsManager.simulateAds=true` + `RewardOffers.offersEnabled=true`; ronde harus sedang berjalan (`IsRoundRunning`) dan kuota ronde ini belum habis. Cek log `[HideSeek/Reward]`. |
| Reward diberikan padahal iklan ditutup | hanya `ShowResult.Finished` yang memberi reward — bila terjadi, berarti masih **mode simulasi** (SDK belum aktif) atau `rewardedPlacement` salah. |
| Tidak ada daftar room | Centang `joinLobbyAfterConnect` di `NetworkManager` (mengirim `PhotonNetwork.JoinLobby` setelah connect); atau tekan tombol REFRESH (re-join typed lobby `hideseek`). Pastikan **App ID benar** dan room dibuat di typed lobby yang sama. |
| UI tidak merespons sentuhan | `EventSystem` tidak ada di scene, atau `GraphicRaycaster` hilang dari Canvas. |
| Tap untuk menangkap tidak jalan | `hiderLayerMask` tidak mencakup layer pemain, atau `EventSystem.IsPointerOverGameObject` menahan input (tombol terlalu besar). |
| `DefaultPool failed to load "PlayerNetworked". Make sure it's in a "Resources" folder` | Prefab pemain ada di **sub-folder** Resources (`Resources/HideSeek/`). Pindahkan ke **`Assets/Resources/PlayerNetworked.prefab`** (root) — `PhotonNetwork.Instantiate()` memakai `Resources.Load(namaFile)`. |
| Klik Start muncul "Butuh minimal 2 pemain" | Wajar saat online. Untuk test sendirian: centang `offlineMode` di `NetworkManager`, atau centang `allowSoloStart` di `GameManager`. |
| Tombol skill tidak muncul / hilang | `UIManager.skills` isinya **2 elemen** (bukan 4): slot 0 = Kamuflase/Radar, slot 1 = Prop Swap/Sonic Blast. Tiap elemen punya `hiderLabel` & `seekerLabel` sendiri, label otomatis berganti sesuai role. `cooldownFill` harus `Image` dengan **Image Type = Filled, Fill Method = Radial**. |
| Player diam saat dijalankan dari prefab manual | `PhotonView.observed` belum terisi (isi `PlayerController` + `PlayerCombat`), atau `Rigidbody2D` dibuat di child, bukan di root yang sama dengan `PlayerController`. Body Type Kinematic tetap didukung (`MovePosition`). |
| Nama pemain tidak berubah | `RoomListUI.playerNameInput` belum di-assign. Nama disimpan di `PlayerPrefs["HideSeek.PlayerNick"]` dan dikirim lewat `NetworkManager.SetPlayerName()`. |

| Room tidak muncul di daftar (padahal sudah create) | Keduanya connect ke **region berbeda** (Best Region bisa beda per perangkat) atau `App Version` beda → isi *Fixed Region* = `asia` dan samakan `HideSeekConstants.GameVersion`. |

**Solo test (tanpa teman, tanpa App ID):** `Window → Photon → ... →` biarkan App ID apa adanya,
centang `offlineMode` di `NetworkManager` scene Lobby → Play → tekan `Space`. `PhotonNetwork.Instantiate`
berjalan lokal, semua state machine + skill + UI teruji; hanya sinkronisasi antar-device yang tidak teruji.

---

## 10) Build tanpa Unity (web demo, HTML5 canvas)

Satu-satunya cara menjalankan game ini tanpa menginstal Unity: `web/` adalah port 1-file
dari aturan C# yang sama, digambar di `<canvas>` dan memakai **sprite yang sama persis**
dengan `Assets/Art/HideSeek/**` (disalin ke `web/assets/`).

### Jalankan

```bash
node web/net-server.js            # port 8790 (bisa: node web/net-server.js 3000)
# buka http://localhost:8790/  → tombol MAIN SENDIRI (bots)
```

Server itu juga = relay room mini (HTTP long-poll, tanpa dependency npm):
**BUAT ROOM** → muncul kode 4 huruf → tab/browser lain pilih **GABUNG** + isi kode.
Host = Authority untuk phase timer & keputusan tangkap, sama seperti `GameManager`.

| Aksi | Unity | web demo |
|---|---|---|
| gerak | WASD + joystick virtual (`MobileJoystick`) | `A/D/W/S`, `←↑↓→`, atau joystick di layar |
| skill 1 / 2 / 3 | tombol HUD (radial `cooldownFill`); slot 3 = Bekukan, hanya Hider | `1` / `2` / `3` atau tombol di kanan-bawah |
| kamera | `PlayerCamera` (SmoothDamp + zoom idle/lari/SEEK) | `uiKit.Camera2D`; matikan dengan `?cam=0` |
| aim Prop | tahan→seret→lepas via `HudV2SkillButton` (popup `GetPropChoices`) | tahan tombol **Prop** lalu seret ke prop tujuan, lepas |
| menangkap | `Tap` → `PlayerCombat.RequestCatch` | `klik`/`tap` di dekat hider (maks. 3 unit) |
| Kamuflase | raycast → rata-rata warna `Collider2D` tanah | rata-rata warna piksel tile di bawah kaki (dihitung dari PNG tile) |
| Prop Swap | `FreezeForProp` + batal saat ada input gerak | identik |
| Radar / Sonic Blast | ping minimap 1s; ring r=5 → slow 50%/2s | digambar prosedural (tanpa aset VFX) |
| Rewarded ad | `AdsManager` (SDK) / `simulateAds` | overlay simulasi 1.5s (`simulateAds`) |
| Net | Photon PUN 2 (`[PunRPC]`, `RaiseEventOptions`) | relay HTTP long-poll (khusus demo) |

### Nilai aturan = 1:1 dengan C#

`CONFIG` di `web/game.js` adalah salinan `HideSeekConstants.cs` (fase 5/30/60/10 s, 3 HP,
speed 6, seeker ×1.15, pushback 3 m, kebal 0.6 s, alpha hantu 0.3, prop swap 8 s, radar/blast
CD 8 s, blast r=5 → 50% slow 2 s, tangkap ≤3 unit, skor catch×30 / bertahan+HP×10,
kuota iklan 1/2/2 + gap 12 s). **`tools/web_selftest.js` membaca file C# dan membandingkan
 angkanya**, jadi kalau konstanta Unity diubah lalu web lupa disinkronkan, test gagal.

```bash
node tools/web_selftest.js    # 243 assertion: paritas konfigurasi + rules (phase, camo, hit,
                              #   catch, blast/radar, freeze/aim/hud-v2, leaderboard, kuota reward, snapshot, bot AI)
node tools/web_dom_smoke.js   # 143 assertion: lapisan browser (loader, renderer, HUD, iklan/referral,
                              #   UI v2 + v2.1 + kamera/aim/Freeze v2.2) dijalankan di DOM tiruan
python3 tools/web_map_preview.py   # PNG QC peta: zoning tile + spot prop + ring spawn (ArtRaw/)
```

### UI/UX v2.2 (kamera, aim Prop, skill Bekukan + port HUD ke Unity)

Tiga rasa baru di web, dan semuanya punya padanan C# supaya kedua build tetap satu game:

| Fitur | Web (`web/`) | Unity (`Assets/Scripts/`) |
| --- | --- | --- |
| **Kamera `smooth follow` + `zoom out` saat lari** — diam `1.25`, lari `1.08`, fase SEEK `1.00` (1.00 = seluruh peta terlihat, jadi tidak pernah ada tepi hitam) | `uiKit.js` kelas `Camera2D` (`BungUI.Camera`), dipakai `game.js` lewat `camStep(dt)`; angka dari `CFG.camIdle/camRun/camSeek/camRunSpeed/camSmooth` | `Utils/PlayerCamera.cs` (`useConstantZoomRatio`, `zoomOutOnRun`) mengambil rasio dari `HideSeekConstants.CamIdleZoom/CamRunZoom/CamSeekZoom/CamRunSpeed/CamSmoothTime` |
| **Aim "tahan → seret → lepas" untuk Prop Swap** — lepas di atas prop tujuan = menyamar jadi prop itu; lepas tanpa seret = perilaku lama (prop dipilih game) | `Round.propCandidates(p, CFG.propAimRadius)` + `usePropSwap(p, wantName)`; overlay garis + ring + nama prop digambar di kanvas; hint `#aimHint`; lewat jaringan dikirim sebagai `pn` | `HiderSkill.CastPropSwap(byte propId)` + `GetPropChoices()`; routing tunggal `UIManager.UseSkill(slot, propId)`; popup kandidat dibangun `UI/Hud/HudV2SkillButton.cs` (mode `propAimMode`) |
| **Skill `Bekukan` (Freeze)** — Seeker dalam 4 unit melambat jadi 35 % selama 2,5 dtk; pemakainya terpaku 0,8 dtk; cooldown sendiri 14 dtk (tidak merebut slot Kamuflase/Prop) | `Round.useFreeze(p)` + `CFG.freezeRadius/freezeTime/freezeSlow/freezeCd/freezeRoot`; jadi tombol skill ke-3 (`Icon_Freeze`), pintasan keyboard `3`; event `freeze` → SFX + haptic + ring partikel | `HiderSkill.CastFreeze()` → `Net.RaiseAll(EvtFreeze, …)`; korban menerapkan `ApplySpeedSlow()` di `PlayerController.OnEvent`; root via `FreezeForProp(true)`; konstanta di `HideSeekConstants` |

Catatan implementasi:

- **Satu sumber angka.** `tools/web_selftest.js` membandingkan tiap konstanta di atas dengan nilai di
  `HideSeekConstants.cs`; angka yang cuma diubah di satu sisi bikin test merah.
- **Kamera bisa dimatikan**: `?cam=0` mengembalikan render fit-penuh (dipakai `tools/web_map_preview.py`
  dan kalau ingin merasa kamera "mengganggu"). Debug lewat console: `hideSeekGame.ui.cam`, `.view`, `.aim`.
- **Port HUD v2 ke Unity (Phase 2 blueprint)** = folder `Assets/Scripts/UI/Hud/`:
  `HudV2Theme.cs` (1 warna = 1 makna, MM:SS, state <10 dtk / ≤5 dtk, target sentuh 44 px),
  `HudSafeArea.cs` (notch via `Screen.safeArea`), `HudV2SkillButton.cs` (ring cooldown radial +
  haptic + popup aim), `HudV2DamageText.cs` (angka damage melayang, dipool),
  `HudV2LocalBoard.cs` (top-10 di `PlayerPrefs` kunci `hideseek_scores_unity` — kosmetik, sama
  seperti web), `HudV2Settings.cs` (sensitivitas tuas 0,7–1,5 + musik/SFX + hapus rekor, disimpan
  di `PlayerPrefs` kunci `hideseek_ui`). Semua referensi di-assign manual; menu Setup → 6
  membangun hierarkinya lalu mengisi field `UIManager` (termasuk slot skill ke-3, yang otomatis
  disembunyikan untuk Seeker).
- **Khusus Hider, HUD kini 3 tombol** (Kamuflase · Prop · Bekukan), Seeker tetap 2 (Radar · Blast);
  ikonnya ditukar per role, jadi `Icon_Radar`/`Icon_SonicBlast` dipakai ulang di tombol yang sama.

### Aset media

`web/assets/*.png` = hasil `Assets/Art/HideSeek/**` (sudah di-key + diresize). Ulangi sinkron
setelah mengganti art:

```bash
mkdir -p web/assets && cp Assets/Art/HideSeek/*/*.png web/assets/ && rm -f web/assets/AppIcon.png
cp Assets/Art/HideSeek/Icons/AppIcon.png web/assets/    # (logo: generate_image -> web/assets/Logo_HideSeek.png)
```

Yang sengaja **tidak** ada di build web: Photon room browser/lobby typed, anti-cheat owner
(`PhotonNetwork.Instantiate` + `RpcTarget.All`), layer `Ground` + `Physics2D.OverlapPointAll`
(camo sampling web membaca piksel, bukan collider), joystick `MobileJoystick` versi Unity,
dan SDK iklan asli (Unity Ads). Build web dipakai untuk: validasi aturan, tuning angka,
preview art, dan test multiplayer 2 device di browser.

### UI/UX v2.1 (blueprint: zoning, glassmorphism, 44px, partikel, XP, PWA)

Build web sekarang punya lapisan UI sendiri — semua vanilla, **tanpa npm/Phaser**
(`hud-gamepad`, `@toolcase/game-components`, Enclave template diganti implementasi lokal):

| File | Isi |
|---|---|
| `web/ui.css` | design system: token warna (hijau=aman/hider, oranye=koin & reward, ungu=seeker/bahaya, merah=damage), glassmorphism (`backdrop-filter`), `--tap:44px`, `env(safe-area-inset-*)`, media query portrait **dan** landscape, `prefers-reduced-motion` / `prefers-contrast` / `:focus-visible` |
| `web/uiKit.js` | `Joystick` (pad 120px + deadzone + vektor ternormalisasi), `SkillButton` (cincin cooldown `conic-gradient`), `Screens` (splash → menu → lobby → game → result + pause), `Fx` (damage number + kilat layar), `Viewport` (safe-area/orientasi), `Haptics` (`navigator.vibrate`) |
| `web/audioKit.js` | SFX + BGM **disintesis Web Audio** (0 file audio): `tap hit catch skill camo swap radar blast coin reward count go win lose join err`; BGM menu vs game beda tempo; `duck()` saat iklan; preferensi di `localStorage['hideseek_audio']` |
| `web/index.html` | zoning blueprint: TL back+nama · TC fase+timer+role+hint+countdown · TR suara+papan skor+minimap · BC HP+reward · BR skill+dock iklan/referral · BL joystick; layar Splash, Main Menu, Lobby, HUD, Pause, Result, Settings, How-to-Play |
| `web/manifest.webmanifest` + `web/sw.js` | PWA: Add to Home Screen, offline (app-shell precache), shortcut Solo/Room. Matikan SW: `?nosw=1` |
| `web/particles.js` | FX canvas: debu saat lari, burst saat kena, sparkle koin/reward, heal & cincin blast/radar. Pool dibatasi (buang tertua), satuan = unit dunia, `stepList()` statis sehingga fisika bisa diuji tanpa DOM; otomatis diam bila `prefers-reduced-motion` |
| `web/assets/UI_HealthFrame.png`, `UI_MinimapFrame.png`, `Icon_Coin.png`, `Icon_Life.png`, `Bg_Splash.jpg` | aset UI hasil AI (bingkai HP, bingkai minimap, ikon koin & nyawa pengganti emoji, latar splash). Semua berkanal alpha (kecuali .jpg) + ikut di-precache service worker |

Perilaku baru yang terlihat:

* **Kontrol**: WASD + `1`/`2` (hider) atau `Q`/`E` (seeker), `Space` mulai, `M` suara, `L` papan skor, `Esc` pause.
* **Ukuran sentuh** semua tombol ≥ 44px; joystick hanya muncul di perangkat sentuh (`hover:none`).
* **Feedback**: angka damage/heal/koin melayang di posisi pemain, kilat merah saat tertangkap, kilat hijau saat camo, getar (`vibrate`), tombol skill berdenyut saat siap, timer memerah < 10 dtk (`warn`) dan blok merah di 5 dtk terakhir (`urgent`).
* **Splash** menampilkan progres muat sprite per aset + tips berganti; tap = lewati.
* **Partikel + guncangan layar**: debu kaki saat berlari, burst merah saat terkena, sparkle emas saat koin/reward, cincin radar/blast — plus `shake-1/2/3` pada `#stage` (padanan “camera shake saat caught”; yang digoyangkan isi stage, bukan stage-nya, supaya tepi layar tidak membuka latar hitam).
* **Latar hidup**: Splash (`Bg_Splash.jpg`) dan Main Menu (`Bg_Lobby.png`) digerakkan sangat lambat (ken-burns 26–34s) + vignets gelap agar teks terbaca.
* **Layar hasil**: peringkat ronde (`#3 dari 6`), koin, XP (0,6/poin + 120 bila menang + 25 bonus main), level + bar progres, dan 5 rekor lokal terbaik. Level memakai kurva `xpForLevel(L) = 300·L(L−1)/2`; XP disimpan di `hideseek_profile`, papan skor di `hideseek_scores` (top 10).
* **Papan skor on-demand** (ikon batang) memakai rumus skor resmi (`30/tangkap`, `detik + 10/HP`).
* **Setelan**: SFX / musik / haptik / volume / **sensitivitas joystick (70–150%)** / orientasi (Screen Orientation API, boleh ditolak browser) / bahasa (kerangka) / hapus rekor lokal, + baris diagnosa `layar 393×851 · dpr 3 · portrait · sentuh`. Semua preferensi di `localStorage['hideseek_ui']`.

Yang **sengaja** menyimpang dari blueprint: 4 skill tidak ditampilkan sekaligus (2 per role, sesuai `UIManager` Unity — HUD minimum), dan **Freeze** belum ada karena ability-nya memang tidak ada di C#/JS; tombol Prop masih tap (mode aim tahan-seret-lepas belum dibuat); kamera web *fixed* (seluruh map 800×600 terlihat) sehingga “smooth follow / zoom out saat lari” tidak diterapkan — guncangan & partikel menutupi kebutuhan feedback-nya; chat digabung ke toast; ikon back/sound/papan skor memakai SVG inline; audio & SFX disintesis Web Audio (nol file) supaya tetap offline-able. **Level/XP adalah progres web-only** — tidak menyentuh aturan skor/koin yang diparitas dengan C# (`web_selftest` tetap 192 PASS).

```bash
node tools/web_ui_test.js      # 227 assertion: blueprint->CSS/HTML, uiKit, audioKit,
                               #   partikel, XP/level, sensitivitas, LocalScores, PWA
node tools/web_dom_smoke.js    # 143 PASS: blok [6] hasil ronde asli + [7] kamera/aim/Freeze di DOM
                               #   tiruan -> rank/XP/bar level/rekor lokal + shake & partikel
```

### Iklan rewarded (AppLixir/AdinPlay) + referral di build web

Dua modul vanilla JS, tanpa dependency — detail lengkap ada di **[`integration-guide.md`](integration-guide.md)**.

| File | Isi |
|---|---|
| `web/adsManager.js` | kelas `AdsManager`: `showRewarded(name, onRewarded, onError)` → AppLixir (Google **Ad Placement API**, `adBreak({type:'reward', …})`) → AdinPlay (`window.AdinPlay.rewarded.show`) → **simulasi 1,5 detik** (`📺 [SIMULASI] Iklan reward ditonton!`). Cooldown global 30 detik di `localStorage['lastAdTime']` dengan pesan `Tunggu X detik lagi` |
| `web/referralSystem.js` | kode unik 7 karakter di `localStorage['myReferralCode']`, link `?ref=`, popup “Selamat datang! … +50 Koin & +1 Nyawa!”, modal **🎁 Undang Teman** (Salin/Bagikan), counter pengundang (`referralBonus`) |
| `web/config.example.js` + `tools/gen_web_config.js` | **ID iklan tidak pernah ditulis di kode**: isi `.env` (contoh: `.env.example`) → `node tools/gen_web_config.js` → `web/config.js` (di-gitignore). Kosong = mode simulasi |
| `web/game.js` (`Profile`) | state yang sebelumnya tidak ada di build web: koin, bonus Max HP, nyawa cadangan; disimpan di `localStorage['hideseek_profile']`. Tombol HUD **📺 Tonton Iklan +1 Nyawa**, **📺 Dapatkan Koin**, **🎁 Undang Teman**, plus toko kecil di lobby (`+1 Max HP`, `+1 Nyawa`) |

```bash
node tools/web_ads_referral_test.js   # 130 assertion: cooldown, fallback, ?ref=, hadiah
node tools/web_dom_smoke.js           # 143 PASS: lapisan browser + [4] iklan/referral + [5] UI v2 + [6] v2.1 + [7] v2.2
node tools/web_ui_test.js             # 258 PASS: blueprint→CSS/HTML, uiKit (+Camera2D), audioKit, partikel, XP, PWA
```

Saat iklan tayang, `game.pause()` dipanggil (loop `step()` dibekukan, ada label **IKLAN**), lalu
`game.resume()` setelah selesai — sama seperti `AudioListener.pause` di Unity. Hadiah pengundang
sengaja **belum** menambah koin (butuh backend untuk tahu siapa mengundang siapa); yang dicatat
baru counter lokal + notifikasi. Versi Unity (`Assets/Scripts/Monetization/`) tidak diubah:
cooldown Unity 12 detik (`AdMinGapSeconds`), web 30 detik (`ADS_COOLDOWN_SECONDS`).

### Mau jadi APK dari build web? (opsional, bukan jalur rilis utama)

```bash
npm i -D @capacitor/core @capacitor/cli @capacitor/android && npx cap init
# webDir = "web" -> npx cap add android && npx cap copy && npx cap open android
```
Alternatif: TWA/`WebView` wrapper. Catatan penting: netcode web (long-poll) **bukan** PUN2 —
bila ingin rilis Play Store dengan multiplayer sungguhan, pakai project Unity (bagian 1–8);
aplikasi WebView hanya cocok untuk versi offline/bots saja.

### Batasan yang perlu diketahui

* Relay `web/net-server.js` tidak mengenkripsi/otoritas-kan seperti Photon; jangan pakai untuk
  sesuatu yang serius.
* `?solo=1` pada URL langsung memulai ronde dengan bot (praktis untuk screenshot/otomasi).
* Orientasi: UI dibuat portrait-friendly, tapi belum diuji di perangkat; pakai DevTools device
  emulation untuk cek cepat.

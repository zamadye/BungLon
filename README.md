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
│   ├── Utils/      CamouflageHelper.cs   (8. rata-rata warna di bawah raycast 2D)
│   │               PlayerVisual.cs       (helper SpriteRenderer / alpha / flip)
│   │               MinimapRadarView.cs   (minimap + lingkaran radar)
│   │               SonicBlastEffect.cs   (ring blast)
│   │               PlayerCamera.cs       (kamera ortho, ikut Seeker saat jadi hantu)
│   └── Editor/     HideSeekSetupTool.cs  (menu setup otomatis — hanya Editor, tidak ikut build)
├── Prefabs/        PlayerNetworked, Props (Meja/Kursi/Pot), SonicBlastRing
├── UI/             Canvas HUD + Lobby (hasil menu setup / manual)
└── Resources/HideSeek/   fallback prefab agar project langsung bisa di-playtest
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
8. Isi App ID (lihat langkah 1 di bawah), lalu **Play** di scene **Lobby**. Tekan `N` = buat room,
   `J` = quick play, `Space` = Start (host). Test sendirian: centang **`offlineMode`** di
   `NetworkManager` (nama field-nya begitu, bukan `testOfflineMode`) — di mode offline minimal
   pemain otomatis jadi 1 (lihat `GameManager.allowSoloStart`).

> Tanpa menu setup pun project tetap compile; hanya field Inspector yang kosong.

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

## 8) Troubleshooting

| Gejala | Penyebab umum |
|---|---|
| Pemain diam di tempat saat Remote | `PhotonView.observed` kosong → tambahkan `PlayerController` (+ `PlayerCombat`). |
| Semua jatuh ke `LOBBY` saat Start | `NetworkManager.playerPrefab` kosong → jalankan menu Setup 1, atau assign prefab. |
| `JoinRandomRoom` selalu gagal | App ID salah / region beda / room penuh. `NetworkManager` otomatis **membuat room baru** bila `OnJoinRandomFailed`. |
| Skill Match Color selalu abu-abu | Tekstur ground belum **Read/Write Enabled** atau tile tidak di layer `Ground` / tidak punya `Collider2D`. |
| Prop tidak muncul | `PropDatabase.id` tidak ada prefabnya → lihat log `Prefab prop tidak ditemukan (id=…)`. |
| Tidak ada daftar room | Centang `joinLobbyAfterConnect` di `NetworkManager` (mengirim `PhotonNetwork.JoinLobby` setelah connect); atau tekan tombol REFRESH (re-join typed lobby `hideseek`). Pastikan **App ID benar** dan room dibuat di typed lobby yang sama. |
| UI tidak merespons sentuhan | `EventSystem` tidak ada di scene, atau `GraphicRaycaster` hilang dari Canvas. |
| Tap untuk menangkap tidak jalan | `hiderLayerMask` tidak mencakup layer pemain, atau `EventSystem.IsPointerOverGameObject` menahan input (tombol terlalu besar). |
| `DefaultPool failed to load "PlayerNetworked". Make sure it's in a "Resources" folder` | Prefab pemain ada di **sub-folder** Resources (`Resources/HideSeek/`). Pindahkan ke **`Assets/Resources/PlayerNetworked.prefab`** (root) — `PhotonNetwork.Instantiate()` memakai `Resources.Load(namaFile)`. |
| Klik Start muncul "Butuh minimal 2 pemain" | Wajar saat online. Untuk test sendirian: centang `offlineMode` di `NetworkManager`, atau centang `allowSoloStart` di `GameManager`. |
| Tombol skill tidak muncul / hilang | `UIManager.skills` isinya **2 elemen** (bukan 4): slot 0 = Kamuflase/Radar, slot 1 = Prop Swap/Sonic Blast. Tiap elemen punya `hiderLabel` & `seekerLabel` sendiri, label otomatis berganti sesuai role. `cooldownFill` harus `Image` dengan **Image Type = Filled, Fill Method = Radial**. |
| Player diam saat dijalankan dari prefab manual | `PhotonView.observed` belum terisi (isi `PlayerController` + `PlayerCombat`), atau `Rigidbody2D` dibuat di child, bukan di root yang sama dengan `PlayerController`. Body Type Kinematic tetap didukung (`MovePosition`). |
| Nama pemain tidak berubah | `RoomListUI.playerNameInput` belum di-assign. Nama disimpan di `PlayerPrefs["HideSeek.PlayerNick"]` dan dikirim lewat `NetworkManager.SetPlayerName()`. |

| Room tidak muncul di daftar (padahal sudah create) | Keduanya connect ke **region berbeda** (Best Region bisa beda per perangkat) atau `App Version` beda → isi *Fixed Region* = `asia` dan samakan `HideSeekConstants.GameVersion`. |
| Tidak bisa Start saat sendiri | Centang `allowSoloStart` (GameManager) atau `offlineMode` (NetworkManager) |

**Solo test (tanpa teman, tanpa App ID):** `Window → Photon → ... →` biarkan App ID apa adanya,
centang `offlineMode` di `NetworkManager` scene Lobby → Play → tekan `Space`. `PhotonNetwork.Instantiate`
berjalan lokal, semua state machine + skill + UI teruji; hanya sinkronisasi antar-device yang tidak teruji.

Folder ini dipakai sebagai FALLBACK prefab/aset saat field Inspector kosong,
sehingga project baru bisa langsung di-playtest tanpa setup manual.

Isi yang diharapkan (dibuat oleh menu: HideSeek > Setup > 1. Generate Placeholder Assets):

  Resources/HideSeek/
    PlayerNetworked.prefab      <- prefab pemain (punya PhotonView + observed components)
    SonicBlastRing.prefab       <- ring visual skill Seeker
    MapPlaceholder.prefab       <- peta sementara (tile + collider layer Ground)
    PropDatabase.asset          <- ScriptableObject daftar prop (id 0=Meja, 1=Kursi, 2=Pot)
    Prop_0.prefab / Prop_1.prefab / Prop_2.prefab
    Sprites/white.png, Sprites/circle.png  (Read/Write Enabled, PPU 32)

Catatan:
  * Nama file prefab HARUS sama persis dengan konstanta di Assets/Scripts/Core/HideSeekPrefabs.cs,
    karena PhotonNetwork.Instantiate() mencocokkan prefab lewat NAMA, bukan GUID.
  * Semua aset di sini ikut di-build (Resources folder). Bila ingin hemat ukuran APK,
    pindahkan prefab ke Assets/Prefabs lalu assign field Inspector - Resources boleh dihapus.
  * Tekstur tanah WAJIB "Read/Write Enabled" agar CamouflageHelper bisa membaca pixel
    (kalau tidak, skill Match Color jatuh ke warna tint sprite).

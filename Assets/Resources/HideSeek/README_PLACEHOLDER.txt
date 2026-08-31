Folder FALLBACK untuk aset yang TIDAK di-Instantiate lewat jaringan, sehingga project baru bisa
langsung di-playtest tanpa setup manual. Dibuat oleh menu: HideSeek > Setup > 1. Generate Placeholder Assets

  Assets/Resources/                      <- ROOT Resources (khusus prefab jaringan!)
    PlayerNetworked.prefab                  WAJIB di sini. PhotonNetwork.Instantiate("PlayerNetworked")
                                            memakai Resources.Load("PlayerNetworked") yang TIDAK membaca
                                            sub-folder. Kalau ditaruh di HideSeek/, muncul error:
                                            "DefaultPool failed to load ... Make sure it's in a Resources folder"

  Assets/Resources/HideSeek/             <- sisanya aman di sub-folder (dimuat lewat field Inspector / path)
    SonicBlastRing.prefab       ring visual skill Seeker (diInstantiate lokal, bukan jaringan)
    MapPlaceholder.prefab       peta sementara (tile + collider layer Ground)
    PropDatabase.asset          ScriptableObject daftar prop (id 0=Meja, 1=Kursi, 2=Pot)
    Prop_0.prefab / Prop_1.prefab / Prop_2.prefab
    Sprites/white.png, Sprites/circle.png  (Read/Write Enabled, PPU 32)

Aturan nama:
  * Nama FILE prefab pemain HARUS sama persis di semua klien/build - Photon mencocokkan lewat
    NAMA FILE, bukan GUID. Nama alternatif "Player" juga diterima (alias di HideSeekPrefabs.PlayerAlias).
  * id prop (0/1/2) dikirim lewat network, jadi urutan PropEntry di PropDatabase tidak boleh berubah
    antar build yang sedang dipakai bersama.
  * Loader mencoba 3 lokasi berurutan: Resources/<nama>, Resources/HideSeek/<nama>,
    Resources/PhotonPrefab/<nama> (lihat PrefabLibrary.Prefixes). Jadi project lama tetap jalan.
  * Tekstur tanah WAJIB "Read/Write Enabled" agar CamouflageHelper bisa membaca pixel
    (kalau tidak, skill Match Color jatuh ke warna tint sprite).
  * Semua yang ada di folder Resources ikut ter-build ke APK. Untuk hemat ukuran:
    pindahkan Prop_*/MapPlaceholder/SonicBlastRing ke Assets/Prefabs lalu assign field Inspector.
    (PlayerNetworked.prefab tetap harus punya salinan di root Resources.)

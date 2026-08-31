# Pipeline Aset AI — HideSeek Online

Alur: **generate (AI) → `ArtRaw/` → `Tools/hideseek_art_postprocess.py` → `Assets/Art/HideSeek/` → menu Unity `HideSeek ▸ Setup  5. Pasang Art AI`.**

```
ArtRaw/                    gambar mentah dari model (di luar Assets -> tidak ikut ter-build)
Assets/Art/HideSeek/       hasil akhir yang dipakai Unity (otomatis di-import, lihat
                           Assets/Scripts/Editor/HideSeekTextureImporter.cs)
Tools/…postprocess.py      keying magenta -> alpha, pisahkan objek, auto-crop, resize, manifest
```

## 1. Aturan prompt (bawaan project)

- Selalu tulis: **`isolated on a solid pure magenta #FF00FF background`** — script memotong
  latar dengan flood-fill dari tepi (warna latar apa pun selama solid, tetap jalan; magenta
  dipilih karena tidak mungkin muncul di karakter/prop).
- **Jangan** minta frame/kotak/border di sekitar objek; objek harus saling berjauhan bila
  digabung dalam satu lembar (script memisahkan per objek, bukan per grid).
- Satu gaya untuk semua: `flat vector 2D game sprite, thick dark outline, saturated
  cel-shaded colors, top-down bird's-eye view, no ground shadow, no text, no watermark`.
- Teks/angka di dalam sprite sebaiknya dihindari (UI memakai `Text` asli Unity).
- Tile tanah **tidak** memakai latar magenta: minta lembar 2x2 penuh (`filling the whole
  canvas edge to edge, no borders`) dan pastikan tiap kuadran **berbeda warna rata-rata** —
  skill Kamuflase bekerja dengan membaca warna tile, jadi tile yang mirip = camo "gratis".

## 2. Prompt yang dipakai untuk set saat ini (`ArtRaw/`)

| File | Prompt inti |
|---|---|
| `char_hider.png` | top-down friendly green chameleon, curled tail, splayed feet, big bulging eyes, facing right |
| `char_seeker.png` | top-down stocky blue chameleon, small orange police helmet + visor, tiny megaphone |
| `props_2x2.png` | round wooden cafe table / wooden chair / terracotta flower pot with red flowers / brown wooden crate — all top-down, one per quadrant |
| `decor_2x2.png` | trimmed rectangular hedge segment / round dark green bush / cluster of grey rocks / three red-white mushrooms — top-down |
| `tiles_2x2.png` | 4 seamless square ground textures: green grass, warm tan sandy dirt, cool grey cobblestone, brown wooden planks |
| `icons_2x2.png` | skill icons: paint palette + brush + chameleon (kamuflase) / cardboard box + circular swap arrows (prop swap) / radar dish + signal arcs / megaphone + sound waves |
| `icon_revive.png` | red heart with white play triangle + yellow sparkles (ikon tombol rewarded-ad) |
| `bg_lobby.png` | 9:16 vertical dusk jungle canopy clearing, dark muted center so UI text stays readable |
| `app_icon.png` | rounded-square yellow→orange gradient badge, green chameleon head, glossy cartoon game icon |

> Gambar pemeriksaan cepat: `ArtRaw/_preview_sprites.png` (semua sprite di atas latar abu-abu
> dan magenta - untuk mengecek keying tidak menyisakan fringe) dan
> `ArtRaw/_preview_map_zones.png` (perkiraan susunan zona tile setelah Setup > 5).
> `ArtRaw/` di-`.gitignore` (hanya bahan mentah), jadi preview ini tidak ikut ke repository.

## 3. Menjalankan

```bash
pip install pillow
python3 Tools/hideseek_art_postprocess.py --probe   # lihat objek yang terdeteksi + warna rata-rata
python3 Tools/hideseek_art_postprocess.py           # tulis PNG final + Assets/Art/HideSeek/manifest.txt
```

`--probe` berguna saat menambah/mengganti sheet: script melaporkan jumlah & posisi objek
sehingga entri `SHEETS[...] = (mode, [nama], ukuran, pick)` bisa disesuaikan
(`pick` boleh berisi tuple indeks untuk menggabungkan beberapa bagian jadi satu sprite —
dipakai untuk `Mushrooms` dan ikon radar/megafon).

`manifest.txt` berisi ukuran + rata-rata RGB tiap aset. Bandingkan dengan warna tile:
`Tile_Grass (73,135,25) · Tile_Sand (217,166,95) · Tile_Stone (124,128,127) · Tile_Wood (140,85,42)`
— jarak antar warna itulah yang membuat "Match Color" terasa adil.

## 4. Penamaan agar otomatis terpasang

| Folder | Nama file | Dipakai oleh |
|---|---|---|
| `Characters/` | `Chameleon_Hider`, `Chameleon_Seeker` | `RoleSkin` di prefab pemain (Setup ▸ 5) |
| `Props/` | `Prop_Table`, `Prop_Chair`, `Prop_FlowerPot`, `Prop_Crate` | prefab `Prop_0..3` + `PropDatabase` (Meja/Kursi/Pot Bunga/Peti) |
| `Tiles/` | `Tile_Grass`, `Tile_Sand`, `Tile_Stone`, `Tile_Wood` | `MapPlaceholder.prefab` (zona: jalur=stone, tengah=sand, pojok=wood, sisanya=grass) |
| `Decor/` | `Hedge_Wall`, `Bush`, `Rocks`, `Mushrooms` | dinding peta + dekorasi tanpa collider |
| `Icons/` | `Icon_Camouflage`, `Icon_PropSwap`, `Icon_Radar`, `Icon_SonicBlast`, `Icon_Revive` | ikon tombol skill + tombol reward |
| `Background/` | `Bg_Lobby` | Image `BgLobby` di Canvas (child pertama) |

Ukuran acuan: tile/prop/dekor **128 px** (PPU 128 → tepat 1 unit dunia), karakter **192 px**
(diskalakan `RoleSkin.heightInUnits`), ikon **112 px**, background **1080×1920**.
Setting import (Read/Write, PPU, filter, mesh type) **tidak perlu disentuh** — sudah diatur
`HideSeekTextureImporter`. Yang perlu Read/Write hanya `Tiles/` (dibaca `CamouflageHelper`).

## 5. Mengganti dengan aset sendiri

1. Taruh PNG di `Assets/Art/HideSeek/<folder yang benar>` dengan nama sesuai tabel di atas.
2. Unity auto-import + `HideSeek ▸ Setup ▸ 5` lagi → prefab/scene diperbarui.
3. Sprite dengan nama lain juga bebas: assign manual ke `PlayerVisual`/`RoleSkin`/`PropDatabase`
   (semua field `public`), tidak ada yang di-hash/dikunci.

## 6. Catatan legal & toko (penting sebelum rilis)

- Simpan prompt + sumber generate tiap aset. Google Play meminta kamu memegang hak atas
  aset; jangan menyalin sprite/ikon berhak cipta sebagai "bahan referensi".
- Aset AI 2D sebaiknya dirapikan (hapus noise, samakan ketebalan outline, konsisten palet)
  sebelum masuk build publik.
- Untuk Play Store: ikon launcher final dari `Icons/AppIcon.png` (512×512, tanpa alpha) di
  `Player Settings ▸ Icon ▸ Override for Android`, dan 1024×512 feature graphic untuk listing.
- Ganti placeholder teks (nama prop, toast) ke Bahasa Indonesia/Inggris sesuai target store.

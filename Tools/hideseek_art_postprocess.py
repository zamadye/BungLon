#!/usr/bin/env python3
"""
hideseek_art_postprocess.py  -  pipeline aset AI -> sprite Unity siap pakai.

Dipakai ulang kapan saja: generate gambar baru (latar magenta polos #FF00FF),
letakkan di ArtRaw/, jalankan script ini -> hasil masuk ke Assets/Art/HideSeek/.

Yang dilakukan:
  1. Sprite sheet "objek terpisah di latar magenta": tiap objek dipisah pakai
     pelabelan komponen terhubung (bukan grid tetap, jadi aman walau model
     membuat 2x2 / 3x2 / 2x3).
  2. Kromakan latar -> alpha (keying) + despill supaya tidak ada fringe pink.
  3. Auto-crop, isi ke kanvas persegi dengan padding, resize ke ukuran target.
  4. Lembar tile (tekstur penuh, tanpa latar) dipotong 2x2 + inset.
  5. Menulis Assets/Art/HideSeek/manifest.txt (ukuran + warna rata-rata tiap aset)
     -> berguna untuk tuning skill Kamuflase.

Kebutuhan: Python 3 + Pillow  (pip install pillow)
"""
import os
import sys

from PIL import Image

PROBE = "--probe" in sys.argv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "ArtRaw")
OUT = os.path.join(ROOT, "Assets", "Art", "HideSeek")

# ------------------------------------------------------------------ konfigurasi
# key: (file_mentah, mode, daftar_nama_output_urut_baca, ukuran_output_px)
PROPS_PICK = [0, 1, 3, 4]   # meja, kursi, pot bunga, peti (2 objek kembar dibuang)

# (mode, [nama_output_urut_baca], ukuran_px, pick=None)
#   pick : daftar indeks objek hasil deteksi yang dipakai (lihat --probe).
#          None = ambil len(nama) objek pertama.
SHEETS = {
    "char_hider.png":  ("objects", ["Chameleon_Hider"], 192, None),
    "char_seeker.png": ("objects", ["Chameleon_Seeker"], 192, [0]),
    "props_2x2.png":   ("objects", ["Prop_Table", "Prop_Chair", "Prop_FlowerPot", "Prop_Crate"], 128, PROPS_PICK),
    "decor_2x2.png":   ("objects", ["Hedge_Wall", "Bush", "Rocks", "Mushrooms"], 128,
                        [0, 1, 2, (3, 4, 5)]),   # jamur = 3 komponen digabung jadi satu sprite
    "icons_2x2.png":   ("objects", ["Icon_Camouflage", "Icon_PropSwap", "Icon_Radar", "Icon_SonicBlast"], 112,
                        [0, 1, (2, 3), (4, 5)]),  # parabola+sinyal & megafon+gelombang digabung
    "icon_revive.png": ("objects", ["Icon_Revive"], 112, None),
}
# folder tujuan per nama aset (prefix cocok sebagian)
DEST = [
    (("Chameleon_",), "Characters"),
    (("Prop_",), "Props"),
    (("Hedge_", "Bush", "Rocks", "Mushrooms"), "Decor"),
    (("Icon_",), "Icons"),
]
TILES_SHEET = ("tiles_2x2.png", ["Tile_Grass", "Tile_Sand", "Tile_Stone", "Tile_Wood"], 128)
FLAT_IMAGES = [  # (file, nama, ukuran_lebar, ukuran_tinggi, keep_aspect_cover)
    ("bg_lobby.png",  "Background/Bg_Lobby", 1080, 1920, True),
    ("app_icon.png",  "Icons/AppIcon",       512,  512,  False),
]


# ------------------------------------------------------------------- util gambar
def is_bg(r, g, b):
    """Latar magenta / pink polos."""
    return r > 135 and b > 135 and g < r * 0.72 and g < b * 0.72


def key_magenta(im, tol=112):
    """
    Latar -> alpha, ditentukan oleh BANJIR dari tepi gambar (flood fill) atas warna yang
    mirip warna rata-rata tepi. Kelebihannya: warna serupa di DALAM sprite (mis. kelopak
    merah muda) tidak ikut bolong, dan latar bergradien/halus tetap terhapus.
    Ditutup dengan despill supaya tidak ada fringe pink di tepi sprite.
    """
    from collections import deque

    rgb = im.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    sr = sc = sb = n = 0
    for x in range(0, w, max(1, w // 160)):
        for y in (0, h - 1):
            r, g, b = px[x, y]; sr += r; sc += g; sb += b; n += 1
    for y in range(0, h, max(1, h // 160)):
        for x in (0, w - 1):
            r, g, b = px[x, y]; sr += r; sc += g; sb += b; n += 1
    BGR = (sr // n, sc // n, sb // n)

    def near_bg(c):
        return abs(c[0] - BGR[0]) <= tol and abs(c[1] - BGR[1]) <= tol and abs(c[2] - BGR[2]) <= tol

    isbg = bytearray(w * h)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if not isbg[i] and near_bg(px[x, y]):
                isbg[i] = 1; dq.append(i)
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if not isbg[i] and near_bg(px[x, y]):
                isbg[i] = 1; dq.append(i)

    while dq:
        i = dq.popleft()
        x, y = i % w, i // w
        if x > 0:
            j = i - 1
            if not isbg[j] and near_bg(px[x - 1, y]): isbg[j] = 1; dq.append(j)
        if x + 1 < w:
            j = i + 1
            if not isbg[j] and near_bg(px[x + 1, y]): isbg[j] = 1; dq.append(j)
        if y > 0:
            j = i - w
            if not isbg[j] and near_bg(px[x, y - 1]): isbg[j] = 1; dq.append(j)
        if y + 1 < h:
            j = i + w
            if not isbg[j] and near_bg(px[x, y + 1]): isbg[j] = 1; dq.append(j)

    out = Image.new("RGBA", (w, h))
    op = out.load()
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if isbg[i]:
                op[x, y] = (0, 0, 0, 0)
                continue
            r, g, b = px[x, y]
            # despill: kurangi rona pink di piksel yang menempel latar
            edge = (x > 0 and isbg[i - 1]) or (y > 0 and isbg[i - w]) or \
                   (x + 1 < w and isbg[i + 1]) or (y + 1 < h and isbg[i + w])
            if edge and r > g and b > g:
                cap = g + max(1, (min(r, b) - g) // 3)
                r, b = min(r, cap), min(b, cap)
            op[x, y] = (r, g, b, 255)
    return out


def label_components(alpha_small):
    """Union-find 4-neighbour pada mask (0=latar). Mengembalikan list box (x0,y0,x1,y1) skala kecil."""
    w, h = alpha_small.size
    a = alpha_small.load()
    parent = list(range(w * h))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for y in range(h):
        base = y * w
        for x in range(w):
            i = base + x
            if a[x, y][3] < 40:
                continue
            if x > 0 and a[x - 1, y][3] >= 40:
                union(i, i - 1)
            if y > 0 and a[x, y - 1][3] >= 40:
                union(i, i - w)

    boxes = {}
    for y in range(h):
        base = y * w
        for x in range(w):
            i = base + x
            if a[x, y][3] < 40:
                continue
            r = find(i)
            b0 = boxes.get(r)
            if b0 is None:
                boxes[r] = [x, y, x + 1, y + 1]
            else:
                b0[0] = min(b0[0], x)
                b0[1] = min(b0[1], y)
                b0[2] = max(b0[2], x + 1)
                b0[3] = max(b0[3], y + 1)
    return [tuple(v) for v in boxes.values()]


def merge_parts(full, pieces):
    """Gabung beberapa komponen jadi satu sprite: pakai union bbox-nya pada gambar penuh."""
    xs0 = min(p.crop_box[0] for p in pieces); ys0 = min(p.crop_box[1] for p in pieces)
    xs1 = max(p.crop_box[2] for p in pieces); ys1 = max(p.crop_box[3] for p in pieces)
    pad = int(max(xs1 - xs0, ys1 - ys0) * 0.04) + 3
    return full.crop((max(0, xs0 - pad), max(0, ys0 - pad),
                      min(full.size[0], xs1 + pad), min(full.size[1], ys1 + pad)))


def split_objects(im, min_area_frac=0.004):
    """Pisahkan objek pada lembar: return list Image RGBA per objek (urutan baca)."""
    w, h = im.size
    small = im.resize((max(1, w // 4), max(1, h // 4)))
    boxes = label_components(small)
    scale = 4
    full = []
    for (x0, y0, x1, y1) in boxes:
        bw, bh = (x1 - x0) * scale, (y1 - y0) * scale
        if bw * bh < w * h * min_area_frac:      # buang serpihan/noise
            continue
        pad = int(max(bw, bh) * 0.06) + 4
        cx0, cy0 = max(0, x0 * scale - pad), max(0, y0 * scale - pad)
        cx1, cy1 = min(w, x1 * scale + pad), min(h, y1 * scale + pad)
        full.append(((cx0 + cx1) // 2, cy0, im.crop((cx0, cy0, cx1, cy1)), (cx0, cy0, cx1, cy1)))
    # urutan baca: per baris (band 12% tinggi), lalu kiri -> kanan
    if not full:
        return []
    ys = sorted(c[1] for c in full)
    band = max(24, (ys[-1] - ys[0]) * 0.35)
    rows = []
    for cx, cy, img, box in sorted(full, key=lambda t: t[1]):
        if rows and abs(cy - rows[-1][0][1]) <= band:
            rows[-1].append((cx, cy, img, box))
        else:
            rows.append([(cx, cy, img, box)])
    out = []
    for row in rows:
        for t in sorted(row, key=lambda t: t[0]):
            img = t[2]
            img.crop_box = t[3]          # disimpan untuk merge_parts
            out.append(img)

    # buang duplikat (model sering menggambar ulang objek yang sama di sheet)
    uniq, seen = [], set()
    for img in out:
        sig = img.resize((16, 16)).convert("RGBA").tobytes()
        # tanda tangan: alpha + luminance kasar -> tahan perubahan kecil, Beda objek pasti beda
        lum = bytes(sum(sig[i * 4:i * 4 + 3]) // 3 for i in range(256))
        key = hash(lum)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(img)
    if len(uniq) != len(out):
        print("   (dedupe: %d objek kembar dibuang)" % (len(out) - len(uniq)))
    return uniq


def square_pad(im, size):
    """Auto-crop ke bbox (berdasarkan alpha), lalu masukkan ke kanvas persegi `size`."""
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    side = max(im.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - im.size[0]) // 2, (side - im.size[1]) // 2), im)
    return canvas.resize((size, size), Image.LANCZOS)


def avg_color(im):
    """Rata-rata warna piksel yang tidak transparan -> dipakai untuk tuning Kamuflase."""
    rgb = im.convert("RGB")
    a = im.split()[-1] if im.mode == "RGBA" else None
    px, ap = rgb.load(), (a.load() if a else None)
    r = g = b = n = 0
    step = max(1, rgb.size[0] // 96)
    for y in range(0, rgb.size[1], step):
        for x in range(0, rgb.size[0], step):
            if ap is not None and ap[x, y] < 40:
                continue
            pr, pg, pb = px[x, y]
            r += pr; g += pg; b += pb; n += 1
    if n == 0:
        return (0, 0, 0)
    return (r // n, g // n, b // n)


def save(im, rel, manifest):
    path = os.path.join(OUT, rel + ".png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    c = avg_color(im)
    manifest.append("%-22s %4dx%-4d avg RGB = (%3d,%3d,%3d)  #%02X%02X%02X"
                    % (os.path.basename(rel), im.size[0], im.size[1], c[0], c[1], c[2], c[0], c[1], c[2]))
    print("  ->", rel + ".png", im.size, "avg", c)


def dest_for(name):
    for prefixes, folder in DEST:
        for p in prefixes:
            if name.startswith(p):
                return folder + "/" + name
    return name


# ------------------------------------------------------------------------- main
def main():
    if not os.path.isdir(RAW):
        sys.exit("ArtRaw/ tidak ditemukan. Jalankan dari root project.")
    os.makedirs(OUT, exist_ok=True)
    manifest = ["# HideSeek - daftar aset hasil post-process (dibuat otomatis oleh Tools/hideseek_art_postprocess.py)",
                "# avg RGB berguna saat menyetel skill Kamuflase: makin beda warna antar tile, makin jelas bedanya.",
                ""]

    print("[1/3] memisahkan objek dari sprite sheet...")
    if PROBE:
        for fname, (mode, names, size, pick) in SHEETS.items():
            src = os.path.join(RAW, fname)
            if not os.path.exists(src):
                continue
            parts = split_objects(key_magenta(Image.open(src)))
            print("== %s : %d objek (nama: %s)" % (fname, len(parts), ",".join(names)))
            for i, img in enumerate(parts):
                c = avg_color(img)
                print("   [%d] %dx%d avg (%3d,%3d,%3d)" % (i, img.size[0], img.size[1], c[0], c[1], c[2]))
        sys.exit(0)
    for fname, (mode, names, size, pick) in SHEETS.items():
        src = os.path.join(RAW, fname)
        if not os.path.exists(src):
            print("  !! lewati (tidak ada):", fname)
            continue
        keyed = key_magenta(Image.open(src))
        parts = split_objects(keyed)
        if not parts:
            print("  !! tidak ada objek terdeteksi di", fname)
            continue
        if len(parts) < len(names):
            print("  ?? %s: %d objek terdeteksi, %d nama diharapkan -> nama ekstra dilewati"
                  % (fname, len(parts), len(names)))
        if pick:
            sel = []
            for p_ in pick:
                if isinstance(p_, (tuple, list)):          # gabung beberapa bagian (mis. jamur)
                    imgs = [parts[i] for i in p_ if i < len(parts)]
                    sel.append(merge_parts(keyed, imgs) if imgs else None)
                elif p_ < len(parts):
                    sel.append(parts[p_])
            parts = [p_ for p_ in sel if p_ is not None]
        if PROBE and fname != list(SHEETS)[0]:
            pass
        for img, name in zip(parts, names):
            save(square_pad(img, size), dest_for(name), manifest)

    print("[2/3] memotong lembar tile 2x2...")
    tfname, tnames, tsize = TILES_SHEET
    tsrc = os.path.join(RAW, tfname)
    if os.path.exists(tsrc):
        t = Image.open(tsrc).convert("RGB")
        w, h = t.size
        inset = max(2, w // 256)
        quads = [(0, 0), (1, 0), (0, 1), (1, 1)]
        for (qx, qy), name in zip(quads, tnames):
            x0 = int(w / 2 * qx) + (inset if qx else 0)
            y0 = int(h / 2 * qy) + (inset if qy else 0)
            x1 = int(w / 2 * (qx + 1)) - (0 if qx == 0 else inset)
            y1 = int(h / 2 * (qy + 1)) - (0 if qy == 0 else inset)
            crop = t.crop((x0, y0, x1, y1))
            side = min(crop.size)
            cx = (crop.size[0] - side) // 2
            cy = (crop.size[1] - side) // 2
            crop = crop.crop((cx, cy, cx + side, cy + side)).resize((tsize, tsize), Image.LANCZOS)
            save(crop.convert("RGBA"), "Tiles/" + name, manifest)
    else:
        print("  !! lewati (tidak ada):", tfname)

    print("[3/3] gambar flat (background / app icon)...")
    for fname, rel, ow, oh, cover in FLAT_IMAGES:
        src = os.path.join(RAW, fname)
        if not os.path.exists(src):
            print("  !! lewati (tidak ada):", fname)
            continue
        im = Image.open(src).convert("RGBA")
        if not cover:
            bbox = im.getbbox()
            if bbox:
                im = im.crop(bbox)
        if cover:
            scale = max(ow / im.size[0], oh / im.size[1])
            im = im.resize((int(im.size[0] * scale + .5), int(im.size[1] * scale + .5)), Image.LANCZOS)
            x = (im.size[0] - ow) // 2
            y = (im.size[1] - oh) // 2
            im = im.crop((max(0, x), max(0, y), max(0, x) + ow, max(0, y) + oh))
        else:
            im = im.resize((ow, oh), Image.LANCZOS)
        save(im, rel, manifest)

    with open(os.path.join(OUT, "manifest.txt"), "w") as f:
        f.write("\n".join(manifest) + "\n")
    print("\nselesai. manifest: Assets/Art/HideSeek/manifest.txt")


if __name__ == "__main__":
    main()

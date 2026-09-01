#!/usr/bin/env python3
"""Pratinjau PNG peta web demo — dipakai untuk QC visual tanpa browser.

Peta TIDAK ditulis ulang di sini: script memanggil node untuk meminta hasil
buildMap() dari web/game.js (satu-satunya sumber aturan web), lalu sprite yang
sama dengan game di-composite. Test tools/web_selftest.js yang menjamin
web/game.js tetap sama dengan C#, jadi rantai kebenarannya:
  C# (SetupTool/ArtInstaller) <- selftest -> web/game.js <- script ini -> PNG.

  python3 tools/web_map_preview.py [--out ArtRaw/web_map_preview.png] [--tile 48]

Kamera HUD (uiKit.Camera2D / flag ?cam=0) tidak relevan di sini: render dilakukan
sendiri (fit penuh), jadi hasil PNG tidak berubah saat follow+zoom dinyalakan.
Butuh: node + pillow.
"""
import argparse
import json
import math
import os
import subprocess
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "web", "assets")


def node(code):
    return subprocess.run(["node", "-e", code], cwd=ROOT, check=True,
                          capture_output=True, text=True).stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "ArtRaw", "web_map_preview.png"))
    ap.add_argument("--tile", type=int, default=48, help="pixel per unit dunia")
    ap.add_argument("--players", type=int, default=6, help="jumlah pemain utk titik spawn")
    a = ap.parse_args()

    data = json.loads(node("""
const { buildMap, spawnFor, PROPS, TILES } = require('./web/game.js');
const m = buildMap();
console.log(JSON.stringify({
  cols: m.cols, rows: m.rows, halfX: m.halfX, halfY: m.halfY,
  tiles: Array.from(m.tiles), walls: m.walls,
  props: m.props.map(p => ({ wx: p.wx, wy: p.wy, name: p.def.name, sprite: p.def.sprite, w: p.def.w, h: p.def.h })),
  decor: m.decor, tiles_: TILES, propNames: PROPS.map(p => p.name),
  spawns: Array.from({ length: %d }, (_, i) => spawnFor(i + 1, %d)),
}));""" % (a.players, a.players)))

    T, hx, hy = a.tile, data["halfX"], data["halfY"]
    W = int((data["cols"] + 1) * T)
    H = int((data["rows"] + 3) * T)
    canvas = Image.new("RGB", (W, H), (8, 17, 13))
    ox, oy = W / 2.0, H / 2.0 - T
    cache = {}

    def load(name):
        if name not in cache:
            p = os.path.join(ASSETS, name + ".png")
            cache[name] = Image.open(p).convert("RGBA") if os.path.exists(p) else None
        return cache[name]

    def paste(name, cx, cy, w, h):
        im = load(name)
        if im is None:
            ImageDraw.Draw(canvas, "RGBA").rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
                                                      fill=(90, 90, 90, 255))
            return
        im = im.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)
        canvas.paste(im, (int(cx - im.width / 2), int(cy - im.height / 2)),
                     im if im.mode == "RGBA" else None)

    px = lambda wx: ox + wx * T
    py = lambda wy: oy - wy * T

    tiles_ = data["tiles_"]
    for gy in range(data["rows"]):
        for gx in range(data["cols"]):
            paste(tiles_[data["tiles"][gy * data["cols"] + gx]], px(gx - hx), py(hy - gy), T + 1, T + 1)
    for w in data["walls"]:
        paste("Hedge_Wall", px(w["cx"]), py(w["cy"]), w["w"] * T, w["h"] * T)
    for d in data["decor"]:
        paste(d["sprite"], px(d["wx"]), py(d["wy"]), 1.5 * T, 1.5 * T)
    dr = ImageDraw.Draw(canvas, "RGBA")
    for p in data["props"]:
        paste(p["sprite"], px(p["wx"]), py(p["wy"]), p["w"] * T, p["h"] * T)
        dr.rectangle([px(p["wx"]) - p["w"] * T / 2, py(p["wy"]) - p["h"] * T / 2,
                      px(p["wx"]) + p["w"] * T / 2, py(p["wy"]) + p["h"] * T / 2],
                     outline=(255, 120, 120, 110))
        dr.text((px(p["wx"]) - 26, py(p["wy"]) + p["h"] * T / 2 + 2), p["name"], fill=(235, 240, 235))
    paste("Chameleon_Seeker", px(0), py(0), 1.5 * T, 1.5 * T)
    dr.text((px(0) - 30, py(0) + 0.8 * T), "SEEKER spawn", fill=(255, 140, 140))
    for i, (sx, sy) in enumerate(data["spawns"]):
        dr.ellipse([px(sx) - 7, py(sy) - 7, px(sx) + 7, py(sy) + 7], outline=(255, 226, 122, 255), width=2)
        dr.text((px(sx) + 9, py(sy) - 7), "H" + str(i + 1), fill=(255, 226, 122))
    # rata-rata warna tiap tile = dasar skill Kamuflase (dihitung ulang dari sprite)
    from collections import defaultdict
    avg = {}
    for name in tiles_:
        im = load(name)
        if im is None:
            continue
        s = im.resize((16, 16), Image.LANCZOS).convert("RGB")
        pix = list(s.getdata())
        avg[name] = tuple(sum(c[i] for c in pix) // len(pix) for i in range(3))
    y = H - 34
    for name in tiles_:
        rgb = avg.get(name, (0, 0, 0))
        dr.rectangle([12, y, 30, y + 14], fill=rgb + (255,))
        dr.text((36, y - 2), f"{name} avg rgb {rgb}", fill=(220, 230, 220, 255))
        y -= 16
    dr.text((12, 6), "peta web demo = buildMap() di web/game.js (sprite dari Assets/Art/HideSeek)",
            fill=(230, 240, 232, 255))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    canvas.save(a.out, optimize=True)
    print("ok:", a.out, canvas.size, str(round(os.path.getsize(a.out) / 1024)) + " KB")


if __name__ == "__main__":
    main()

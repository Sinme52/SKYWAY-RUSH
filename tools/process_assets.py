#!/usr/bin/env python3
"""GPT Image で生成した原画 (assets/raw) を、ゲームで使うサイズに切り出し・縮小する。

使い方:  python3 tools/process_assets.py   (リポジトリの直下で実行)
"""
from pathlib import Path
import os

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "assets"
DEBUG_DIR = os.environ.get("TIRE_DEBUG_DIR")  # 指定するとタイヤのマスクを赤く塗った確認画像を書き出す


def crop_alpha(im, thresh=24):
    """アルファがほぼ 0 の余白を切り落とす。"""
    a = im.split()[-1].point(lambda v: 255 if v > thresh else 0)
    box = a.getbbox()
    return im.crop(box) if box else im


def fit_width(im, w):
    h = round(im.height * w / im.width)
    return im.resize((w, h), Image.LANCZOS)


def fit_height(im, h):
    w = round(im.width * h / im.height)
    return im.resize((w, h), Image.LANCZOS)


def save_png(im, name):
    im.save(OUT / name, optimize=True)
    print(name, im.size)


def save_jpg(im, name, q=86):
    im.convert("RGB").save(OUT / name, quality=q, optimize=True, progressive=True)
    print(name, im.size)


def split_components(im, count, thresh=200, step=4):
    """透過スプライトシートを、つながった領域ごとに切り出す（大きい順に count 個、左から並べる）。"""
    a = im.split()[-1]
    small = a.resize((im.width // step, im.height // step), Image.NEAREST)
    w, h = small.size
    px = small.load()
    label = [[0] * w for _ in range(h)]
    comps = []
    for y0 in range(h):
        for x0 in range(w):
            if px[x0, y0] <= thresh or label[y0][x0]:
                continue
            n = len(comps) + 1
            stack, cells = [(x0, y0)], []
            label[y0][x0] = n
            while stack:
                x, y = stack.pop()
                cells.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not label[ny][nx] and px[nx, ny] > thresh:
                        label[ny][nx] = n
                        stack.append((nx, ny))
            comps.append(cells)
    comps = sorted(comps, key=len, reverse=True)[:count]
    comps.sort(key=lambda c: min(x for x, _ in c))
    out = []
    for cells in comps:
        mask = Image.new("L", (w, h), 0)
        mp = mask.load()
        for x, y in cells:
            mp[x, y] = 255
        # 1 セルぶん広げてから原寸へ戻し、輪郭の半透明部分も残す
        mask = mask.filter(ImageFilter.MaxFilter(3)).resize(im.size, Image.NEAREST)
        part = im.copy()
        part.putalpha(Image.composite(a, Image.new("L", im.size, 0), mask))
        out.append(crop_alpha(part))
    return out


def components(mask):
    """2値マスクのつながった領域ごとに (ys, xs) の配列を返す。"""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    out = []
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        stack, ys, xs = [(y0, x0)], [], []
        seen[y0, x0] = True
        while stack:
            y, x = stack.pop()
            ys.append(y)
            xs.append(x)
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        out.append((np.array(ys), np.array(xs)))
    return out


def keep_large(mask, min_frac):
    """2値マスクのうち、面積が全体の min_frac 以上のつながった領域だけ残す。"""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    keep = np.zeros_like(mask)
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            stack, cells = [(y0, x0)], []
            seen[y0, x0] = True
            while stack:
                y, x = stack.pop()
                cells.append((y, x))
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if len(cells) >= min_frac * w * h:
                ys, xs = zip(*cells)
                keep[list(ys), list(xs)] = True
    return keep


def morph(mask, op, size):
    img = Image.fromarray((mask * 255).astype(np.uint8))
    f = ImageFilter.MaxFilter(size) if op == "grow" else ImageFilter.MinFilter(size)
    return np.asarray(img.filter(f)) > 0


def align(base, other, mask_body):
    """other を拡大縮小・平行移動して base の車体部分にいちばん重なる位置を探す。"""
    b = np.asarray(base).astype(np.float32)
    best = None
    for sc in np.arange(0.97, 1.031, 0.01):
        w = round(other.width * sc)
        h = round(other.height * sc)
        o = np.asarray(other.resize((w, h), Image.LANCZOS)).astype(np.float32)
        for dy in range(-8, 9):
            for dx in range(-8, 9):
                canvas = np.zeros_like(b)
                y0, x0 = max(0, dy), max(0, dx)
                y1, x1 = min(b.shape[0], dy + h), min(b.shape[1], dx + w)
                if y1 <= y0 or x1 <= x0:
                    continue
                canvas[y0:y1, x0:x1] = o[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
                err = np.abs(canvas[..., :3] - b[..., :3])[mask_body].mean()
                if best is None or err < best[0]:
                    best = (err, canvas)
    return best


def tire_frames(base_raw, spin_raw, width):
    """ベースの車と、タイヤだけ差し替えた『溝が進んだ絵』『高速回転の絵』を返す。

    spin_raw は base_raw を参照画像にして「タイヤだけ回転ぶれにして」と描かせた画像。
    構図はほぼ同じなので同じ範囲で切り出し、わずかなずれを探して合わせてから、
    「元の絵では暗く、回転の絵とは大きく違う」部分をタイヤとみなして差し替える。
    """
    a = np.asarray(base_raw)[..., 3]
    ys, xs = np.where(a > 128)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    base = fit_width(base_raw.crop(box), width)
    spin = fit_width(spin_raw.convert("RGBA").crop(box), width)
    b = np.asarray(base).astype(np.float32)
    rgb = b[..., :3]
    dark = (b[..., 3] > 200) & (rgb.max(-1) < 110) & (rgb.max(-1) - rgb.min(-1) < 60)
    err, aligned = align(base, spin, (b[..., 3] > 200) & ~dark)
    print(f"  spin frame aligned, body error {err:.1f}")
    # タイヤの決め方：
    # 1) 元の絵で暗く彩度の低い所を、細いつながりが切れるまで削ってから塊に分ける
    # 2) 生成画像との差が大きい画素（＝回転ぶれに描き変わった所）を多く含む塊だけ残す
    #    （車体の黒い部品は生成画像でもほぼ同じなので外れる）
    # 3) 削ったぶんを暗い所の中だけで広げ戻し、塊ごとまるごと差し替える
    #    （差の大きい画素だけを差し替えると、溝の模様が似た所が漏れてタイヤが止まって見える）
    diff = np.abs(aligned[..., :3] - rgb).max(-1)
    seeds = dark & (diff > 35)
    opened = morph(morph(dark, "shrink", 9), "grow", 9)
    tires = np.zeros_like(dark)
    for ys, xs in components(opened):
        if len(ys) >= 0.004 * dark.size and seeds[ys, xs].mean() > 0.12:
            tires[ys, xs] = True
    for _ in range(3):
        tires = morph(tires, "grow", 5) & dark
    tires = morph(morph(tires, "grow", 7), "shrink", 7) & (b[..., 3] > 200)
    print(f"  tire mask covers {tires.mean() * 100:.1f}% of the frame")
    if DEBUG_DIR:
        dbg = b.copy()
        dbg[tires, 0] = 255
        dbg[tires, 1] *= 0.4
        dbg[tires, 2] *= 0.4
        Image.fromarray(dbg.astype(np.uint8), "RGBA").save(Path(DEBUG_DIR) / f"mask_{base_raw.width}_{int(tires.sum())}.png")
    use = morph(tires, "grow", 3) & (aligned[..., 3] > 200) & (b[..., 3] > 0)
    spin_out = b.copy()
    spin_out[use, :3] = aligned[use, :3]
    # 低速：タイヤの内側だけ、溝を少し下へずらす（輪郭は残す）
    inner = morph(tires, "shrink", 7)
    roll = b.copy()
    shift = max(2, round(width * 0.018))
    moved = np.roll(b, shift, axis=0)
    ok = inner & np.roll(inner, shift, axis=0)
    roll[ok, :3] = moved[ok, :3]
    to_img = lambda arr: Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
    return base, to_img(roll), to_img(spin_out)

def main():
    # 車：通常・溝送り・高速回転の 3 コマ（真後ろと斜め後ろ）
    for view in ("rear", "turn"):
        frames = tire_frames(Image.open(RAW / f"car_{view}.png"), Image.open(RAW / f"car_{view}_spin.png"), 320)
        for name, im in zip(("", "_roll", "_spin"), frames):
            save_png(im, f"car_{view}{name}.png")
    save_jpg(Image.open(RAW / "road.png").resize((512, 512), Image.LANCZOS), "road.jpg")
    save_jpg(Image.open(RAW / "deck.png").resize((768, 256), Image.LANCZOS), "deck.jpg")

    pillar = crop_alpha(Image.open(RAW / "pillar.png"), 200)
    save_png(fit_width(pillar, 96), "pillar.png")

    # コースごとの空・地面・景色
    for suffix in ("", "_canyon", "_bay"):
        save_jpg(Image.open(RAW / f"sky{suffix}.png").resize((1536, 512), Image.LANCZOS), f"sky{suffix}.jpg")
        save_jpg(Image.open(RAW / f"ground{suffix}.png").resize((512, 512), Image.LANCZOS), f"ground{suffix}.jpg")
    sheets = {
        "scenery": ["palm", "tree", "rock", "windmill"],
        "scenery_canyon": ["cactus", "arch", "butte", "deadtree"],
        "scenery_bay": ["lighthouse", "sailboat", "islet", "buoy"],
    }
    for sheet, names in sheets.items():
        parts = split_components(Image.open(RAW / f"{sheet}.png"), len(names))
        if len(parts) != len(names):
            raise SystemExit(f"{sheet}: expected {len(names)} parts, got {len(parts)}")
        for name, part in zip(names, parts):
            save_png(fit_height(part, 320), f"{name}.png")

    save_png(fit_width(crop_alpha(Image.open(RAW / "gate.png"), 200), 768), "gate.png")
    save_png(fit_width(crop_alpha(Image.open(RAW / "logo.png"), 120), 768), "logo.png")


if __name__ == "__main__":
    main()

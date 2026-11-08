#!/usr/bin/env python3
"""NEGAN'S VISION - gorsel uretim scripti.

Kullanim:
  python render.py                      # queue.csv'deki tum satirlari isle
  python render.py --queue queue.csv --input input --output output
  python render.py --image input/a.jpg --text "Your sentence." --tone quiet --accent "sentence"
"""
import argparse
import colorsys
import csv
import json
import math
import os
import re
import threading
import sys
import zlib
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

import psdfile
import adjustments
import filters
import layerfx
import looks

# .exe olarak paketlenirse dosyalar (brand.json, fonts) exe'nin yaninda aranir
HERE = (Path(sys.executable).resolve().parent if getattr(sys, "frozen", False)
        else Path(__file__).resolve().parent)

FALLBACK_FONTS = {
    "quiet": ["DejaVuSerif.ttf", "DejaVuSans.ttf"],
    "hard": ["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"],
    "signature": ["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"],
}


# ----------------------------------------------------------------- yardimcilar
def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def load_font(cfg, role, size):
    candidates = [cfg["fonts"].get(role, "")] + FALLBACK_FONTS.get(role, [])
    for c in candidates:
        if not c:
            continue
        p = Path(c)
        if not p.is_absolute():
            p = HERE / p
        for attempt in (str(p), c):
            try:
                return ImageFont.truetype(attempt, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


def font_was_fallback(cfg, role):
    p = Path(cfg["fonts"].get(role, ""))
    if not p.is_absolute():
        p = HERE / p
    return not p.exists()


# ------------------------------------------------------------- gorsel isleme
def cover_crop(img, size, focus=(0.5, 0.5)):
    """4:5'e doldurarak kirp (EXIF yonunu duzelt)."""
    img = ImageOps.exif_transpose(img).convert("RGB")
    return ImageOps.fit(img, size, method=Image.LANCZOS, centering=focus)


def grade(img, cfg, seed, fx=None, grain_scale=1.0):
    """fx: {"bw": bool, "grain": 0..1+ (carpan), "vignette": 0..1+ (carpan),
            "look": hazir ayar (looks.apply) ya da None = klasik gorunum,
            "amount": 0..1 hazir ayarin yogunlugu, "adjust": ince ayar kaydiricilari}
    grain_scale: tuval 1080x1350'den buyukse gren tanesi de o oranda buyur (k, bkz. canvas_scale)."""
    s = dict(cfg["image"])
    if fx:
        if not fx.get("bw", True):
            s["saturation"] = s.get("color_saturation", 0.85)
        s["grain"] = s["grain"] * float(fx.get("grain", 1.0))
        s["vignette"] = s["vignette"] * float(fx.get("vignette", 1.0))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    src = arr  # akilli secim renk ayarlarindan onceki fotograf uzerinden yapilir
    for m in ((fx or {}).get("masks") or []) if fx else []:
        if m.get("fill"):  # alan silindi/tasindi: renk islemeden once doldurulur, sonuc renk ayarlarini izler
            key = json.dumps([m.get("ops"), m.get("refine"), m.get("feather"), m.get("invert")], sort_keys=True)
            arr = fill_region(np.clip(arr, 0, 1), mask_weight(m, *arr.shape[:2], src, (fx or {}).get("_matte")), src, key)
    if fx and fx.get("retouch"):  # cilt, frekans ayirma ve onarim: renk islemeden once, sonuc renk ayarlarini izler
        arr = apply_retouch(np.clip(arr, 0, 1), fx["retouch"], fx, src)
    look = fx.get("look") if fx else None
    if look is not None:
        graded = looks.apply(arr, look)
        amount = float(fx.get("amount", 1.0))
        arr = graded if amount >= 1 else arr + (graded - arr) * amount
        if fx.get("bw"):
            arr = np.repeat((arr @ looks.LUMA)[..., None], 3, axis=-1)
    else:
        gray = (arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
        arr = gray + (arr - gray) * s["saturation"]
        arr = (arr - 0.5) * s["contrast"] + 0.5
        arr = arr * s["brightness"]
    adjust = looks.adjust_look(fx.get("adjust")) if fx else {}
    if adjust:
        arr = looks.apply(np.clip(arr, 0, 1), adjust)
    if fx and fx.get("color"):  # renk ve isik duzenlemeleri
        arr = adjustments.apply(np.clip(arr, 0, 1), fx["color"], gauss)
    # detay: kullanicinin ayari + hazir ayarin netligi (yogunlukla)
    adj = (fx.get("adjust") or {}) if fx else {}
    clarity = float(adj.get("clarity") or 0) + float((look or {}).get("clarity") or 0) * float(fx.get("amount", 1.0) if fx else 1)
    sharpen, denoise = float(adj.get("sharpen") or 0), float(adj.get("denoise") or 0)
    if sharpen or clarity or denoise:
        arr = detail(arr, sharpen, max(-1.0, min(1.0, clarity)), denoise, grain_scale)

    matte_fn = (fx or {}).get("_matte") if fx else None  # konu maskesi: boyut -> 0..1 dizi (sunucu saglar)
    for m in ((fx or {}).get("masks") or []) if fx else []:
        arr = apply_mask(arr, m, grain_scale, src, matte_fn)
    if fx and fx.get("filters"):
        arr = filters.apply(np.clip(arr, 0, 1), fx["filters"], gauss, lambda q: mask_weight(q, *arr.shape[:2], src, matte_fn), matte_fn, fx.get("_filter_k"))

    tex = ((fx or {}).get("texture") or {}) if fx else {}
    if tex.get("bloom"):
        arr = bloom(arr, float(tex["bloom"]), grain_scale)
    if tex.get("leak"):
        arr = light_leak(arr, float(tex["leak"]), int(tex.get("variant") or 0), seed)

    h, w = arr.shape[:2]
    if s["vignette"] > 0:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
        arr = arr * (1.0 - s["vignette"] * r ** 2)[..., None]

    if s["grain"] > 0:
        rng = np.random.default_rng(seed)
        nh, nw = (h, w) if abs(grain_scale - 1) < 1e-3 else (max(1, round(h / grain_scale)), max(1, round(w / grain_scale)))
        noise = rng.normal(0.0, s["grain"], (nh, nw)).astype(np.float32)
        noise_img = Image.fromarray(np.clip(noise * 2 * 127.5 + 127.5, 0, 255).astype(np.uint8), "L")
        noise_img = noise_img.filter(ImageFilter.GaussianBlur(0.6))
        if (nh, nw) != (h, w):
            noise_img = noise_img.resize((w, h), Image.BILINEAR)
        noise = (np.asarray(noise_img, dtype=np.float32) - 127.5) / 127.5 * 1.6
        arr = arr + noise[..., None]

    img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGB")
    bg = ((fx or {}).get("background") or {}) if fx else {}
    if bg.get("mode") in BG_MODES:
        if matte_fn is None:
            raise ValueError("Arka plan için yapay zekâ modeli gerekli.")
        matte = matte_fn(img.size)
        if bg.get("edge"):
            matte = guided_refine(matte, np.asarray(img, np.float32) / 255.0, max(1.0, float(bg["edge"]) * 0.04 * min(img.size)))
        img = apply_background(img, matte, bg, grain_scale)
    if tex.get("dust"):
        img = dust(img, float(tex["dust"]), seed, grain_scale)
    frame = ((fx or {}).get("frame") or {}) if fx else {}
    if frame.get("style") in FRAME_STYLES:
        img = apply_frame(img, frame)
    return img


# ------------------------------------------------------------ yerel duzenlemeler
# mask: {"type": "linear", "a": [x, y], "b": [x, y]}  a'da tam etki, b'de sifir
#       {"type": "radial", "c": [x, y], "r": [rx, ry], "feather": 0..1}  icte tam etki
#       ortak: "invert", "adjust": {exposure, contrast, highlights, shadows, temperature, tint, saturation, clarity}
# Koordinatlar tuvale gore 0..1 (rx genislige, ry yukseklige oranli): her cozunurlukte ayni yer.
MASK_KEYS = ("exposure", "contrast", "highlights", "shadows", "temperature", "tint", "saturation", "clarity")


def mask_weight(m, h, w, src=None, matte_fn=None):
    if m.get("type") == "select":
        wgt = select_weight(m, src if src is not None else np.zeros((h, w, 3), np.float32), matte_fn)
        return (1 - wgt if m.get("invert") else wgt).astype(np.float32)
    X = ((np.arange(w, dtype=np.float32) + 0.5))[None, :]
    Y = ((np.arange(h, dtype=np.float32) + 0.5))[:, None]
    if m.get("type") == "linear":
        ax, ay = m["a"][0] * w, m["a"][1] * h
        bx, by = m["b"][0] * w, m["b"][1] * h
        dx, dy = bx - ax, by - ay
        t = ((X - ax) * dx + (Y - ay) * dy) / max(dx * dx + dy * dy, 1e-6)
        wgt = 1 - looks._smooth(0.0, 1.0, t)
    else:
        cx, cy = m["c"][0] * w, m["c"][1] * h
        rx, ry = max(m["r"][0] * w, 1.0), max(m["r"][1] * h, 1.0)
        d = np.sqrt(((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2)
        f = max(0.02, float(m.get("feather", 0.5)))
        wgt = 1 - looks._smooth(1 - f, 1.0, d)
    if m.get("invert"):
        wgt = 1 - wgt
    return wgt.astype(np.float32)


def _smooth_fill(arr, known):
    """Cevreden yumusak dolgu: cok olcekli normalize bulaniklastirma (kaynak bulunamazsa son care)."""
    h, w = arr.shape[:2]
    known = known.astype(np.float32)
    est = (arr * known[..., None]).sum((0, 1)) / max(float(known.sum()), 1.0)
    est = np.broadcast_to(est, arr.shape).astype(np.float32)
    for f in (0.3, 0.12, 0.05, 0.02, 0.008):
        s = max(1.0, max(h, w) * f)
        den = gauss(known, s)
        e = gauss(arr * known[..., None], s) / np.maximum(den, 1e-4)[..., None]
        conf = np.clip(den * 3, 0, 1)[..., None]
        est = est * (1 - conf) + e * conf
    return est


# ------------------------------------------------------------ icerige duyarli dolgu
# PatchMatch: her bos piksele resmin baska yerinden en benzer yamayi bulur (kaba-ince piramit).
# Sonuc piksel degil "su piksel suradan gelsin" haritasidir: renk ayarlari degisince yeniden hesap gerekmez.
_PATCH_R = 3
_PATCH = np.array([(y, x) for y in range(-_PATCH_R, _PATCH_R + 1) for x in range(-_PATCH_R, _PATCH_R + 1)])
_FILLS = {}


def _resize_rgb(a, size):
    return np.dstack([_resize_f(a[..., i], size) for i in range(3)])


def _patch_level(I, J, hole, Ty, Tx, valid, rng, iters):
    """Bir piramit katinda en iyi yamalari arar, J'yi yeniden kurar."""
    H, W = hole.shape
    ys, xs = np.nonzero(hole)
    py, px = _PATCH[:, 0][None], _PATCH[:, 1][None]
    Y, X = ys[:, None] + py, xs[:, None] + px
    Y0, X0 = np.clip(Y, 0, H - 1), np.clip(X, 0, W - 1)
    known = (~hole).astype(np.float32)
    conf = np.maximum(known, gauss(known, 2.5) * 0.9, gauss(known, 6.0) * 0.5) + 0.02
    C = conf[Y0, X0]

    def cost(ty, tx):
        return (((J[Y0, X0] - J[np.clip(ty[:, None] + py, 0, H - 1), np.clip(tx[:, None] + px, 0, W - 1)]) ** 2).sum(2) * C).sum(1)

    best = cost(Ty[ys, xs], Tx[ys, xs])

    def attempt(cy, cx):
        nonlocal best
        cy, cx = np.clip(cy, 0, H - 1), np.clip(cx, 0, W - 1)
        ok = valid[cy, cx]
        c = np.full(len(ys), np.inf, np.float32)
        if ok.any():
            c[ok] = cost(cy[ok], cx[ok]) if ok.all() else _partial(cy, cx, ok)
        better = c < best
        Ty[ys[better], xs[better]], Tx[ys[better], xs[better]] = cy[better], cx[better]
        best = np.where(better, c, best)

    def _partial(cy, cx, ok):
        return (((J[Y0[ok], X0[ok]] - J[np.clip(cy[ok][:, None] + py, 0, H - 1), np.clip(cx[ok][:, None] + px, 0, W - 1)]) ** 2).sum(2) * C[ok]).sum(1)

    for it in range(iters):
        for s in (1, -1) if it % 2 == 0 else (-1, 1):  # komsudan yayilim
            for dy, dx in ((0, s), (s, 0)):
                ny, nx = np.clip(ys - dy, 0, H - 1), np.clip(xs - dx, 0, W - 1)
                inside = hole[ny, nx]
                attempt(np.where(inside, Ty[ny, nx] + dy, Ty[ys, xs]), np.where(inside, Tx[ny, nx] + dx, Tx[ys, xs]))
        r = max(H, W)
        while r >= 1:  # rastgele arama
            attempt(Ty[ys, xs] + rng.integers(-r, r + 1, len(ys)), Tx[ys, xs] + rng.integers(-r, r + 1, len(ys)))
            r //= 2
        # oylama: her piksel kendisini kapsayan yamalarin ortalamasi
        total = np.zeros((H, W, 3), np.float32)
        count = np.zeros((H, W), np.float32)
        for oy in range(-1, 2):
            for ox in range(-1, 2):
                qy, qx = ys + oy, xs + ox
                keep = (qy >= 0) & (qy < H) & (qx >= 0) & (qx < W)
                qy, qx = qy[keep], qx[keep]
                inside = hole[qy, qx]
                qy, qx = qy[inside], qx[inside]
                ty, tx = np.clip(Ty[qy, qx] - oy, 0, H - 1), np.clip(Tx[qy, qx] - ox, 0, W - 1)
                ry, rx = qy - oy, qx - ox
                ins = (ry >= 0) & (ry < H) & (rx >= 0) & (rx < W)
                np.add.at(total, (ry[ins], rx[ins]), J[ty[ins], tx[ins]])
                np.add.at(count, (ry[ins], rx[ins]), 1.0)
        n = count[ys, xs] > 0
        J[ys[n], xs[n]] = total[ys[n], xs[n]] / count[ys[n], xs[n]][..., None]
        best = cost(Ty[ys, xs], Tx[ys, xs])


def patch_fill(rgb, hole):
    """hole pikselleri icin kaynak koordinatlari: (hy, hx, sy, sx) ya da kaynak yoksa None."""
    H, W = hole.shape
    ys, xs = np.nonzero(hole)
    if not len(ys):
        return None
    t, b, l, r = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    m = int(max(b - t, r - l) * 0.9) + 40  # cevreden yeterli kaynak alani
    t, b, l, r = max(0, t - m), min(H, b + m), max(0, l - m), min(W, r + m)
    crop, ch = rgb[t:b, l:r].astype(np.float32), hole[t:b, l:r]
    h0, w0 = ch.shape
    f = min(1.0, 512 / max(h0, w0))
    size = (max(16, round(w0 * f)), max(16, round(h0 * f)))
    I0 = _resize_rgb(crop, size) if f < 1 else crop
    H0 = (_resize_f(ch, size) > 0.05) if f < 1 else ch.copy()
    # piramit: bosluk en fazla ~24 piksel olana kadar
    pyr = [(I0, H0)]
    while len(pyr) < 7 and min(pyr[-1][1].shape) >= 40 and pyr[-1][1].any():
        hh, ww = pyr[-1][1].shape
        sz = (ww // 2, hh // 2)
        yy, xx = np.nonzero(pyr[-1][1])
        if max(int(yy.max()) - int(yy.min()), int(xx.max()) - int(xx.min())) <= 12:
            break
        pyr.append((_resize_rgb(pyr[-1][0], sz), _resize_f(pyr[-1][1], sz) > 0.02))
    rng = np.random.default_rng(5)
    Ty, Tx, J_prev = None, None, None
    for lvl in range(len(pyr) - 1, -1, -1):
        I, hl = pyr[lvl]
        hh, ww = hl.shape
        grown = _dilate(hl, _PATCH_R)
        valid = ~grown
        valid[:_PATCH_R], valid[-_PATCH_R:], valid[:, :_PATCH_R], valid[:, -_PATCH_R:] = False, False, False, False
        if not valid.any():
            return None
        vy, vx = np.nonzero(valid)
        J = I.copy()
        gy, gx = np.mgrid[0:hh, 0:ww]
        if Ty is None:
            pick = rng.integers(0, len(vy), hl.shape)
            Ty, Tx = vy[pick], vx[pick]
            J[hl] = _smooth_fill(I, ~hl)[hl]
        else:
            Ty = np.asarray(Image.fromarray(Ty.astype(np.int32), "I").resize((ww, hh), Image.NEAREST)) * 2
            Tx = np.asarray(Image.fromarray(Tx.astype(np.int32), "I").resize((ww, hh), Image.NEAREST)) * 2
            Ty, Tx = np.clip(Ty, 0, hh - 1).copy(), np.clip(Tx, 0, ww - 1).copy()
            bad = hl & ~valid[Ty, Tx]
            if bad.any():
                pick = rng.integers(0, len(vy), int(bad.sum()))
                Ty[bad], Tx[bad] = vy[pick], vx[pick]
            J[hl] = _resize_rgb(J_prev, (ww, hh))[hl]
        _patch_level(I, J, hl, Ty, Tx, valid, rng, 10 if lvl == len(pyr) - 1 else 4)
        J_prev = J
    # harita tam cozunurluge: kaydirma alani en yakin komsuyla buyur, pikseller kaynagindan keskin kopyalanir
    gy, gx = np.mgrid[0:size[1], 0:size[0]]
    oy, ox = (Ty - gy) / f, (Tx - gx) / f
    if f < 1:
        oy = _resize_nearest(oy, (w0, h0))
        ox = _resize_nearest(ox, (w0, h0))
    hy, hx = np.nonzero(ch)
    sy = np.clip(hy + np.round(oy[hy, hx]).astype(np.int32), 0, h0 - 1)
    sx = np.clip(hx + np.round(ox[hy, hx]).astype(np.int32), 0, w0 - 1)
    return hy + t, hx + l, sy + t, sx + l


def _resize_nearest(a, size):
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize(size, Image.NEAREST), np.float32)


def filled_map(rgb, hole, key):
    k = (key, hole.shape, zlib.crc32(np.packbits(hole).tobytes()))
    return _cached(_FILLS, k, lambda: patch_fill(rgb, hole), 12)


INPAINT_FN = None  # sunucu: yapay zeka dolgusu (LaMa) kuruluysa (rgb, hole) -> rgb dondurur; yoksa None


def _ai_fill(arr, hole, key):
    """Boslugun cevresinden kare kirpip modele verir (model 512x512 calisir); sonuc onbellekte."""
    h, w = hole.shape
    ys, xs = np.nonzero(hole)
    t, b, l, r = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    side = max(256, int(max(b - t, r - l) * 1.8))
    cy, cx = (t + b) // 2, (l + r) // 2
    t2, l2 = max(0, min(cy - side // 2, h - side)), max(0, min(cx - side // 2, w - side))
    b2, r2 = min(h, t2 + side), min(w, l2 + side)
    crop, ch = arr[t2:b2, l2:r2, :3], hole[t2:b2, l2:r2]
    k = ("ai", key, hole.shape, zlib.crc32(np.packbits(hole).tobytes()), zlib.crc32((crop[::9, ::9] * 255).astype(np.uint8).tobytes()))
    filled = _cached(_FILLS, k, lambda: INPAINT_FN(crop, ch), 16)
    out = arr.copy()
    region = out[t2:b2, l2:r2]
    region[..., :3] = np.where(ch[..., None], filled, region[..., :3])
    return out


def inpaint(arr, core, guide=None, key="", ai=True):
    """core alanini doldurur -> (sonuc, kaplama 0..1). Yapay zeka modeli varsa onunla; yoksa yama eslestirmeyle.
    Yamada dolgu kenardan tasirilir: tasan seritte gercek piksellerle farki olculur ve icerige yayilir (dikissiz)."""
    h, w = core.shape
    band_r = max(3, round(min(h, w) * 0.012))
    if ai and INPAINT_FN and core.any():
        mr = max(2, round(min(h, w) * 0.005))  # nesnenin kenarindaki karisik pikseller de gitsin
        out = _ai_fill(arr, _dilate(core, mr), key)
        cover = np.clip(gauss(_dilate(core, mr).astype(np.float32), 1.5) * 1.3 - 0.15, 0, 1)
        return out, np.maximum(cover, core.astype(np.float32))
    hole = _dilate(core, band_r)
    mapping = filled_map(guide if guide is not None else arr, hole, key)
    if mapping is None:
        return _smooth_fill(arr, ~hole), hole.astype(np.float32)
    hy, hx, sy, sx = mapping
    out = arr.copy()
    out[hy, hx] = arr[sy, sx]
    t, b, l, r = int(hy.min()), int(hy.max()) + 1, int(hx.min()), int(hx.max()) + 1
    band = hole[t:b, l:r] & ~core[t:b, l:r]
    if band.any():
        d = (arr[t:b, l:r] - out[t:b, l:r]).astype(np.float32)
        fix = np.clip(gauss(_smooth_fill(d, band), float(band_r)), -0.25, 0.25)  # yalnizca yavas degisen ton farki
        c = out[t:b, l:r]
        out[t:b, l:r] = np.where(hole[t:b, l:r][..., None], np.clip(c + fix, 0, 1), c)
    cover = np.clip(gauss(_dilate(core, band_r // 2).astype(np.float32), max(1.0, band_r * 0.35)) * 1.25 - 0.1, 0, 1)
    return out, np.maximum(cover, core.astype(np.float32))


def fill_region(arr, wgt, guide=None, key="", ai=True):
    """Secilen alani icerige duyarli doldurur. guide: yamalarin arandigi goruntu (renk ayarlarindan bagimsiz)."""
    out, cover = inpaint(arr, wgt > 0.3, guide, key, ai)
    a = np.maximum(cover, wgt)[..., None]
    return arr * (1 - a) + out * a


def apply_mask(arr, m, k=1.0, src=None, matte_fn=None):
    adj = m.get("adjust") or {}
    look = {key: adj[key] for key in MASK_KEYS if key != "clarity" and adj.get(key)}
    clarity = float(adj.get("clarity") or 0)
    if not look and not clarity:
        return arr
    arr = np.clip(arr, 0, 1)
    out = looks.apply(arr, look) if look else arr
    if clarity:
        out = detail(out, 0.0, clarity, 0.0, k)
    wgt = mask_weight(m, *arr.shape[:2], src, matte_fn)[..., None]
    return arr + (out - arr) * wgt


# ------------------------------------------------------------ akilli secim
# {"type": "select", "ops": [...], "feather": 0..1, "invert", "adjust"}
#   wand:  {"kind": "wand", "p": [x, y], "tol": 0..1, "contiguous": bool, "add": bool}
#   brush: {"kind": "brush", "pts": [[x, y], ...], "r": yaricap (kisa kenara oranli), "hard": 0..1, "add": bool}
# Adimlar saklanir, piksel degil: her cozunurlukte ayni secim yeniden hesaplanir.
WAND_W = np.array([1.0, 1.25, 0.85], np.float32)  # yesile biraz daha duyarli (goz gibi)
WAND_GRID = 256  # bitisik bolge bu boyutta bulunur, kenarlar tam cozunurlukte rafine edilir


def _color_dist(src, seed):
    return np.sqrt((((src - seed) * WAND_W) ** 2).sum(-1))


def wand_region(src, op):
    h, w = src.shape[:2]
    sx = min(w - 1, max(0, int(op["p"][0] * w)))
    sy = min(h - 1, max(0, int(op["p"][1] * h)))
    rr = max(1, round(min(h, w) / 200))
    seed = src[max(0, sy - rr):sy + rr + 1, max(0, sx - rr):sx + rr + 1].reshape(-1, 3).mean(0)
    thr = 0.03 + 0.5 * float(op.get("tol", 0.3))
    within = _color_dist(src, seed) < thr
    if not op.get("contiguous", True):
        return within.astype(np.float32)
    # bitisik bolge: kucuk izgarada tasma doldurma, sonra tam cozunurlukte renk kosuluyla kirp
    f = min(1.0, WAND_GRID / max(h, w))
    gw, gh = max(1, round(w * f)), max(1, round(h * f))
    small = np.asarray(Image.fromarray((np.clip(src, 0, 1) * 255).astype(np.uint8)).resize((gw, gh), Image.BILINEAR),
                       np.float32) / 255.0
    ok = _color_dist(small, seed) < thr
    gx, gy = min(gw - 1, int(sx * f)), min(gh - 1, int(sy * f))
    region = np.zeros((gh, gw), bool)
    if ok[gy, gx]:
        region[gy, gx] = True
        stack = [(gy, gx)]
        while stack:
            y, x = stack.pop()
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < gh and 0 <= nx < gw and ok[ny, nx] and not region[ny, nx]:
                    region[ny, nx] = True
                    stack.append((ny, nx))
    up = np.asarray(Image.fromarray(region.astype(np.uint8) * 255).resize((w, h), Image.BILINEAR), np.float32) / 255.0
    grow = gauss(up, max(1.0, 1.5 / f)) > 0.02
    out = within & grow
    out[sy, sx] = True
    return out.astype(np.float32)


def brush_region(h, w, op):
    pts = [(x * w, y * h) for x, y in op.get("pts") or []]
    if not pts:
        return np.zeros((h, w), np.float32)
    r = max(0.5, float(op.get("r", 0.03)) * min(h, w))
    layer = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(layer)
    if len(pts) > 1:
        d.line(pts, fill=255, width=max(1, round(2 * r)), joint="curve")
    for x, y in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
    out = np.asarray(layer, np.float32) / 255.0
    soft = (1 - float(op.get("hard", 0.6))) * r * 0.6
    return gauss(out, soft) if soft >= 1 else out


# ------------------------------------------------------------ selection tool
# Tum adimlar 0..1 koordinatli ve sirayla uygulanir; "add": False cikarir, "intersect": True kesistirir.
#   rect/ellipse/object: {"box": [x0, y0, x1, y1]}   row: {"y"}   col: {"x"}
#   poly/magnetic: {"pts": [[x, y], ...]}            quick: {"pts", "r", "tol"}
#   range: {"p", "tol"}   focus: {"amt"}   sky: {}
#   duzenleme (o ana kadarki secimi degistirir): invert, expand/contract/feather/smooth/border {"amt"}, grow/similar {"tol"}
MODIFY_OPS = ("invert", "expand", "contract", "feather", "smooth", "border", "grow", "similar")


def _resize_f(a, size):
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize(size, Image.BILINEAR), np.float32)


def _small(src, side):
    h, w = src.shape[:2]
    f = min(1.0, side / max(h, w))
    if f >= 1:
        return src
    size = (max(1, round(w * f)), max(1, round(h * f)))
    return np.asarray(Image.fromarray((np.clip(src, 0, 1) * 255).astype(np.uint8)).resize(size, Image.BILINEAR), np.float32) / 255.0


def _flood(ok, seeds):
    """seeds'ten baslayip ok icinde bitisik alan."""
    gh, gw = ok.shape
    region = seeds.copy()
    stack = list(zip(*np.nonzero(region)))
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < gh and 0 <= nx < gw and ok[ny, nx] and not region[ny, nx]:
                region[ny, nx] = True
                stack.append((ny, nx))
    return region


def _dilate(b, r):
    """Kare yapi elemaniyla genisletme (tam sayi toplamla, yaricaptan bagimsiz hiz)."""
    if r < 1:
        return b
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(b.astype(np.int32), pad), axis=axis)
        n = b.shape[axis]
        hi, lo = [slice(None)] * 2, [slice(None)] * 2
        hi[axis], lo[axis] = slice(2 * r + 1, 2 * r + 1 + n), slice(0, n)
        b = (c[tuple(hi)] - c[tuple(lo)]) > 0
    return b


def _expand(a, r):
    """Secimi r piksel genisletir. Gauss es-yuzeyi kose yuvarlatir; ince seritler icin kare genisletme de eklenir."""
    if r < 0.5:
        return a
    sigma = max(0.6, r / 1.5)
    ramp = np.clip((gauss(a.astype(np.float32), sigma) - 0.0668) * sigma / 0.1295 + 0.5, 0, 1)
    square = _dilate(a > 0.5, max(1, int(r * 0.7))).astype(np.float32)
    return np.maximum(np.maximum(ramp, square), a)


def _contract(a, r):
    return 1 - _expand(1 - a, r)


def _top_colors(pixels, n=8):
    """Bir bolgenin baskin renkleri (kaba renk kutularinin ortalamalari)."""
    if not len(pixels):
        return np.zeros((1, 3), np.float32)
    keys = (np.clip(pixels, 0, 0.999) * 16).astype(np.int32) @ np.array([256, 16, 1])
    uniq, inv, counts = np.unique(keys, return_inverse=True, return_counts=True)
    top = np.argsort(-counts)[:n]
    return np.array([pixels[inv.ravel() == i].mean(0) for i in top], np.float32)


def _near(a, colors):
    return np.min([_color_dist(a, c) for c in colors], axis=0)


def _seed(src, p):
    h, w = src.shape[:2]
    sx, sy = min(w - 1, max(0, int(p[0] * w))), min(h - 1, max(0, int(p[1] * h)))
    rr = max(1, round(min(h, w) / 200))
    return src[max(0, sy - rr):sy + rr + 1, max(0, sx - rr):sx + rr + 1].reshape(-1, 3).mean(0)


def _antialiased(h, w, paint):
    s = 2 if max(h, w) <= 3000 else 1
    layer = Image.new("L", (w * s, h * s), 0)
    paint(ImageDraw.Draw(layer), w * s, h * s)
    if s > 1:
        layer = layer.resize((w, h), Image.BOX)
    return np.asarray(layer, np.float32) / 255.0


def shape_region(h, w, op):
    x0, y0, x1, y1 = op["box"]
    box = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

    def paint(d, W, H):
        xy = [box[0] * W, box[1] * H, box[2] * W - 1, box[3] * H - 1]
        (d.ellipse if op["kind"] == "ellipse" else d.rectangle)(xy, fill=255)
    return _antialiased(h, w, paint)


def line_region(h, w, op):
    out = np.zeros((h, w), np.float32)
    if op["kind"] == "row":
        out[min(h - 1, max(0, int(op["y"] * h))), :] = 1
    else:
        out[:, min(w - 1, max(0, int(op["x"] * w)))] = 1
    return out


def polygon_region(h, w, pts):
    return _antialiased(h, w, lambda d, W, H: d.polygon([(x * W, y * H) for x, y in pts], fill=255))


def snap_path(src, pts):
    """Manyetik kement: cizilen yolu en yakin belirgin kenara yapistirir."""
    small = _small(src, 640)
    gh, gw = small.shape[:2]
    g = gauss((small @ looks.LUMA).astype(np.float32), 1.0)
    gy, gx = np.gradient(g)
    edge = np.hypot(gx, gy)
    P = np.array(pts, np.float64) * [gw, gh]
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]
    t = np.linspace(0, d[-1], max(8, int(d[-1] / 3)))
    P = np.c_[np.interp(t, d, P[:, 0]), np.interp(t, d, P[:, 1])]
    T = np.gradient(P, axis=0)
    N = np.c_[-T[:, 1], T[:, 0]] / np.maximum(np.hypot(T[:, 0], T[:, 1]), 1e-6)[:, None]
    R = 7
    ts = np.arange(-R, R + 1)
    X = np.clip((P[:, 0, None] + N[:, 0, None] * ts).astype(np.int32), 0, gw - 1)
    Y = np.clip((P[:, 1, None] + N[:, 1, None] * ts).astype(np.int32), 0, gh - 1)
    score = edge[Y, X] * (1 - 0.35 * np.abs(ts) / R)
    best = ts[score.argmax(1)].astype(np.float64)
    best[score.max(1) < 0.015] = 0  # yakinda kenar yoksa cizilen yolda kal
    best = np.convolve(np.pad(best, 3, mode="edge"), np.ones(7) / 7, mode="valid")
    return ((P + N * best[:, None]) / [gw, gh]).tolist()


def quick_region(src, op):
    """Hizli secim: firca altindaki renklerden kenara kadar buyur, firca cevresinden fazla tasmaz."""
    h, w = src.shape[:2]
    small = _small(src, 384)
    gh, gw = small.shape[:2]
    stroke = brush_region(gh, gw, {**op, "hard": 1.0}) > 0.5
    if not stroke.any():
        return np.zeros((h, w), np.float32)
    colors = _top_colors(small[stroke], 6)
    thr = 0.03 + 0.4 * float(op.get("tol", 0.25))
    limit = _dilate(stroke, max(2, round(float(op.get("r", 0.03)) * min(gh, gw) * 5)))
    region = _flood((_near(small, colors) < thr) & limit, stroke)
    mid = _small(src, 1200)
    up = _resize_f(region, (mid.shape[1], mid.shape[0]))
    fine = (gauss(up, 2.0) > 0.05) & (_near(mid, colors) < thr) | (up > 0.9)
    return np.clip(_resize_f(fine, (w, h)), 0, 1)


def range_region(src, op):
    """Renk araligi: tiklanan renge benzerlige gore yumusak, resmin tamaminda secim."""
    thr = 0.03 + 0.5 * float(op.get("tol", 0.3))
    return np.clip(1 - (_color_dist(src, _seed(src, op["p"])) - thr * 0.6) / (thr * 0.4 + 1e-3), 0, 1).astype(np.float32)


def focus_region(src, op):
    """Odak alani: yerel keskinligi yuksek bolgeler."""
    h, w = src.shape[:2]
    small = _small(src, 640)
    g = (small @ looks.LUMA).astype(np.float32)
    e = gauss(np.abs(g - gauss(g, 1.5)), min(g.shape) * 0.035)
    n = e / max(float(np.percentile(e, 98)), 1e-5)
    return np.clip(_resize_f(np.clip((n - (0.75 - 0.6 * float(op.get("amt", 0.5)))) / 0.12, 0, 1), (w, h)), 0, 1)


def sky_region(src, matte_fn=None):
    """Gokyuzu: ustten baslayan, dokusuz, mavi/beyaz/gun batimi tonlu bitisik alan; konu varsa cikarilir."""
    h, w = src.shape[:2]
    small = _small(src, 384)
    gh, gw = small.shape[:2]
    r, g, b = small[..., 0], small[..., 1], small[..., 2]
    lum, sat = small @ looks.LUMA, small.max(-1) - small.min(-1)
    gy, gx = np.gradient(lum.astype(np.float32))
    tex = gauss(np.hypot(gx, gy).astype(np.float32), 1.5)
    top = (np.arange(gh)[:, None] < gh * 0.6)
    cand = (((b >= r - 0.02) & (lum > 0.25)) | ((lum > 0.72) & (sat < 0.22)) | ((lum > 0.45) & (r > b) & (sat < 0.6) & top)) & (tex < 0.035)
    seeds = np.zeros_like(cand)
    seeds[:max(1, round(gh * 0.03))] = True
    region = _flood(cand, seeds & cand)
    if matte_fn is not None and getattr(matte_fn, "ready", False):
        region &= matte_fn((gw, gh)) < 0.5
    closed = gauss(region.astype(np.float32), 2.0) > 0.5
    return np.clip((_resize_f(closed, (w, h)) - 0.5) * 3 + 0.5, 0, 1)


def _object_by_color(crop):
    """Yapay zeka yoksa nesne secimi: kutunun kenarindan ulasilan benzer renkler arka plandir, kalani nesnedir."""
    h, w = crop.shape[:2]
    small = _small(crop, 256)
    gh, gw = small.shape[:2]
    edge = np.zeros((gh, gw), bool)
    edge[[0, -1], :] = True
    edge[:, [0, -1]] = True
    ok = _near(small, _top_colors(small[edge], 6)) < 0.14
    background = _flood(ok, edge & ok)
    return np.clip((_resize_f(gauss((~background).astype(np.float32), 1.0), (w, h)) - 0.5) * 3 + 0.5, 0, 1)


def object_region(src, op, matte_fn=None):
    h, w = src.shape[:2]
    x0, y0, x1, y1 = op["box"]
    l, r = sorted((max(0, int(x0 * w)), min(w, round(x1 * w))))
    t, b = sorted((max(0, int(y0 * h)), min(h, round(y1 * h))))
    out = np.zeros((h, w), np.float32)
    if r - l < 2 or b - t < 2:
        return out
    crop = src[t:b, l:r]
    cut = getattr(matte_fn, "crop", None)
    found = cut(crop, op["box"]) if cut and getattr(matte_fn, "ready", False) else None
    # model kutuda belirgin bir nesne bulamazsa renk ayrimina don
    out[t:b, l:r] = found if found is not None and (found > 0.5).mean() >= 0.03 else _object_by_color(crop)
    return out


def modify_selection(src, out, op):
    h, w = src.shape[:2]
    kind, r = op["kind"], float(op.get("amt", 0)) * min(h, w)
    if kind == "invert":
        return 1 - out
    if kind == "expand":
        return _expand(out, r)
    if kind == "contract":
        return _contract(out, r)
    if kind == "feather":
        return gauss(out, r)
    if kind == "smooth":
        return np.clip((gauss(out, r) - 0.5) * 3 + 0.5, 0, 1)
    if kind == "border":
        return np.clip(_expand(out, r / 2) - _contract(out, r / 2), 0, 1)
    # grow / similar
    side = 384 if kind == "grow" else 1200
    small = _small(src, side)
    gh, gw = small.shape[:2]
    sel = _resize_f(out, (gw, gh)) > 0.5
    if not sel.any():
        return out
    near = _near(small, _top_colors(small[sel])) < 0.03 + 0.5 * float(op.get("tol", 0.3))
    region = _flood(near | sel, sel) if kind == "grow" else near | sel
    return np.maximum(out, np.clip(_resize_f(region, (w, h)), 0, 1))


def op_region(src, op, matte_fn=None):
    h, w = src.shape[:2]
    kind = op.get("kind")
    if kind == "subject":  # yapay zeka konu maskesi (inverse: arka plan)
        if matte_fn is None:
            raise ValueError("Konu seçimi için yapay zekâ modeli gerekli.")
        reg = matte_fn((w, h))
        return 1 - reg if op.get("inverse") else reg
    if kind == "wand":
        return wand_region(src, op)
    if kind in ("rect", "ellipse"):
        return shape_region(h, w, op)
    if kind in ("row", "col"):
        return line_region(h, w, op)
    if kind == "poly":
        return polygon_region(h, w, op["pts"])
    if kind == "magnetic":
        return polygon_region(h, w, snap_path(src, op["pts"]))
    if kind == "object":
        return object_region(src, op, matte_fn)
    if kind == "quick":
        return quick_region(src, op)
    if kind == "range":
        return range_region(src, op)
    if kind == "focus":
        return focus_region(src, op)
    if kind == "sky":
        return sky_region(src, matte_fn)
    return brush_region(h, w, op)


def guided_refine(p, rgb, r, eps=2e-3):
    """Kenar iyilestirme: secimi goruntunun kenarlarina oturtur (sac gibi ince ayrintilar icin yonlendirmeli suzgec)."""
    I = (rgb @ looks.LUMA).astype(np.float32)
    p = p.astype(np.float32)
    mi, mp = gauss(I, r), gauss(p, r)
    a = (gauss(I * p, r) - mi * mp) / (gauss(I * I, r) - mi * mi + eps)
    b = mp - a * mi
    return np.clip(gauss(a.astype(np.float32), r) * I + gauss(b.astype(np.float32), r), 0, 1).astype(np.float32)


def defringe_edges(rgba, r):
    """Renk sacagi temizleme: kesilmis konunun kenarindaki eski arka plan rengini icerideki renkle degistirir."""
    a = rgba[..., 3]
    core = _contract((a > 0.95).astype(np.float32), r) > 0.5
    if not core.any():
        return rgba
    s = max(1.0, r * 1.5)
    den = gauss(core.astype(np.float32), s)
    col = gauss((rgba[..., :3] * core[..., None]).astype(np.float32), s) / np.maximum(den, 1e-3)[..., None]
    band = (a > 0) & ~core & (den > 0.02)
    out = rgba.copy()
    out[band, 0:3] = col[band]
    return out


def refine_selection(out, rf, src=None):
    """Sec ve Maskele: kenar iyilestir, yumusat, kenari kaydir, kontrast."""
    side = min(out.shape)
    edge = float(rf.get("edge") or 0) * 0.04 * side
    if edge >= 1 and src is not None:
        out = guided_refine(out, src, edge)
    smooth = float(rf.get("smooth") or 0) * 0.03 * side
    if smooth >= 1:
        out = np.clip((gauss(out, smooth) - 0.5) * 3 + 0.5, 0, 1)
    shift = float(rf.get("shift") or 0) * 0.03 * side
    if shift:
        out = _expand(out, shift) if shift > 0 else _contract(out, -shift)
    contrast = float(rf.get("contrast") or 0)
    if contrast:
        out = np.clip((out - 0.5) * (1 + contrast * 15) + 0.5, 0, 1)
    return out


def select_weight(m, src, matte_fn=None):
    h, w = src.shape[:2]
    out = np.zeros((h, w), np.float32)
    for op in (m.get("ops") or [])[:300]:
        if op.get("kind") in MODIFY_OPS:
            out = modify_selection(src, out, op).astype(np.float32)
            continue
        reg = op_region(src, op, matte_fn)
        if op.get("intersect"):
            out = np.minimum(out, reg)
        else:
            out = np.maximum(out, reg) if op.get("add", True) else np.minimum(out, 1 - reg)
    if m.get("refine"):
        out = refine_selection(out, m["refine"], src).astype(np.float32)
    f = float(m.get("feather") or 0)
    if f > 0:
        out = gauss(out, f * 0.02 * min(h, w))
    return np.clip(out, 0, 1)


# ------------------------------------------------------------ arka plan (yapay zeka konu maskesiyle)
BG_MODES = ("remove", "color", "blur")


def align_matte(matte, geo, full_size, size, guide=None):
    """Tam kare konu maskesini (L) fotografin kirpma/dondurmesine ve hedef boyuta hizalar -> 0..1."""
    if not geo:
        m = ImageOps.fit(matte, size, method=Image.BILINEAR)
    else:
        m = apply_geo(matte, geo, full_size, size, guide)
    return np.asarray(m, np.float32) / 255.0


def apply_background(img, matte, bg, k=1.0):
    """remove: seffaf (RGBA), color: duz renk, blur: arka plani bulaniklastir."""
    a = np.clip(matte, 0, 1)[..., None]
    fg = np.asarray(img, np.float32) / 255.0
    mode = bg.get("mode")
    if mode == "remove":
        rgba = np.dstack([fg, a[..., 0]]).astype(np.float32)
        if bg.get("defringe"):
            rgba = defringe_edges(rgba, max(1.0, float(bg["defringe"]) * 0.02 * min(img.size)))
        return Image.fromarray((rgba * 255).astype(np.uint8), "RGBA")
    if mode == "color":
        try:
            back = np.array(hex_to_rgb(bg.get("color") or "#FFFFFF"), np.float32) / 255.0
        except (ValueError, TypeError):
            back = np.ones(3, np.float32)
        back = np.broadcast_to(back, fg.shape)
    else:  # blur: konuyu arka plana tasirmadan bulaniklastir (konu yerini arka planin ortalamasiyla doldur)
        sigma = (4 + 36 * float(bg.get("blur", 0.5))) * k
        wb = gauss((1 - a[..., 0]).astype(np.float32), sigma)[..., None]
        back = gauss((fg * (1 - a)).astype(np.float32), sigma) / np.maximum(wb, 1e-3)
    if bg.get("defringe"):
        fg = defringe_edges(np.dstack([fg, a[..., 0]]).astype(np.float32), max(1.0, float(bg["defringe"]) * 0.02 * min(img.size)))[..., :3]
    out = fg * a + back * (1 - a)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGB")


# ------------------------------------------------------------ doku ve cerceve
# Tum konumlar tuvale gore oransal ve fotograf adina gore sabit: onizleme ve cikti ayni gorunur.
def bloom(arr, amount, k=1.0):
    """Isima: parlak alanlar etrafa yumusakca tasar (ruya gibi)."""
    arr = np.clip(arr, 0, 1)
    L = arr @ LUMA_V
    bright = arr * np.clip((L - 0.55) / 0.45, 0, 1)[..., None]
    glow = gauss(bright, 14 * k) * min(1.5, amount * 1.4)
    return 1 - (1 - arr) * (1 - np.clip(glow, 0, 1))


LEAK_COLORS = np.array([[1.0, 0.42, 0.12], [1.0, 0.72, 0.28], [0.95, 0.22, 0.32], [1.0, 0.55, 0.2]], np.float32)


def light_leak(arr, amount, variant, seed):
    """Isik sizintisi: kenarlardan giren sicak, bulanik renk lekeleri (ekran karisimi)."""
    h, w = arr.shape[:2]
    rng = np.random.default_rng((seed + 7919 * (variant + 1)) % (2 ** 32))
    yy = (np.arange(h, dtype=np.float32) / h)[:, None]
    xx = (np.arange(w, dtype=np.float32) / w)[None, :]
    leak = np.zeros((h, w, 3), np.float32)
    side = variant % 4  # 0 sol, 1 sag, 2 ust, 3 alt kenar
    for _ in range(3):
        t = rng.uniform(0.0, 1.0)
        cx, cy = {0: (-0.08, t), 1: (1.08, t), 2: (t, -0.08), 3: (t, 1.08)}[side]
        cx, cy = cx + rng.uniform(-0.05, 0.05), cy + rng.uniform(-0.05, 0.05)
        rx, ry = rng.uniform(0.25, 0.55), rng.uniform(0.25, 0.55)
        g = np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2))
        leak += g[..., None] * LEAK_COLORS[rng.integers(len(LEAK_COLORS))] * rng.uniform(0.6, 1.0)
    leak = np.clip(leak * min(1.2, amount * 1.1), 0, 1)
    return 1 - (1 - np.clip(arr, 0, 1)) * (1 - leak)


def dust(img, amount, seed, k=1.0):
    """Toz ve cizik: seyrek acik/koyu noktalar ve ince dikey cizgiler."""
    w, h = img.size
    rng = np.random.default_rng((seed + 104729) % (2 ** 32))
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(int(40 + 360 * amount)):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.uniform(0.4, 1.8) * k * (1.6 if rng.random() < 0.08 else 1.0)
        c = 240 if rng.random() < 0.7 else 20
        d.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, c, int(rng.uniform(70, 200) * min(1.0, amount + 0.2))))
    for _ in range(int(amount * 7)):
        x = rng.uniform(0, w)
        y0 = rng.uniform(0, h * 0.7)
        y1 = y0 + rng.uniform(0.1, 0.5) * h
        d.line([x, y0, x + rng.uniform(-0.01, 0.01) * w, y1], fill=(235, 235, 235, int(70 * amount + 20)), width=max(1, round(0.7 * k)))
    out = Image.alpha_composite(img.convert("RGBA"), layer)
    return out if img.mode == "RGBA" else out.convert("RGB")


FRAME_STYLES = ("solid", "polaroid", "film", "line")
FRAME_DEFAULT_COLOR = {"solid": "#FFFFFF", "polaroid": "#F4F1EA", "film": "#0E0E0E", "line": "#FFFFFF"}


def apply_frame(img, frame):
    """Cerceve tuval boyutunu degistirmez: fotograf cercevenin icine yerlesir."""
    W, H = img.size
    style = frame.get("style")
    t = max(1, round(min(W, H) * (0.015 + 0.1 * max(0.0, min(1.0, float(frame.get("size", 0.4)))))))
    try:
        color = hex_to_rgb(frame.get("color") or FRAME_DEFAULT_COLOR[style])
    except (ValueError, TypeError):
        color = hex_to_rgb(FRAME_DEFAULT_COLOR[style])
    if style == "line":  # galeri tarzi: fotograf tam, icte ince cizgi
        out = img.copy()
        lw = max(1, round(t * 0.12))
        ImageDraw.Draw(out).rectangle([t, t, W - 1 - t, H - 1 - t], outline=color, width=lw)
        return out
    left = right = top = t
    bottom = t
    if style == "polaroid":
        bottom = round(t * 3.6)
    elif style == "film":
        left = right = max(1, round(t * 0.45))
        top = bottom = round(t * 1.7)
    inner = (max(1, W - left - right), max(1, H - top - bottom))
    out = Image.new(img.mode, (W, H), color + ((255,) if img.mode == "RGBA" else ()))
    out.paste(ImageOps.fit(img, inner, method=Image.LANCZOS), (left, top))
    if style == "film":  # film delikleri
        d = ImageDraw.Draw(out)
        hw, hh = max(2, round(top * 0.34)), max(2, round(top * 0.42))
        gap = hw * 2.2
        for y in (round((top - hh) / 2), H - bottom + round((bottom - hh) / 2)):
            x = gap / 2
            while x + hw < W:
                d.rounded_rectangle([x, y, x + hw, y + hh], radius=max(1, hw // 4), fill=(225, 222, 214))
                x += gap
    return out


def _box(a, r, axis):
    """Kenarlari uzatilmis kutu bulaniklastirma (kumulatif toplamla, yaricaptan bagimsiz hiz)."""
    if r < 1:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float32)
    n = a.shape[axis]
    hi = [slice(None)] * a.ndim
    lo = [slice(None)] * a.ndim
    hi[axis] = slice(2 * r + 1, 2 * r + 1 + n)
    lo[axis] = slice(0, n)
    out = c[tuple(hi)] - c[tuple(lo)]
    out *= np.float32(1 / (2 * r + 1))
    return out


def gauss(a, sigma):
    """Uc gecisli kutu bulaniklastirmayla Gauss yaklasimi (ilk iki eksen)."""
    r = max(0, int(round((np.sqrt(4 * sigma * sigma + 1) - 1) / 2)))
    if r < 1:
        return a
    for _ in range(3):
        a = _box(_box(a, r, 0), r, 1)
    return a


def detail(arr, sharpen=0.0, clarity=0.0, denoise=0.0, k=1.0):
    """Gurultu azaltma (0..1), netlik/yerel kontrast (-1..1), keskinlik (0..1).
    Yaricaplar tuval olcegi k ile buyur: onizleme ve tam boyut ayni gorunur."""
    arr = np.clip(arr, 0, 1)
    L = arr @ LUMA_V
    if denoise > 0:
        C = arr - L[..., None]
        C = C + (gauss(C, 2.5 * k) - C) * denoise              # renk parazitini guclu yumusat
        L = L + (gauss(L, 1.2 * k) - L) * denoise * 0.6        # parlaklikta daha olculu
        arr = L[..., None] + C
    if clarity:
        d = L - gauss(L, 18 * k)
        mid = np.clip(1 - np.abs(L - 0.5) * 2, 0, 1)            # en cok orta tonlarda
        arr = arr + (d * clarity * 0.9 * (0.35 + 0.65 * mid))[..., None]
        L = arr @ LUMA_V
    if sharpen > 0:
        arr = arr + ((L - gauss(L, 0.9 * k)) * sharpen * 2.2)[..., None]
    return arr


LUMA_V = np.array([0.299, 0.587, 0.114], dtype=np.float32)


# --------------------------------------------------------------------- yazi
def word_width(font, word, tracking):
    if tracking == 0:
        return font.getlength(word)
    return sum(font.getlength(c) + tracking for c in word) - tracking


def wrap(words, font, tracking, max_w):
    space = font.getlength(" ") + tracking
    lines, cur, cur_w = [], [], 0.0
    for wd in words:
        ww = word_width(font, wd, tracking)
        add = ww if not cur else space + ww
        if cur and cur_w + add > max_w:
            lines.append(cur)
            cur, cur_w = [wd], ww
        else:
            cur.append(wd)
            cur_w += add
    if cur:
        lines.append(cur)
    return lines


def draw_word(draw, x, y, word, font, fill, tracking, anchor="la", stroke_width=0, stroke_fill=None):
    kw = {"stroke_width": stroke_width, "stroke_fill": stroke_fill} if stroke_width else {}
    if tracking == 0:
        draw.text((x, y), word, font=font, fill=fill, anchor=anchor, **kw)
        return
    for c in word:
        draw.text((x, y), c, font=font, fill=fill, anchor=anchor, **kw)
        x += font.getlength(c) + tracking


def norm(w):
    return re.sub(r"[^\w']", "", w).lower()


WEIGHT_CHAIN = ["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold",
                "Bold", "ExtraBold", "Black"]
WEIGHT_ALIASES = {"thin": "Thin", "extralight": "ExtraLight", "light": "Light",
                  "regular": "Regular", "medium": "Medium", "semibold": "SemiBold",
                  "bold": "Bold", "extrabold": "ExtraBold", "black": "Black"}
_font_cache = {}


def font_for(cfg, role, size, weight=None, italic=False, family=None):
    """Aile (Montserrat/Cormorant) icinde istenen kalinlik ve italik fontu bul.
    Istenen kalinlik dosyasi yoksa en yakin olani kullanir. family: kullanicinin sectigi yazi tipi."""
    size = max(6, int(round(size)))
    if family:
        f = family_font(family, size, weight, italic, default_weight(cfg, role))
        if f is not None:
            return f
    if not weight and not italic:
        return load_font(cfg, role, size)
    base = Path(cfg["fonts"].get(role, ""))
    if not base.is_absolute():
        base = HERE / base
    stem = base.stem
    family, _, default_w = stem.rpartition("-")
    if not family:
        return load_font(cfg, role, size)
    want = WEIGHT_ALIASES.get((weight or "").lower()) or (default_w if default_w in WEIGHT_CHAIN else "Regular")
    key = (str(base.parent), family, want, bool(italic), size)
    if key in _font_cache:
        return _font_cache[key]
    idx = WEIGHT_CHAIN.index(want)
    order = sorted(range(len(WEIGHT_CHAIN)), key=lambda i: (abs(i - idx), i > idx))
    font = None
    for use_italic in ([True, False] if italic else [False]):
        for i in order:
            w = WEIGHT_CHAIN[i]
            name = f"{family}-{('Italic' if w == 'Regular' else w + 'Italic') if use_italic else w}.ttf"
            p = base.parent / name
            if p.exists():
                try:
                    font = ImageFont.truetype(str(p), size)
                    break
                except OSError:
                    continue
        if font:
            break
    if font is None:
        font = load_font(cfg, role, size)
    _font_cache[key] = font
    return font


# ------------------------------------------------------------ yazi tipi kayit defteri
# Uygulamanin fonts/ klasoru ve bilgisayarda kurulu yazi tipleri: aile -> {(kalinlik, italik): dosya}
_FONT_DIRS_SYSTEM = [
    Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Windows/Fonts" if os.environ.get("LOCALAPPDATA") else None,
    Path("/Library/Fonts"), Path.home() / "Library/Fonts", Path("/System/Library/Fonts"),
    Path("/usr/share/fonts"), Path.home() / ".fonts", Path.home() / ".local/share/fonts",
]
_STYLE_WEIGHTS = [("extralight", "ExtraLight"), ("ultralight", "ExtraLight"), ("semilight", "Light"),
                  ("light", "Light"), ("thin", "Thin"), ("medium", "Medium"), ("semibold", "SemiBold"),
                  ("demibold", "SemiBold"), ("demi", "SemiBold"), ("extrabold", "ExtraBold"),
                  ("ultrabold", "ExtraBold"), ("heavy", "ExtraBold"), ("black", "Black"), ("bold", "Bold")]
_registry = None
_registry_lock = threading.Lock()


def _style_of(style):
    st = style.lower().replace(" ", "").replace("-", "")
    weight = next((w for token, w in _STYLE_WEIGHTS if token in st), "Regular")
    return weight, ("italic" in st or "oblique" in st)


def font_registry():
    """{"families": {aile: {(kalinlik, italik): yol}}, "bundled": set(aile)} (bir kez taranir)."""
    global _registry
    with _registry_lock:
        if _registry is not None:
            return _registry
        families, bundled = {}, set()
        dirs = [(HERE / "fonts", True)] + [(d, False) for d in _FONT_DIRS_SYSTEM if d]
        for root, is_bundled in dirs:
            if not root.is_dir():
                continue
            for f in root.rglob("*"):
                if f.suffix.lower() not in (".ttf", ".otf", ".ttc"):
                    continue
                try:
                    fam, style = ImageFont.truetype(str(f), 12).getname()
                except Exception:
                    continue
                if not fam or fam.startswith("."):
                    continue
                families.setdefault(fam, {}).setdefault(_style_of(style or "Regular"), str(f))
                if is_bundled:
                    bundled.add(fam)
        _registry = {"families": families, "bundled": bundled}
        return _registry


def default_weight(cfg, role):
    stem = Path(cfg["fonts"].get(role, "")).stem
    w = stem.rpartition("-")[2]
    return w if w in WEIGHT_CHAIN else "Regular"


def family_font(family, size, weight, italic, fallback_weight="Regular"):
    styles = font_registry()["families"].get(family)
    if not styles:
        return None
    want = WEIGHT_ALIASES.get((weight or "").lower()) or fallback_weight
    key = ("family", family, want, bool(italic), size)
    if key in _font_cache:
        return _font_cache[key]
    idx = WEIGHT_CHAIN.index(want) if want in WEIGHT_CHAIN else 3
    order = sorted(styles, key=lambda wi: (wi[1] != bool(italic), abs(WEIGHT_CHAIN.index(wi[0]) - idx)))
    for wi in order:
        try:
            font = ImageFont.truetype(styles[wi], size)
            _font_cache[key] = font
            return font
        except OSError:
            continue
    return None


TR_CHARS = set("çğıöşüÇĞİÖŞÜ")


def to_upper(text, turkish):
    """Turkce metinde i -> İ ve ı -> I olmali (str.upper 'bir' kelimesini 'BIR' yapar)."""
    if turkish:
        text = text.replace("i", "İ").replace("ı", "I")
    return text.upper()


def build_specs(text, accent_word, styles, uppercase):
    """Her kelime icin stil: color, weight, italic, size(carpan). styles kelime sirasina gore liste."""
    accent_norm = norm(accent_word) if accent_word else None
    turkish = bool(TR_CHARS & set(text))
    specs = []
    for i, w in enumerate(text.split()):
        st = (styles[i] if styles and i < len(styles) and styles[i] else {})
        specs.append({
            "text": to_upper(w, turkish) if uppercase else w,
            "color": st.get("color"),
            "weight": st.get("weight"),
            "italic": bool(st.get("italic")),
            "scale": float(st.get("size") or 1.0),
            "accent": bool(accent_norm and norm(w) == accent_norm),
        })
    return specs


def wrap_idx(widths, space, max_w):
    lines, cur, cur_w = [], [], 0.0
    for i, ww in enumerate(widths):
        add = ww if not cur else space + ww
        if cur and cur_w + add > max_w:
            lines.append(cur)
            cur, cur_w = [i], ww
        else:
            cur.append(i)
            cur_w += add
    if cur:
        lines.append(cur)
    return lines


def layout_text(cfg, tone_name, specs, W, H, k=1.0, family=None, tracking_add=0.0, leading=1.0):
    """Kelimelerin (kaydirma oncesi) konumlarini hesapla. k: yazi olcegi (1 = 1080x1350 tuval)."""
    t = cfg["tones"][tone_name]
    margin = int(W * cfg["layout"]["margin_ratio"])
    max_w = W - 2 * margin
    max_h = int(H * t["max_height_ratio"])

    size = t["font_size_start"] * k
    while True:
        fonts, widths = [], []
        for sp in specs:
            sz = size * sp["scale"]
            f = font_for(cfg, tone_name, sz, sp["weight"], sp["italic"], family)
            tr = (t["tracking_em"] + tracking_add) * sz
            fonts.append((f, tr))
            widths.append(word_width(f, sp["text"], tr))
        space = font_for(cfg, tone_name, size, family=family).getlength(" ") + (t["tracking_em"] + tracking_add) * size
        lines = wrap_idx(widths, space, max_w)
        line_hs = [max(size * specs[i]["scale"] for i in ln) * t["line_spacing"] * leading for ln in lines]
        block_h = sum(line_hs)
        if (len(lines) <= t["max_lines"] and block_h <= max_h) or size <= t["font_size_min"] * k:
            break
        size -= 2 * k

    top = (H - block_h) / 2 if t["position"] == "center" else H * 0.86 - block_h
    words, y = [], top
    for ln, lh in zip(lines, line_hs):
        total = sum(widths[i] for i in ln) + space * (len(ln) - 1)
        x = margin if t["align"] == "left" else (W - total) / 2
        ascent = max(fonts[i][0].getmetrics()[0] for i in ln)
        for i in ln:
            f, tr = fonts[i]
            words.append({"idx": i, "text": specs[i]["text"], "font": f, "tracking": tr,
                          "x": x, "base": y + ascent, "w": widths[i],
                          "color": specs[i]["color"], "accent": specs[i]["accent"]})
            x += widths[i] + space
        y += lh
    return {"size": int(round(size / k)), "top": top, "margin": margin, "words": words,
            "accent_line": t["accent_line"], "boxes": [], "k": k}


def draw_layout(cfg, layout, W, H, block=(0, 0), offsets=None, outline=0.0, outline_color=None):
    """Yerlesimi cizer. block: tum metnin kaymasi, offsets: kelime bazli kayma
    (1080x1350 tuval pikseli cinsinden; buyuk tuvalde k ile olceklenir)."""
    k = layout.get("k", 1.0)
    offsets = {i: (v[0] * k, v[1] * k) for i, v in (offsets or {}).items()}
    block = (block[0] * k, block[1] * k) if block else (0, 0)
    text_rgb = hex_to_rgb(cfg["colors"]["text"])
    accent_rgb = hex_to_rgb(cfg["colors"]["accent"])
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    boxes = []
    for w in layout["words"]:
        ox, oy = offsets.get(str(w["idx"]), (0, 0))
        x = w["x"] + block[0] + ox
        yb = w["base"] + block[1] + oy
        rgb = hex_to_rgb(w["color"]) if w["color"] else (accent_rgb if w["accent"] else text_rgb)
        sw = max(1, round(outline * 0.09 * w["font"].size)) if outline > 0 else 0
        draw_word(d, x, yb, w["text"], w["font"], rgb + (255,), w["tracking"], anchor="ls",
                  stroke_width=sw, stroke_fill=hex_to_rgb(outline_color or "#000000") + (255,) if sw else None)
        asc, desc = w["font"].getmetrics()
        boxes.append({"idx": w["idx"], "box": (x, yb - asc, x + w["w"], yb + desc)})
    if layout["accent_line"]:
        ly = int(layout["top"] - 34 * k + block[1])
        lx = layout["margin"] + block[0]
        d.rectangle([lx, ly, lx + 84 * k, ly + max(1, round(2 * k))], fill=accent_rgb + (255,))
    layout["boxes"] = boxes
    return layer


def add_shadow(layer, radius=14, strength=0.65):
    alpha = layer.split()[3].filter(ImageFilter.GaussianBlur(radius))
    alpha = alpha.point(lambda v: int(min(255, v * strength * 1.6)))
    shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    shadow.putalpha(alpha)
    return Image.alpha_composite(shadow, layer)


WM_POSITIONS = ("br", "bl", "tr", "tl", "center", "tile")


def default_watermark(cfg):
    """Eski "imza" davranisi: sag altta, marka yazisi."""
    text = cfg["brand"]["signature_text"].strip()
    return {"enabled": bool(text), "text": text, "position": "br",
            "opacity": cfg["signature"]["opacity"], "size": 1.0}


def watermark_layer(cfg, W, H, k=1.0, wm=None):
    """Filigran katmani. wm: {enabled, text, position, opacity 0..1, size (carpan)}."""
    wm = wm or default_watermark(cfg)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    text = str(wm.get("text") or "").strip().upper()
    if not wm.get("enabled") or not text:
        return layer
    s = cfg["signature"]
    fs = s["size"] * k * float(wm.get("size") or 1.0)
    font = load_font(cfg, "signature", max(6, round(fs)))
    tracking = s["tracking_em"] * fs
    w = word_width(font, text, tracking)
    alpha = int(255 * max(0.0, min(1.0, float(wm.get("opacity", 0.7)))))
    fill = hex_to_rgb(cfg["colors"]["text"]) + (alpha,)
    pos = wm.get("position") if wm.get("position") in WM_POSITIONS else "br"

    if pos == "tile":  # tum gorsele capraz dosenmis filigran
        side = int(math.hypot(W, H)) + 2
        tile = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        d = ImageDraw.Draw(tile)
        step_x, step_y = w + fs * 4, fs * 7
        for row, y in enumerate(np.arange(0, side, step_y)):
            for x in np.arange(-(row % 2) * step_x / 2, side, step_x):
                draw_word(d, x, y, text, font, fill, tracking)
        tile = tile.rotate(30, resample=Image.BICUBIC)
        x0, y0 = (side - W) // 2, (side - H) // 2
        return tile.crop((x0, y0, x0 + W, y0 + H))

    margin = int(W * cfg["layout"]["margin_ratio"])
    edge = int(H * s["bottom_margin_ratio"])
    x = {"br": W - margin - w, "tr": W - margin - w, "bl": margin, "tl": margin, "center": (W - w) / 2}[pos]
    y = {"br": H - edge - fs, "bl": H - edge - fs, "tr": edge, "tl": edge, "center": (H - fs) / 2}[pos]
    draw_word(ImageDraw.Draw(layer), x, y, text, font, fill, tracking)
    return layer


def signature_layer(cfg, W, H):
    """Geriye donuk uyumluluk: varsayilan filigran."""
    return watermark_layer(cfg, W, H)


# ------------------------------------------------------------------ geometri
# geo: {"aspect": "original" | "free" | "a:b", "crop": [x, y, w, h] (0..1) ya da None,
#       "rotate": 0/90/180/270 (saat yonu), "flipH", "flipV", "straighten": -45..45 derece,
#       "outW", "outH": cikti boyutu (None = kirpilan alanin dogal boyutu),
#       "ca": True -> icerige duyarli kirpma: bos koseler ve fotografin disi cevreden doldurulur, kirpma cercevesi disari tasabilir,
#       "fit": "content" -> orana kirparak degil icerige duyarli olcekleyerek uy (onemsiz alanlar daralir/genisler),
#       "persp": [[x, y] x4] 0..1 (sol ust, sag ust, sag alt, sol alt) - perspektif kirpma, dondurmeden sonraki goruntude}
# geo None: eski davranis, 1080x1350'ye ortadan doldurarak kirp.
MAX_SIDE = 12000


def canvas_scale(W, H):
    """Yazi/filigran/gren olcegi: 1080x1350 tuvalde 1."""
    return math.sqrt(W * H / (1080 * 1350))


def aspect_ratio(aspect):
    m = re.fullmatch(r"(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)", str(aspect or ""))
    return float(m.group(1)) / float(m.group(2)) if m and float(m.group(2)) else None


def _inner(w, h, deg):
    """w x h dikdortgen deg derece donunce icine sigan en buyuk eksene paralel dikdortgen."""
    if not deg:
        return float(w), float(h)
    a = math.radians(abs(deg))
    sa, ca = math.sin(a), math.cos(a)
    long_side, short_side = (w, h) if w >= h else (h, w)
    if short_side <= 2.0 * sa * ca * long_side or abs(sa - ca) < 1e-10:
        x = 0.5 * short_side
        wr, hr = (x / sa, x / ca) if w >= h else (x / ca, x / sa)
    else:
        cos2a = ca * ca - sa * sa
        wr, hr = (w * ca - h * sa) / cos2a, (h * ca - w * sa) / cos2a
    return wr, hr


def persp_quad(geo):
    q = geo.get("persp")
    if isinstance(q, (list, tuple)) and len(q) == 4 and all(isinstance(p, (list, tuple)) and len(p) == 2 for p in q):
        return [(float(p[0]), float(p[1])) for p in q]
    return None


def persp_size(quad, w, h):
    """Dortgenin duzeltilmis dikdortgen boyutu (karsilikli kenarlarin ortalamasi)."""
    pts = [(x * w, y * h) for x, y in quad]
    d = lambda a, b: math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1])
    return max(16, round((d(0, 1) + d(3, 2)) / 2)), max(16, round((d(0, 3) + d(1, 2)) / 2))


def persp_coeffs(quad, w, h, out_w, out_h):
    """PIL PERSPECTIVE katsayilari: cikti (out_w x out_h) -> kaynak dortgeni (w x h)."""
    src = [(x * w, y * h) for x, y in quad]
    dst = [(0, 0), (out_w, 0), (out_w, out_h), (0, out_h)]
    A, b = [], []
    for (X, Y), (x, y) in zip(dst, src):
        A.append([X, Y, 1, 0, 0, 0, -x * X, -x * Y]); b.append(x)
        A.append([0, 0, 0, X, Y, 1, -y * X, -y * Y]); b.append(y)
    return tuple(np.linalg.solve(np.array(A, float), np.array(b, float)))


CA_SCALE = 1.5  # icerige duyarli kirpmada cerceve her yonde %25 disari tasabilir


def geo_plan(geo, w, h):
    """Kaynak boyutundan (EXIF duzeltilmis) kirpma plani ve cikti boyutu."""
    rot = int(geo.get("rotate") or 0) % 360 // 90 * 90
    ow, oh = (h, w) if rot in (90, 270) else (w, h)
    quad = persp_quad(geo)
    pre = (ow, oh)
    if quad:
        ow, oh = persp_size(quad, ow, oh)
    ang = max(-45.0, min(45.0, float(geo.get("straighten") or 0)))
    iw, ih = _inner(ow, oh, ang)
    ca = bool(geo.get("ca"))
    if ca:  # donen fotografin tum siniri + tasma payi
        sa, ca_ = abs(math.sin(math.radians(ang))), abs(math.cos(math.radians(ang)))
        iw, ih = (ow * ca_ + oh * sa) * CA_SCALE, (ow * sa + oh * ca_) * CA_SCALE
    base = 1 / CA_SCALE if ca else 1.0
    crop = geo.get("crop")
    r = aspect_ratio(geo.get("aspect"))
    content = geo.get("fit") == "content" and r
    if isinstance(crop, (list, tuple)) and len(crop) == 4:
        cx, cy, cw, ch = (float(v) for v in crop)
        cw, ch = max(0.01, min(1.0, cw)), max(0.01, min(1.0, ch))
        cx, cy = max(0.0, min(1 - cw, cx)), max(0.0, min(1 - ch, cy))
    else:
        cw, ch = base, base
        if r and not content:
            if iw / ih > r:
                cw = base * r * ih / iw
            else:
                ch = base * iw / r / ih
        cx, cy = (1 - cw) / 2, (1 - ch) / 2
    nat = (max(1, round(cw * iw)), max(1, round(ch * ih)))
    if content:  # kirpilan alan orana daraltilarak sigdirilir (buyuk kenar kisalir)
        nat = (max(1, round(nat[1] * r)), nat[1]) if nat[0] / nat[1] > r else (nat[0], max(1, round(nat[0] / r)))
    try:
        size = (int(geo["outW"]), int(geo["outH"]))
    except (KeyError, TypeError, ValueError):
        size = nat
    size = tuple(max(16, min(MAX_SIDE, v)) for v in size)
    return {"rot": rot, "flipH": bool(geo.get("flipH")), "flipV": bool(geo.get("flipV")), "angle": ang,
            "quad": quad, "pre": pre, "oriented": (ow, oh), "content": bool(content), "ca": ca, "inner": (iw, ih), "crop": (cx, cy, cw, ch), "natural": nat, "size": size}


def open_photo(path, max_pixels=None):
    """EXIF yonu duzeltilmis RGB; max_pixels verilirse JPEG hizlica kucultulerek acilir."""
    im = Image.open(path)
    if max_pixels and im.width * im.height > max_pixels:
        f = math.sqrt(max_pixels / (im.width * im.height))
        im.draft("RGB", (int(im.width * f), int(im.height * f)))
    return ImageOps.exif_transpose(im).convert("RGB")


def photo_size(path):
    """EXIF yonu uygulanmis tam boyut (gorseli cozmeden)."""
    with Image.open(path) as im:
        w, h = im.size
        if im.getexif().get(0x0112) in (5, 6, 7, 8):
            w, h = h, w
    return w, h


def _content_extend(img, plan):
    """Icerige duyarli kirpma: fotografi aynalayarak genisletir, kenardan uzaklastikca bulaniklastirip tekrari gizler."""
    s = img.width / plan["oriented"][0]
    tw, th = plan["inner"][0] * s, plan["inner"][1] * s
    a = math.radians(plan["angle"])
    c, sn = abs(math.cos(a)), abs(math.sin(a))
    px = max(0, math.ceil((tw * c + th * sn - img.width) / 2))
    py = max(0, math.ceil((tw * sn + th * c - img.height) / 2))
    arr = np.asarray(img)
    out = Image.fromarray(np.pad(arr, ((py, py), (px, px)) + (((0, 0),) if arr.ndim == 3 else ()), mode="reflect"), img.mode)
    W, H = out.size
    if px or py:
        blurred = out.resize((max(1, W // 16), max(1, H // 16)), Image.BILINEAR).filter(ImageFilter.GaussianBlur(2)).resize((W, H), Image.BILINEAR)
        X, Y = np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32)
        dx = np.maximum(np.maximum(px - X, X - (W - 1 - px)), 0)[None, :]
        dy = np.maximum(np.maximum(py - Y, Y - (H - 1 - py)), 0)[:, None]
        t = np.clip(np.maximum(dx, dy) / max(1.0, 0.1 * min(img.size)), 0, 1)
        out = Image.composite(blurred, out, Image.fromarray((t * t * (3 - 2 * t) * 255).astype(np.uint8), "L"))
    if plan["angle"]:
        out = out.rotate(-plan["angle"], resample=Image.BICUBIC)
    return out, ((W - tw) / 2, (H - th) / 2, (W + tw) / 2, (H + th) / 2)


# ------------------------------------------------------------------ otomatik duzeltme
def _line_field(rgb):
    """Belirgin kenarlarin cizgi yonu (derece, ekran koordinati), gucu ve konumu."""
    g = gauss((rgb @ looks.LUMA).astype(np.float32), 1.2)
    gy, gx = np.gradient(g)
    mag = np.hypot(gx, gy)
    keep = mag > max(float(np.percentile(mag, 92)), 0.01)
    ys, xs = np.nonzero(keep)
    return np.degrees(np.arctan2(gx[keep], -gy[keep])), mag[keep], xs, ys


def auto_straighten(rgb):
    """Ufuk/duvar gibi baskin cizgilerin egimi: duzeltmek icin gereken derece (bulunamazsa 0)."""
    theta, mag, xs, ys = _line_field(rgb)
    if len(theta) < 50:
        return 0.0
    a = (theta + 45) % 90 - 45
    edges = np.arange(-15, 15.25, 0.25)
    hist = np.convolve(np.histogram(a, bins=edges, weights=mag)[0], np.ones(5) / 5, mode="same")
    if hist.max() < 2.5 * max(float(np.median(hist)), 1e-6):
        return 0.0
    a0 = float((edges[hist.argmax()] + edges[hist.argmax() + 1]) / 2)
    # gradyan yonu kaba: en iyi aciyi, kenar noktalari o acida tek cizgilerde toplandigi anda bul
    near = np.abs(a - a0) < 5
    d = theta[near] % 180
    is_h = (d < 45) | (d > 135)
    x, y, w = xs[near].astype(np.float64), ys[near].astype(np.float64), mag[near]
    best, score = a0, -1.0
    for c in np.arange(a0 - 3, a0 + 3.01, 0.05):
        t = math.tan(math.radians(c))
        q = np.where(is_h, y - x * t, x + y * t)
        s = float((np.bincount((q - q.min()).astype(np.int64), weights=w) ** 2).sum())
        if s > score:
            best, score = float(c), s
    return -best


def _wmedian(v, w):
    if len(v) < 30:
        return 0.0
    o = np.argsort(v)
    c = np.cumsum(w[o])
    return float(v[o][np.searchsorted(c, c[-1] / 2)])


def _keystone(slope, mag, pos, first, ratio):
    """Iki yarinin egim farkindan yakinsama -> kaydirici degeri (kenardaki icerleme / 0.4)."""
    if first.sum() < 30 or (~first).sum() < 30:
        return 0.0
    gap = _wmedian(pos[~first], mag[~first]) - _wmedian(pos[first], mag[first])
    q = (_wmedian(slope[~first], mag[~first]) - _wmedian(slope[first], mag[first])) / max(gap, 0.1) / 2 * ratio
    return q / (1 + abs(q)) / 0.4  # egim orta yukseklikte olculur, kenara cevrilir


def auto_upright(rgb):
    """Perspektif: dikey cizgilerin yukariya, yatay cizgilerin yana yakinsamasi -> (v, h) -1..1."""
    H, W = rgb.shape[:2]
    theta, mag, xs, ys = _line_field(rgb)
    d = theta % 180
    vert = np.abs(d - 90) < 20
    slope = 1 / np.tan(np.radians(d[vert]))  # dx/dy
    left = xs[vert] < W / 2
    v = _keystone(slope, mag[vert], xs[vert] / W, left, H / W)
    horiz = (d < 20) | (d > 160)
    slope = np.tan(np.radians(d[horiz]))  # dy/dx
    top = ys[horiz] < H / 2
    h = _keystone(slope, mag[horiz], ys[horiz] / H, top, W / H)
    return float(np.clip(v, -1, 1)), float(np.clip(h, -1, 1))


def trim_box(rgb):
    """Kenarlardaki duz renkli boslugu bulur: [x, y, w, h] 0..1; kesilecek bir sey yoksa None."""
    H, W = rgb.shape[:2]
    ref = np.median(np.array([rgb[0, 0], rgb[0, -1], rgb[-1, 0], rgb[-1, -1]]), axis=0)
    diff = np.abs(rgb - ref).max(-1) > 0.05
    rows, cols = np.nonzero(diff.mean(1) > 0.004)[0], np.nonzero(diff.mean(0) > 0.004)[0]
    if not len(rows) or not len(cols):
        return None
    x0, x1, y0, y1 = int(cols[0]), int(cols[-1]) + 1, int(rows[0]), int(rows[-1]) + 1
    if (x1 - x0) * (y1 - y0) > 0.995 * W * H:
        return None
    return [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H]


def orient(img, plan):
    """Dondur, cevir, egimi duzelt. (gorsel, ic kutu) dondurur; ic kutu egim sonrasi bos koseleri dislar."""
    if plan["rot"]:
        img = img.transpose({90: Image.ROTATE_270, 180: Image.ROTATE_180, 270: Image.ROTATE_90}[plan["rot"]])
    if plan["flipH"]:
        img = ImageOps.mirror(img)
    if plan["flipV"]:
        img = ImageOps.flip(img)
    if plan.get("quad"):  # perspektif: dortgeni dikdortgene ac
        s0 = img.width / plan["pre"][0]
        tw, th = max(1, round(plan["oriented"][0] * s0)), max(1, round(plan["oriented"][1] * s0))
        img = img.transform((tw, th), Image.PERSPECTIVE, persp_coeffs(plan["quad"], img.width, img.height, tw, th), Image.BICUBIC)
    if plan.get("ca"):
        return _content_extend(img, plan)
    if not plan["angle"]:
        return img, (0.0, 0.0, float(img.width), float(img.height))
    s = img.width / plan["oriented"][0]  # kucultulmus kaynakta olcek
    img = img.rotate(-plan["angle"], resample=Image.BICUBIC, expand=True)
    iw, ih = plan["inner"][0] * s, plan["inner"][1] * s
    return img, ((img.width - iw) / 2, (img.height - ih) / 2, (img.width + iw) / 2, (img.height + ih) / 2)


def apply_geo(img, geo, full_size, target=None, guide=None):
    """img: tam ya da kucultulmus kaynak (EXIF duzeltilmis); full_size: tam kaynak boyutu.
    target: cikti boyutu (varsayilan plandaki boyut). Kirpilmis ve olceklenmis RGB dondurur."""
    plan = geo_plan(geo, *full_size)
    img, box = orient(img, plan)
    cx, cy, cw, ch = plan["crop"]
    bw, bh = box[2] - box[0], box[3] - box[1]
    crop = (box[0] + cx * bw, box[1] + cy * bh, box[0] + (cx + cw) * bw, box[1] + (cy + ch) * bh)
    target = target or plan["size"]
    if plan.get("content"):
        g = None
        if guide is not None:  # maske gibi ikincil goruntu: fotografla ayni bukulme
            gi, gb = orient(guide, plan)
            gw, gh = gb[2] - gb[0], gb[3] - gb[1]
            g = gi.crop((round(gb[0] + cx * gw), round(gb[1] + cy * gh), round(gb[0] + (cx + cw) * gw), round(gb[1] + (cy + ch) * gh)))
        return content_resize(img.crop(tuple(round(v) for v in crop)), target, g)
    return img.resize(target, Image.LANCZOS, box=crop, reducing_gap=3.0)


# ------------------------------------------------------------------ icerige duyarli olcekleme
def _importance(img, axis, n):
    """Sutun (axis=1) ya da satir (axis=0) basina onem 0..1 (n parca): kenar/doku yogunlugu, yumusatilmis."""
    small = img.convert("L")
    small.thumbnail((512, 512))
    g = np.asarray(small, np.float32) / 255.0
    e = np.abs(np.diff(g, axis=1, append=g[:, -1:])) + np.abs(np.diff(g, axis=0, append=g[-1:, :]))
    prof = e.mean(axis=0 if axis == 1 else 1)
    prof = gauss(prof[:, None].astype(np.float32), max(1.0, len(prof) / 60))[:, 0]
    lo, hi = np.percentile(prof, 20), np.percentile(prof, 95)
    imp = np.clip((prof - lo) / max(hi - lo, 1e-6), 0, 1)
    return np.interp(np.linspace(0, len(imp) - 1, n), np.arange(len(imp)), imp)


def _warp_axis(img, n_out, axis, guide=None):
    """Tek eksende onemsiz bolgeleri daha cok daraltip/genisleterek n_out'a getirir.
    guide: onemin hesaplandigi goruntu (ayni kadraj; verilmezse img)."""
    n = img.width if axis == 1 else img.height
    q = n_out / n
    imp = _importance(guide if guide is not None else img, axis, n)
    room = 1 - imp  # degisime acik pay

    def scales(t):
        return np.clip(1 + t * room, 0.12, 4.0) if q > 1 else np.clip(1 - t * room, 0.12, 1.0)
    lo, hi = 0.0, 50.0
    for _ in range(50):  # ortalama olcek = q olacak t
        mid = (lo + hi) / 2
        if (scales(mid).mean() < q) == (q > 1):
            lo = mid
        else:
            hi = mid
    s = scales((lo + hi) / 2)
    bounds = np.concatenate([[0.0], np.cumsum(s)])
    bounds *= n_out / bounds[-1]
    src_x = np.interp(np.arange(n_out) + 0.5, bounds, np.arange(n + 1)) - 0.5
    i0 = np.clip(np.floor(src_x).astype(int), 0, n - 1)
    i1 = np.clip(i0 + 1, 0, n - 1)
    fr = np.clip(src_x - i0, 0, 1).astype(np.float32)
    a = np.asarray(img)
    gray = a.ndim == 2  # konu maskesi (L) de ayni sekilde bukulur
    if gray:
        a = a[..., None]
    if axis == 0:
        a = a.transpose(1, 0, 2)
    out = np.empty((a.shape[0], n_out, a.shape[2]), np.uint8)
    for r in range(0, a.shape[0], 256):  # bellek: satir parcalari halinde
        blk = a[r:r + 256].astype(np.float32)
        out[r:r + 256] = np.clip(blk[:, i0] * (1 - fr)[None, :, None] + blk[:, i1] * fr[None, :, None] + 0.5, 0, 255).astype(np.uint8)
    if axis == 0:
        out = out.transpose(1, 0, 2)
    return Image.fromarray(np.ascontiguousarray(out[..., 0] if gray else out), img.mode)


def content_resize(img, size, guide=None):
    """Icerige duyarli olcekleme (Content-Aware Scale): once oran korunarak kisa yonde olceklenir,
    sonra fazla/eksik kalan yon onemli bolgeler (kisiler, nesneler, doku) korunarak daraltilir ya da genisletilir."""
    tw, th = size
    if abs(img.width / img.height - tw / th) < 1e-3:
        return img.resize(size, Image.LANCZOS)
    if img.width / img.height > tw / th:  # fazla genis: yuksekligi esitle, genisligi buk
        img = img.resize((max(1, round(img.width * th / img.height)), th), Image.LANCZOS)
        return _warp_axis(img, tw, 1, guide)
    img = img.resize((tw, max(1, round(img.height * tw / img.width))), Image.LANCZOS)
    return _warp_axis(img, th, 0, guide)


# ------------------------------------------------------------------ ana akis
def load_cropped(cfg, image_path):
    W, H = cfg["canvas"]["width"], cfg["canvas"]["height"]
    return cover_crop(Image.open(image_path), (W, H))


# ------------------------------------------------------------------ firca ve cizim
# paint: {"strokes": [{"tool", "pts": [[x, y, basinc], ...] (0..1 tuval), "seed", "b": {firca ayarlari}}]}
# Boya piksel olarak degil darbe olarak saklanir; her cozunurlukte ayni sonuc yeniden cizilir.
# Rotus araclari: st["src"] = [dx, dy] kaynak kaydirmasi (0..1), st["mode"] = patch/camove secenegi.
RETOUCH_REGION = ("spot", "heal", "clone", "patstamp", "dodge", "burn", "sponge", "blur", "sharpen", "freq", "wrinkle", "skin", "blemish", "teeth", "eye", "redeye")
PAINT_TOOLS = ("brush", "pencil", "replace", "mixer", "erase", "bgerase", "magic", "history", "arthistory", "remove", "fillgaps", "colorkey", "smudge", "patch", "camove") + RETOUCH_REGION
TEX_KINDS = ("paper", "canvas", "grain", "noise")
PATTERN_KINDS = ("dots", "stripes", "checker", "hatch")
TIP_LOADER = None  # sunucu: "img:<id>" ucu icin L maske dondurur
STAMP_LOADER = None  # sunucu: desen damgasi icin RGB gorsel dondurur
_TIPS = {}
_MAPS = {}


def _cached(cache, key, make, limit):
    if key not in cache:
        cache[key] = make()
        while len(cache) > limit:
            cache.pop(next(iter(cache)))
    return cache[key]


def _tip_mask(b, d, angle, rnd, hard=None, tip=None):
    """Firca ucu: d capinda 0..1 maske. Kucuk bir onbellekte tutulur (cap tam sayi, aci 5 derece)."""
    d = max(1, int(round(d)))
    tip = tip or b.get("tip") or "round"
    hard = float(b.get("hard", 0.8)) if hard is None else hard
    key = (tip, d, round(angle / 5) * 5, round(rnd * 20), round(hard * 20))

    def make():
        if tip.startswith("img:") and TIP_LOADER:
            im = TIP_LOADER(tip[4:]).resize((d, max(1, round(d * rnd))), Image.LANCZOS)
            if key[2]:
                im = im.rotate(-key[2], resample=Image.BICUBIC, expand=True)
            return np.asarray(im, np.float32) / 255.0
        s = d + 2 + (d & 1 == 0)
        c = (s - 1) / 2
        y, x = np.mgrid[0:s, 0:s].astype(np.float32)
        a = math.radians(key[2])
        ca, sa = math.cos(a), math.sin(a)
        u, v = (x - c) * ca + (y - c) * sa, -(x - c) * sa + (y - c) * ca
        r = np.sqrt(u * u + (v / max(0.05, key[3] / 20)) ** 2) / max(0.5, d / 2)
        h = key[4] / 20
        if h >= 0.99:
            return np.clip((1 - r) * d / 2 + 0.5, 0, 1).astype(np.float32)
        t = np.clip((1 - r) / max(1 - h, 0.02), 0, 1)
        return (t * t * (3 - 2 * t)).astype(np.float32)
    return _cached(_TIPS, key, make, 256)


def _value_noise(rng, W, H, cell):
    small = rng.random((max(2, int(H / cell) + 2), max(2, int(W / cell) + 2)), np.float32)
    return np.asarray(Image.fromarray(small, "F").resize((W, H), Image.BICUBIC), np.float32)


def _tex_map(kind, W, H):
    """Tuval boyunca sabit doku (0..1): darbe neresinden gecerse gecsin ayni kagit."""
    def make():
        rng = np.random.default_rng(11)
        k = max(1.0, min(W, H) / 1080)
        if kind == "canvas":
            p = 5.0 * k
            y, x = np.mgrid[0:H, 0:W].astype(np.float32)
            t = 0.5 + 0.25 * np.sin(x / p * np.pi) + 0.25 * np.sin(y / p * np.pi)
        elif kind == "paper":
            t = 0.6 * _value_noise(rng, W, H, 2.2 * k) + 0.4 * _value_noise(rng, W, H, 7 * k)
        elif kind == "grain":
            t = _value_noise(rng, W, H, 1.6 * k)
        else:
            t = _value_noise(rng, W, H, 14 * k)
        lo, hi = np.percentile(t, 1), np.percentile(t, 99)
        return np.clip((t - lo) / max(hi - lo, 1e-5), 0, 1).astype(np.float32)
    return _cached(_MAPS, ("t", kind, W, H), make, 6)


def _pattern_map(kind, W, H, cell=None):
    def make():
        p = cell or max(4.0, min(W, H) * 0.028)
        y, x = np.mgrid[0:H, 0:W].astype(np.float32)
        if kind == "dots":
            m = np.hypot((x % p) - p / 2, (y % p) - p / 2) < p * 0.3
        elif kind == "stripes":
            m = ((x + y) % p) < p * 0.5
        elif kind == "checker":
            m = ((x // p + y // p) % 2) == 0
        else:
            m = (((x + y) % p) < p * 0.18) | (((x - y) % p) < p * 0.18)
        return m.astype(np.float32)
    return _cached(_MAPS, ("p", kind, W, H, cell), make, 6)


def _stroke_stamps(st, W, H, rng):
    """Darbe boyunca damgalar: (x, y, cap, aci, yuvarlaklik, basinc)."""
    b = st["b"]
    base = max(1.0, float(b["size"]) * min(W, H))
    pts = np.array(st["pts"], np.float64)
    P, press = pts[:, :2] * [W, H], pts[:, 2]
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))] if len(P) > 1 else np.zeros(1)
    step = max(1.0, float(b["spacing"]) * base)
    n = int(min(20000, seg[-1] // step)) + 1
    ts = np.arange(n) * step
    xs, ys = np.interp(ts, seg, P[:, 0]), np.interp(ts, seg, P[:, 1])
    ps = np.interp(ts, seg, press)
    for i in range(n):
        p = float(ps[i])
        d = base * (max(0.05, p) if b.get("pressSize") else 1.0)
        if b["sizeJ"]:
            d *= 1 - float(b["sizeJ"]) * rng.random() * (1 - float(b["minD"]))
        for _ in range(int(b["count"])):
            x, y = float(xs[i]), float(ys[i])
            if b["scatter"]:
                a = rng.random() * 6.2832
                r = float(b["scatter"]) * base * rng.random()
                x, y = x + math.cos(a) * r, y + math.sin(a) * r
            ang = float(b["angle"]) + float(b["angleJ"]) * 180 * (rng.random() * 2 - 1)
            rnd = float(b["round"]) * (1 - float(b["roundJ"]) * rng.random() * 0.9)
            yield x, y, d, ang, rnd, p


def _stamp_at(m, x, y, x0, y0, bw, bh):
    """Maske bu kutuya nereye dusuyor: (kutu dilimleri, maske dilimleri) ya da None."""
    mh, mw = m.shape
    l, t = int(round(x - mw / 2)) - x0, int(round(y - mh / 2)) - y0
    l2, t2, r2, b2 = max(0, l), max(0, t), min(bw, l + mw), min(bh, t + mh)
    if r2 <= l2 or b2 <= t2:
        return None
    return (slice(t2, b2), slice(l2, r2)), (slice(t2 - t, b2 - t), slice(l2 - l, r2 - l))


def _jitter_color(b, rng):
    c = np.array(hex_to_rgb(b["color"]), np.float32) / 255.0
    if b["fgbgJ"]:
        c = c + (np.array(hex_to_rgb(b["color2"]), np.float32) / 255.0 - c) * float(b["fgbgJ"]) * rng.random()
    if b["hueJ"] or b["satJ"] or b["briJ"]:
        hv, sv, vv = colorsys.rgb_to_hsv(*(float(v) for v in c))
        hv = (hv + float(b["hueJ"]) * (rng.random() - 0.5)) % 1.0
        sv = min(1.0, max(0.0, sv * (1 - float(b["satJ"]) * rng.random())))
        vv = min(1.0, max(0.0, vv * (1 - float(b["briJ"]) * rng.random())))
        c = np.array(colorsys.hsv_to_rgb(hv, sv, vv), np.float32)
    return c


def _flatten_paint(arr, layer):
    la = layer[..., 3:]
    ba = arr[..., 3:] * (1 - la)
    a = la + ba
    arr[..., :3] = (layer[..., :3] + arr[..., :3] * ba) / np.maximum(a, 1e-4)
    arr[..., 3:] = a
    layer[...] = 0


def paint_stroke(st, arr, layer, orig, W, H):
    b, tool = st["b"], st["tool"]
    rng = np.random.default_rng(int(st.get("seed") or 0))
    if tool == "magic":  # sihirli silgi: tiklanan renge benzeyen alan seffaf olur
        x, y = st["pts"][0][:2]
        reg = wand_region(np.clip(arr[..., :3], 0, 1), {"p": [x, y], "tol": b["tol"], "contiguous": b["contiguous"]})
        arr[..., 3] *= 1 - reg
        layer *= (1 - reg)[..., None]
        return
    if tool == "colorkey":  # duz arka plan: dort koseden baslayip o renkleri seffaf yapar
        for x, y in ((0.005, 0.005), (0.995, 0.005), (0.005, 0.995), (0.995, 0.995)):
            arr[..., 3] *= 1 - wand_region(np.clip(arr[..., :3], 0, 1), {"p": [x, y], "tol": b["tol"], "contiguous": True})
        return
    if tool == "fillgaps":  # seffaf kalan yerleri cevreden tamamla
        _flatten_paint(arr, layer)
        hole = arr[..., 3] < 0.5
        if hole.any() and not hole.all():
            filled, cover = inpaint(arr[..., :3], hole, None, "gaps")
            arr[..., :3] = arr[..., :3] * (1 - cover[..., None]) + filled * cover[..., None]
            arr[..., 3] = np.where(hole, 1.0, arr[..., 3])
        return
    if tool in ("patch", "camove"):
        _flatten_paint(arr, layer)
        _patch_stroke(st, arr, W, H)
        return
    base = max(1.0, float(b["size"]) * min(W, H))
    pts = np.array(st["pts"], np.float64)[:, :2] * [W, H]
    pad = int(base * (1 + float(b["scatter"])) * 1.2 + base * float(b["dualSize"]) + float(b["dualScatter"]) * base) + 4
    x0, y0 = max(0, int(pts[:, 0].min()) - pad), max(0, int(pts[:, 1].min()) - pad)
    x1, y1 = min(W, int(pts[:, 0].max()) + pad + 1), min(H, int(pts[:, 1].max()) + pad + 1)
    bw, bh = x1 - x0, y1 - y0
    if bw <= 0 or bh <= 0:
        return
    painting = tool in ("brush", "pencil")
    direct = tool in ("mixer", "arthistory", "smudge")
    if direct or tool == "remove" or tool in RETOUCH_REGION:
        _flatten_paint(arr, layer)
    walk = {**st, "b": {**b, "spacing": min(float(b["spacing"]), 0.05)}} if tool == "smudge" else st  # parmak kesintisiz kaymali
    buf = np.zeros((bh, bw, 4 if painting else 1), np.float32)
    flow = float(b["flow"])
    tex = _tex_map(b["tex"], W, H)[y0:y1, x0:x1] if b["tex"] else None
    grain = _tex_map("grain", W, H)[y0:y1, x0:x1] if b["dry"] else None
    pat = _pattern_map(b["pattern"], W, H)[y0:y1, x0:x1] if b["pattern"] else None
    depth, dry, wet = float(b["texDepth"]), float(b["dry"]), float(b["wet"])
    thr = 0.03 + 0.5 * float(b["tol"])
    pencil = tool == "pencil"
    carry = None
    pick, load = float(b["pickup"]), float(b["load"])
    fg = np.array(hex_to_rgb(b["color"]), np.float32) / 255.0
    for x, y, d, ang, rnd, p in _stroke_stamps(walk, W, H, rng):
        m = _tip_mask(b, d, ang, rnd, hard=1.0 if pencil else None)
        hit = _stamp_at(m, x, y, x0, y0, bw, bh)
        if hit is None:
            continue
        box, tipbox = hit
        a = m[tipbox]
        if tool == "arthistory":  # sanatsal: kisa, yonlu boya lekeleri, renkleri eski halden
            sx, sy = min(W - 1, max(0, int(x))), min(H - 1, max(0, int(y)))
            dab = _tip_mask(b, d * 0.5, float(rng.random() * 180), 0.3, hard=0.7)
            for _ in range(3):
                ox, oy = x + rng.normal(0, d * 0.5), y + rng.normal(0, d * 0.5)
                h2 = _stamp_at(dab, ox, oy, x0, y0, bw, bh)
                if h2 is None:
                    continue
                c = orig[min(H - 1, max(0, int(oy))), min(W - 1, max(0, int(ox)))]
                bx, tb = h2
                sub_ = arr[y0:y1, x0:x1][bx]
                al = (dab[tb] * flow)[..., None]
                sub_[..., :3] = sub_[..., :3] * (1 - al) + c[:3] * al
                sub_[..., 3:] = np.maximum(sub_[..., 3:], al)
            continue
        if tex is not None:
            a = a * (1 - depth + depth * tex[box])
        if grain is not None:
            a = a * np.clip((grain[box] - dry * 0.62) / 0.14, 0, 1)
        if pat is not None:
            a = a * pat[box]
        a = a * flow * (max(0.05, p) if b.get("pressOpacity") else 1.0)
        if tool == "mixer":  # karistirici: firca alttaki boyayi yukleyip surukler
            t = arr[y0:y1, x0:x1][box]
            al = a[..., None]
            if carry is None or carry.shape != m.shape + (3,):
                carry = np.zeros(m.shape + (3,), np.float32)
                carry[tipbox] = t[..., :3] * (1 - load) + fg * load
            c = carry[tipbox]
            t[..., :3] = t[..., :3] * (1 - al) + c * al
            carry[tipbox] = c * (1 - pick) + t[..., :3] * pick
            continue
        if tool == "smudge":  # parmak: boyayi surukler; guc ne kadar yuksekse o kadar uzaga tasir
            t = arr[y0:y1, x0:x1][box]
            if carry is None or carry.shape != m.shape + (3,):
                carry = np.empty(m.shape + (3,), np.float32)
                carry[...] = fg if b["finger"] else t[..., :3].reshape(-1, 3).mean(0)  # tuval disinda kalan kisim siyah getirmesin
                if not b["finger"]:
                    carry[tipbox] = t[..., :3]
            keep = 0.55 + 0.445 * float(b["amount"])
            c = carry[tipbox] * keep + t[..., :3] * (1 - keep)
            al = a[..., None]
            t[..., :3] = t[..., :3] * (1 - al) + c * al
            carry[tipbox] = c
            continue
        if painting:
            c = _jitter_color(b, rng)
            if wet:
                under = arr[min(H - 1, max(0, int(y))), min(W - 1, max(0, int(x)))][:3]
                c = c * (1 - wet * 0.55) + under * wet * 0.55
            t = buf[box]
            al = a[..., None]
            t[..., :3] = t[..., :3] * (1 - al) + c * al
            t[..., 3:] = t[..., 3:] * (1 - al) + al
        else:
            if tool in ("replace", "bgerase"):  # renge duyarli: yalnizca damganin merkezindeki renge benzeyenler
                sample = arr[min(H - 1, max(0, int(y))), min(W - 1, max(0, int(x)))][:3]
                a = a * (_color_dist(arr[y0:y1, x0:x1][box][..., :3], sample) < thr)
            buf[box][..., 0] = buf[box][..., 0] * (1 - a) + a
    if direct:
        return
    if b["dual"]:  # cift firca: ikinci uc birinciyi delik deser
        mask = np.zeros((bh, bw), np.float32)
        r2 = np.random.default_rng(int(st.get("seed") or 0) + 1)
        b2 = {**b, "size": float(b["size"]) * float(b["dualSize"]), "scatter": float(b["dualScatter"]), "sizeJ": 0, "count": 1, "angleJ": 0, "roundJ": 0, "round": 1.0, "spacing": 0.3, "pressSize": False}
        for x, y, d, ang, rnd, _p in _stroke_stamps({**st, "b": b2}, W, H, r2):
            m = _tip_mask(b2, d, 0, 1.0, hard=float(b["dualHard"]), tip="round")
            hit = _stamp_at(m, x, y, x0, y0, bw, bh)
            if hit:
                mask[hit[0]] = np.maximum(mask[hit[0]], m[hit[1]])
        buf = buf * mask[..., None]
    op = float(b["opacity"])
    reg = (x0, y0, x1, y1)
    a_ = arr[y0:y1, x0:x1]
    l_ = layer[y0:y1, x0:x1]
    if painting:
        if pencil:  # kalem: yumusak kenar yok
            on = buf[..., 3] > 0.5
            buf[..., :3] = np.where(on[..., None], buf[..., :3] / np.maximum(buf[..., 3:], 1e-4), 0)
            buf[..., 3] = on
            buf[..., :3] *= buf[..., 3:]
        if wet:  # islak boya: kenarlarda birikme
            A = buf[..., 3]
            rgb = buf[..., :3] / np.maximum(buf[..., 3:], 1e-4)
            e = np.clip(A - gauss(A, max(1.0, base * 0.06)), 0, 1)
            A = np.clip(A * (1 - 0.3 * wet) + e * 1.4 * wet, 0, 1)
            buf = np.dstack([rgb * A[..., None], A])
        buf *= op
        l_[...] = buf + l_ * (1 - buf[..., 3:])
        return
    M = buf * op
    if tool in RETOUCH_REGION:
        _retouch_region(tool, st, arr, buf, M, reg, W, H, base)
        return
    if tool == "remove":  # kaldirma araci: boyanan yer cevresindeki dokuyla kapanir
        wgt = np.zeros((H, W), np.float32)
        wgt[y0:y1, x0:x1] = M[..., 0]
        arr[..., :3] = fill_region(np.clip(arr[..., :3], 0, 1), wgt, None, "rm%d" % int(st.get("seed") or 0))
        return
    if tool in ("erase", "bgerase"):
        l_ *= 1 - M
        if not b["paintOnly"]:
            a_[..., 3:] *= 1 - M
    elif tool == "history":  # gecmis firca: duzenleme oncesi hale boyar
        l_ *= 1 - M
        a_[...] = a_ * (1 - M) + orig[y0:y1, x0:x1] * M
    elif tool == "replace":  # renk degistirme: isik ayni, renk yeni
        lum = (a_[..., :3] @ looks.LUMA)[..., None]
        t = fg / max(float(fg @ looks.LUMA), 0.02)
        a_[..., :3] = a_[..., :3] * (1 - M) + np.clip(lum * t, 0, 1) * M


# ------------------------------------------------------------------ rotus ve onarim
def _shift_src(arr, dx, dy, x0, y0, x1, y1):
    """Kutunun (dx, dy) otesindeki pikseller -> (kopya, gecerli 0/1). Goruntu disi kaynak gecersizdir."""
    H, W = arr.shape[:2]
    ys, xs = np.mgrid[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
    ok = (ys >= 0) & (ys < H) & (xs >= 0) & (xs < W)
    return arr[np.clip(ys, 0, H - 1), np.clip(xs, 0, W - 1)].copy(), ok[..., None].astype(np.float32)


def _heal(D, S, m):
    """Iyilestirme: doku kaynaktan, ton ve renk hedeften gelir (kenardaki fark iceri yayilir, dikis kalmaz)."""
    hole = m > 0.01
    ring = _dilate(hole, 2) & ~hole
    if not ring.any():
        return S
    return np.clip(S + gauss(np.clip(_smooth_fill(D - S, ring), -0.6, 0.6), 1.5), 0, 1)


def _guided_self(D, r, eps):
    """Kenar koruyan yumusatma (kendi kendini yoneten suzgec)."""
    mean = gauss(D, r)
    a = (gauss(D * D, r) - mean * mean)
    a = a / (a + eps)
    return gauss(a, r) * D + gauss(mean * (1 - a), r)


def _fine(short):
    return max(0.8, short * 0.0013)


def _skin_smooth(D, short, k, texture=0.6):
    """Cilt yumusatma: gozenek ve kirisikligin bulundugu orta frekans yumusar, ince doku geri eklenir (plastik gorunmesin)."""
    q = _guided_self(D, max(2.0, short * 0.009 * (0.6 + k)), (0.012 + 0.05 * k) ** 2)
    return q + (D - gauss(D, _fine(short))) * texture


def _soft_fill(D, hole, s):
    """Ince bosluklar: cevreden renk, yakindaki bolgeden tane (duz leke kalmaz)."""
    known = (~hole).astype(np.float32)
    est = gauss(D * known[..., None], s) / np.maximum(gauss(known, s), 1e-3)[..., None]
    sh = int(s * 2) + 1
    grain = np.roll((D - gauss(D, max(0.8, s * 0.6))) * known[..., None], (sh, sh), (0, 1))
    w = np.maximum(gauss(hole.astype(np.float32), 0.9), hole.astype(np.float32))[..., None]
    return np.clip(D * (1 - w) + (est + grain) * w, 0, 1)


def _small_spots(cand, rmax):
    """Kucuk ve toplu lekeler kalir; kas, kirpik, sac gibi uzun yapilar elenir."""
    ys, xs = np.nonzero(cand)
    left = set(zip(ys.tolist(), xs.tolist()))
    out = np.zeros(cand.shape, bool)
    while left:
        stack, comp = [left.pop()], []
        while stack:
            y, x = stack.pop()
            comp.append((y, x))
            for q in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1), (y - 1, x - 1), (y - 1, x + 1), (y + 1, x - 1), (y + 1, x + 1)):
                if q in left:
                    left.remove(q)
                    stack.append(q)
        cy, cx = zip(*comp)
        h, w = max(cy) - min(cy) + 1, max(cx) - min(cx) + 1
        if len(comp) >= 2 and max(h, w) <= rmax and max(h, w) <= 2.4 * min(h, w) + 1:
            out[list(cy), list(cx)] = True
    return out


def _blemish_mask(D, region, short, level=0.5):
    """Cevresinden koyu ya da kirmizi kalan kucuk noktalar."""
    L = D @ looks.LUMA
    red = D[..., 0] - D[..., 1]
    s1, s2 = max(0.7, short * 0.0012), max(2.0, short * 0.009)
    dark = gauss(L, s2) - gauss(L, s1)
    flush = gauss(red, s1) - gauss(red, s2)
    noise = np.sqrt(gauss(dark * dark, s2 * 2))
    score = dark / (noise * 2.2 + 0.012) + np.maximum(flush, 0) / 0.05
    cand = (score > 1.7 - level) & region
    if cand.sum() > 60000:
        cand &= score > np.percentile(score[cand], 80)
    return _small_spots(cand, max(4, int(short * 0.018)))


def skin_weight(rgb):
    """Cilt rengi agirligi (0..1). Yuz tanima degil renk modelidir: ten rengine yakin nesneler de secilebilir."""
    Y = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    Cb, Cr = (rgb[..., 2] - Y) * 0.564 + 0.5, (rgb[..., 0] - Y) * 0.713 + 0.5
    sm = looks._smooth
    w = sm(0.27, 0.32, Cb) * (1 - sm(0.49, 0.54, Cb)) * sm(0.51, 0.55, Cr) * (1 - sm(0.66, 0.71, Cr)) * sm(0.10, 0.2, Y) * (1 - sm(0.97, 1.0, Y))
    total = float(w.sum())
    if total > w.size * 0.002:  # fotograftaki baskin ten rengine daralt: duvar, kum gibi yakin renkler azalir
        mb, mr = float((Cb * w).sum() / total), float((Cr * w).sum() / total)
        sd = max(0.018, math.sqrt(float((((Cb - mb) ** 2 + (Cr - mr) ** 2) * w).sum() / total)))
        w = w * (1 - sm(2.2 * sd, 3.6 * sd, np.hypot(Cb - mb, Cr - mr)))
    return np.clip(gauss(w, max(1.0, min(rgb.shape[:2]) * 0.003)) * 1.15, 0, 1).astype(np.float32)


def _scratch_mask(D, level):
    """Eski fotograftaki ince cizik ve toz: morfolojik kapama/acma farki, dokulu yerlerde esik yukselir."""
    S = _small(D, 1600)
    L = (np.clip(S @ looks.LUMA, 0, 1) * 255).astype(np.uint8)
    r = max(1, round(min(L.shape) * 0.003))
    size = 2 * r + 1
    im = Image.fromarray(L, "L")
    closed = np.asarray(im.filter(ImageFilter.MaxFilter(size)).filter(ImageFilter.MinFilter(size)), np.float32)
    opened = np.asarray(im.filter(ImageFilter.MinFilter(size)).filter(ImageFilter.MaxFilter(size)), np.float32)
    Lf = L.astype(np.float32)
    score = np.maximum(closed - Lf, Lf - opened) / 255.0
    busy = gauss(np.abs(Lf / 255.0 - gauss(Lf / 255.0, 3.0)), r * 6.0)
    hole = score > (0.2 - 0.14 * level) + busy * 3.0
    hole = _dilate(hole, 1)
    if hole.shape != D.shape[:2]:
        hole = _resize_f(hole.astype(np.float32), (D.shape[1], D.shape[0])) > 0.25
    return hole, max(1.5, r * 2.0 * D.shape[0] / L.shape[0])


def _restore(out, rt, short):
    """Fotograf onarimi: cizik, gurultu, solma, renk kaymasi, keskinlik (bu sirayla)."""
    if rt.get("scratch"):
        hole, s = _scratch_mask(out, float(rt["scratch"]))
        if hole.any():
            out = _soft_fill(out, hole, s)
    if rt.get("denoise"):
        k = float(rt["denoise"])
        L = (out @ looks.LUMA)[..., None]
        C = out - L
        L2 = _guided_self(L, max(1.5, short * 0.003), (0.012 + 0.1 * k) ** 2)
        out = L + (L2 - L) * min(1.0, k * 1.6) + C + (gauss(C, max(1.5, short * 0.006)) - C) * k
    if rt.get("cast"):
        k = float(rt["cast"])
        sample = np.clip(out[::4, ::4].reshape(-1, 3), 0, 1)
        lo, hi = np.percentile(sample, 0.5, axis=0), np.percentile(sample, 99.5, axis=0)
        fixed = (out - lo) / np.maximum(hi - lo, 0.05) * float((hi - lo).mean()) + float(lo.mean())
        out = out + (np.clip(fixed, 0, 1) - out) * k
    if rt.get("fade"):
        k = float(rt["fade"])
        L = np.clip(out[::4, ::4] @ looks.LUMA, 0, 1)
        lo, hi = np.percentile(L, 0.5), np.percentile(L, 99.5)
        t = np.clip((out - lo) / max(float(hi - lo), 0.05), 0, 1)
        out = out + (t + (t * t * (3 - 2 * t) - t) * 0.2 - out) * k  # solan siyah ve beyazi geri getirir, hafif S egrisi
    if rt.get("sharp"):
        L = out @ looks.LUMA
        out = out + ((L - gauss(L, max(0.9, short * 0.0013))) * float(rt["sharp"]) * 2.0)[..., None]
    return np.clip(out, 0, 1)


def _retouch_all(arr, rt, area, short):
    out = arr
    restore = {k: rt[k] for k in ("scratch", "denoise", "cast", "fade", "sharp") if rt.get(k)}
    if restore:  # cilt kaydiricisi degisince onarim yeniden hesaplanmaz
        key = (json.dumps(restore, sort_keys=True), arr.shape, zlib.crc32((arr[::11, ::11] * 255).astype(np.uint8).tobytes()))
        out = _cached(_RT_RESTORE, key, lambda: _restore(arr, rt, short), 1)
    skin = None
    if any(rt.get(k) for k in ("smooth", "tone", "blemish")) or (rt.get("fsSkin") and (rt.get("fsLow") or rt.get("fsHigh"))):
        skin = skin_weight(out)
        if area is not None:
            skin = skin * area
    if rt.get("blemish"):
        hole = _blemish_mask(out, skin > 0.35, short, float(rt["blemish"]))
        if hole.any():
            r = max(1, round(short * 0.0015))
            out = _soft_fill(out, _dilate(hole, r), max(1.5, short * 0.008))
    if rt.get("smooth"):
        k = float(rt["smooth"])
        out = out + (_skin_smooth(out, short, k, float(rt.get("texture", 0.6))) - out) * (skin * min(1.0, k * 1.4))[..., None]
    if rt.get("tone"):  # lekeli ten: kisa dalga renk ve ton farklari azalir
        s = max(4.0, short * 0.035)
        mid = gauss(out, max(1.5, short * 0.006))
        even = gauss(out * skin[..., None], s) / np.maximum(gauss(skin, s), 1e-3)[..., None]
        calm = 1 - looks._smooth(0.035, 0.09, np.abs((even - mid) @ looks.LUMA))
        out = out + (even - mid) * (skin * calm * float(rt["tone"]) * 0.75)[..., None]
    if rt.get("fsLow") or rt.get("fsHigh"):
        r = max(1.0, short * (0.002 + 0.03 * float(rt.get("fsRadius", 0.3))))
        low = gauss(out, r)
        high = out - low
        low2 = low + (gauss(low, r * 3.5) - low) * float(rt.get("fsLow") or 0)
        rebuilt = low2 + high * (1 + float(rt.get("fsHigh") or 0))
        w = skin if rt.get("fsSkin") else area
        out = out + (rebuilt - out) * (1.0 if w is None else w[..., None])
    return np.clip(out, 0, 1).astype(np.float32)


_RT = {}  # renk ayari degisince cilt ve onarim yeniden hesaplanmaz
_RT_RESTORE = {}


def apply_retouch(arr, rt, fx, src):
    h, w = arr.shape[:2]
    area = None
    mask = rt.get("areaMask")
    if mask:
        area = mask_weight(mask, h, w, src, fx.get("_matte"))
    key = (json.dumps(rt, sort_keys=True), json.dumps([mask.get("ops"), mask.get("refine"), mask.get("invert")], sort_keys=True) if mask else "",
           arr.shape, zlib.crc32((arr[::11, ::11] * 255).astype(np.uint8).tobytes()))
    return _cached(_RT, key, lambda: _retouch_all(arr, rt, area, min(h, w)), 2)


def _stamp_map(b, W, H):
    """Desen damgasi: tuval boyunca tekrar eden desen."""
    stamp, scale = b["stamp"] or "checker", float(b["stampScale"])

    def make():
        if stamp.startswith("img:") and STAMP_LOADER:
            im = STAMP_LOADER(stamp[4:]).convert("RGB")
            th = max(4, round(min(W, H) * scale))
            im = im.resize((max(4, round(im.width * th / im.height)), th), Image.LANCZOS)
            t = np.asarray(im, np.float32) / 255.0
            return np.tile(t, (H // t.shape[0] + 1, W // t.shape[1] + 1, 1))[:H, :W]
        m = _pattern_map(stamp if stamp in PATTERN_KINDS else "checker", W, H, max(4.0, min(W, H) * scale * 0.4))[..., None]
        c1, c2 = np.array(hex_to_rgb(b["color"]), np.float32) / 255.0, np.array(hex_to_rgb(b["color2"]), np.float32) / 255.0
        return m * c1 + (1 - m) * c2
    return _cached(_MAPS, ("st", stamp, b["color"], b["color2"], scale, W, H), make, 6)


def _retouch_region(tool, st, arr, buf, M, reg, W, H, base):
    """Fircayla boyanan alanda calisan rotus araclari. M: opaklikli maske, buf: opakliksiz."""
    b = st["b"]
    x0, y0, x1, y1 = reg
    k = float(b["amount"])
    short = min(W, H)
    a_ = arr[y0:y1, x0:x1]
    D = np.clip(a_[..., :3], 0, 1)
    m = M[..., 0]
    if tool in ("heal", "clone"):
        src = st.get("src") or [0.0, 0.0]
        S, ok = _shift_src(arr, round(src[0] * W), round(src[1] * H), x0, y0, x1, y1)
        M2 = M * ok
        if tool == "clone":
            a_[...] = a_ * (1 - M2) + S * M2
        else:
            a_[..., :3] = D * (1 - M2) + _heal(D, np.clip(S[..., :3], 0, 1), M2[..., 0]) * M2
        return
    if tool == "spot":  # nokta iyilestirme: cevredeki dokudan, yapay zekasiz ve hizli
        if not (buf[..., 0] > 0.3).any():
            return
        p = max(40, int(max(x1 - x0, y1 - y0) * 1.5))
        t, u, l, r = max(0, y0 - p), min(H, y1 + p), max(0, x0 - p), min(W, x1 + p)
        wgt = np.zeros((u - t, r - l), np.float32)
        wgt[y0 - t:y1 - t, x0 - l:x1 - l] = buf[..., 0]
        crop = np.clip(arr[t:u, l:r, :3], 0, 1)
        filled = fill_region(crop, wgt, None, "sp%d" % int(st.get("seed") or 0), ai=False)
        op = float(b["opacity"])
        arr[t:u, l:r, :3] = crop * (1 - op) + filled * op
        return
    if tool == "patstamp":
        T = _stamp_map(b, W, H)[y0:y1, x0:x1]
        a_[..., :3] = D * (1 - M) + T * M
        a_[..., 3:] = np.maximum(a_[..., 3:], M)
        return
    L = D @ looks.LUMA
    if tool in ("dodge", "burn"):
        w = {"shadows": (1 - L) ** 2, "high": L ** 2}.get(b["range"], 1 - np.abs(2 * L - 1) * 0.85)
        g = 1 + 1.3 * k * w
        out = np.power(D, (1 / g if tool == "dodge" else g)[..., None])
    elif tool == "sponge":
        f = 1 + 1.5 * k if b["sponge"] == "sat" else 1 - k
        if b["vib"]:  # dogal: zaten doygun renkler daha az etkilenir
            f = 1 + (f - 1) * (1 - np.clip((D.max(-1) - D.min(-1)) * 1.3, 0, 1))[..., None]
        out = np.clip(L[..., None] + (D - L[..., None]) * f, 0, 1)
    elif tool == "blur":
        out = gauss(D, max(1.0, base * (0.04 + 0.32 * k)))
    elif tool == "sharpen":
        out = np.clip(D + ((L - gauss(L, max(0.8, short * 0.0013))) * k * 3.2)[..., None], 0, 1)
    elif tool == "freq":  # frekans ayirma: ton duzelir, ince doku korunur
        out = gauss(D, max(2.0, base * (0.08 + 0.3 * k))) + (D - gauss(D, _fine(short)))
    elif tool == "wrinkle":  # kirisik: yalnizca koyu cizgiler cevrenin tonuna kalkar
        t = gauss(D, max(2.0, base * 0.32)) + (D - gauss(D, _fine(short)))
        gain = np.clip(((t @ looks.LUMA) - L) * 30, 0, 1)[..., None]
        out = D + (t - D) * gain * min(1.0, 0.35 + k)
    elif tool == "skin":
        out = D + (_skin_smooth(D, short, k) - D) * min(1.0, k * 1.5)
    elif tool == "blemish":
        hole = _blemish_mask(D, m > 0.2, short, 0.2 + k * 0.8)
        if not hole.any():
            return
        out = _soft_fill(D, _dilate(hole, max(1, round(short * 0.0015))), max(1.5, short * 0.008))
    elif tool == "teeth":  # disler: sarilik gider, aydinlanir; dudak ve koyu bosluklar korunur
        lip = np.clip((D[..., 0] - D[..., 1] - 0.1) / 0.12, 0, 1)
        w = (np.clip((L - 0.2) / 0.15, 0, 1) * (1 - lip))[..., None]
        out = np.power(np.clip(L[..., None] + (D - L[..., None]) * (1 - 0.85 * k), 0, 1), 1 - 0.32 * k)
        out = D + (out - D) * w
    elif tool == "eye":  # goz: iris aydinlanir, renk ve keskinlik artar; gozbebegi koyu kalir
        w = np.clip((L - 0.04) / 0.1, 0, 1)[..., None]
        out = L[..., None] + (D - L[..., None]) * (1 + 0.55 * k)
        out = np.power(np.clip(out, 0, 1), 1 - 0.3 * k * w)
        out = np.clip(out + ((L - gauss(L, max(0.8, short * 0.0013))) * k * 2.4)[..., None], 0, 1)
    else:  # redeye: kirmizi gozbebegi notr ve koyu olur
        gb = (D[..., 1] + D[..., 2]) / 2
        w = gauss(np.clip((D[..., 0] / (gb + 0.03) - 1.5) / 0.5, 0, 1) * np.clip((D[..., 0] - 0.16) / 0.1, 0, 1), 0.8)[..., None]
        fixed = np.stack([gb, D[..., 1], D[..., 2]], -1) * (1 - 0.55 * k)
        out = D + (fixed - D) * w
    a_[..., :3] = D * (1 - M) + np.clip(out, 0, 1) * M


def _polygon(P, W, H, feather):
    """Cokgen -> (yumusak maske, x0, y0, x1, y1). Tuval disinda kalirsa None."""
    p = int(feather * 3) + 2
    x0, y0 = max(0, int(P[:, 0].min()) - p), max(0, int(P[:, 1].min()) - p)
    x1, y1 = min(W, int(P[:, 0].max()) + p + 1), min(H, int(P[:, 1].max()) + p + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    im = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(im).polygon([(float(x) - x0, float(y) - y0) for x, y in P], fill=255)
    return gauss(np.asarray(im, np.float32) / 255.0, feather), x0, y0, x1, y1


def _patch_stroke(st, arr, W, H):
    """Yama ve icerige duyarli tasima: kement cokgeni ile kaynak kaydirmasi."""
    if len(st["pts"]) < 3:
        return
    P = np.array(st["pts"], np.float64)[:, :2] * [W, H]
    dx, dy = (st.get("src") or [0.0, 0.0])[:2]
    dx, dy = round(dx * W), round(dy * H)
    feather = max(1.0, min(W, H) * 0.002)
    tool = st["tool"]
    if tool == "patch":
        hit = _polygon(P, W, H, feather)
        if hit is None:
            return
        m, x0, y0, x1, y1 = hit
        S, ok = _shift_src(arr, dx, dy, x0, y0, x1, y1)
        M = m[..., None] * ok
        D = np.clip(arr[y0:y1, x0:x1, :3], 0, 1)
        arr[y0:y1, x0:x1, :3] = D * (1 - M) + _heal(D, np.clip(S[..., :3], 0, 1), M[..., 0]) * M
        return
    snap = arr.copy()
    hit = _polygon(P, W, H, feather)
    if hit is None:
        return
    if st.get("mode") != "extend":  # eski yer cevresinden kapanir; "genislet" kipinde kalir
        m, x0, y0, x1, y1 = hit
        p = max(40, int(max(x1 - x0, y1 - y0) * 1.2))
        t, u, l, r = max(0, y0 - p), min(H, y1 + p), max(0, x0 - p), min(W, x1 + p)
        wgt = np.zeros((u - t, r - l), np.float32)
        wgt[y0 - t:y1 - t, x0 - l:x1 - l] = np.clip(m * 1.4, 0, 1)
        arr[t:u, l:r, :3] = fill_region(np.clip(arr[t:u, l:r, :3], 0, 1), wgt, None, "cm%d" % int(st.get("seed") or 0))
    hit = _polygon(P + [dx, dy], W, H, feather)
    if hit is None:
        return
    m, x0, y0, x1, y1 = hit
    S, ok = _shift_src(snap, -dx, -dy, x0, y0, x1, y1)
    M = m[..., None] * ok
    D = np.clip(arr[y0:y1, x0:x1, :3], 0, 1)
    arr[y0:y1, x0:x1, :3] = D * (1 - M) + _heal(D, np.clip(S[..., :3], 0, 1), M[..., 0]) * M


_PAINTED = {}  # onizleme: son cizim; yeni darbe eklenince bastan cizilmez


def apply_paint(base, orig, paint, cache_key=None):
    """base: islenmis RGBA, orig: duzenleme oncesi RGBA (ayni boyut). Darbeleri sirayla uygular."""
    strokes = (paint or {}).get("strokes") or []
    if not strokes:
        return base
    W, H = base.size
    origa = np.asarray(orig, np.float32) / 255.0
    done = 0
    c = _PAINTED.get("last")
    if cache_key is not None and c and c["key"] == cache_key and len(c["strokes"]) <= len(strokes) and strokes[:len(c["strokes"])] == c["strokes"]:
        arr, layer, done = c["arr"], c["layer"], len(c["strokes"])
    else:
        arr, layer = np.array(base, np.float32) / 255.0, np.zeros((H, W, 4), np.float32)
    for st in strokes[done:]:
        paint_stroke(st, arr, layer, origa, W, H)
    if cache_key is not None:
        _PAINTED["last"] = {"key": cache_key, "strokes": strokes, "arr": arr, "layer": layer}
    arr, layer = arr.copy(), layer.copy()
    _flatten_paint(arr, layer)
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def finish_base(base, cropped, fx, geo, f=1.0, cache_key=None):
    """Tuval genisletme ve boya: renk islemeden sonra."""
    out = extend_canvas(base, geo, f)
    paint = (fx or {}).get("paint")
    if paint and paint.get("strokes"):
        out = apply_paint(out, extend_canvas(cropped.convert("RGBA"), geo, f), paint, cache_key)
    return out


def grade_base(cfg, cropped, image_path, fx=None, grain_scale=1.0):
    seed = zlib.crc32(str(Path(image_path).name).encode())
    return grade(cropped, cfg, seed, fx, grain_scale).convert("RGBA")


def make_base(cfg, image_path, fx=None, geo=None):
    """Fotografi kirp + siyah-beyaz/vinyet/gren uygula (yazi yok)."""
    if not geo:
        cropped = load_cropped(cfg, image_path)
        return finish_base(grade_base(cfg, cropped, image_path, fx), cropped, fx, None)
    img = open_photo(image_path)
    cropped = apply_geo(img, geo, img.size)
    return finish_base(grade_base(cfg, cropped, image_path, fx, canvas_scale(*cropped.size)), cropped, fx, geo)


# ------------------------------------------------------------------ tuval boyutu
# geo["canvas"]: {"w", "h": son tuval (px), "anchor": [ax, ay] 0..1 (fotografin yeri), "color": "#RRGGBB" | "transparent"}
def canvas_plan(geo, photo_size):
    """(tuval boyutu, fotografin sol ust kosesi) - tuval yoksa fotografin kendisi."""
    c = (geo or {}).get("canvas") if geo else None
    pw, ph = photo_size
    if not c:
        return (pw, ph), (0, 0)
    W, H = int(c["w"]), int(c["h"])
    ax, ay = c.get("anchor") or (0.5, 0.5)
    return (W, H), (round((W - pw) * float(ax)), round((H - ph) * float(ay)))


def extend_canvas(img, geo, f=1.0):
    """Islenmis fotografi daha buyuk (ya da kucuk) tuvale yerlestirir. f: onizleme olcegi."""
    c = (geo or {}).get("canvas") if geo else None
    if not c:
        return img
    (W, H), (x, y) = canvas_plan(geo, (img.width / f, img.height / f))
    W, H = max(1, round(W * f)), max(1, round(H * f))
    if c.get("color") == "transparent":
        fill = (0, 0, 0, 0)
    else:
        try:
            fill = hex_to_rgb(c.get("color") or "#FFFFFF") + (255,)
        except (ValueError, TypeError):
            fill = (255, 255, 255, 255)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.paste(img.convert("RGBA"), (round(x * f), round(y * f)))  # tuval kucukse fotograf kirpilir
    return Image.alpha_composite(Image.new("RGBA", (W, H), fill), layer)


# ------------------------------------------------------------------ gorsel katmanlari (birlestirme)
# layer: {"photo": id, "x", "y": merkez (0..1 tuval), "w": genislik (tuvalin orani), "rot": derece,
#         "opacity": 0..1, "flipH": bool, "cutout": yapay zeka ile konuyu kes}
# Donusum alanlari (hepsi kutuya gore 0..1):
#   "sy": dikey olcek carpani   "corners": [[du, dv] x4] koselerin kaymasi (egme, bozma, perspektif)
#   "warp": 4x4 dugum [u, v]    "pwarp": 3x2 dugum (iki duzlem)   "pins": [{"p": [u, v], "q": [u, v]}] kukla pimleri
#   "blend": otomatik harmanlama (renk eslestirme + yumusak kenar)
MESH_N = 24
_UNIT = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))


def _unit_homography(q):
    """Birim kareyi q dortgenine (sol ust, sag ust, sag alt, sol alt) goturen 3x3 matris."""
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = q
    dx1, dx2, sx = x1 - x2, x3 - x2, x0 - x1 + x2 - x3
    dy1, dy2, sy = y1 - y2, y3 - y2, y0 - y1 + y2 - y3
    den = dx1 * dy2 - dx2 * dy1
    if abs(den) < 1e-9:
        den = 1e-9
    g, h = (sx * dy2 - dx2 * sy) / den, (dx1 * sy - sx * dy1) / den
    return np.array([[x1 - x0 + g * x1, x3 - x0 + h * x3, x0], [y1 - y0 + g * y1, y3 - y0 + h * y3, y0], [g, h, 1.0]])


def _apply_h(M, u, v):
    d = M[2, 0] * u + M[2, 1] * v + M[2, 2]
    d = np.where(np.abs(d) < 1e-6, 1e-6, d)
    return (M[0, 0] * u + M[0, 1] * v + M[0, 2]) / d, (M[1, 0] * u + M[1, 1] * v + M[1, 2]) / d


def _lagrange(t):
    """0, 1/3, 2/3, 1 dugumlerinden gecen kubik taban fonksiyonlari."""
    n = (0.0, 1 / 3, 2 / 3, 1.0)
    return [np.prod([(t - n[j]) / (n[i] - n[j]) for j in range(4) if j != i], axis=0) for i in range(4)]


def _warp_uv(pts, u, v):
    P = np.array(pts, np.float64).reshape(4, 4, 2)
    Lu, Lv = _lagrange(u), _lagrange(v)
    x, y = 0.0, 0.0
    for r in range(4):
        for c in range(4):
            w = Lu[c] * Lv[r]
            x, y = x + w * P[r, c, 0], y + w * P[r, c, 1]
    return x, y


def _pwarp_uv(pts, u, v):
    """Perspektif carpitma: iki yan yana duzlem, her biri kendi dortgenine."""
    P = np.array(pts, np.float64).reshape(2, 3, 2)
    x, y = np.zeros_like(u), np.zeros_like(u)
    for c in range(2):
        cell = (u < 0.5) if c == 0 else (u >= 0.5)
        M = _unit_homography([P[0, c], P[0, c + 1], P[1, c + 1], P[1, c]])
        px, py = _apply_h(M, (u[cell] - c * 0.5) / 0.5, v[cell])
        x[cell], y[cell] = px, py
    return x, y


def _puppet_uv(pins, u, v):
    """Kukla carpitma: pimlere gore en kucuk kareler rijit bukme (hareket eden pim etrafi bukulur, gerisi sabit kalir)."""
    p = np.array([complex(*q["p"]) for q in pins])
    q = np.array([complex(*q["q"]) for q in pins])
    z = u + 1j * v
    w = 1 / np.maximum(np.abs(z[..., None] - p) ** 2, 1e-5)
    sw = w.sum(-1)
    ps, qs = (w * p).sum(-1) / sw, (w * q).sum(-1) / sw
    S = (w * (q - qs[..., None]) * np.conj(p - ps[..., None])).sum(-1)
    R = S / np.maximum(np.abs(S), 1e-9)
    R = np.where(np.abs(S) < 1e-9, 1.0, R)
    f = qs + R * (z - ps)
    return f.real, f.imag


def layer_deformed(ly):
    return bool(ly.get("corners") or ly.get("warp") or ly.get("pwarp") or ly.get("pins"))


def layer_mesh(ly, W, H, ratio, n=MESH_N):
    """Katmanin kaynak (u, v) izgarasinin tuval pikseli karsiliklari."""
    g = np.linspace(0, 1, n + 1)
    U0, V0 = np.meshgrid(g, g)
    u, v = U0, V0
    if ly.get("warp"):
        u, v = _warp_uv(ly["warp"], u, v)
    elif ly.get("pwarp"):
        u, v = _pwarp_uv(ly["pwarp"], u, v)
    if ly.get("pins"):
        u, v = _puppet_uv(ly["pins"], u, v)
    if ly.get("corners"):
        u, v = _apply_h(_unit_homography([(a + d[0], b + d[1]) for (a, b), d in zip(_UNIT, ly["corners"])]), u, v)
    bw = float(ly["w"]) * W
    bh = bw * ratio * float(ly.get("sy", 1.0))
    x, y = (u - 0.5) * bw, (v - 0.5) * bh
    a = math.radians(float(ly.get("rot") or 0))
    c, sn = math.cos(a), math.sin(a)
    return x * c - y * sn + float(ly["x"]) * W, x * sn + y * c + float(ly["y"]) * H, U0, V0


def raster_mesh(src, X, Y, U, V, W, H):
    """Izgarayi tuvale ucgen ucgen cizer: her piksel icin kaynak koordinati bulunup orneklenir."""
    x0, x1 = max(0, int(math.floor(X.min()))), min(W, int(math.ceil(X.max())) + 1)
    y0, y1 = max(0, int(math.floor(Y.min()))), min(H, int(math.ceil(Y.max())) + 1)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if x1 <= x0 or y1 <= y0:
        return out
    h, w = y1 - y0, x1 - x0
    mu, mv = np.zeros((h, w), np.float32), np.zeros((h, w), np.float32)
    hit = np.zeros((h, w), bool)
    n = X.shape[0] - 1

    def tri(i0, i1, i2):
        ax, ay, bx, by, cx, cy = X[i0] - x0, Y[i0] - y0, X[i1] - x0, Y[i1] - y0, X[i2] - x0, Y[i2] - y0
        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(det) < 1e-9:
            return
        l, r = max(0, int(min(ax, bx, cx))), min(w, int(max(ax, bx, cx)) + 2)
        t, b = max(0, int(min(ay, by, cy))), min(h, int(max(ay, by, cy)) + 2)
        if r <= l or b <= t:
            return
        px = np.arange(l, r, dtype=np.float32)[None, :] + 0.5
        py = np.arange(t, b, dtype=np.float32)[:, None] + 0.5
        w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det
        w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det
        w2 = 1 - w0 - w1
        ins = (w0 >= -1e-3) & (w1 >= -1e-3) & (w2 >= -1e-3)
        if ins.any():
            mu[t:b, l:r][ins] = (w0 * U[i0] + w1 * U[i1] + w2 * U[i2])[ins]
            mv[t:b, l:r][ins] = (w0 * V[i0] + w1 * V[i1] + w2 * V[i2])[ins]
            hit[t:b, l:r] |= ins

    for r in range(n):
        for c in range(n):
            tl, tr, bl, br = (r, c), (r, c + 1), (r + 1, c), (r + 1, c + 1)
            tri(tl, tr, br)
            tri(tl, br, bl)
    a = np.asarray(src, np.float32) / 255.0
    a = np.dstack([a[..., :3] * a[..., 3:], a[..., 3]])  # kenarda renk sizmasin
    sh, sw = a.shape[:2]
    fx, fy = np.clip(mu * (sw - 1), 0, sw - 1), np.clip(mv * (sh - 1), 0, sh - 1)
    ix, iy = np.minimum(fx.astype(np.int32), sw - 2 if sw > 1 else 0), np.minimum(fy.astype(np.int32), sh - 2 if sh > 1 else 0)
    tx, ty = (fx - ix)[..., None], (fy - iy)[..., None]
    jx, jy = np.minimum(ix + 1, sw - 1), np.minimum(iy + 1, sh - 1)
    res = (a[iy, ix] * (1 - tx) + a[iy, jx] * tx) * (1 - ty) + (a[jy, ix] * (1 - tx) + a[jy, jx] * tx) * ty
    alpha = res[..., 3] * (np.asarray(Image.fromarray(hit.astype(np.uint8) * 255, "L").filter(ImageFilter.BoxBlur(0.6)), np.float32) / 255.0)
    rgb = res[..., :3] / np.maximum(res[..., 3:], 1e-4)
    arr = (np.clip(np.dstack([rgb, alpha]), 0, 1) * 255).astype(np.uint8)
    arr[~hit] = 0
    out.paste(Image.fromarray(arr, "RGBA"), (x0, y0))
    return out


def _auto_blend(layer, img, side):
    """Otomatik harmanlama: katmanin rengini altindakine esitler, kenarlarini yumusatir."""
    arr = np.asarray(layer, np.float32) / 255.0
    a = arr[..., 3]
    under = np.asarray(img, np.float32) / 255.0
    both = (a > 0.5) & (under[..., 3] > 0.5)
    if both.any():
        gain = np.clip(under[both][:, :3].mean(0) / np.maximum(arr[both][:, :3].mean(0), 1e-3), 0.6, 1.6)
        arr[..., :3] = np.clip(arr[..., :3] * gain, 0, 1)
    soft = np.clip((gauss(a, max(1.0, side * 0.07)) - 0.5) * 2, 0, 1)
    arr[..., 3] = np.minimum(a, soft)
    return Image.fromarray((arr * 255).astype(np.uint8), "RGBA")


def layer_mask_array(ly, w, h):
    """Katman maskesi (firca) ve vektor maske: katmanin kendi koordinatlarinda 0..1."""
    out = np.ones((h, w), np.float32)
    mk = ly.get("mask") or {}
    if mk and not mk.get("off"):
        for op in mk.get("ops") or []:
            reg = brush_region(h, w, op)
            out = np.maximum(out, reg) if op.get("add", True) else np.minimum(out, 1 - reg)
        if mk.get("invert"):
            out = 1 - out
        if mk.get("feather"):
            out = gauss(out, max(0.5, float(mk["feather"]) * 0.05 * min(w, h)))
        if mk.get("density", 1) < 1:  # yogunluk: gizlenen yerler tamamen kaybolmaz
            out = 1 - (1 - out) * float(mk["density"])
    v = ly.get("vector")
    if v:
        out = np.minimum(out, polygon_region(h, w, v["pts"]) if v["kind"] == "path" else shape_region(h, w, v))
    return out


def _layer_font(family, size, bold):
    size = max(4, int(size))
    f = family_font(family, size, "Bold" if bold else None, False) if family else None
    if f is None:
        reg = font_registry()
        fam = sorted(reg["bundled"], key=str.casefold)
        f = family_font(fam[0], size, "Bold" if bold else None, False) if fam else None
    return f or ImageFont.load_default(size)


def _adjust_layer(img, ly, under):
    """Ayar katmani: altindaki her seyi etkiler; maske ve opaklikla sinirlanir."""
    if not ly.get("adjust"):
        return img
    W, H = img.size
    a = np.asarray(img, np.float32) / 255.0
    rgb = a[..., :3]
    m = layer_mask_array(ly, W, H) * float(ly.get("opacity", 1.0))
    if ly.get("clip") and under is not None:
        m = m * under
    out = adjustments.apply(rgb, ly["adjust"], gauss)
    a[..., :3] = rgb + (out - rgb) * m[..., None]
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")


def place_layers(base, layers, loader, source=None):
    """Fotografin ustune (yazinin altina) baska gorselleri yerlestirir. loader(layer) -> RGBA.
    id'si "base" olan katman fotografin kendisidir: tuval once bosalir, islenmis fotograf o katman gibi yerlesir.
    "base" isaretli kopyalar da islenmis fotografi kullanir (source verilmezse base)."""
    if not layers:
        return base
    W, H = base.size
    photo = (source or base).convert("RGBA")
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0)) if any(ly.get("id") == "base" for ly in layers) else base.convert("RGBA")
    under = None  # kirpma maskesi: alttaki normal katmanin alfasi
    for ly in layers:
        kind = ly.get("kind")
        if kind == "adjust":
            img = _adjust_layer(img, ly, under)
            continue
        if kind in layerfx.GENERATED:
            gw = min(max(1, round(float(ly["w"]) * W)), 8192)
            src = layerfx.make(ly, gw, min(max(1, round(gw * float(ly["ar"]))), 8192), _layer_font)
        else:
            src = photo if ly.get("base") else loader(ly)
        fancy = bool(ly.get("styles")) or float(ly.get("fill", 1.0)) < 1 or ly.get("mode", "normal") != "normal"
        sy = float(ly.get("sy", 1.0))
        w = max(1, round(float(ly["w"]) * W))
        h = max(1, round(w * src.height / src.width * sy))
        im = src.resize((min(w, 8192), min(h, 8192)), Image.LANCZOS)
        if ly.get("paint"):
            im = apply_paint(im, im, ly["paint"])
        if ly.get("flipH"):
            im = ImageOps.mirror(im)
        if ly.get("mask") or ly.get("vector") or ly.get("defringe"):
            a = np.asarray(im, np.float32) / 255.0
            if ly.get("defringe"):
                a = defringe_edges(a, max(1.0, float(ly["defringe"]) * 0.02 * min(im.size)))
            if ly.get("mask") or ly.get("vector"):
                a = np.dstack([a[..., :3], a[..., 3] * layer_mask_array(ly, im.width, im.height)])
            im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
        op = float(ly.get("opacity", 1.0))
        if op < 1 and not fancy:  # stilli katmanda opaklik stillerle birlikte en sonda uygulanir
            im.putalpha(im.getchannel("A").point(lambda v: round(v * op)))
        if layer_deformed(ly):
            X, Y, U, V = layer_mesh(ly, W, H, src.height / src.width)
            layer = raster_mesh(im, X, Y, U, V, W, H)
        else:
            if ly.get("rot"):
                im = im.rotate(-float(ly["rot"]), resample=Image.BICUBIC, expand=True)
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            layer.paste(im, (round(float(ly["x"]) * W - im.width / 2), round(float(ly["y"]) * H - im.height / 2)))
        if ly.get("blend"):
            layer = _auto_blend(layer, img, min(w, h))
        if ly.get("clip") and under is not None:
            layer.putalpha(Image.fromarray((np.asarray(layer.getchannel("A"), np.float32) * under).astype(np.uint8), "L"))
        elif not ly.get("clip"):
            under = np.asarray(layer.getchannel("A"), np.float32) / 255.0
        img = layerfx.composite(img, layer, ly, gauss, min(W, H) / 1000.0) if fancy else Image.alpha_composite(img, layer)
    return img


def _phase_shift(a, b):
    """b'nin a ile ortusmesi icin gereken (dx, dy) tam piksel kaydirma."""
    F = np.fft.fft2(a) * np.conj(np.fft.fft2(b))
    F /= np.maximum(np.abs(F), 1e-9)
    c = np.fft.ifft2(F).real
    y, x = np.unravel_index(c.argmax(), c.shape)
    h, w = c.shape
    return (x - w if x > w / 2 else x), (y - h if y > h / 2 else y)


def _ncc(a, b, mask):
    if mask.sum() < 50:
        return -1.0
    x, y = a[mask] - a[mask].mean(), b[mask] - b[mask].mean()
    return float((x * y).sum() / max(float(np.sqrt((x * x).sum() * (y * y).sum())), 1e-6))


def auto_align_layer(ref, ref_mask, ly, loader, W, H):
    """Katmani icerigine gore referansa hizalar. ref/ref_mask: W x H gri ve gecerli alan. {x, y, w, rot} ya da None."""
    best = None
    blank = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for s in (0.92, 0.96, 1.0, 1.04, 1.08):
        for r in (-4.0, -2.0, 0.0, 2.0, 4.0):
            t = {**ly, "w": float(ly["w"]) * s, "rot": float(ly.get("rot") or 0) + r, "opacity": 1.0, "blend": False}
            a = np.asarray(place_layers(blank, [t], loader), np.float32) / 255.0
            m = a[..., 3] > 0.9
            if m.sum() < 80:
                continue
            g = a[..., :3] @ looks.LUMA
            g2 = np.where(m, g, g[m].mean())
            rr = np.where(ref_mask, ref, ref[ref_mask].mean())
            dx, dy = _phase_shift(rr - rr.mean(), g2 - g2.mean())
            ov = np.roll(m, (dy, dx), (0, 1)) & ref_mask
            if abs(dx) > W * 0.6 or abs(dy) > H * 0.6 or ov.sum() < 0.15 * min(m.sum(), ref_mask.sum()):
                continue
            score = _ncc(rr, np.roll(g2, (dy, dx), (0, 1)), ov)
            if best is None or score > best[0]:
                best = (score, t, dx, dy)
    if best is None or best[0] < 0.2:
        return None
    _, t, dx, dy = best
    return {"x": float(t["x"]) + dx / W, "y": float(t["y"]) + dy / H, "w": t["w"], "rot": t["rot"], "score": round(best[0], 3)}


def compose(cfg, base, text, tone, accent_word="", styles=None, block=(0, 0), offsets=None,
            k=None, wm=None, font=None, textfx=None, layers=None, loader=None):
    """Hazir zemine gorsel katmanlarini, yaziyi ve filigrani ekle. (gorsel, yerlesim) dondurur; yazi yoksa yerlesim None.
    k: yazi olcegi (varsayilan tuval boyutundan), wm: filigran (varsayilan marka imzasi)."""
    W, H = base.size
    k = canvas_scale(W, H) if k is None else k
    layout, img = None, place_layers(base, layers, loader)
    if text.strip():
        specs = build_specs(text, accent_word, styles, cfg["tones"][tone]["uppercase"])
        tfx = textfx or {}
        layout = layout_text(cfg, tone, specs, W, H, k, font, float(tfx.get("tracking") or 0), float(tfx.get("leading") or 1.0))
        layer = draw_layout(cfg, layout, W, H, block, offsets, float(tfx.get("outline") or 0), tfx.get("outlineColor"))
        shadow = float(tfx["shadow"]) if "shadow" in tfx else 0.65
        img = Image.alpha_composite(img, add_shadow(layer, radius=14 * k, strength=shadow) if shadow > 0 else layer)
    img = Image.alpha_composite(img, watermark_layer(cfg, W, H, k, wm))
    return img, layout


EXPORT_FORMATS = {"jpg": "JPEG", "png": "PNG", "webp": "WEBP", "tiff": "TIFF", "psd": "PSD"}
# renk modu -> kaydedebilen bicimler (ilki varsayilan)
COLOR_MODES = {"rgb": ("jpg", "png", "webp", "tiff", "psd"), "gray": ("jpg", "png", "tiff"), "cmyk": ("jpg", "tiff"),
               "bitmap": ("png", "tiff"), "indexed": ("png", "tiff"), "lab": ("tiff",)}


def to_color_mode(img, color):
    """RGB(A) -> istenen renk modu. Seffaflik yalnizca rgb/gray'de korunur."""
    if color == "gray":
        return img.convert("LA") if img.mode == "RGBA" else img.convert("L")
    if img.mode == "RGBA":
        flat = Image.new("RGB", img.size, (255, 255, 255))
        flat.paste(img, mask=img.getchannel("A"))
        img = flat
    if color == "cmyk":
        return img.convert("CMYK")
    if color == "bitmap":
        return img.convert("L").convert("1")  # Floyd-Steinberg ile siyah-beyaz noktalar
    if color == "indexed":
        return img.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
    if color == "lab":
        from PIL import ImageCms
        t = ImageCms.buildTransform(ImageCms.createProfile("sRGB"), ImageCms.createProfile("LAB"), "RGB", "LAB")
        return ImageCms.applyTransform(img, t)
    return img


def source_exif(image_path):
    """Kaynak fotografin EXIF'i (kamera, tarih); yon sifirlanir, konum (GPS) her zaman silinir."""
    try:
        with Image.open(image_path) as im:
            exif = im.getexif()
        exif[0x0112] = 1          # yon zaten uygulandi
        exif.pop(0x8825, None)    # GPS
        return exif.tobytes()
    except Exception:
        return None


def save_image(img, out_path, fmt="jpg", quality=95, exif=None, color="rgb", dpi=None):
    """Seffaf arka plan PNG/WebP/TIFF'te korunur; JPEG seffaflik tasimaz, beyaz zemine yerlestirilir.
    color: COLOR_MODES anahtari, dpi: baski cozunurlugu (dosyaya yazilir, pikselleri degistirmez)."""
    alpha = img.mode == "RGBA" and img.getchannel("A").getextrema()[0] < 255
    if alpha and fmt in ("png", "webp", "tiff"):
        pass
    elif alpha:
        flat = Image.new("RGB", img.size, (255, 255, 255))
        flat.paste(img, mask=img.getchannel("A"))
        img = flat
    else:
        img = img.convert("RGB")
    if color in COLOR_MODES and color != "rgb":
        img = to_color_mode(img, color)
    kw = {"exif": exif} if exif else {}
    if dpi:
        kw["dpi"] = (int(dpi), int(dpi))
    if fmt == "tiff":
        img.save(out_path, "TIFF", compression="tiff_lzw" if img.mode not in ("1", "LAB") else None, **kw)
    elif fmt == "png":
        img.save(out_path, "PNG", compress_level=6, **kw)
    elif fmt == "webp":
        img.save(out_path, "WEBP", quality=int(quality), method=4, **kw)
    else:
        img.save(out_path, "JPEG", quality=int(quality), subsampling=0 if quality >= 90 else 2, **kw)


def psd_stack(cfg, base, layers, loader, text_layer, wm_layer):
    """PSD icin katmanlar (alttan uste). Ayar katmani ve otomatik harman PSD'de karsiliksiz: o noktaya kadarki birlesik goruntu piksel katmani olur."""
    W, H = base.size
    blank = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out = []
    if not any(ly.get("id") == "base" for ly in layers):
        out.append({"name": "Arka Plan", "image": base.convert("RGBA")})
    shown = []
    for ly in layers:
        off = bool(ly.get("off"))
        name = ly.get("name") or "Katman"
        if not off:
            shown.append(ly)
        entry = {"name": name, "hidden": off, "group": ly.get("groupName")}
        if ly.get("kind") == "adjust" or ly.get("blend"):
            out.append({**entry, "name": f"{name} (uygulanmış)", "image": place_layers(base, shown, loader) if shown else blank})
            continue
        solo = {**ly, "opacity": 1.0, "mode": "normal", "clip": False}
        out.append({**entry, "image": place_layers(blank, [solo], loader, source=base), "opacity": float(ly.get("opacity", 1.0)), "mode": ly.get("mode", "normal"), "clip": bool(ly.get("clip"))})
    if text_layer is not None:
        out.append({"name": "Yazı", "image": text_layer})
    if wm_layer is not None:
        out.append({"name": "Filigran", "image": wm_layer})
    return out


def render_one(cfg, image_path, text, tone, accent_word, out_path,
               styles=None, fx=None, block=(0, 0), offsets=None, geo=None, wm=None,
               fmt="jpg", quality=95, keep_exif=False, font=None, textfx=None, color="rgb", dpi=None,
               layers=None, loader=None, slices=None):
    """slices verilirse tam gorsel yerine her dilim ayri dosya olur ve yollarin listesi doner."""
    out_path = Path(out_path)
    if fmt == "psd" and slices:  # dilimler tek katmanli parcalardir
        fmt, out_path = "png", out_path.with_suffix(".png")
    base = make_base(cfg, image_path, fx, geo)
    # gizli katmanlar yalnizca PSD'ye yazilir, cizime girmez (gizli Arka Plan tuvali bos birakir)
    visible = [({**ly, "opacity": 0.0} if ly.get("id") == "base" else ly) if ly.get("off") else ly for ly in (layers or [])]
    visible = [ly for ly in visible if not ly.get("off") or ly.get("id") == "base"]
    img, layout = compose(cfg, base, text, tone, accent_word, styles, block, offsets, wm=wm, font=font, textfx=textfx,
                          layers=visible, loader=loader)
    size = layout["size"] if layout else 0
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "psd":
        W, H = base.size
        blank = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        text_layer = compose(cfg, blank, text, tone, accent_word, styles, block, offsets, wm={"enabled": False}, font=font, textfx=textfx)[0] if text.strip() else None
        mark = watermark_layer(cfg, W, H, canvas_scale(W, H), wm)
        psdfile.write(out_path, W, H, psd_stack(cfg, base, layers or [], loader, text_layer, mark if mark.getbbox() else None), img, dpi)
        return size
    if slices:
        W, H = img.size
        paths = []
        for i, sl in enumerate(slices, start=1):
            box = (round(sl["x"] * W), round(sl["y"] * H), round((sl["x"] + sl["w"]) * W), round((sl["y"] + sl["h"]) * H))
            p = out_path.with_name(f"{out_path.stem}_{sl.get('name') or f'{i:02d}'}{out_path.suffix}")
            save_image(img.crop(box), p, fmt, quality, None, color, dpi)
            paths.append(p)
        return paths
    save_image(img, out_path, fmt, quality, source_exif(image_path) if keep_exif else None, color, dpi)
    return size


def check_row(cfg, row):
    warns = []
    n = len(row["text"].split())
    if n > cfg["limits"]["max_words"]:
        warns.append(f"{n} kelime (onerilen en fazla {cfg['limits']['max_words']})")
    if row.get("accent_word") and norm(row["accent_word"]) not in [norm(w) for w in row["text"].split()]:
        warns.append(f"accent_word '{row['accent_word']}' metinde yok")
    if row["tone"] not in cfg["tones"]:
        warns.append(f"bilinmeyen ton '{row['tone']}' (quiet/hard)")
    return warns


IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def natural_key(p):
    """01, 2, 10 gibi adlari dogru sirala (2, 10'dan once gelir)."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", p.name)]


def parse_texts(path):
    """texts.txt satiri:  ton | metin | vurgu_kelimesi   (ton ve vurgu opsiyonel)"""
    rows = []
    for n, line in enumerate(Path(path).read_text(encoding="utf-8-sig").splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) == 1:
            tone, text, accent = "quiet", parts[0], ""
        elif len(parts) == 2:
            tone, text, accent = parts[0], parts[1], ""
        else:
            tone, text, accent = parts[0], parts[1], parts[2]
        rows.append({"tone": tone.lower(), "text": text, "accent_word": accent, "line": n})
    return rows


def run_texts(cfg, args):
    in_dir, out_dir = Path(args.input), Path(args.output)
    photos = sorted((p for p in in_dir.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXT),
                    key=natural_key) if in_dir.exists() else []
    rows = parse_texts(args.texts)

    if not photos:
        sys.exit(f"[hata] {in_dir} icinde fotograf yok.")
    if len(photos) != len(rows):
        sys.exit(f"[hata] {len(photos)} fotograf ama {len(rows)} metin var. "
                 f"Eski fotograflar input klasorunde kaldiysa tasi ya da --archive kullan.")

    bad = [r for r in rows if r["tone"] not in cfg["tones"]]
    if bad:
        for r in bad:
            print(f"[hata] texts.txt satir {r['line']}: bilinmeyen ton '{r['tone']}' "
                  f"({'/'.join(cfg['tones'])})")
        sys.exit(1)

    sched = cfg.get("schedule", {})
    hh, mm = (int(x) for x in sched.get("time", "20:00").split(":"))
    start = (datetime.strptime(args.start, "%Y-%m-%d") if args.start
             else datetime.now() + timedelta(days=1))
    start = start.replace(hour=hh, minute=mm, second=0, microsecond=0)

    manifest = []
    for i, (photo, row) in enumerate(zip(photos, rows), start=1):
        for w in check_row(cfg, row):
            print(f"[uyari] metin satiri {row['line']}: {w}")
        out = out_dir / f"{i:03d}_{photo.stem}.jpg"
        size = render_one(cfg, photo, row["text"], row["tone"], row["accent_word"], out)
        publish_at = (start + timedelta(days=i - 1)).strftime("%Y-%m-%d %H:%M")
        print(f"ok  {out.name}  ({row['tone']}, font {size}px, {publish_at})")
        manifest.append({"image": photo.name, "text": row["text"], "tone": row["tone"],
                         "accent_word": row["accent_word"], "publish_at": publish_at,
                         "caption": "", "output": str(out)})

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.archive:
        arch = in_dir / "kullanilanlar"
        arch.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d")
        for p in photos:
            target = arch / p.name
            if target.exists():
                target = arch / f"{stamp}_{p.name}"
            p.rename(target)
        print(f"{len(photos)} fotograf {arch} klasorune tasindi.")

    print(f"\n{len(manifest)} gorsel hazir. Liste: {out_dir / 'manifest.json'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(HERE / "brand.json"))
    ap.add_argument("--queue", default=str(HERE / "queue.csv"))
    ap.add_argument("--input", default=str(HERE / "input"))
    ap.add_argument("--output", default=str(HERE / "output"))
    ap.add_argument("--image")
    ap.add_argument("--text")
    ap.add_argument("--tone", default="quiet")
    ap.add_argument("--accent", default="")
    ap.add_argument("--out")
    ap.add_argument("--texts", default=str(HERE / "texts.txt"))
    ap.add_argument("--csv", action="store_true", help="texts.txt varken bile queue.csv kullan")
    ap.add_argument("--start", help="ilk paylasim tarihi YYYY-MM-DD (varsayilan: yarin)")
    ap.add_argument("--archive", action="store_true",
                    help="islenen fotograflari input/kullanilanlar klasorune tasi")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))

    for role in ("quiet", "hard", "signature"):
        if font_was_fallback(cfg, role):
            print(f"[uyari] '{role}' fontu bulunamadi, sistem fontu kullaniliyor: {cfg['fonts'][role]}")

    # tek gorsel onizleme modu
    if args.image:
        if not args.text:
            sys.exit("--image ile birlikte --text gerekli")
        out = Path(args.out or Path(args.output) / "preview.jpg")
        size = render_one(cfg, args.image, args.text, args.tone, args.accent, out)
        print(f"ok -> {out} (font {size}px)")
        return

    # texts.txt modu: fotograflar ad sirasina gore metinlerle eslesir
    if Path(args.texts).exists() and not args.csv:
        run_texts(cfg, args)
        return

    # kuyruk modu (queue.csv)
    qpath = Path(args.queue)
    if not qpath.exists():
        sys.exit(f"Kuyruk dosyasi yok: {qpath}")
    out_dir = Path(args.output)
    manifest, errors = [], 0

    with open(qpath, newline="", encoding="utf-8-sig") as f:
        for i, row in enumerate(csv.DictReader(f), start=1):
            row = {k: (v or "").strip() for k, v in row.items()}
            img_path = Path(args.input) / row["image"]
            if not img_path.exists():
                print(f"[hata] satir {i}: gorsel yok -> {img_path}")
                errors += 1
                continue
            for w in check_row(cfg, row):
                print(f"[uyari] satir {i}: {w}")
            if row["tone"] not in cfg["tones"]:
                errors += 1
                continue
            out = out_dir / f"{i:03d}_{Path(row['image']).stem}.jpg"
            size = render_one(cfg, img_path, row["text"], row["tone"], row.get("accent_word", ""), out)
            print(f"ok  {out.name}  ({row['tone']}, font {size}px)")
            manifest.append({**row, "output": str(out)})

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{len(manifest)} gorsel hazir, {errors} hata. Liste: {out_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()

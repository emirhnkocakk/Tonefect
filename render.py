#!/usr/bin/env python3
"""NEGAN'S VISION - gorsel uretim scripti.

Kullanim:
  python render.py                      # queue.csv'deki tum satirlari isle
  python render.py --queue queue.csv --input input --output output
  python render.py --image input/a.jpg --text "Your sentence." --tone quiet --accent "sentence"
"""
import argparse
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
    # detay: kullanicinin ayari + hazir ayarin netligi (yogunlukla)
    adj = (fx.get("adjust") or {}) if fx else {}
    clarity = float(adj.get("clarity") or 0) + float((look or {}).get("clarity") or 0) * float(fx.get("amount", 1.0) if fx else 1)
    sharpen, denoise = float(adj.get("sharpen") or 0), float(adj.get("denoise") or 0)
    if sharpen or clarity or denoise:
        arr = detail(arr, sharpen, max(-1.0, min(1.0, clarity)), denoise, grain_scale)

    matte_fn = (fx or {}).get("_matte") if fx else None  # konu maskesi: boyut -> 0..1 dizi (sunucu saglar)
    for m in ((fx or {}).get("masks") or []) if fx else []:
        arr = apply_mask(arr, m, grain_scale, src, matte_fn)

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
        img = apply_background(img, matte_fn(img.size), bg, grain_scale)
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


def fill_region(arr, wgt):
    """Secilen alani cevresinden doldurur (alan tasindiysa arkada kalan bosluk icin).
    Cok olcekli normalize bulaniklastirma: yakin pikseller once, uzaktakiler sonra."""
    h, w = arr.shape[:2]
    known = np.clip(1 - wgt * 1.5, 0, 1).astype(np.float32)  # kenarda secimden biraz pay birak
    est = (arr * known[..., None]).sum((0, 1)) / max(float(known.sum()), 1.0)
    est = np.broadcast_to(est, arr.shape).astype(np.float32)
    for f in (0.3, 0.12, 0.05, 0.02, 0.008):
        s = max(1.0, max(h, w) * f)
        den = gauss(known, s)
        e = gauss(arr * known[..., None], s) / np.maximum(den, 1e-4)[..., None]
        conf = np.clip(den * 3, 0, 1)[..., None]
        est = est * (1 - conf) + e * conf
    return arr * (1 - wgt[..., None]) + est * wgt[..., None]


def apply_mask(arr, m, k=1.0, src=None, matte_fn=None):
    if m.get("fill"):  # alan tasindi: arkada kalan yer cevreden doldurulur
        arr = fill_region(np.clip(arr, 0, 1), mask_weight(m, *arr.shape[:2], src, matte_fn))
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


def select_weight(m, src, matte_fn=None):
    h, w = src.shape[:2]
    out = np.zeros((h, w), np.float32)
    for op in (m.get("ops") or [])[:300]:
        kind = op.get("kind")
        if kind == "subject":  # yapay zeka konu maskesi (inverse: arka plan)
            if matte_fn is None:
                raise ValueError("Konu seçimi için yapay zekâ modeli gerekli.")
            reg = matte_fn((w, h))
            reg = 1 - reg if op.get("inverse") else reg
        elif kind == "wand":
            reg = wand_region(src, op)
        else:
            reg = brush_region(h, w, op)
        out = np.maximum(out, reg) if op.get("add", True) else np.minimum(out, 1 - reg)
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
        rgba = np.dstack([fg, a[..., 0]])
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
    crop = geo.get("crop")
    r = aspect_ratio(geo.get("aspect"))
    content = geo.get("fit") == "content" and r
    if isinstance(crop, (list, tuple)) and len(crop) == 4:
        cx, cy, cw, ch = (float(v) for v in crop)
        cw, ch = max(0.01, min(1.0, cw)), max(0.01, min(1.0, ch))
        cx, cy = max(0.0, min(1 - cw, cx)), max(0.0, min(1 - ch, cy))
    else:
        cx, cy, cw, ch = 0.0, 0.0, 1.0, 1.0
        if r and not content:
            if iw / ih > r:
                cw = r * ih / iw
            else:
                ch = iw / r / ih
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
            "quad": quad, "pre": pre, "oriented": (ow, oh), "content": bool(content), "inner": (iw, ih), "crop": (cx, cy, cw, ch), "natural": nat, "size": size}


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


def grade_base(cfg, cropped, image_path, fx=None, grain_scale=1.0):
    seed = zlib.crc32(str(Path(image_path).name).encode())
    return grade(cropped, cfg, seed, fx, grain_scale).convert("RGBA")


def make_base(cfg, image_path, fx=None, geo=None):
    """Fotografi kirp + siyah-beyaz/vinyet/gren uygula (yazi yok)."""
    if not geo:
        return grade_base(cfg, load_cropped(cfg, image_path), image_path, fx)
    img = open_photo(image_path)
    cropped = apply_geo(img, geo, img.size)
    return extend_canvas(grade_base(cfg, cropped, image_path, fx, canvas_scale(*cropped.size)), geo)


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
def place_layers(base, layers, loader):
    """Fotografin ustune (yazinin altina) baska gorselleri yerlestirir. loader(layer) -> RGBA."""
    if not layers:
        return base
    W, H = base.size
    img = base.convert("RGBA")
    for ly in layers:
        src = loader(ly)
        w = max(1, round(float(ly["w"]) * W))
        h = max(1, round(w * src.height / src.width))
        im = src.resize((w, h), Image.LANCZOS)
        if ly.get("flipH"):
            im = ImageOps.mirror(im)
        if ly.get("rot"):
            im = im.rotate(-float(ly["rot"]), resample=Image.BICUBIC, expand=True)
        op = float(ly.get("opacity", 1.0))
        if op < 1:
            im.putalpha(im.getchannel("A").point(lambda v: round(v * op)))
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        layer.paste(im, (round(float(ly["x"]) * W - im.width / 2), round(float(ly["y"]) * H - im.height / 2)))
        img = Image.alpha_composite(img, layer)
    return img


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


EXPORT_FORMATS = {"jpg": "JPEG", "png": "PNG", "webp": "WEBP", "tiff": "TIFF"}
# renk modu -> kaydedebilen bicimler (ilki varsayilan)
COLOR_MODES = {"rgb": ("jpg", "png", "webp", "tiff"), "gray": ("jpg", "png", "tiff"), "cmyk": ("jpg", "tiff"),
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


def render_one(cfg, image_path, text, tone, accent_word, out_path,
               styles=None, fx=None, block=(0, 0), offsets=None, geo=None, wm=None,
               fmt="jpg", quality=95, keep_exif=False, font=None, textfx=None, color="rgb", dpi=None,
               layers=None, loader=None):
    out_path = Path(out_path)
    base = make_base(cfg, image_path, fx, geo)
    img, layout = compose(cfg, base, text, tone, accent_word, styles, block, offsets, wm=wm, font=font, textfx=textfx,
                          layers=layers, loader=loader)
    size = layout["size"] if layout else 0
    out_path.parent.mkdir(parents=True, exist_ok=True)
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

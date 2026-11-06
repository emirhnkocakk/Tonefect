#!/usr/bin/env python3
"""Tonefect - yerel sunucu ve uygulama penceresi.

Arayuz (web/ klasoru, React + shadcn/ui) bu sunucuyla konusur; gorsel uretim render.py motorunu kullanir.
Calistir:  python server.py
"""
import atexit
import base64
import io
import json
import math
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import tempfile
import urllib.request
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

if sys.stdout is None:  # exe (konsolsuz) modunda
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import numpy as np
from PIL import Image, ImageOps

import ai
import looks
import render as engine

HERE = engine.HERE
WEB = HERE / "web"
UPLOADS = HERE / "uploads"
THUMBS = UPLOADS / ".thumbs"
MATTES = UPLOADS / ".mattes"  # yapay zeka konu maskeleri (fotograf basina bir kez)
SESSION = HERE / "oturum_web.json"  # eski tek oturum; ilk açılışta projeye taşınır
PROJECTS = HERE / "projects"
PROJECT_LOCK = threading.Lock()
PREFS = HERE / "ayarlar.json"
PENDING = Path(tempfile.gettempdir()) / "grainline_update_pending.json"
DEFAULT_OUT = HERE / "output"

CFG = json.loads((HERE / "brand.json").read_text(encoding="utf-8"))
W, H = CFG["canvas"]["width"], CFG["canvas"]["height"]
TONES = list(CFG["tones"].keys())
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
WEIGHTS = set(engine.WEIGHT_ALIASES.keys())

LOCK = threading.Lock()
CROP, BASE, JOBS = {}, {}, {}
USER_PRESETS = HERE / "presets"
PRESETS = looks.load_all(USER_PRESETS)


STATE = {"quit_on_close": True, "last_beat": 0.0, "closing_at": 0.0, "seen": False}


def num(v, lo, hi, default=0.0):
    """Sayıya çevirir, NaN/sonsuz değerleri ve aralık dışını engeller."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, f)) if math.isfinite(f) else default


def read_prefs():
    try:
        return json.loads(PREFS.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_prefs(**kw):
    d = read_prefs()
    d.update(kw)
    PREFS.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")


WATERMARK = {}


def clean_wm(w):
    w = w if isinstance(w, dict) else {}
    return {"enabled": bool(w.get("enabled")), "text": str(w.get("text") or "").strip()[:40],
            "position": w.get("position") if w.get("position") in engine.WM_POSITIONS else "br",
            "opacity": round(num(w.get("opacity"), 0.05, 1.0, 0.7), 3),
            "size": round(num(w.get("size"), 0.3, 6.0, 1.0), 3)}


def load_prefs():
    d = read_prefs()
    if "signature" in d:  # eski sürüm: boş kaydedildiyse imza kapalı
        CFG["brand"]["signature_text"] = str(d["signature"]).strip()[:40]
    WATERMARK.clear()
    WATERMARK.update(clean_wm(d["watermark"]) if "watermark" in d else engine.default_watermark(CFG))
    STATE["quit_on_close"] = bool(d.get("quitOnClose", True))


def save_watermark(w):
    WATERMARK.clear()
    WATERMARK.update(clean_wm(w))
    write_prefs(watermark=WATERMARK)
    return WATERMARK


def save_signature(text):
    """Eski arayüz uyumluluğu: yalnızca yazıyı değiştirir, boşsa filigranı kapatır."""
    text = (text or "").strip()[:40]
    save_watermark({**WATERMARK, "text": text, "enabled": bool(text)})
    return text


load_prefs()
PORT = 8765


# ------------------------------------------------------------------ yardimcilar
def safe_name(name):
    stem = re.sub(r"[^\w.\- ]", "_", Path(name).stem, flags=re.UNICODE).strip(" .")[:60] or "foto"
    return stem + Path(name).suffix.lower()


def photo_path(pid):
    p = UPLOADS / Path(pid).name
    if not p.is_file():
        raise FileNotFoundError(f"Fotoğraf bulunamadı: {pid}")
    return p


def clean_styles(styles, n_words):
    out = []
    for i in range(n_words):
        st = styles[i] if styles and i < len(styles) and isinstance(styles[i], dict) else {}
        c = {}
        if isinstance(st.get("color"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", st["color"]):
            c["color"] = st["color"]
        if st.get("weight") in WEIGHTS:
            c["weight"] = st["weight"]
        if st.get("italic") is True:
            c["italic"] = True
        try:
            if st.get("size") and abs(float(st["size"]) - 1.0) > 1e-6:
                c["size"] = max(0.3, min(4.0, float(st["size"])))
        except (TypeError, ValueError):
            pass
        out.append(c)
    return out


def clean_fx(fx_in):
    preset = str(fx_in.get("preset") or "")
    if preset not in PRESETS:  # silinmiş ayar -> klasik görünüm
        preset = ""
    recipe = PRESETS[preset].get("recipe")
    if recipe:  # kendi kaydedilen ayar: temel görünümüne çevir (arayüz değerleri zaten kopyalar)
        preset = recipe["base"] if recipe.get("base") in PRESETS and not PRESETS[recipe["base"]].get("recipe") else ""
    adj_in = fx_in.get("adjust") if isinstance(fx_in.get("adjust"), dict) else {}
    adjust = {k: round(num(adj_in.get(k), 0.0 if k in looks.POSITIVE_KEYS else -1.0, 1.0), 3)
              for k in looks.ADJUST_KEYS}
    hsl_in = adj_in.get("hsl") if isinstance(adj_in.get("hsl"), dict) else {}
    hsl = {}
    for band, v in hsl_in.items():
        if band in looks.HUE_BANDS and isinstance(v, list):
            vals = [round(num(x, -1.0, 1.0), 3) for x in (v + [0, 0, 0])[:3]]
            if any(vals):
                hsl[band] = vals
    adjust["hsl"] = hsl
    lv = adj_in.get("levels")  # otomatik iyileştirmenin ton germe noktaları
    if isinstance(lv, list) and len(lv) == 2:
        lo, hi = num(lv[0], 0.0, 0.9), num(lv[1], 0.1, 1.0, 1.0)
        if hi - lo > 0.05 and (lo > 0 or hi < 1):
            adjust["levels"] = [round(lo, 3), round(hi, 3)]
    return {"bw": bool(fx_in.get("bw", True)),
            "grain": num(fx_in.get("grain", 1.0), 0.0, 2.0, 1.0),
            "vignette": num(fx_in.get("vignette", 1.0), 0.0, 2.0, 1.0),
            "preset": preset, "look": PRESETS[preset]["look"],
            "amount": num(fx_in.get("amount", 1.0), 0.0, 1.0, 1.0),
            "adjust": {k: v for k, v in adjust.items() if v},
            "texture": clean_texture(fx_in.get("texture")), "frame": clean_frame(fx_in.get("frame")),
            "masks": clean_masks(fx_in.get("masks")), "background": clean_background(fx_in.get("background"))}


def clean_background(b):
    b = b if isinstance(b, dict) else {}
    if b.get("mode") not in engine.BG_MODES:
        return {}
    c = b.get("color")
    return {"mode": b["mode"], "color": c if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c) else "#FFFFFF",
            "blur": round(num(b.get("blur"), 0.0, 1.0, 0.5), 3)}


AI_LOCK = threading.Lock()


def needs_matte(fx):
    return bool(fx.get("background")) or any(op.get("kind") == "subject" for m in fx.get("masks") or [] for op in m.get("ops") or [])


def matte_provider(path, geo):
    """Konu maskesini fotoğrafın kırpma/döndürmesine ve istenen boyuta hizalayan fonksiyon (gecikmeli yükler)."""
    held = {}

    def fn(size):
        if "m" not in held:
            if not ai.installed(HERE):
                raise ValueError("Yapay zekâ modeli kurulu değil. Yerel → Akıllı seçim → Konuyu seç ile kurabilirsin.")
            with AI_LOCK:
                held["m"] = ai.matte_for(HERE, path, MATTES)
        guide = get_src(path)["proxy"] if geo and geo.get("fit") == "content" else None  # aynı bükülme için
        return engine.align_matte(held["m"], geo, get_src(path)["size"] if geo else None, size, guide)
    return fn


def attach_matte(fx, path, geo):
    if needs_matte(fx):
        fx["_matte"] = matte_provider(path, geo)
    return fx


def _pt(v, lo=-0.5, hi=1.5):
    return [num(v[0], lo, hi, 0.5), num(v[1], lo, hi, 0.5)] if isinstance(v, list) and len(v) == 2 else [0.5, 0.5]


def clean_select_ops(ops):
    """Akıllı seçim adımları (sihirli değnek / fırça); toplam nokta sayısı sınırlı."""
    out, budget = [], 6000
    for op in (ops if isinstance(ops, list) else [])[:300]:
        if not isinstance(op, dict):
            continue
        add = op.get("add", True) is not False
        if op.get("kind") == "subject":
            out.append({"kind": "subject", "add": add, "inverse": bool(op.get("inverse"))})
        elif op.get("kind") == "wand":
            out.append({"kind": "wand", "p": _pt(op.get("p"), 0.0, 1.0), "tol": round(num(op.get("tol"), 0.0, 1.0, 0.3), 3),
                        "contiguous": op.get("contiguous", True) is not False, "add": add})
        elif op.get("kind") == "brush" and isinstance(op.get("pts"), list):
            pts = [_pt(q, -0.2, 1.2) for q in op["pts"][:budget]]
            budget -= len(pts)
            if pts:
                out.append({"kind": "brush", "pts": [[round(x, 4), round(y, 4)] for x, y in pts],
                            "r": round(num(op.get("r"), 0.002, 0.3, 0.03), 4), "hard": round(num(op.get("hard"), 0.0, 1.0, 0.6), 3), "add": add})
        if budget <= 0:
            break
    return out


def clean_masks(ms, keep_empty=False):
    """Yerel düzenlemeler (en fazla 8). keep_empty: ayarı olmayan maskeyi de tut (seçim görünümü için)."""
    out = []
    pt = _pt
    for m in (ms if isinstance(ms, list) else [])[:8]:
        if not isinstance(m, dict) or m.get("type") not in ("linear", "radial", "select"):
            continue
        adj_in = m.get("adjust") if isinstance(m.get("adjust"), dict) else {}
        adj = {k: round(num(adj_in.get(k), -1.0, 1.0), 3) for k in engine.MASK_KEYS}
        c = {"type": m["type"], "invert": bool(m.get("invert")), "adjust": {k: v for k, v in adj.items() if v}}
        if m["type"] == "linear":
            c.update(a=pt(m.get("a")), b=pt(m.get("b")))
        elif m["type"] == "select":
            c.update(ops=clean_select_ops(m.get("ops")), feather=round(num(m.get("feather"), 0.0, 1.0, 0.1), 3))
        else:
            c.update(c=pt(m.get("c")), r=pt(m.get("r"), 0.01, 2.0), feather=round(num(m.get("feather"), 0.0, 1.0, 0.5), 3))
        if m["type"] == "select" and m.get("fill"):
            c["fill"] = True
        if c["adjust"] or c.get("fill") or keep_empty:
            out.append(c)
    return out


def mask_view(d):
    """Akıllı seçimin önizlemede kırmızı katman olarak gösterimi (PNG, alfa = seçim)."""
    path = photo_path(d["photo"])
    geo = clean_geo(d.get("geo"))
    masks = clean_masks([d.get("mask")], keep_empty=True)
    if not masks:
        raise ValueError("Geçersiz maske")
    tw = max(120, min(1200, int(num(d.get("w"), 120, 1200, 600))))
    with LOCK:
        if geo is None:
            img = get_crop(path).resize((tw, round(tw * H / W)), Image.BILINEAR)
        else:
            size = engine.geo_plan(geo, *get_src(path)["size"])["size"]
            img = geo_image(path, geo, (tw, max(1, round(tw * size[1] / size[0]))))
    src = np.asarray(img, dtype=np.float32) / 255.0
    mfx = attach_matte({"masks": masks}, path, geo)
    wgt = engine.mask_weight(masks[0], *src.shape[:2], src, mfx.get("_matte"))
    rgba = np.zeros(src.shape[:2] + (4,), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 255, 40, 70
    rgba[..., 3] = (wgt * 120).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, "PNG")
    return {"image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
            "coverage": round(float((wgt > 0.5).mean()), 4)}


EXTRACT_SIDE = 4096


def extract_selection(d):
    """Seçili alanı (renk ayarları uygulanmış) şeffaf PNG katmana çevirir: Photoshop'taki "kopyalayarak katman".
    Dönen x, y, w katmanın tuvaldeki yeri; böylece katman tam seçildiği yerde başlar."""
    raw = d.get("item") or {}
    item = clean_item(raw)
    path = photo_path(raw["id"])
    geo, fx = item["geo"], item["fx"]
    mraw = next((m for m in (raw.get("fx") or {}).get("masks") or [] if isinstance(m, dict) and m.get("id") == d.get("maskId")), None)
    masks = clean_masks([{**mraw, "fill": False}], keep_empty=True) if mraw else []
    if not masks or not masks[0].get("ops"):
        raise ValueError("Önce bir alan seç.")
    attach_matte(fx, path, geo)
    with LOCK:
        if geo is None:
            src_img, size = get_crop(path), (W, H)
        else:
            size = engine.geo_plan(geo, *get_src(path)["size"])["size"]
            f = min(1.0, EXTRACT_SIDE / max(size))
            src_img = geo_image(path, geo, (max(1, round(size[0] * f)), max(1, round(size[1] * f))))
    f = src_img.width / size[0]
    graded = engine.grade_base(CFG, src_img, path, fx, engine.canvas_scale(*size) * f)
    src = np.asarray(src_img, dtype=np.float32) / 255.0
    wgt = engine.mask_weight(masks[0], *src.shape[:2], src, fx.get("_matte"))
    ys, xs = np.nonzero(wgt > 0.02)
    if not len(xs):
        raise ValueError("Seçim boş.")
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    a = (wgt[y0:y1, x0:x1] * 255).astype(np.uint8)
    out = graded.crop((x0, y0, x1, y1))
    out.putalpha(Image.fromarray(np.minimum(np.asarray(out.getchannel("A")), a)))
    buf = io.BytesIO()
    out.save(buf, "PNG")
    stem = Path(str(raw.get("name") or "foto")).stem[:30]
    info = save_photo(f"{stem}_secim.png", buf.getvalue())
    (cw, ch), (ox, oy) = engine.canvas_plan(geo, size) if geo else ((W, H), (0, 0))
    return {**info, "x": (ox + (x0 + x1) / 2 / f) / cw, "y": (oy + (y0 + y1) / 2 / f) / ch, "w": (x1 - x0) / f / cw}


def clean_texture(t):
    t = t if isinstance(t, dict) else {}
    out = {k: round(num(t.get(k), 0.0, 1.0), 3) for k in ("leak", "bloom", "dust")}
    out = {k: v for k, v in out.items() if v}
    if out.get("leak"):
        out["variant"] = int(num(t.get("variant"), 0, 3))
    return out


def clean_frame(f):
    f = f if isinstance(f, dict) else {}
    if f.get("style") not in engine.FRAME_STYLES:
        return {}
    color = f.get("color") if isinstance(f.get("color"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", f["color"]) else None
    return {"style": f["style"], "size": round(num(f.get("size"), 0.0, 1.0, 0.4), 3), "color": color}


def clean_item(d):
    text = " ".join(str(d.get("text", "")).split())
    tone = d.get("tone") if d.get("tone") in TONES else TONES[0]
    fx_in = d.get("fx") or {}
    fx = clean_fx(fx_in)
    block = d.get("block") or [0, 0]
    lim = 2 * max(W, H)  # metni tuvalin çok dışına atan değerler çizimi bozmasın
    block = [num(block[0], -lim, lim), num(block[1], -lim, lim)]
    offsets = {str(k): (num(v[0], -lim, lim), num(v[1], -lim, lim))
               for k, v in (d.get("offsets") or {}).items()}
    return {
        "text": text, "tone": tone, "accent": str(d.get("accent", "")).strip(),
        "styles": clean_styles(d.get("styles"), len(text.split())),
        "fx": fx, "block": (float(block[0]), float(block[1])), "offsets": offsets,
        "geo": clean_geo(d.get("geo")),
        "font": clean_font(d.get("font")), "textfx": clean_textfx(d.get("textfx")),
        "layers": clean_layers(d.get("layers"), d.get("hidden")),
    }


def clean_layers(ls, hidden=None):
    """Görsel katmanları (birleştirme). Gizlenenler ve dosyası olmayanlar atlanır."""
    hidden = set(hidden) if isinstance(hidden, list) else set()
    out = []
    for ly in (ls if isinstance(ls, list) else [])[:20]:
        if not isinstance(ly, dict) or f"img:{ly.get('id')}" in hidden:
            continue
        pid = Path(str(ly.get("photo") or "")).name
        if not pid or not (UPLOADS / pid).is_file():
            continue
        out.append({"photo": pid, "x": num(ly.get("x"), -2.0, 3.0, 0.5), "y": num(ly.get("y"), -2.0, 3.0, 0.5),
                    "w": num(ly.get("w"), 0.01, 5.0, 0.4), "rot": num(ly.get("rot"), -360.0, 360.0, 0.0),
                    "opacity": num(ly.get("opacity"), 0.0, 1.0, 1.0), "flipH": bool(ly.get("flipH")),
                    "cutout": bool(ly.get("cutout"))})
    return out


LAYER_IMG = {}


def layer_loader(full=False):
    """Katman görselini (şeffaflığı korunarak, EXIF yönü uygulanmış) yükler; konuyu kes seçiliyse yapay zekâ maskesi alfa olur."""
    def load(ly):
        key = (ly["photo"], ly["cutout"], full)

        def make():
            path = photo_path(ly["photo"])
            with Image.open(path) as im:
                if not full:
                    im.draft("RGB", (2048, 2048))
                img = ImageOps.exif_transpose(im).convert("RGBA")
            if not full and max(img.size) > 2048:
                img.thumbnail((2048, 2048), Image.LANCZOS)
            if ly["cutout"]:
                if not ai.installed(HERE):
                    raise ValueError("Konuyu kesmek için yapay zekâ modeli gerekli (Efekt → Arka plan'dan kurabilirsin).")
                with AI_LOCK:
                    m = ai.matte_for(HERE, path, MATTES).resize(img.size, Image.BILINEAR)
                a = np.minimum(np.asarray(img.getchannel("A")), np.asarray(m))
                img.putalpha(Image.fromarray(a))
            return img
        return _lru(LAYER_IMG, key, make, 8)
    return load


def clean_font(f):
    """Kullanıcının seçtiği yazı tipi ailesi; bilinmiyorsa tonun kendi yazı tipi."""
    return f if isinstance(f, str) and f in engine.font_registry()["families"] else None


def clean_textfx(t):
    t = t if isinstance(t, dict) else {}
    out = {}
    if "shadow" in t:
        out["shadow"] = round(num(t["shadow"], 0.0, 1.0, 0.65), 3)
    if t.get("outline"):
        out["outline"] = round(num(t["outline"], 0.0, 1.0), 3)
        c = t.get("outlineColor")
        out["outlineColor"] = c if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c) else "#000000"
    if t.get("tracking"):
        out["tracking"] = round(num(t["tracking"], -0.1, 0.5), 3)
    if t.get("leading"):
        out["leading"] = round(num(t["leading"], 0.6, 2.0, 1.0), 3)
    return out


def font_list():
    reg = engine.font_registry()
    fams = sorted(reg["families"], key=str.casefold)
    return {"bundled": [f for f in fams if f in reg["bundled"]], "system": [f for f in fams if f not in reg["bundled"]]}


def clean_geo(g):
    """Kırpma/döndürme/boyut. None: eski fotoğraflar (1080x1350, ortadan kırpılmış)."""
    if not isinstance(g, dict):
        return None
    aspect = str(g.get("aspect") or "original")
    if aspect not in ("original", "free") and not engine.aspect_ratio(aspect):
        aspect = "original"
    crop = g.get("crop")
    crop = [num(v, 0.0, 1.0) for v in crop] if isinstance(crop, list) and len(crop) == 4 else None
    out = {}
    for k in ("outW", "outH"):
        v = g.get(k)
        out[k] = int(num(v, 16, engine.MAX_SIDE)) if isinstance(v, (int, float)) and v else None
    if not (out["outW"] and out["outH"]):
        out = {"outW": None, "outH": None}
    return {"aspect": aspect, "crop": crop, "rotate": int(num(g.get("rotate"), 0, 270)) // 90 * 90,
            "flipH": bool(g.get("flipH")), "flipV": bool(g.get("flipV")),
            "straighten": round(num(g.get("straighten"), -45.0, 45.0), 2), **out, "canvas": clean_canvas(g.get("canvas")),
            "persp": clean_persp(g.get("persp")), "fit": "content" if g.get("fit") == "content" else None}


def clean_persp(q):
    if not (isinstance(q, list) and len(q) == 4 and all(isinstance(p, list) and len(p) == 2 for p in q)):
        return None
    q = [[round(num(p[0], -0.5, 1.5), 4), round(num(p[1], -0.5, 1.5), 4)] for p in q]
    return None if q == [[0, 0], [1, 0], [1, 1], [0, 1]] else q


def clean_canvas(c):
    """Tuval boyutu: fotoğrafın çevresine boşluk (ya da kırpma). Yoksa None."""
    if not isinstance(c, dict) or not isinstance(c.get("w"), (int, float)) or not isinstance(c.get("h"), (int, float)):
        return None
    a = c.get("anchor")
    a = [num(a[0], 0.0, 1.0, 0.5), num(a[1], 0.0, 1.0, 0.5)] if isinstance(a, list) and len(a) == 2 else [0.5, 0.5]
    col = c.get("color")
    col = col if col == "transparent" or (isinstance(col, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", col)) else "#FFFFFF"
    return {"w": int(num(c["w"], 16, engine.MAX_SIDE)), "h": int(num(c["h"], 16, engine.MAX_SIDE)), "anchor": a, "color": col}


def get_crop(path):
    """Eski fotoğraflar için 1080x1350 kırpılmış görsel."""
    crop = CROP.pop(str(path), None) or engine.load_cropped(CFG, path)
    CROP[str(path)] = crop
    while len(CROP) > 8:
        CROP.pop(next(iter(CROP)))
    return crop


PROXY_PIXELS = 4_000_000   # önizleme için küçültülmüş kaynak
WORK_PIXELS = 2_200_000    # önizlemenin işlendiği en büyük tuval (1080x1350 tam boyutta kalır)
SRC, FULL = {}, {}


def _lru(cache, key, make, limit):
    if key in cache:
        cache[key] = cache.pop(key)
        return cache[key]
    cache[key] = make()
    while len(cache) > limit:
        cache.pop(next(iter(cache)))
    return cache[key]


def get_src(path):
    """{"size": tam boyut, "proxy": en fazla ~4 MP kopya}"""
    def make():
        proxy = engine.open_photo(path, PROXY_PIXELS)
        if proxy.width * proxy.height > PROXY_PIXELS * 1.5:  # JPEG dışı biçimler
            f = math.sqrt(PROXY_PIXELS / (proxy.width * proxy.height))
            proxy = proxy.resize((round(proxy.width * f), round(proxy.height * f)), Image.LANCZOS)
        return {"size": engine.photo_size(path), "proxy": proxy}
    return _lru(SRC, str(path), make, 6)


def geo_image(path, geo, target):
    """Kırpılmış/döndürülmüş görsel; yeterince keskinse küçültülmüş kaynaktan, değilse tam kaynaktan."""
    src = get_src(path)
    plan = engine.geo_plan(geo, *src["size"])
    need = target[0] / max(1.0, plan["crop"][2] * plan["inner"][0])  # kaynakta gereken ölçek
    img = src["proxy"]
    if img.width / src["size"][0] < need * 0.9:
        img = _lru(FULL, str(path), lambda: engine.open_photo(path), 2)
    return engine.apply_geo(img, geo, src["size"], target)


def fx_key(fx):
    return (fx["bw"], round(fx["grain"], 2), round(fx["vignette"], 2), fx["preset"],
            round(fx["amount"], 2), json.dumps([fx["adjust"], fx["texture"], fx["frame"], fx["masks"], fx.get("background")], sort_keys=True))


def get_base(path, fx, geo=None, want_w=0):
    """Önizleme zemini. (görsel, tam tuval boyutu, işleme ölçeği f) döndürür.
    want_w: yakınlaştırınca istenen genişlik; gerekirse tam çözünürlüğe kadar çıkılır."""
    if geo is None:
        size, f = (W, H), 1.0
    else:
        size = engine.geo_plan(geo, *get_src(path)["size"])["size"]
        f = min(1.0, math.sqrt(WORK_PIXELS / (size[0] * size[1])))
        if want_w > size[0] * f * 1.05:
            f = min(1.0, want_w / size[0])
    key = (str(path), json.dumps(geo, sort_keys=True), fx_key(fx), round(f, 4))
    if key in BASE:
        BASE[key] = BASE.pop(key)
        return BASE[key], size if geo is None else engine.canvas_plan(geo, size)[0], f
    if geo is None:
        base = engine.grade_base(CFG, get_crop(path), path, fx)
    else:
        target = (max(1, round(size[0] * f)), max(1, round(size[1] * f)))
        img = geo_image(path, geo, target)
        base = engine.extend_canvas(engine.grade_base(CFG, img, path, fx, engine.canvas_scale(*size) * f), geo, f)
    BASE[key] = base
    while len(BASE) > 6:
        BASE.pop(next(iter(BASE)))
    return base, size if geo is None else engine.canvas_plan(geo, size)[0], f


ORIGINAL_FX = {"preset": "b:original", "bw": False, "grain": 0.0, "vignette": 0.0}


def checkerboard(size, cell=None):
    w, h = size
    cell = cell or max(8, min(w, h) // 40)
    yy, xx = np.mgrid[0:h, 0:w]
    on = ((xx // cell + yy // cell) % 2).astype(bool)
    a = np.where(on[..., None], np.array([205, 205, 205, 255], np.uint8), np.array([245, 245, 245, 255], np.uint8))
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def render_preview(d):
    path = photo_path(d["photo"])
    item = clean_item(d)
    want = max(200, min(engine.MAX_SIDE, int(num(d.get("w"), 200, engine.MAX_SIDE, 640))))
    original = bool(d.get("original"))  # önce/sonra: renk, efekt, yazı ve filigran yok
    if original:
        item["fx"] = clean_fx(ORIGINAL_FX)
    attach_matte(item["fx"], path, item["geo"])
    with LOCK:
        base, (cw, ch), f = get_base(path, item["fx"], item["geo"], want)
        k = engine.canvas_scale(cw, ch)
        if original:
            img, layout = base, None
        else:
            img, layout = engine.compose(CFG, base, item["text"], item["tone"], item["accent"],
                                         styles=item["styles"], block=item["block"], offsets=item["offsets"],
                                         k=k * f, wm=clean_wm(d["wm"]) if isinstance(d.get("wm"), dict) else WATERMARK,
                                         font=item["font"], textfx=item["textfx"],
                                         layers=item["layers"], loader=layer_loader())
    out_w = max(200, min(want, max(1600, base.width)))
    out_h = max(1, round(out_w * base.height / base.width))
    if img.mode == "RGBA" and img.getchannel("A").getextrema()[0] < 255:
        img = Image.alpha_composite(checkerboard(img.size), img)  # şeffaf arka plan dama deseninde
    im = img.convert("RGB").resize((out_w, out_h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    # kutular tam tuval pikselinde; k: kaydırma birimi (1080x1350 tuval pikseli) -> piksel
    boxes = [{"idx": b["idx"], "box": [round(v / f, 1) for v in b["box"]]}
             for b in (layout["boxes"] if layout else [])]
    return {"image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
            "boxes": boxes, "size": layout["size"] if layout else 0, "w": cw, "h": ch, "k": k}


def auto_enhance(d):
    """Otomatik iyileştirme: seçili görünümle işlenmiş (ince ayarsız) küçük görselden değerler."""
    path = photo_path(d["photo"])
    geo = clean_geo(d.get("geo"))
    fx = {**clean_fx(d.get("fx") or {}), "grain": 0.0, "vignette": 0.0, "adjust": {}, "texture": {}, "frame": {}, "masks": [], "background": {}}
    with LOCK:
        if geo is None:
            img = get_crop(path).resize((432, 540), Image.BILINEAR)
        else:
            size = engine.geo_plan(geo, *get_src(path)["size"])["size"]
            f = 480 / max(size)
            img = geo_image(path, geo, (max(1, round(size[0] * f)), max(1, round(size[1] * f))))
    graded = engine.grade(img, CFG, 0, fx, engine.canvas_scale(*img.size))
    arr = np.asarray(graded, dtype=np.float32) / 255.0
    return {"adjust": looks.auto_adjust(arr, bw=fx["bw"])}


def geo_source(d):
    """Kırpma aracı için: döndürülmüş/düzeltilmiş ama kırpılmamış görsel ve ölçüleri."""
    path = photo_path(d["photo"])
    geo = clean_geo(d.get("geo")) or {"aspect": "4:5"}
    fx = {**clean_fx(d.get("fx") or {}), "grain": 0.0, "vignette": 0.0, "frame": {}, "masks": [], "background": {}}
    tw = max(200, min(1600, int(d.get("w", 900))))
    with LOCK:
        src = get_src(path)
        plan = engine.geo_plan({**geo, "crop": None, "aspect": "original"}, *src["size"])
        small = src["proxy"]
        f = tw * 1.3 / max(small.size)  # döndürmeden önce ekrana yetecek boyuta küçült (hız)
        if f < 1:
            small = small.resize((max(1, round(small.width * f)), max(1, round(small.height * f))), Image.BILINEAR)
        img, box = engine.orient(small, plan)
    iw, ih = plan["inner"]
    img = img.resize((tw, max(1, round(tw * ih / iw))), Image.LANCZOS, box=box, reducing_gap=3.0)
    img = engine.grade(img, CFG, 0, fx, engine.canvas_scale(*img.size))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return {"image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
            "inner": [round(iw, 2), round(ih, 2)], "source": list(src["size"])}


def preset_list():
    return {"presets": [looks.meta(p) for p in PRESETS.values()], "groups": looks.GROUPS}


SAMPLE = WEB / "preview.png"  # önizleme kutucuklarının sade, net örnek görseli
SAMPLE_THUMBS = {}
THUMB_W = 240  # kutucuk ~100 px; yüksek DPI ekranda da keskin


def sample_image():
    try:
        return Image.open(SAMPLE).convert("RGB").resize((THUMB_W, THUMB_W), Image.LANCZOS)
    except Exception:  # görsel yoksa yumuşak bir gökyüzü/zemin geçişi
        y = np.linspace(0, 1, THUMB_W, dtype=np.float32)[:, None, None]
        sky = np.array([0.45, 0.62, 0.85], np.float32) * (1 - y) + np.array([0.9, 0.7, 0.5], np.float32) * y
        a = np.where(y > 0.62, np.array([0.3, 0.42, 0.22], np.float32), sky) * np.ones((1, THUMB_W, 1), np.float32)
        return Image.fromarray((a * 255).astype(np.uint8), "RGB")


def _data_url(img):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=92, subsampling=0)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def preset_thumbs():
    """Her hazır ayarın aynı örnek görsel üzerindeki kare önizlemesi; bir kez hesaplanıp saklanır.
    Vinyet ve parazit kullanıcıya ait olduğundan önizlemelerde yok."""
    todo = [p for p in list(PRESETS.values()) if p["id"] not in SAMPLE_THUMBS]
    if todo:
        img = sample_image()
        for p in todo:
            fx = {"bw": p["bw"], "grain": 0.0, "vignette": 0.0, "look": p["look"], "amount": 1.0}
            if p.get("recipe"):
                r = clean_fx({**p["recipe"], "preset": p["recipe"].get("base"), "grain": 0, "vignette": 0})
                fx = {**r, "grain": 0.0, "vignette": 0.0}
            SAMPLE_THUMBS[p["id"]] = _data_url(engine.grade(img, CFG, 0, fx, engine.canvas_scale(*img.size)))
    return {"thumbs": {k: SAMPLE_THUMBS[k] for k in PRESETS if k in SAMPLE_THUMBS}}


FX_SAMPLES = {
    "orig": {}, "bw": {"bw": True}, "grain": {"grain": 1.0}, "vignette": {"vignette": 1.0},
    "leak": {"texture": {"leak": 0.8, "variant": 0}}, "bloom": {"texture": {"bloom": 0.8}}, "dust": {"texture": {"dust": 0.9}},
    **{f"frame:{s}": {"frame": {"style": s, "size": 0.45}} for s in engine.FRAME_STYLES},
}
FX_THUMBS = {}


def fx_thumbs():
    """Efekt ve çerçeve kutucukları: her biri aynı örnek görselde."""
    if not FX_THUMBS:
        img = sample_image()
        for k, extra in FX_SAMPLES.items():
            fx = clean_fx({"preset": "b:original", "bw": False, "grain": 0, "vignette": 0, **extra})
            FX_THUMBS[k] = _data_url(engine.grade(img, CFG, 7, fx, engine.canvas_scale(*img.size) * 2.5))
    return {"thumbs": FX_THUMBS}


def import_presets(name, data):
    global PRESETS
    if Path(name).suffix.lower() not in looks.IMPORT_EXT:
        raise ValueError("Desteklenen dosyalar: .xmp, .lrtemplate, .dng (Lightroom), .cube (LUT), .zip")
    saved, warns = looks.import_file(USER_PRESETS, name, data)
    PRESETS = looks.load_all(USER_PRESETS)
    return {"imported": [looks.meta(PRESETS[p["id"]]) for p in saved if p["id"] in PRESETS],
            "warnings": warns}


def save_preset(d):
    """Seçili fotoğrafın renk ayarlarını kendi hazır ayarı olarak kaydeder."""
    global PRESETS
    name = str(d.get("name") or "").strip()[:60]
    if not name:
        raise ValueError("Hazır ayara bir ad ver")
    fx = clean_fx(d.get("fx") or {})
    recipe = {"base": fx["preset"], "amount": fx["amount"], "adjust": fx["adjust"], "bw": fx["bw"]}
    saved = looks.save_recipe(USER_PRESETS, name, recipe)
    PRESETS = looks.load_all(USER_PRESETS)
    return looks.meta(PRESETS[saved["id"]])


def delete_preset(pid):
    global PRESETS
    looks.delete_user(USER_PRESETS, pid)
    PRESETS = looks.load_all(USER_PRESETS)
    with LOCK:
        for k in [k for k in BASE if k[2][3] == pid]:
            BASE.pop(k, None)


def save_photo(name, data):
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise ValueError(f"Desteklenmeyen dosya türü: {ext or name} (jpg, png, webp)")
    UPLOADS.mkdir(exist_ok=True)
    THUMBS.mkdir(parents=True, exist_ok=True)
    pid = f"{uuid.uuid4().hex[:8]}_{safe_name(name)}"
    path = UPLOADS / pid
    path.write_bytes(data)
    try:
        with Image.open(path) as src:
            im = ImageOps.exif_transpose(src).convert("RGB")
        width, height = im.size
        im.thumbnail((360, 450))
        im.save(THUMBS / (pid + ".jpg"), "JPEG", quality=82)
    except Exception as e:
        path.unlink(missing_ok=True)
        raise ValueError(f"Görsel okunamadı: {e}")
    return {"id": pid, "name": name, "width": width, "height": height}


def duplicate_photo(pid):
    """Fotoğrafın kopyası (ayrı düzenlenebilsin diye ayrı dosya); küçük resim ve konu maskesi de kopyalanır."""
    src = photo_path(pid)
    new = f"{uuid.uuid4().hex[:8]}_{src.name.split('_', 1)[-1]}"
    shutil.copyfile(src, UPLOADS / new)
    for d, ext in ((THUMBS, ".jpg"), (MATTES, ".png")):
        if (d / (src.name + ext)).is_file():
            shutil.copyfile(d / (src.name + ext), d / (new + ext))
    return {"id": new}


def delete_photo(pid):
    p = UPLOADS / Path(pid).name
    (THUMBS / (p.name + ".jpg")).unlink(missing_ok=True)
    (MATTES / (p.name + ".png")).unlink(missing_ok=True)
    p.unlink(missing_ok=True)
    with LOCK:  # önizleme iş parçacığı aynı anda önbelleği değiştirebilir
        for k in [k for k in BASE if k[0] == str(p)]:
            BASE.pop(k, None)
        CROP.pop(str(p), None)
        SRC.pop(str(p), None)
        FULL.pop(str(p), None)


def load_session():
    try:
        data = json.loads(SESSION.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    items = data.get("items") if isinstance(data.get("items"), list) else []
    data["items"] = [it for it in items
                     if isinstance(it, dict) and (UPLOADS / Path(str(it.get("id", ""))).name).is_file()]
    return data


def save_session(body):
    data = json.loads(body)  # bozuk veri kaydedilip oturum kaybolmasın
    if not isinstance(data, dict) or not isinstance(data.get("items", []), list):
        raise ValueError("Geçersiz oturum verisi")
    tmp = SESSION.with_suffix(".tmp")
    tmp.write_bytes(body)
    tmp.replace(SESSION)


# ------------------------------------------------------------------ projeler
# projects/<id>.json: {"meta": {"name", "created", "updated", "size": [w, h] | None, "preset"}, "items", "currentId", "settings"}
PID_RE = re.compile(r"[0-9a-f]{8}")


def project_file(pid):
    if not PID_RE.fullmatch(str(pid)):
        raise FileNotFoundError("Proje bulunamadı")
    return PROJECTS / f"{pid}.json"


def read_project(pid):
    data = json.loads(project_file(pid).read_text(encoding="utf-8"))
    items = data.get("items") if isinstance(data.get("items"), list) else []
    data["items"] = [it for it in items if isinstance(it, dict) and (UPLOADS / Path(str(it.get("id", ""))).name).is_file()]
    data.setdefault("meta", {})
    return data


def write_project(pid, data):
    PROJECTS.mkdir(exist_ok=True)
    f = project_file(pid)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(f)


def migrate_session():
    """Eski sürümlerin tek oturumunu ilk açılışta bir projeye çevirir (fotoğraflar ve ayarlar korunur)."""
    if PROJECTS.is_dir() or not SESSION.is_file():
        return
    data = load_session()
    PROJECTS.mkdir(exist_ok=True)
    if not data.get("items"):
        return
    now = time.time()
    data["meta"] = {"name": "Önceki çalışmam", "created": now, "updated": now, "size": None, "preset": "original"}
    write_project(uuid.uuid4().hex[:8], data)


def list_projects():
    out = []
    for f in PROJECTS.glob("*.json") if PROJECTS.is_dir() else []:
        try:
            d = read_project(f.stem)
        except Exception:
            continue
        m = d["meta"]
        out.append({"id": f.stem, "name": m.get("name") or "Adsız proje", "updated": m.get("updated") or f.stat().st_mtime,
                    "count": len(d["items"]), "size": m.get("size"), "preset": m.get("preset")})
    return sorted(out, key=lambda p: -p["updated"])


def blank_canvas(w, h, color):
    """Boş tuval: düz renkli bir PNG; proje bu "fotoğrafla" başlar, üstüne görsel ve yazı eklenir."""
    try:
        rgb = engine.hex_to_rgb(color)
    except (ValueError, TypeError):
        rgb = (255, 255, 255)
    buf = io.BytesIO()
    Image.new("RGB", (w, h), rgb).save(buf, "PNG")
    return save_photo("Tuval.png", buf.getvalue())


def blank_item(info, size):
    geo = {"aspect": "original", "crop": None, "rotate": 0, "flipH": False, "flipV": False, "straighten": 0, "outW": None, "outH": None}
    return {"id": info["id"], "name": "Tuval", "src": size, "geo": geo, "text": "", "tone": TONES[0], "accent": "",
            "styles": [], "block": [0, 0], "offsets": {}, "fx": {"preset": "b:original", "bw": False, "grain": 0, "vignette": 0}}


def create_project(d):
    name = " ".join(str(d.get("name") or "").split())[:60] or "Yeni proje"
    size = d.get("size")
    size = [int(num(size[0], 16, engine.MAX_SIDE)), int(num(size[1], 16, engine.MAX_SIDE))] if isinstance(size, list) and len(size) == 2 else None
    # ayarlar (tema, dışa aktarma tercihleri) son projeden devralınır
    prev = list_projects()
    settings = {}
    if prev:
        try:
            settings = read_project(prev[0]["id"]).get("settings") or {}
        except Exception:
            settings = {}
    preset = str(d.get("preset") or "original")[:40]
    settings = {**settings, "aspect": preset}
    if d.get("dpi"):  # inçle oluşturulan proje: dışa aktarma o DPI'yi dosyaya yazar
        settings["export"] = {**(settings.get("export") or {}), "dpi": int(num(d["dpi"], 1, 2400, 300))}
    items, cur = [], None
    if size and d.get("blank", True):
        info = blank_canvas(*size, d.get("color") or "#FFFFFF")
        items, cur = [blank_item(info, size)], info["id"]
    now = time.time()
    pid = uuid.uuid4().hex[:8]
    write_project(pid, {"meta": {"name": name, "created": now, "updated": now, "size": size, "preset": preset},
                        "items": items, "currentId": cur, "settings": settings})
    return {"id": pid}


def save_project(pid, body):
    data = json.loads(body)  # bozuk veri kaydedilip proje kaybolmasın
    if not isinstance(data, dict) or not isinstance(data.get("items", []), list):
        raise ValueError("Geçersiz proje verisi")
    old = read_project(pid)
    data["meta"] = {**old["meta"], "updated": time.time()}
    write_project(pid, data)


def rename_project(pid, name):
    data = read_project(pid)
    data["meta"]["name"] = " ".join(str(name or "").split())[:60] or "Adsız proje"
    write_project(pid, data)


def delete_project(pid):
    project_file(pid).unlink(missing_ok=True)
    (PROJECTS / f"{pid}.jpg").unlink(missing_ok=True)


def project_thumb(pid):
    """Başlangıç sayfası için küçük görsel: güncel değilse projenin seçili sayfasından çizilir."""
    f, t = project_file(pid), PROJECTS / f"{pid}.jpg"
    if t.is_file() and t.stat().st_mtime >= f.stat().st_mtime:
        return t
    d = read_project(pid)
    it = next((i for i in d["items"] if i.get("id") == d.get("currentId")), d["items"][0] if d["items"] else None)
    if not it:
        return None
    r = render_preview({**it, "photo": it["id"], "w": 480, "textfx": it.get("textFx")})
    t.write_bytes(base64.b64decode(r["image"].split(",", 1)[1]))
    return t


def prune_uploads():
    """Hiçbir projede kullanılmayan yüklemeleri siler (fotoğraflar ve görsel katmanları).
    Arayüz silinen fotoğrafı geri alınabilsin diye hemen silmez; temizlik açılışta yapılır."""
    keep = set()
    try:
        for f in PROJECTS.glob("*.json"):
            data = json.loads(f.read_text(encoding="utf-8"))
            for it in data["items"]:
                keep.add(Path(str(it.get("id", ""))).name)
                keep.update(Path(str(ly.get("photo", ""))).name for ly in it.get("layers") or [] if isinstance(ly, dict))
    except Exception:
        return  # bir proje okunamıyorsa hiçbir şeye dokunma
    if not UPLOADS.is_dir():
        return
    for p in UPLOADS.iterdir():
        if p.is_file() and p.name not in keep:
            try:
                delete_photo(p.name)
            except OSError:
                pass


# ------------------------------------------------------------------ guncelleme
REPO = "emirhnkocakk/Tonefect"
OWNER = REPO.split("/")[0]
# Depo adı birkaç kez değişti (basic-photo-editor -> grainline-photo-editor -> Tonefect); GitHub eski adları
# yönlendirir. Bu yüzden ada değil hesaba güvenilir: yalnızca bu hesabın sürüm indirmeleri kurulur.
ASSET_URL = re.compile(rf"https://github\.com/{OWNER}/[\w.-]+/releases/download/[^/\s]+/[^/\s]+$")


def trusted_asset(url):
    return bool(ASSET_URL.match(str(url or "")))
UPDATE = {"checked": 0.0, "info": None, "state": "idle", "done": 0, "total": 0, "error": ""}


def read_version():
    try:
        return (HERE / "VERSION").read_text(encoding="utf-8").strip() or "dev"
    except Exception:
        return "dev"


VERSION = read_version()


def update_failure():
    """Önceki güncelleme denemesi sürümü yükseltmediyse bir kez bildirir."""
    try:
        p = json.loads(PENDING.read_text(encoding="utf-8"))
        PENDING.unlink()
    except Exception:
        return None
    if vtuple(VERSION) >= vtuple(p.get("target", "0")):
        return None
    return p


def vtuple(v):
    nums = re.findall(r"\d+", str(v))
    return tuple(int(n) for n in nums[:3]) if nums else (0,)


def check_update(force=False):
    if not force and UPDATE["info"] and time.time() - UPDATE["checked"] < 600:
        return UPDATE["info"]
    info = {"current": VERSION, "latest": VERSION, "newer": False, "notes": "", "page": "",
            "canInstall": False, "size": 0, "error": ""}
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO}/releases/latest",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "Tonefect"})
        with urllib.request.urlopen(req, timeout=6) as r:
            rel = json.loads(r.read().decode("utf-8"))
        latest = str(rel.get("tag_name", "")).lstrip("v")
        info.update(latest=latest, notes=rel.get("body") or "", page=rel.get("html_url") or "")
        asset = next((a for a in rel.get("assets", []) if a.get("name", "").lower().endswith("-setup.exe")), None)
        if asset and trusted_asset(asset.get("browser_download_url")):
            info["_asset"] = asset["browser_download_url"]
            info["size"] = asset.get("size", 0)
        info["newer"] = VERSION != "dev" and vtuple(latest) > vtuple(VERSION)
        info["canInstall"] = bool(info["newer"] and info.get("_asset") and sys.platform == "win32"
                                  and getattr(sys, "frozen", False))
    except Exception as e:
        info["error"] = str(e)
    UPDATE.update(checked=time.time(), info=info)
    return info


def public_info(info):
    return {k: v for k, v in info.items() if not k.startswith("_")}


def open_download():
    """Otomatik kurulum yapılamıyorsa kurulum dosyasını (yoksa sürüm sayfasını) tarayıcıda açar."""
    info = check_update()
    url = info.get("_asset") or info.get("page") or ""
    if not (trusted_asset(url) or re.match(rf"https://github\.com/{OWNER}/[\w.-]+/releases/", url)):
        url = f"https://github.com/{REPO}/releases/latest"
    webbrowser.open(url)


def launch_installer(exe, args):
    """Kurulumu, bu süreç tamamen kapandıktan SONRA başlatır. Penceresi olmayan uygulamayı Windows'un
    Restart Manager'ı kapatamıyor; kurulum bizi açık bulursa "uygulama kapatılamadı" diye takılıyordu.
    Bağımsız bir PowerShell bekler, sonra kurulumu açar (bizim işlem ağacımızın dışında)."""
    q = lambda s: str(s).replace("'", "''")
    ps = (f"Wait-Process -Id {os.getpid()} -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600; "
          f"Start-Process -FilePath '{q(exe)}' -ArgumentList '{q(args)}'")
    # NO_WINDOW | NEW_PROCESS_GROUP. DETACHED_PROCESS kullanma: konsolsuz PowerShell'de Start-Process
    # hatasız çıkıp hiçbir şey başlatmıyor (denendi).
    flags = 0x08000000 | 0x00000200
    cmd = ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
           "-WindowStyle", "Hidden", "-Command", ps]
    for extra in (0x01000000, 0):  # önce iş nesnesinden ayrılmayı dene (CREATE_BREAKAWAY_FROM_JOB)
        try:
            subprocess.Popen(cmd, creationflags=flags | extra, close_fds=True,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except OSError:
            continue
    os.startfile(str(exe), "open", args)  # PowerShell yoksa eski yol (kurulum betiği bizi yine kapatır)


def run_update():
    try:
        info = check_update(force=True)
        url = info.get("_asset")
        if not (info.get("canInstall") and url):
            raise RuntimeError("Otomatik güncelleme yalnızca kurulu sürümde çalışır.")
        dest = Path(tempfile.mkdtemp(prefix="grainline_")) / "Tonefect-Setup.exe"
        UPDATE.update(state="downloading", done=0, total=info.get("size", 0), error="")
        req = urllib.request.Request(url, headers={"User-Agent": "Tonefect"})
        with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
            UPDATE["total"] = int(r.headers.get("Content-Length") or UPDATE["total"] or 0)
            while True:
                chunk = r.read(256 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                UPDATE["done"] += len(chunk)
        if UPDATE["total"] and dest.stat().st_size != UPDATE["total"]:
            raise RuntimeError("İndirme eksik kaldı, tekrar dene.")
        UPDATE["state"] = "installing"
        log = Path(tempfile.gettempdir()) / "grainline_update.log"
        PENDING.write_text(json.dumps({"target": info["latest"], "log": str(log)}), encoding="utf-8")
        launch_installer(dest, f'/SILENT /NORESTART /CLOSEAPPLICATIONS /LOG="{log}"')
        time.sleep(0.5)  # durum yanıtı arayüze ulaşsın
        os._exit(0)
    except Exception as e:
        UPDATE.update(state="error", error=str(e))


# ------------------------------------------------------------------ uretim isi
def resolve_out(path):
    """Göreli çıktı klasörünü uygulama klasörüne göre çözer (çalışma dizinine göre değil)."""
    p = Path(str(path or "").strip() or DEFAULT_OUT).expanduser()
    return p if p.is_absolute() else HERE / p


def clean_export(e):
    e = e if isinstance(e, dict) else {}
    color = e.get("color") if e.get("color") in engine.COLOR_MODES else "rgb"
    fmt = e.get("format") if e.get("format") in engine.EXPORT_FORMATS else "jpg"
    if fmt not in engine.COLOR_MODES[color]:  # örn. Lab yalnızca TIFF
        fmt = engine.COLOR_MODES[color][0]
    return {"format": fmt, "quality": int(num(e.get("quality"), 50, 100, 95)),
            "naming": "original" if e.get("naming") == "original" else "number",
            "exif": bool(e.get("exif")), "color": color, "dpi": int(num(e.get("dpi"), 0, 2400, 0)) or None}


MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "tiff": "image/tiff"}


def render_file(d):
    """Farklı kaydet / kopya kaydet: tek fotoğrafı dosya baytları olarak döndürür (tarayıcı kaydeder)."""
    raw = d.get("item") or {}
    ex = clean_export(d.get("export"))
    item = clean_item(raw)
    path = photo_path(raw["id"])
    attach_matte(item["fx"], path, item["geo"])
    tmp = UPLOADS / f".save_{uuid.uuid4().hex[:8]}.{ex['format']}"
    try:
        engine.render_one(CFG, path, item["text"], item["tone"], item["accent"], tmp,
                          styles=item["styles"], fx=item["fx"], block=item["block"],
                          offsets=item["offsets"], geo=item["geo"], wm=WATERMARK,
                          font=item["font"], textfx=item["textfx"],
                          fmt=ex["format"], quality=ex["quality"], keep_exif=ex["exif"],
                          color=ex["color"], dpi=ex["dpi"], layers=item["layers"], loader=layer_loader(True))
        return tmp.read_bytes(), ex["format"]
    finally:
        tmp.unlink(missing_ok=True)


def run_job(jid, d):
    job = JOBS[jid]
    try:
        out_dir = resolve_out(d.get("outDir"))
        out_dir.mkdir(parents=True, exist_ok=True)
        job["outDir"] = str(out_dir)
        ex = clean_export(d.get("export"))
        single = bool(d.get("single"))  # tek fotoğraf: toplu manifest.json'a dokunma
        manifest, used = [], set()
        for i, raw in enumerate(d["items"], start=1):
            try:
                item = clean_item(raw)
                path = photo_path(raw["id"])
                attach_matte(item["fx"], path, item["geo"])
                stem = Path(safe_name(str(raw.get("name") or path.name))).stem[:40]
                if ex["naming"] == "number":
                    stem = f"{i:03d}_{stem}"
                name, n = stem, 2
                while name.lower() in used:  # aynı adlı iki fotoğraf birbirini ezmesin
                    name, n = f"{stem}_{n}", n + 1
                used.add(name.lower())
                out = out_dir / f"{name}.{ex['format']}"
                engine.render_one(CFG, path, item["text"], item["tone"], item["accent"], out,
                                  styles=item["styles"], fx=item["fx"], block=item["block"],
                                  offsets=item["offsets"], geo=item["geo"], wm=WATERMARK,
                                  font=item["font"], textfx=item["textfx"],
                                  fmt=ex["format"], quality=ex["quality"], keep_exif=ex["exif"],
                                  color=ex["color"], dpi=ex["dpi"], layers=item["layers"], loader=layer_loader(True))
                with Image.open(out) as done:
                    out_size = list(done.size)
                manifest.append({
                    "image": raw.get("name", path.name), "text": item["text"], "tone": item["tone"],
                    "accent_word": item["accent"],
                    "preset": PRESETS.get(item["fx"]["preset"], looks.CLASSIC)["name"],
                    "size": out_size, "caption": "", "output": str(out)})
                job["files"].append({"name": out.name, "text": item["text"]})
            except Exception as e:
                job["errors"].append(f"{raw.get('name', '?')}: {e}")
            job["done"] = i
        if not single:
            (out_dir / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        job["errors"].append(f"{e}")
        traceback.print_exc()
    job["finished"] = True


def open_folder(path):
    p = resolve_out(path)
    if not p.exists():
        p.mkdir(parents=True, exist_ok=True)  # henüz üretim yapılmadıysa klasör boş olarak açılsın
    if not p.is_dir():
        raise FileNotFoundError(str(p))
    if hasattr(os, "startfile"):
        os.startfile(str(p))
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p)])


# ----------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Tonefect"

    def log_message(self, *a):
        pass

    # --- guvenlik: sadece yerel host ve (degistiren isteklerde) ozel baslik
    def _allowed(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            return False
        if self.command in ("POST", "PUT", "DELETE") and self.headers.get("X-NV") != "1":
            return False
        return True

    def _send(self, status, body, ctype="application/json", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, status=200):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _err(self, status, msg):
        self._json({"error": msg}, status)

    def _body(self):
        # Gövde her zaman tam okunur (keep-alive bağlantıda artık bayt kalırsa sonraki istek bozulur)
        if not hasattr(self, "_cached_body"):
            n = int(self.headers.get("Content-Length") or 0)
            self._cached_body = self.rfile.read(n) if n else b""
        return self._cached_body

    def _file(self, path, cache=False):
        data = Path(path).read_bytes()
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        extra = {"Cache-Control": "public, max-age=31536000, immutable"} if cache else None
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {"Cache-Control": "no-store"}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.route()

    do_HEAD = do_GET

    def do_POST(self):
        self.route()

    do_PUT = do_POST
    do_DELETE = do_POST

    def route(self):
        self.__dict__.pop("_cached_body", None)
        if self.command not in ("GET", "HEAD"):
            self._body()
        if not self._allowed():
            return self._err(403, "izin yok")
        url = urlparse(self.path)
        path, q = unquote(url.path), parse_qs(url.query)
        try:
            m, c = self.command, path
            if m in ("GET", "HEAD") and not c.startswith("/api/"):
                return self.static(c)
            if c == "/api/config" and m == "GET":
                missing = [r for r in ("quiet", "hard", "signature") if engine.font_was_fallback(CFG, r)]
                return self._json({
                    "canvas": {"w": W, "h": H}, "tones": TONES, "brand": CFG["brand"],
                    "limits": CFG.get("limits", {}), "version": VERSION, "quitOnClose": STATE["quit_on_close"], "updateFailed": update_failure(),
                    "fontWarn": missing, "outDir": str(DEFAULT_OUT),
                    "watermark": WATERMARK})
            if c == "/api/ping" and m == "GET":
                return self._json({"app": "grainline", "version": VERSION})
            if c == "/api/heartbeat" and m == "POST":
                STATE.update(last_beat=time.time(), closing_at=0.0, seen=True)
                return self._json({"ok": True})
            if c == "/api/closing" and m == "POST":
                STATE["closing_at"] = time.time()
                return self._json({"ok": True})
            if c == "/api/prefs" and m == "PUT":
                STATE["quit_on_close"] = bool(json.loads(self._body()).get("quitOnClose", True))
                write_prefs(quitOnClose=STATE["quit_on_close"])
                return self._json({"ok": True})
            if c == "/api/watermark" and m == "PUT":
                return self._json(save_watermark(json.loads(self._body())))
            if c == "/api/ai/status" and m == "GET":
                return self._json(ai.status(HERE))
            if c == "/api/ai/install" and m == "POST":
                if ai.STATE["state"] != "downloading" and not ai.installed(HERE):
                    ai.STATE.update(state="downloading", done=0, error="")
                    threading.Thread(target=ai.download, args=(HERE,), daemon=True).start()
                return self._json(ai.status(HERE))
            if c == "/api/mask/view" and m == "POST":
                return self._json(mask_view(json.loads(self._body())))
            if c == "/api/fonts" and m == "GET":
                return self._json(font_list())
            if c == "/api/auto" and m == "POST":
                return self._json(auto_enhance(json.loads(self._body())))
            if c == "/api/geo/source" and m == "POST":
                return self._json(geo_source(json.loads(self._body())))
            if c == "/api/signature" and m == "PUT":
                return self._json({"signature": save_signature(json.loads(self._body()).get("text"))})
            if c == "/api/projects" and m == "GET":
                return self._json({"projects": list_projects()})
            if c == "/api/projects" and m == "POST":
                return self._json(create_project(json.loads(self._body())))
            if c.startswith("/api/projects/"):
                parts = c.split("/")
                pid, part = parts[3], (parts[4] if len(parts) > 4 else "")
                if part == "thumb" and m in ("GET", "HEAD"):
                    with PROJECT_LOCK:
                        t = project_thumb(pid)
                    return self._file(t) if t else self._err(404, "Önizleme yok")
                if part == "rename" and m == "POST":
                    rename_project(pid, json.loads(self._body()).get("name"))
                    return self._json({"ok": True})
                if not part and m == "GET":
                    return self._json(read_project(pid))
                if not part and m == "PUT":
                    with PROJECT_LOCK:
                        save_project(pid, self._body())
                    return self._json({"ok": True})
                if not part and m == "DELETE":
                    delete_project(pid)
                    return self._json({"ok": True})
            if c == "/api/session" and m == "GET":
                return self._json(load_session())
            if c == "/api/session" and m == "PUT":
                save_session(self._body())
                return self._json({"ok": True})
            if c == "/api/photos" and m == "POST":
                return self._json(save_photo(q.get("name", ["foto.jpg"])[0], self._body()))
            if c.startswith("/api/photos/") and c.endswith("/duplicate") and m == "POST":
                return self._json(duplicate_photo(c.split("/")[3]))
            if c.startswith("/api/photos/") and m == "DELETE":
                delete_photo(c.rsplit("/", 1)[1])
                return self._json({"ok": True})
            if c.startswith("/api/thumb/") and m in ("GET", "HEAD"):
                t = THUMBS / (Path(c.rsplit("/", 1)[1]).name + ".jpg")
                return self._file(t, cache=True) if t.is_file() else self._err(404, "yok")
            if c == "/api/presets" and m == "GET":
                return self._json(preset_list())
            if c == "/api/presets/thumbs" and m == "GET":
                return self._json(preset_thumbs())
            if c == "/api/fx/thumbs" and m == "GET":
                return self._json(fx_thumbs())
            if c == "/api/presets/save" and m == "POST":
                return self._json(save_preset(json.loads(self._body())))
            if c == "/api/presets/import" and m == "POST":
                return self._json(import_presets(q.get("name", [""])[0], self._body()))
            if c.startswith("/api/presets/") and m == "DELETE":
                delete_preset(c.split("/", 3)[3])
                return self._json(preset_list())
            if c == "/api/preview" and m == "POST":
                return self._json(render_preview(json.loads(self._body())))
            if c == "/api/selection/extract" and m == "POST":
                return self._json(extract_selection(json.loads(self._body())))
            if c == "/api/render-file" and m == "POST":
                body, fmt = render_file(json.loads(self._body()))
                return self._send(200, body, MIME[fmt], {"X-Format": fmt})
            if c == "/api/generate" and m == "POST":
                d = json.loads(self._body())
                if not isinstance(d.get("items"), list) or not d["items"]:
                    raise ValueError("Üretilecek fotoğraf yok")
                for old in [k for k, j in JOBS.items() if j["finished"]][:-10]:
                    JOBS.pop(old, None)  # bitmiş işleri sınırsız biriktirme
                jid = uuid.uuid4().hex[:8]
                JOBS[jid] = {"total": len(d["items"]), "done": 0, "files": [], "errors": [],
                             "finished": False, "outDir": ""}
                threading.Thread(target=run_job, args=(jid, d), daemon=True).start()
                return self._json({"job": jid})
            if c.startswith("/api/job/") and m == "GET":
                j = JOBS.get(c.rsplit("/", 1)[1])
                return self._json(j) if j else self._err(404, "iş yok")
            if c.startswith("/api/output/") and m in ("GET", "HEAD"):
                _, _, _, jid, name = c.split("/", 4)
                j = JOBS.get(jid)
                f = Path(j["outDir"]) / Path(name).name if j else None
                return self._file(f) if f and f.is_file() else self._err(404, "yok")
            if c == "/api/open-folder" and m == "POST":
                open_folder(json.loads(self._body()).get("path") or DEFAULT_OUT)
                return self._json({"ok": True})
            if c == "/api/update/check" and m == "GET":
                return self._json(public_info(check_update(force="force" in q)))
            if c == "/api/update/install" and m == "POST":
                if UPDATE["state"] not in ("downloading", "installing"):
                    UPDATE.update(state="downloading", done=0, error="")
                    threading.Thread(target=run_update, daemon=True).start()
                return self._json({"ok": True})
            if c == "/api/update/open" and m == "POST":
                open_download()
                return self._json({"ok": True})
            if c == "/api/update/status" and m == "GET":
                return self._json({k: UPDATE[k] for k in ("state", "done", "total", "error")})
            if c == "/api/quit" and m == "POST":
                self._json({"ok": True})
                threading.Timer(0.4, lambda: os._exit(0)).start()
                return
            return self._err(404, "bulunamadı")
        except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
            pass
        except FileNotFoundError as e:
            self._err(404, str(e))
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as e:
            self._err(400, str(e))
        except Exception as e:
            traceback.print_exc()
            self._err(500, str(e))

    def static(self, c):
        rel = "index.html" if c in ("", "/") else c.lstrip("/")
        f = (WEB / rel).resolve()
        if WEB.resolve() not in f.parents and f != WEB.resolve() / "index.html":
            return self._err(403, "izin yok")
        if not f.is_file():
            f = WEB / "index.html"
        if not f.is_file():
            return self._send(500, "web/ klasörü bulunamadı. Arayüz dosyaları eksik.".encode("utf-8"),
                              "text/plain; charset=utf-8")
        return self._file(f, cache="/assets/" in c)


# ------------------------------------------------------------------ baslatma
def free_port(start):
    for p in range(start, start + 30):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise RuntimeError("Boş port bulunamadı")


def open_window(url):
    env = os.environ.get
    cands = [
        Path(env("ProgramFiles(x86)", "")) / "Microsoft/Edge/Application/msedge.exe",
        Path(env("ProgramFiles", "")) / "Microsoft/Edge/Application/msedge.exe",
        Path(env("ProgramFiles", "")) / "Google/Chrome/Application/chrome.exe",
        Path(env("ProgramFiles(x86)", "")) / "Google/Chrome/Application/chrome.exe",
        Path(env("LocalAppData", "")) / "Google/Chrome/Application/chrome.exe",
    ]
    for exe in cands:
        if exe.is_file():
            try:
                # Ayrı profil (--user-data-dir) KULLANMA: yeni profil, Edge'in "Daha sonra / Özelleştir"
                # karşılama ekranını tetikler ve Özelleştir edge ayarlarını açar.
                subprocess.Popen([str(exe), f"--app={url}", "--window-size=1380,900",
                                  "--no-default-browser-check", "--disable-session-crashed-bubble",
                                  "--disable-background-mode"])
                return
            except OSError:
                continue
    webbrowser.open(url)


def busy():
    return UPDATE["state"] in ("downloading", "installing") or ai.STATE["state"] == "downloading" or any(not j.get("finished") for j in JOBS.values())


def watchdog():
    """Pencere kapanınca (ve ayar açıksa) uygulamayı tamamen kapatır."""
    while True:
        time.sleep(1)
        if not (STATE["quit_on_close"] and STATE["seen"]) or busy():
            continue
        now = time.time()
        gone = (STATE["closing_at"] and now - STATE["closing_at"] > 5) or now - STATE["last_beat"] > 120
        if gone:
            os._exit(0)


INSTANCE = Path(tempfile.gettempdir()) / "tonefect_instance.json"  # çalışan kopyanın portu


def running_instance():
    """Zaten çalışan bir Tonefect varsa adresini döndürür.
    Portlar tek tek yoklanmaz (Windows'ta kapalı her port ~0.4 sn bekletir, açılışı 12 sn uzatıyordu);
    çalışan kopya portunu bir dosyaya yazar, yalnızca o denenir."""
    try:
        p = int(json.loads(INSTANCE.read_text(encoding="utf-8"))["port"])
    except Exception:
        return None
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{p}/api/ping", timeout=0.5) as r:
            if json.loads(r.read().decode("utf-8")).get("app") == "grainline":
                return f"http://127.0.0.1:{p}/"
    except Exception:
        pass
    return None


def mark_instance(port):
    try:
        INSTANCE.write_text(json.dumps({"port": port, "pid": os.getpid()}), encoding="utf-8")
    except OSError:
        pass


def clear_instance():
    try:
        if json.loads(INSTANCE.read_text(encoding="utf-8")).get("pid") == os.getpid():
            INSTANCE.unlink()
    except Exception:
        pass


def main():
    global PORT
    if "--no-window" not in sys.argv and "NV_PORT" not in os.environ:
        url = running_instance()
        if url:  # ikinci kopya açma, mevcut olana pencere aç
            open_window(url)
            return
    # eski sürümlerden kalan ayrı tarayıcı profili artık kullanılmıyor; temizlik pencereyi bekletmesin
    threading.Thread(target=shutil.rmtree, args=(HERE / ".webprofile",), kwargs={"ignore_errors": True}, daemon=True).start()
    migrate_session()
    prune_uploads()
    threading.Thread(target=engine.font_registry, daemon=True).start()  # yazı tipi taraması önceden
    PORT = free_port(int(os.environ.get("NV_PORT", 8765)))
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    url = f"http://127.0.0.1:{PORT}/"
    print(f"Tonefect çalışıyor: {url}")
    print("Kapatmak için uygulamadaki güç düğmesine bas ya da bu pencereyi kapat.")
    if "--no-window" not in sys.argv:
        mark_instance(PORT)
        atexit.register(clear_instance)
        threading.Thread(target=open_window, args=(url,), daemon=True).start()  # sunucu zaten dinliyor
    threading.Thread(target=watchdog, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

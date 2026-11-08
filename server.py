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
import adjustments
import filters
import psdfile
import layerfx
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
ACTIONS = HERE / "eylemler.json"
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


RETOUCH_NUMS = ("smooth", "tone", "blemish", "fsLow", "fsHigh", "scratch", "denoise", "fade", "cast", "sharp")


def clean_retouch(r, masks=None):
    """Otomatik rötuş; hepsi sıfırsa yok sayılır (eski projeler bire bir aynı kalır)."""
    if not isinstance(r, dict):
        return {}
    out = {k: round(num(r.get(k), 0.0, 1.0), 3) for k in RETOUCH_NUMS if num(r.get(k), 0.0, 1.0)}
    area = next((m for m in masks if isinstance(m, dict) and m.get("id") == r.get("area")), None) if r.get("area") and isinstance(masks, list) else None
    if not out:
        return {}
    out["texture"] = round(num(r.get("texture", 0.6), 0.0, 1.0, 0.6), 3)
    out["fsRadius"] = round(num(r.get("fsRadius", 0.3), 0.0, 1.0, 0.3), 3)
    if r.get("fsSkin"):
        out["fsSkin"] = True
    if isinstance(area, dict):
        got = clean_masks([area], keep_empty=True)
        if got and got[0]["type"] == "select":
            out["areaMask"] = got[0]
    return out


COLOR_HSL = ("Red", "Yellow", "Green", "Cyan", "Blue", "Magenta", "White", "Neutral", "Black")


def _hex(v, d):
    return v.upper() if isinstance(v, str) and HEX_RE.fullmatch(v) else d


def _triple(v, lo=-1.0, hi=1.0):
    v = v if isinstance(v, list) and len(v) == 3 else [0, 0, 0]
    return [round(num(x, lo, hi), 3) for x in v]


def clean_color(c):
    """Renk ve ışık düzenlemeleri; yalnızca etkisi olanlar kalır (eski projeler bire bir aynı)."""
    if not isinstance(c, dict):
        return {}
    out = {}

    def nums(name, spec):
        d = c.get(name) if isinstance(c.get(name), dict) else {}
        r = {k: round(num(d.get(k), lo, hi, de), 3) for k, (lo, hi, de) in spec.items()}
        return d, r, any(r[k] != spec[k][2] for k in spec)

    _, r, on = nums("wb", {"temp": (-1, 1, 0), "tint": (-1, 1, 0)})
    if on:
        out["wb"] = r
    _, r, on = nums("bc", {"b": (-1, 1, 0), "c": (-1, 1, 0)})
    if on:
        out["bc"] = r
    _, r, on = nums("hue", {"h": (-180, 180, 0), "s": (-1, 1, 0), "l": (-1, 1, 0)})
    if on:
        out["hue"] = r
    _, r, on = nums("shhi", {"s": (0, 1, 0), "h": (0, 1, 0), "mid": (-1, 1, 0)})
    if on:
        out["shhi"] = {**r, **nums("shhi", {"radius": (0, 1, 0.3), "color": (-1, 1, 0)})[1]}
    _, r, on = nums("hdr", {"amount": (0, 1, 0)})
    if on:
        out["hdr"] = {**r, **nums("hdr", {"radius": (0, 1, 0.3), "detail": (0, 1, 0.3), "sat": (-1, 1, 0)})[1]}
    d, r, on = nums("filter", {"density": (0, 1, 0)})
    if on:
        out["filter"] = {**r, "color": _hex(d.get("color"), "#EC8A00"), "preserve": d.get("preserve", True) is not False}
    for name in ("invert", "desat"):
        if isinstance(c.get(name), dict) and c[name].get("on"):
            out[name] = {"on": True}
    d = c.get("posterize")
    if isinstance(d, dict) and d.get("on"):
        out["posterize"] = {"n": int(num(d.get("n"), 2, 32, 4))}
    d = c.get("threshold")
    if isinstance(d, dict) and d.get("on"):
        out["threshold"] = {"level": round(num(d.get("level"), 0, 1, 0.5), 3)}
    d = c.get("bw")
    if isinstance(d, dict) and d.get("on"):
        defaults = {"r": 0.4, "y": 0.6, "g": 0.4, "c": 0.6, "b": 0.2, "m": 0.8}
        out["bw"] = {k: round(num(d.get(k), -2, 3, v), 3) for k, v in defaults.items()}
        if d.get("tint"):
            out["bw"].update(tint=True, hue=round(num(d.get("hue"), 0, 360, 40), 1), sat=round(num(d.get("sat"), 0, 1, 0.2), 3))
    d = c.get("mixer")
    if isinstance(d, dict):
        rows = {k: [round(num(x, -2, 2), 3) for x in (d.get(k) if isinstance(d.get(k), list) and len(d[k]) == 4 else base)]
                for k, base in (("r", [1, 0, 0, 0]), ("g", [0, 1, 0, 0]), ("b", [0, 0, 1, 0]))}
        if d.get("mono") or rows != {"r": [1, 0, 0, 0], "g": [0, 1, 0, 0], "b": [0, 0, 1, 0]}:
            out["mixer"] = {**rows, "mono": bool(d.get("mono"))}
    d = c.get("lut")
    if isinstance(d, dict) and d.get("id") in PRESETS and d["id"] and num(d.get("amount"), 0, 1, 1):
        out["lut"] = {"id": d["id"], "amount": round(num(d.get("amount"), 0, 1, 1), 3)}
    d = c.get("gradient")
    if isinstance(d, dict) and d.get("on") and isinstance(d.get("stops"), list):
        stops = sorted(([round(num(s[0], 0, 1), 3), _hex(s[1], "#000000")] for s in d["stops"][:8] if isinstance(s, list) and len(s) == 2), key=lambda s: s[0])
        if len(stops) >= 2:
            out["gradient"] = {"stops": stops, "amount": round(num(d.get("amount"), 0, 1, 1), 3), "reverse": bool(d.get("reverse"))}
    d = c.get("selective")
    if isinstance(d, dict) and isinstance(d.get("bands"), dict):
        bands = {}
        for k, v in d["bands"].items():
            if k in COLOR_HSL and isinstance(v, list) and len(v) == 4:
                ink = [round(num(x, -1, 1), 3) for x in v]
                if any(ink):
                    bands[k] = ink
        if bands:
            out["selective"] = {"bands": bands, "relative": d.get("relative", True) is not False}
    d = c.get("balance")
    if isinstance(d, dict):
        r = {k: _triple(d.get(k)) for k in ("shadows", "mids", "highs")}
        if any(any(v) for v in r.values()):
            out["balance"] = {**r, "preserve": d.get("preserve", True) is not False}
    d = c.get("levels")
    if isinstance(d, dict):
        lv = {}
        for k in ("rgb", "r", "g", "b"):
            v = d.get(k)
            if isinstance(v, list) and len(v) == 5:
                b = round(num(v[0], 0, 0.95), 3)
                e = [b, round(num(v[1], 0.1, 9.99, 1), 3), round(max(b + 0.01, num(v[2], 0.02, 1, 1)), 3), round(num(v[3], 0, 1), 3), round(num(v[4], 0, 1, 1), 3)]
                if e != [0, 1, 1, 0, 1]:
                    lv[k] = e
        if lv:
            out["levels"] = lv
    d = c.get("curves")
    if isinstance(d, dict):
        cv = {}
        for k in ("rgb", "r", "g", "b"):
            v = d.get(k)
            if isinstance(v, list) and 2 <= len(v) <= 16:
                pts = {}
                for p in v:
                    if isinstance(p, list) and len(p) == 2:
                        pts[round(num(p[0], 0, 1), 4)] = round(num(p[1], 0, 1), 4)
                e = [[x, pts[x]] for x in sorted(pts)]
                if len(e) >= 2 and any(abs(x - y) > 1e-3 for x, y in e) or (len(e) >= 2 and (e[0][0] > 0 or e[-1][0] < 1)):
                    cv[k] = e
        if cv:
            out["curves"] = cv
    d = c.get("match")
    if isinstance(d, dict) and d.get("photo") and (UPLOADS / Path(str(d["photo"])).name).is_file():
        out["match"] = {"photo": Path(str(d["photo"])).name, "lum": round(num(d.get("lum"), 0, 2, 1), 3), "sat": round(num(d.get("sat"), 0, 2, 1), 3), "fade": round(num(d.get("fade"), 0, 1), 3)}
    d, r, on = nums("replace", {"h": (-180, 180, 0), "s": (-1, 1, 0), "l": (-1, 1, 0)})
    if on:
        out["replace"] = {**r, "color": _hex(d.get("color"), "#FF0000"), "fuzz": round(num(d.get("fuzz"), 0, 1, 0.3), 3)}
    d = c.get("grade")
    if isinstance(d, dict):
        r = {}
        for k in ("shadow", "mid", "high", "global"):
            v = d.get(k)
            if isinstance(v, list) and len(v) == 3 and (num(v[1], 0, 1) or num(v[2], -1, 1)):
                r[k] = [round(num(v[0], 0, 360), 1), round(num(v[1], 0, 1), 3), round(num(v[2], -1, 1), 3)]
        if r:
            out["grade"] = {**r, "balance": round(num(d.get("balance"), -1, 1), 3), "blend": round(num(d.get("blend"), 0, 1, 0.5), 3)}
    return out


def clean_filters(ls, masks):
    """Filtre yığını: sıra korunur; kapalı ve bilinmeyenler atlanır. Yalnızca seçili alan: seçim filtreye gömülür."""
    out = []
    for raw in (ls if isinstance(ls, list) else [])[:filters.MAX_STACK]:
        if not isinstance(raw, dict):
            continue
        f = filters.clean_one(raw, lambda pid: (UPLOADS / Path(pid).name).is_file())
        if f is None:
            continue
        area = next((m for m in masks if isinstance(m, dict) and m.get("id") == raw.get("area")), None) if raw.get("area") and isinstance(masks, list) else None
        if area:
            got = clean_masks([area], keep_empty=True)
            if got and got[0]["type"] == "select":
                f["areaMask"] = got[0]
        out.append(f)
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
            "masks": clean_masks(fx_in.get("masks")), "background": clean_background(fx_in.get("background")),
            "retouch": clean_retouch(fx_in.get("retouch"), fx_in.get("masks")), "color": clean_color(fx_in.get("color")),
            "filters": clean_filters(fx_in.get("filters"), fx_in.get("masks"))}


def clean_background(b):
    b = b if isinstance(b, dict) else {}
    if b.get("mode") not in engine.BG_MODES:
        return {}
    c = b.get("color")
    return {"mode": b["mode"], "color": c if isinstance(c, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", c) else "#FFFFFF",
            "blur": round(num(b.get("blur"), 0.0, 1.0, 0.5), 3), "edge": round(num(b.get("edge"), 0.0, 1.0), 3), "defringe": round(num(b.get("defringe"), 0.0, 1.0), 3)}


AI_LOCK = threading.Lock()


def ai_model(m):
    return m if m in ai.MODELS else "isnet"


def lama_fill(rgb, hole):
    with AI_LOCK:
        return ai.lama_fill(HERE, rgb, hole)


class _InpaintHook:
    """Model kurulduysa engine.INPAINT_FN gibi davranır; kurulu değilse yama eşleştirme kullanılır."""
    def __bool__(self):
        return ai.installed(HERE, "lama")

    def __call__(self, rgb, hole):
        return lama_fill(rgb, hole)


AI_OPS = ("subject", "object", "sky")  # object ve sky model yoksa da çalışır, varsa daha iyi sonuç verir
OBJECTS = {}  # nesne seçimi: kutu başına bir kez çalışır


def needs_matte(fx):
    masks = list(fx.get("masks") or []) + [(fx.get("retouch") or {}).get("areaMask") or {}] + [f.get("areaMask") or {} for f in fx.get("filters") or []]
    if any(f["kind"] == "lens" and f.get("depth") == "subject" for f in fx.get("filters") or []):
        return True
    return bool(fx.get("background")) or any(op.get("kind") in AI_OPS for m in masks for op in m.get("ops") or [])


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

    def crop(arr, box):
        """Nesne seçimi: model yalnızca kutunun içine bakar."""
        def make():
            img = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
            img.thumbnail((1024, 1024), Image.BILINEAR)
            with AI_LOCK:
                return ai.predict(HERE, img)
        key = (str(path), json.dumps(geo, sort_keys=True), tuple(box))
        return np.asarray(_lru(OBJECTS, key, make, 8).resize((arr.shape[1], arr.shape[0]), Image.BILINEAR), np.float32) / 255.0
    fn.ready, fn.crop = ai.installed(HERE), crop
    return fn


def attach_matte(fx, path, geo):
    if needs_matte(fx):
        fx["_matte"] = matte_provider(path, geo)
    return fx


def _pt(v, lo=-0.5, hi=1.5):
    return [num(v[0], lo, hi, 0.5), num(v[1], lo, hi, 0.5)] if isinstance(v, list) and len(v) == 2 else [0.5, 0.5]


def clean_select_ops(ops):
    """Selection Tool adımları; toplam nokta sayısı sınırlı."""
    out, budget = [], 6000

    def box(q):
        if not isinstance(q, list) or len(q) != 4:
            return None
        v = [round(num(c, -0.2, 1.2), 4) for c in q]
        return v if abs(v[2] - v[0]) > 0.002 and abs(v[3] - v[1]) > 0.002 else None

    for op in (ops if isinstance(ops, list) else [])[:300]:
        if not isinstance(op, dict):
            continue
        kind, add, c = op.get("kind"), op.get("add", True) is not False, None
        pts = [[round(x, 4), round(y, 4)] for x, y in (_pt(q, -0.2, 1.2) for q in op["pts"][:budget])] if isinstance(op.get("pts"), list) else []
        tol = round(num(op.get("tol"), 0.0, 1.0, 0.3), 3)
        if kind == "subject":
            c = {"kind": kind, "inverse": bool(op.get("inverse"))}
        elif kind == "wand":
            c = {"kind": kind, "p": _pt(op.get("p"), 0.0, 1.0), "tol": tol, "contiguous": op.get("contiguous", True) is not False}
        elif kind == "brush" and pts:
            c = {"kind": kind, "pts": pts, "r": round(num(op.get("r"), 0.002, 0.3, 0.03), 4), "hard": round(num(op.get("hard"), 0.0, 1.0, 0.6), 3)}
        elif kind == "quick" and pts:
            c = {"kind": kind, "pts": pts, "r": round(num(op.get("r"), 0.002, 0.3, 0.03), 4), "tol": tol}
        elif kind in ("poly", "magnetic") and len(pts) >= 3:
            c = {"kind": kind, "pts": pts}
        elif kind in ("rect", "ellipse", "object") and box(op.get("box")):
            c = {"kind": kind, "box": box(op["box"])}
        elif kind == "row":
            c = {"kind": kind, "y": round(num(op.get("y"), 0.0, 1.0, 0.5), 5)}
        elif kind == "col":
            c = {"kind": kind, "x": round(num(op.get("x"), 0.0, 1.0, 0.5), 5)}
        elif kind == "range":
            c = {"kind": kind, "p": _pt(op.get("p"), 0.0, 1.0), "tol": tol}
        elif kind == "focus":
            c = {"kind": kind, "amt": round(num(op.get("amt"), 0.0, 1.0, 0.5), 3)}
        elif kind == "sky":
            c = {"kind": kind}
        elif kind == "invert":
            out.append({"kind": kind})
        elif kind in ("expand", "contract", "feather", "smooth", "border"):
            out.append({"kind": kind, "amt": round(num(op.get("amt"), 0.0, 0.2, 0.01), 5)})
        elif kind in ("grow", "similar"):
            out.append({"kind": kind, "tol": tol})
        if c:
            c["add"] = add
            if op.get("intersect"):
                c["intersect"] = True
            out.append(c)
            budget -= len(pts)
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
        if m["type"] == "select" and isinstance(m.get("refine"), dict):
            rf = m["refine"]
            rf = {"edge": round(num(rf.get("edge"), 0.0, 1.0), 3), "smooth": round(num(rf.get("smooth"), 0.0, 1.0), 3), "shift": round(num(rf.get("shift"), -1.0, 1.0), 3), "contrast": round(num(rf.get("contrast"), 0.0, 1.0), 3)}
            if any(rf.values()):
                c["refine"] = rf
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
    fx["paint"] = clean_paint(d.get("paint"), d.get("hidden"))
    block = [num(block[0], -lim, lim), num(block[1], -lim, lim)]
    offsets = {str(k): (num(v[0], -lim, lim), num(v[1], -lim, lim))
               for k, v in (d.get("offsets") or {}).items()}
    return {
        "text": text, "tone": tone, "accent": str(d.get("accent", "")).strip(),
        "styles": clean_styles(d.get("styles"), len(text.split())),
        "fx": fx, "block": (float(block[0]), float(block[1])), "offsets": offsets,
        "geo": clean_geo(d.get("geo")),
        "font": clean_font(d.get("font")), "textfx": clean_textfx(d.get("textfx")),
        "layers": name_groups(clean_layers(d.get("layers"), d.get("hidden")), d.get("groups")),
        "textAt": text_index(d),
        "slices": clean_slices(d.get("slices")),
    }


BRUSH_NUMS = {"size": (0.001, 0.6, 0.03), "hard": (0, 1, 0.8), "opacity": (0, 1, 1), "flow": (0, 1, 1), "spacing": (0.02, 3, 0.15),
              "angle": (-180, 180, 0), "round": (0.05, 1, 1), "sizeJ": (0, 1, 0), "minD": (0, 1, 0), "angleJ": (0, 1, 0), "roundJ": (0, 1, 0),
              "hueJ": (0, 1, 0), "satJ": (0, 1, 0), "briJ": (0, 1, 0), "fgbgJ": (0, 1, 0), "scatter": (0, 10, 0), "count": (1, 8, 1),
              "wet": (0, 1, 0), "dry": (0, 1, 0), "texDepth": (0, 1, 0.6), "tol": (0, 1, 0.3), "pickup": (0, 1, 0.5), "load": (0, 1, 0),
              "dualSize": (0.1, 3, 0.5), "dualScatter": (0, 5, 0), "dualHard": (0, 1, 0.8), "amount": (0, 1, 0.5), "stampScale": (0.02, 1, 0.2)}
HEX_RE = re.compile(r"#[0-9a-fA-F]{6}")


def clean_brush(b):
    b = b if isinstance(b, dict) else {}
    out = {k: round(num(b.get(k), lo, hi, d), 4) for k, (lo, hi, d) in BRUSH_NUMS.items()}
    out["count"] = int(out["count"])
    for k in ("pressSize", "pressOpacity", "paintOnly", "vib", "finger"):
        out[k] = bool(b.get(k))
    out["range"] = b["range"] if b.get("range") in ("shadows", "mid", "high") else "mid"
    out["sponge"] = "sat" if b.get("sponge") == "sat" else "desat"
    stamp = str(b.get("stamp") or "")
    out["stamp"] = stamp if stamp in engine.PATTERN_KINDS or (stamp.startswith("img:") and (UPLOADS / Path(stamp[4:]).name).is_file()) else ""
    out["contiguous"] = b.get("contiguous", True) is not False
    out["color"] = b["color"] if isinstance(b.get("color"), str) and HEX_RE.fullmatch(b["color"]) else "#000000"
    out["color2"] = b["color2"] if isinstance(b.get("color2"), str) and HEX_RE.fullmatch(b["color2"]) else "#FFFFFF"
    tip = str(b.get("tip") or "round")
    out["tip"] = tip if tip == "round" or (tip.startswith("img:") and (UPLOADS / Path(tip[4:]).name).is_file()) else "round"
    out["tex"] = b["tex"] if b.get("tex") in engine.TEX_KINDS else ""
    out["pattern"] = b["pattern"] if b.get("pattern") in engine.PATTERN_KINDS else ""
    out["dual"] = bool(b.get("dual"))
    return out


def clean_paint(p, hidden=None):
    """Boya darbeleri; toplam nokta sayısı sınırlı. Gizliyse çizilmez."""
    if not isinstance(p, dict) or (isinstance(hidden, list) and "paint" in hidden):
        return {}
    out, budget = [], 200000
    for st in (p.get("strokes") if isinstance(p.get("strokes"), list) else [])[:3000]:
        if not isinstance(st, dict) or st.get("tool") not in engine.PAINT_TOOLS or not isinstance(st.get("pts"), list):
            continue
        pts = []
        for q in st["pts"][:min(budget, 6000)]:
            if isinstance(q, list) and len(q) >= 2:
                pts.append([round(num(q[0], -0.5, 1.5), 5), round(num(q[1], -0.5, 1.5), 5), round(num(q[2] if len(q) > 2 else 1.0, 0.0, 1.0, 1.0), 3)])
        if pts:
            s = {"tool": st["tool"], "pts": pts, "seed": int(num(st.get("seed"), 0, 2**31 - 1)), "b": clean_brush(st.get("b"))}
            if isinstance(st.get("src"), list) and len(st["src"]) == 2:  # rötuş: kaynak kaydırması
                s["src"] = [round(num(st["src"][0], -1.5, 1.5), 5), round(num(st["src"][1], -1.5, 1.5), 5)]
            if st.get("mode") == "extend":
                s["mode"] = "extend"
            out.append(s)
            budget -= len(pts)
        if budget <= 0:
            break
    return {"strokes": out} if out else {}


def load_tip(pid):
    """Özel fırça ucu: şeffaf PNG'de alfa, değilse koyu yerler boya olur."""
    def make():
        with Image.open(photo_path(pid)) as im:
            rgba = ImageOps.exif_transpose(im).convert("RGBA")
        a = rgba.getchannel("A")
        if a.getextrema()[0] < 250:
            return a
        return ImageOps.invert(rgba.convert("L"))
    return _lru(TIPS, pid, make, 16)


def load_stamp(pid):
    """Desen damgası görseli: şeffaf yerler beyaz olur."""
    def make():
        with Image.open(photo_path(pid)) as im:
            rgba = ImageOps.exif_transpose(im).convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(bg, rgba).convert("RGB")
    return _lru(TIPS, "rgb:" + pid, make, 16)


TIPS = {}
engine.TIP_LOADER = load_tip
engine.STAMP_LOADER = load_stamp
engine.INPAINT_FN = _InpaintHook()


def brush_thumb(d):
    """Hazır ayar kutucuğu: açık zeminde örnek darbe."""
    W, H = 320, 88
    b = {**clean_brush(d.get("b")), "color": "#1E1E22", "color2": "#8A8A92"}
    b["size"] = min(b["size"], 0.42) if d.get("real") else max(0.14, min(0.42, b["size"] * 6))
    tool = d.get("tool") if d.get("tool") in engine.PAINT_TOOLS else "brush"
    xs = np.linspace(0.08, 0.92, 80)
    pts = [[float(x), float(0.5 + 0.24 * np.sin((x - 0.08) * 7.5)), float(0.25 + 0.75 * np.sin((x - 0.08) / 0.84 * np.pi))] for x in xs]
    base = Image.new("RGBA", (W, H), (242, 242, 244, 255))
    out = engine.apply_paint(base, base, {"strokes": [{"tool": "pencil" if tool == "pencil" else "brush", "pts": pts, "seed": 7, "b": b}]})
    buf = io.BytesIO()
    out.convert("RGB").save(buf, "PNG")
    return {"image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}


def clean_slices(ls):
    """Dilimler: tuvale göre 0..1 kutular; en fazla 200."""
    out = []
    for s in (ls if isinstance(ls, list) else [])[:200]:
        if not isinstance(s, dict):
            continue
        x, y = num(s.get("x"), 0.0, 1.0), num(s.get("y"), 0.0, 1.0)
        w, h = min(num(s.get("w"), 0.0, 1.0), 1 - x), min(num(s.get("h"), 0.0, 1.0), 1 - y)
        if w > 0.002 and h > 0.002:
            out.append({"x": x, "y": y, "w": w, "h": h, "name": Path(safe_name(str(s.get("name") or "") + ".x")).stem[:30] if s.get("name") else ""})
    return out


def clean_layers(ls, hidden=None):
    """Görsel katmanları (birleştirme). Gizlenenler ve dosyası olmayanlar atlanır."""
    hidden = set(hidden) if isinstance(hidden, list) else set()
    out = []
    for ly in (ls if isinstance(ls, list) else [])[:MAX_LAYERS]:
        if not isinstance(ly, dict):
            continue
        from_photo = bool(ly.get("base"))  # Arka Plan katmanı ya da kopyası: işlenmiş fotoğrafı kullanır
        primary = from_photo and ly.get("id") == BASE_LAYER
        if f"img:{ly.get('id')}" in hidden and not primary:  # gizli Arka Plan opaklık 0 ile gelir, tuval boş kalır
            continue
        kind = ly.get("kind") if ly.get("kind") in layerfx.GENERATED + ("adjust",) else None
        pid = Path(str(ly.get("photo") or "")).name
        if not kind and not from_photo and (not pid or not (UPLOADS / pid).is_file()):
            continue
        c = {"id": str(ly.get("id") or ""), "photo": pid, "x": num(ly.get("x"), -2.0, 3.0, 0.5), "y": num(ly.get("y"), -2.0, 3.0, 0.5),
             "w": num(ly.get("w"), 0.01, 5.0, 0.4), "rot": num(ly.get("rot"), -360.0, 360.0, 0.0),
             "opacity": num(ly.get("opacity"), 0.0, 1.0, 1.0), "flipH": bool(ly.get("flipH")),
             "cutout": bool(ly.get("cutout")), "sy": num(ly.get("sy"), 0.02, 20.0, 1.0), "blend": bool(ly.get("blend")),
             "clip": bool(ly.get("clip")), "defringe": round(num(ly.get("defringe"), 0.0, 1.0), 3),
             "name": str(ly.get("name") or "")[:120]}
        if ly.get("group"):
            c["group"] = str(ly["group"])
        if ly.get("off"):  # yalnızca PSD: gizli katman dosyaya gizli olarak yazılır
            c["off"] = True
        c.update(clean_deform(ly))
        c.update(clean_layer_extra(ly, kind))
        if from_photo:
            c["base"] = True
            if primary and _base_untouched(c):
                continue  # değişmemiş Arka Plan çizime girmez: sonuç birebir aynı kalır
        out.append(c)
    return out


BASE_LAYER = "base"
MAX_LAYERS = 200
_LAYER_CORE = {"id", "photo", "x", "y", "w", "rot", "opacity", "flipH", "cutout", "sy", "blend", "clip", "defringe", "base", "name", "group"}


def _base_untouched(c):
    """Arka Plan katmanı tuvali tam dolduruyor ve hiçbir katman özelliği açık değil mi?"""
    near = lambda a, b: abs(a - b) < 1e-4
    return not (set(c) - _LAYER_CORE) and near(c["x"], 0.5) and near(c["y"], 0.5) and near(c["w"], 1.0) and near(c["sy"], 1.0) \
        and near(c["rot"], 0.0) and near(c["opacity"], 1.0) and not (c["flipH"] or c["blend"] or c["clip"] or c["defringe"])


# Bu filtreler görüntüyü kaydırır ya da yayar: katmanın şeffaflığı da aynı işlemden geçer
SHAPE_FILTERS = {"gaussian", "boxblur", "motion", "radial", "lens", "field", "iris", "tilt", "displace", "pinch", "polar", "ripple", "shear", "spherize", "twirl", "wave", "zigzag", "lenscor", "liquify", "perspective", "wideangle", "wind", "extrude"}


def clean_layer_fx(raw):
    """Katmana özel renk, filtre ve efektler. Etkisizse hiç yazılmaz."""
    fx = {**clean_fx({**ORIGINAL_FX, **raw}), "frame": {}, "masks": [], "background": {}, "paint": {}, "retouch": {}}
    if fx["preset"] == "b:original" and not (fx["bw"] or fx["adjust"] or fx["color"] or fx["filters"] or fx["grain"] or fx["vignette"] or fx["texture"]):
        return {}
    out = {"fx": fx}
    shape = [f for f in (raw.get("filters") if isinstance(raw.get("filters"), list) else []) if isinstance(f, dict) and f.get("kind") in SHAPE_FILTERS and not f.get("off")]
    if shape:
        out["fxAlpha"] = clean_fx({**ORIGINAL_FX, "filters": shape})
    return out


GRADED_LAYERS = {}


def grade_layer(src, ly):
    """Katman görseline kendi renk ve filtrelerini uygular; şeffaflık korunur, bulanıklık ve bozma kenara da yansır."""
    fx = ly["fx"]

    def make():
        a = np.asarray(src.getchannel("A"), np.float32) / 255.0
        rgb = np.asarray(src.convert("RGB"), np.float32) / 255.0
        if a.min() < 0.999:  # şeffaf yerlerin siyahı filtrelerde kenara sızmasın
            s = max(src.size) / 64.0
            soft = engine.gauss(rgb * a[..., None], s) / np.maximum(engine.gauss(a, s), 1e-4)[..., None]
            rgb = rgb * a[..., None] + np.clip(soft, 0, 1) * (1 - a[..., None])
        base = Image.fromarray((rgb * 255 + 0.5).astype(np.uint8), "RGB")
        k = engine.canvas_scale(*src.size)
        out = engine.grade(base, CFG, 7, {**fx, "_filter_k": None}, k).convert("RGBA")
        alpha = src.getchannel("A")
        if ly.get("fxAlpha"):
            alpha = engine.grade(alpha.convert("RGB"), CFG, 7, {**ly["fxAlpha"], "_filter_k": None}, k).convert("L")
        out.putalpha(alpha)
        return out

    if not ly.get("photo"):
        return make()  # üretilen katman her seferinde yeniden çizilir
    return _lru(GRADED_LAYERS, (ly["photo"], ly.get("cutout"), src.size, fx_key(fx)), make, 16)


engine.LAYER_FX = grade_layer


def layer_from_strokes(d):
    """Çizimi şeffaf görsele işler ve doluluk kutusuna kırpar: katman gibi davranan gerçek bir görsel olur."""
    paint = clean_paint({"strokes": d.get("strokes")})
    if not paint:
        return {"empty": True}
    cw, ch = int(num(d.get("w"), 16, 30000, 1080)), int(num(d.get("h"), 16, 30000, 1350))
    f = min(1.0, 4096 / max(cw, ch))
    size = (max(1, round(cw * f)), max(1, round(ch * f)))
    blank = Image.new("RGBA", size, (0, 0, 0, 0))
    out = engine.apply_paint(blank, blank, paint)
    box = out.getchannel("A").getbbox()
    if not box:
        return {"empty": True}
    rec = save_photo("cizim.png", _png(out.crop(box)))
    w, h = box[2] - box[0], box[3] - box[1]
    return {**rec, "x": (box[0] + w / 2) / size[0], "y": (box[1] + h / 2) / size[1], "w": w / size[0], "ar": h / w}


def text_index(d):
    """Yazının altında kalan katman sayısı (çizime giren katmanlara göre); None: en üstte."""
    anchor, raw = d.get("textAfter"), d.get("layers")
    if not anchor or not isinstance(raw, list):
        return None
    ids = [str(ly.get("id")) for ly in raw[:MAX_LAYERS] if isinstance(ly, dict)]
    if anchor not in ids:
        return None
    below = set(ids[:ids.index(anchor) + 1])
    return sum(1 for c in clean_layers(raw, d.get("hidden")) if c["id"] in below)


def name_groups(layers, groups):
    """PSD'ye yazılacak grup adları."""
    names = {str(g.get("id")): str(g.get("name") or "Grup")[:120] for g in (groups if isinstance(groups, list) else []) if isinstance(g, dict)}
    for ly in layers:
        if ly.get("group") in names:
            ly["groupName"] = names[ly["group"]]
    return layers


def clean_layer_extra(ly, kind):
    """Katman türü, karışım kipi, dolgu opaklığı ve stiller; varsayılanlar yazılmaz (eski projeler aynı kalır)."""
    out = {}
    if ly.get("mode") in layerfx.MODES and ly["mode"] != "normal":
        out["mode"] = ly["mode"]
    fill = round(num(ly.get("fill"), 0.0, 1.0, 1.0), 3)
    if fill < 1:
        out["fill"] = fill
    st = layerfx.clean_styles(ly.get("styles"))
    if st:
        out["styles"] = st
    if isinstance(ly.get("fx"), dict):
        out.update(clean_layer_fx(ly["fx"]))
    if kind:
        out["kind"] = kind
        out["ar"] = round(num(ly.get("ar"), 0.01, 50.0, 1.0), 4)
        hx = lambda v, d: v.upper() if isinstance(v, str) and HEX_RE.fullmatch(v) else d
        if kind == "text":
            t = ly.get("textDef") if isinstance(ly.get("textDef"), dict) else {}
            out["textDef"] = {"value": str(t.get("value") or "Metin")[:2000], "family": clean_font(t.get("family")), "color": hx(t.get("color"), "#FFFFFF"),
                              "align": t.get("align") if t.get("align") in ("left", "center", "right") else "center", "bold": bool(t.get("bold"))}
        elif kind == "shape":
            t = ly.get("shapeDef") if isinstance(ly.get("shapeDef"), dict) else {}
            out["shapeDef"] = {"type": t.get("type") if t.get("type") in ("rect", "ellipse", "triangle", "star", "hexagon", "path") else "rect",
                               "pts": [[round(num(q[0], -1.0, 2.0), 5), round(num(q[1], -1.0, 2.0), 5)] for q in (t.get("pts") if isinstance(t.get("pts"), list) else [])[:4000] if isinstance(q, list) and len(q) >= 2], "color": hx(t.get("color"), "#E0314A"),
                               "stroke": hx(t.get("stroke"), "#FFFFFF"), "strokeW": round(num(t.get("strokeW"), 0.0, 0.5), 3), "radius": round(num(t.get("radius"), 0.0, 1.0), 3)}
        elif kind == "fill":
            t = ly.get("fillDef") if isinstance(ly.get("fillDef"), dict) else {}
            out["fillDef"] = {"type": t.get("type") if t.get("type") in ("color", "gradient", "pattern") else "color", "color": hx(t.get("color"), "#808080"), "color2": hx(t.get("color2"), "#FFFFFF"),
                              "angle": num(t.get("angle"), -180.0, 180.0, 90.0), "pattern": t.get("pattern") if t.get("pattern") in layerfx.PATTERNS else "dots", "scale": round(num(t.get("scale"), 0.005, 0.5, 0.03), 3)}
        elif kind == "adjust":
            out["adjust"] = clean_color(ly.get("adjust"))
    if kind == "blank":
        out["paint"] = clean_paint(ly.get("paint"))
    return out


def clean_deform(ly):
    """Katman bozma alanları: geçersiz ya da etkisiz olanlar atılır."""
    def grid(q, n):
        if not (isinstance(q, list) and len(q) == n and all(isinstance(p, list) and len(p) == 2 for p in q)):
            return None
        return [[round(num(p[0], -3.0, 4.0), 4), round(num(p[1], -3.0, 4.0), 4)] for p in q]
    out = {}
    for key, n in (("corners", 4), ("warp", 16), ("pwarp", 6)):
        g = grid(ly.get(key), n)
        if g and (key != "corners" or any(v for p in g for v in p)):
            out[key] = g
    pins = []
    for q in (ly.get("pins") if isinstance(ly.get("pins"), list) else [])[:24]:
        if isinstance(q, dict) and grid([q.get("p"), q.get("q")], 2):
            a, b = grid([q["p"], q["q"]], 2)
            pins.append({"p": a, "q": b})
    if pins:
        out["pins"] = pins
    mk = ly.get("mask")
    if isinstance(mk, dict):
        ops = [o for o in clean_select_ops(mk.get("ops")) if o["kind"] == "brush"]
        if ops or mk.get("invert"):
            out["mask"] = {"ops": ops, "invert": bool(mk.get("invert")), "off": bool(mk.get("off"))}
            d, f = round(num(mk.get("density"), 0.0, 1.0, 1.0), 3), round(num(mk.get("feather"), 0.0, 1.0), 3)
            if d < 1:
                out["mask"]["density"] = d
            if f:
                out["mask"]["feather"] = f
    v = ly.get("vector")
    if isinstance(v, dict):
        if v.get("kind") in ("rect", "ellipse") and grid([v.get("box", [])[:2], v.get("box", [])[2:]], 2):
            a, b = grid([v["box"][:2], v["box"][2:]], 2)
            out["vector"] = {"kind": v["kind"], "box": a + b}
        elif v.get("kind") == "path" and isinstance(v.get("pts"), list) and 3 <= len(v["pts"]) <= 400 and grid(v["pts"], len(v["pts"])):
            out["vector"] = {"kind": "path", "pts": grid(v["pts"], len(v["pts"]))}
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
        return _lru(LAYER_IMG, key, make, 32)
    return load


def _item_canvas(item, path):
    geo = item["geo"]
    if geo is None:
        return W, H
    return engine.canvas_plan(geo, engine.geo_plan(geo, *get_src(path)["size"])["size"])[0]


def layers_merge(d):
    """Seçili (ya da görünen) katmanları tek şeffaf görsele çizer; yeni dosya bilgisini döndürür."""
    raw = d.get("item") or {}
    item = clean_item(raw)
    ids = set(str(i) for i in d.get("ids") or [])
    chosen = [ly for ly in item["layers"] if (not ids or ly["id"] in ids) and ly.get("kind") != "adjust"]
    if not chosen:
        raise ValueError("Birleştirilecek katman yok.")
    cw, ch = _item_canvas(item, photo_path(raw["id"]))
    f = min(1.0, 4096 / max(cw, ch))
    size = (max(1, round(cw * f)), max(1, round(ch * f)))
    source = None
    if any(ly.get("base") for ly in chosen):
        attach_matte(item["fx"], photo_path(raw["id"]), item["geo"])
        source = engine.make_base(CFG, photo_path(raw["id"]), item["fx"], item["geo"])
    out = engine.place_layers(Image.new("RGBA", size, (0, 0, 0, 0)), chosen, layer_loader(True), source)
    buf = io.BytesIO()
    out.save(buf, "PNG")
    return save_photo("birlesik.png", buf.getvalue())


def layers_flatten(d):
    """Görüntüyü düzleştir: fotoğraf, efektler, katmanlar ve yazı tek görsel olur (filigran hariç).
    ids verilirse yalnızca o katmanlar Arka Plan'la birleşir; yazı ayrı kalır."""
    raw = d.get("item") or {}
    item = clean_item(raw)
    path = photo_path(raw["id"])
    attach_matte(item["fx"], path, item["geo"])
    ids = set(str(i) for i in d.get("ids") or [])
    if ids:
        item["layers"] = [ly for ly in item["layers"] if ly["id"] in ids]
        item["text"] = ""
    tmp = UPLOADS / f".flat_{uuid.uuid4().hex[:8]}.png"
    try:
        engine.render_one(CFG, path, item["text"], item["tone"], item["accent"], tmp, styles=item["styles"], fx=item["fx"], block=item["block"],
                          offsets=item["offsets"], geo=item["geo"], wm=None, font=item["font"], textfx=item["textfx"], fmt="png", quality=95,
                          keep_exif=False, color="rgb", dpi=None, layers=item["layers"], loader=layer_loader(True), text_at=item["textAt"])
        with Image.open(tmp) as im:  # sonuç yeni fotoğraf olur: şeffaf yerler (Photoshop'taki gibi) beyaz
            rgba = im.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel("A"))
        buf = io.BytesIO()
        flat.save(buf, "PNG")
        return save_photo("duzlestirilmis.png", buf.getvalue())
    finally:
        tmp.unlink(missing_ok=True)


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
            "persp": clean_persp(g.get("persp")), "fit": "content" if g.get("fit") == "content" else None, "ca": bool(g.get("ca"))}


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
            round(fx["amount"], 2), json.dumps([fx["adjust"], fx["texture"], fx["frame"], fx["masks"], fx.get("background"), fx.get("paint"), fx.get("retouch"), fx.get("color"), fx.get("filters")], sort_keys=True))


GRADED = {}


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
    paint_key = (key[0], key[1], fx_key({**fx, "paint": None}), key[3])

    def graded(make):  # yeni fırça darbesinde renk işleme tekrar çalışmasın
        return _lru(GRADED, paint_key, make, 3) if fx.get("paint") else make()

    if geo is None:
        crop = get_crop(path)
        base = engine.finish_base(graded(lambda: engine.grade_base(CFG, crop, path, fx)), crop, fx, None, 1.0, paint_key)
    else:
        target = (max(1, round(size[0] * f)), max(1, round(size[1] * f)))
        img = geo_image(path, geo, target)
        base = engine.finish_base(graded(lambda: engine.grade_base(CFG, img, path, fx, engine.canvas_scale(*size) * f)), img, fx, geo, f, paint_key)
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
                                         layers=item["layers"], loader=layer_loader(), text_at=item["textAt"])
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


def color_auto(d):
    """Otomatik Ton / Kontrast / Renk: seviyeler hariç işlenmiş küçük görselden düzenlenebilir seviye değerleri."""
    kind = d.get("kind") if d.get("kind") in ("tone", "contrast", "color") else "tone"
    path = photo_path(d["photo"])
    geo = clean_geo(d.get("geo"))
    fx = clean_fx(d.get("fx") or {})
    fx = {**fx, "grain": 0.0, "vignette": 0.0, "texture": {}, "frame": {}, "background": {}, "color": {k: v for k, v in fx["color"].items() if k != "levels"}}
    with LOCK:
        if geo is None:
            img = get_crop(path).resize((432, 540), Image.BILINEAR)
        else:
            size = engine.geo_plan(geo, *get_src(path)["size"])["size"]
            f = 480 / max(size)
            img = geo_image(path, geo, (max(1, round(size[0] * f)), max(1, round(size[1] * f))))
    arr = np.asarray(engine.grade(img, CFG, 0, fx, engine.canvas_scale(*img.size)), np.float32) / 255.0
    return {"levels": adjustments.auto_levels(arr, kind)}


STATS = {}


def photo_stats(pid):
    """Renk Eşleştirme kaynağının renk istatistiği (küçük görselden)."""
    def make():
        with Image.open(photo_path(pid)) as im:
            im = ImageOps.exif_transpose(im).convert("RGB")
            im.thumbnail((256, 256))
            return adjustments.color_stats(np.asarray(im, np.float32) / 255.0)
    return _lru(STATS, pid, make, 16)


def filter_image(pid):
    def make():
        with Image.open(photo_path(pid)) as im:
            return ImageOps.exif_transpose(im).convert("RGB")
    return _lru(STATS, "img:" + pid, make, 16)


filters.IMAGE_LOADER = filter_image
adjustments.PHOTO_STATS = photo_stats
adjustments.LUT_LOADER = lambda pid: (PRESETS.get(pid) or {}).get("look")


def layers_auto_align(d):
    """Otomatik hizala: seçili katmanları içeriklerine göre hizalar (tek katmansa fotoğrafa, birden çoksa en alttakine)."""
    raw = d.get("item") or {}
    item = clean_item(raw)
    ids = [str(i) for i in d.get("ids") or []]
    sel = [ly for ly in item["layers"] if ly["id"] in ids and ly.get("photo") and not ly.get("base")]
    if not sel:
        raise ValueError("Önce hizalanacak katmanı seç.")
    path = photo_path(raw["id"])
    attach_matte(item["fx"], path, item["geo"])
    with LOCK:
        base = get_base(path, item["fx"], item["geo"], 0)[0].copy()
    base.thumbnail((512, 512), Image.BILINEAR)
    W, H = base.size
    load = layer_loader()
    if len(sel) > 1:
        ref = np.asarray(engine.place_layers(Image.new("RGBA", (W, H), (0, 0, 0, 0)), [{**sel[0], "opacity": 1.0, "blend": False}], load), np.float32) / 255.0
        moving = sel[1:]
    else:
        ref = np.asarray(base.convert("RGBA"), np.float32) / 255.0
        moving = sel
    gray, mask = ref[..., :3] @ looks.LUMA, ref[..., 3] > 0.9
    out = {}
    for ly in moving:
        r = engine.auto_align_layer(gray, mask, ly, load, W, H)
        if r:
            out[ly["id"]] = r
    return {"layers": out, "tried": len(moving)}


def geo_auto(d):
    """Otomatik düzelt: straighten (eğim), upright (perspektif), trim (düz renkli kenarlar)."""
    path = photo_path(d["photo"])
    geo = clean_geo(d.get("geo")) or {"aspect": "4:5"}
    kind = d.get("kind")
    base = {**geo, "crop": None, "aspect": "original", "fit": None, "ca": False}
    if kind in ("straighten", "upright"):
        base["straighten"] = 0
    if kind == "upright":
        base["persp"] = None
    with LOCK:
        src = get_src(path)
        plan = engine.geo_plan(base, *src["size"])
        small = src["proxy"].copy()
        small.thumbnail((900, 900), Image.BILINEAR)
        img, box = engine.orient(small, plan)
    arr = np.asarray(img.crop(tuple(round(v) for v in box)), np.float32) / 255.0
    if kind == "straighten":
        return {"straighten": round(max(-45.0, min(45.0, engine.auto_straighten(arr))), 2)}
    if kind == "upright":
        v, h = engine.auto_upright(arr)
        return {"v": round(v, 3), "h": round(h, 3)}
    if kind == "trim":
        return {"crop": engine.trim_box(arr)}
    raise ValueError("Geçersiz işlem")


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


FILTER_THUMBS = {}
# Galeride etkisi belli olsun diye bazı filtrelerin örnek ayarları güçlendirilir
THUMB_PARAMS = {"radial": {"amount": 30}, "motion": {"d": 90}, "tilt": {"focus": 8, "trans": 12}, "iris": {"rx": 25, "ry": 25}, "shake": {"len": 8}, "lenscor": {"dist": 70, "ca": 60}, "liquify": {"strokes": [{"tool": "cw", "size": 0.7, "rate": 0.9, "pts": [[0.5, 0.5]] * 16}]},
                "lens": {"r": 22}, "smartsharp": {"amount": 300}, "unsharp": {"amount": 300, "r": 4}, "field": {"pins": [[0.15, 0.2, 0], [0.8, 0.85, 45]]}, "wave": {"h": 40, "v": 40}, "ripple": {"amount": 220}, "dustscr": {"r": 8, "thr": 4}, "custom": {"kernel": [0, 0, 0, 0, 0, 0, -2, -1, 0, 0, 0, -1, 1, 1, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0]}}


def filter_thumbs():
    """Filtre galerisi: her filtre aynı örnek görselde, kare önizleme."""
    if not FILTER_THUMBS:
        img = sample_image()
        for kind in filters.SPEC:
            fx = clean_fx({"preset": "b:original", "bw": False, "grain": 0, "vignette": 0, "filters": [{"kind": kind, **THUMB_PARAMS.get(kind, {})}]})
            FILTER_THUMBS[kind] = _data_url(engine.grade(img, CFG, 7, {**fx, "_filter_k": 0.45}, engine.canvas_scale(*img.size) * 2.5))
    return {"thumbs": FILTER_THUMBS}


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
    recipe = {"base": fx["preset"], "amount": fx["amount"], "adjust": fx["adjust"], "bw": fx["bw"], "color": fx["color"]}
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


def _png(img):
    buf = io.BytesIO()
    img.save(buf, "PNG", compress_level=1)
    return buf.getvalue()


def import_psd(name, data):
    """PSD'yi Tonefect belgesine çevirir: Arka Plan ana fotoğraf, diğerleri katman olur."""
    doc = psdfile.read(data)
    W, H = doc["width"], doc["height"]
    layers = doc["layers"]
    warnings = list(doc["warnings"])
    if len(layers) > MAX_LAYERS:
        warnings.append(f"Yalnızca üstteki {MAX_LAYERS} katman açıldı.")
        layers = layers[-MAX_LAYERS:]
    stem = Path(safe_name(name)).stem or "belge"
    first = layers[0] if layers else None
    is_bg = bool(first) and first["left"] == 0 and first["top"] == 0 and first["right"] == W and first["bottom"] == H and first["opaque"] \
        and first["mode"] == "normal" and first["opacity"] > 0.999 and not first["hidden"] and "group" not in first
    hide_base = False
    if not layers:
        base_img = doc["composite"]
    elif is_bg:
        base_img, layers = first["image"].convert("RGB"), layers[1:]
    else:  # Arka Plan'sız belge: tuval şeffaf başlar
        base_img, hide_base = Image.new("RGB", (W, H), (255, 255, 255)), True
    photo = save_photo(f"{stem}.png", _png(base_img))
    out, hidden, ids = [], ["img:base"] if hide_base else [], {}
    for i, ly in enumerate(layers):
        rec = save_photo(f"{stem}_katman{i + 1}.png", _png(ly["image"]))
        lid = uuid.uuid4().hex[:7]
        w, h = ly["right"] - ly["left"], ly["bottom"] - ly["top"]
        c = {"id": lid, "photo": rec["id"], "name": ly["name"][:120] or f"Katman {i + 1}", "x": (ly["left"] + w / 2) / W, "y": (ly["top"] + h / 2) / H, "w": w / W, "ar": h / w,
             "rot": 0, "opacity": round(ly["opacity"], 3), "flipH": False, "cutout": False, "clip": ly["clip"]}
        if ly["mode"] != "normal":
            c["mode"] = ly["mode"]
        if "group" in ly:
            c["group"] = ly["group"]
        if ly["hidden"]:
            hidden.append(f"img:{lid}")
        out.append(c)
    used = {c["group"] for c in out if "group" in c}
    groups = [{"id": g["id"], "name": g["name"], "open": True} for g in doc["groups"] if g["id"] in used]
    hidden += [f"group:{g['id']}" for g in doc["groups"] if g["hidden"] and g["id"] in used]
    return {**photo, "name": name, "layers": out, "groups": groups, "hidden": hidden, "warnings": warnings}


def load_actions():
    try:
        d = json.loads(ACTIONS.read_text(encoding="utf-8"))
        return {"actions": d if isinstance(d, list) else []}
    except (OSError, ValueError):
        return {"actions": []}


def save_actions(d):
    """Eylemler projelerden bağımsızdır; tüm projelerde kullanılır."""
    items = d.get("actions") if isinstance(d, dict) else None
    if not isinstance(items, list) or len(items) > 500:
        raise ValueError("Eylem listesi geçersiz.")
    text = json.dumps(items, ensure_ascii=False)
    if len(text) > 30_000_000:
        raise ValueError("Eylemler çok büyük; uzun fırça kayıtlarını silmeyi dene.")
    tmp = ACTIONS.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(ACTIONS)
    return {"ok": True}


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
                keep.add(Path(str((((it.get("fx") or {}).get("color") or {}).get("match") or {}).get("photo", ""))).name)
                keep.update(Path(str(f.get("photo") or "")).name for f in (it.get("fx") or {}).get("filters") or [] if isinstance(f, dict))
                for st in (it.get("paint") or {}).get("strokes") or []:  # özel fırça uçları
                    for field in ("tip", "stamp"):
                        tip = str((st.get("b") or {}).get(field) or "")
                        if tip.startswith("img:"):
                            keep.add(Path(tip[4:]).name)
            for t in ((data.get("settings") or {}).get("brushes") or {}).get("tips") or []:
                keep.add(Path(str(t.get("photo", ""))).name)
    except Exception:
        return  # bir proje okunamıyorsa hiçbir şeye dokunma
    if not UPLOADS.is_dir():
        return
    try:  # eylemlerin kullandığı görseller (katman, fırça ucu) projelerden bağımsız kalır
        used_by_actions = ACTIONS.read_text(encoding="utf-8") if ACTIONS.is_file() else ""
    except OSError:
        return
    for p in UPLOADS.iterdir():
        if p.is_file() and p.name not in keep and p.name not in used_by_actions:
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


MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "tiff": "image/tiff", "psd": "image/vnd.adobe.photoshop"}


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
                          color=ex["color"], dpi=ex["dpi"], layers=item["layers"], loader=layer_loader(True), text_at=item["textAt"])
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
                slices = item["slices"] if d.get("slices") else None
                result = engine.render_one(CFG, path, item["text"], item["tone"], item["accent"], out,
                                  styles=item["styles"], fx=item["fx"], block=item["block"],
                                  offsets=item["offsets"], geo=item["geo"], wm=WATERMARK,
                                  font=item["font"], textfx=item["textfx"],
                                  fmt=ex["format"], quality=ex["quality"], keep_exif=ex["exif"],
                                  color=ex["color"], dpi=ex["dpi"], layers=item["layers"], loader=layer_loader(True), text_at=item["textAt"], slices=slices)
                if slices:
                    job["files"].extend({"name": p.name, "text": item["text"]} for p in result)
                    job["done"] = i
                    continue
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
            if c == "/api/actions" and m == "GET":
                return self._json(load_actions())
            if c == "/api/actions" and m == "PUT":
                return self._json(save_actions(json.loads(self._body())))
            if c == "/api/watermark" and m == "PUT":
                return self._json(save_watermark(json.loads(self._body())))
            if c == "/api/ai/status" and m == "GET":
                model = ai_model(q.get("model", ["isnet"])[0])
                if model == "lama" and ai.installed(HERE, "lama"):  # panel açılınca model ısınsın: ilk dolgu beklemesin
                    threading.Thread(target=ai.warm, args=(HERE, "lama"), daemon=True).start()
                return self._json(ai.status(HERE, model))
            if c == "/api/ai/install" and m == "POST":
                model = ai_model(json.loads(self._body() or b"{}").get("model"))
                if ai.STATES[model]["state"] != "downloading" and not ai.installed(HERE, model):
                    ai.STATES[model].update(state="downloading", done=0, error="")
                    threading.Thread(target=ai.download, args=(HERE, model), daemon=True).start()
                return self._json(ai.status(HERE, model))
            if c == "/api/mask/view" and m == "POST":
                return self._json(mask_view(json.loads(self._body())))
            if c == "/api/fonts" and m == "GET":
                return self._json(font_list())
            if c == "/api/color/auto" and m == "POST":
                return self._json(color_auto(json.loads(self._body())))
            if c == "/api/auto" and m == "POST":
                return self._json(auto_enhance(json.loads(self._body())))
            if c == "/api/brush/thumb" and m == "POST":
                return self._json(brush_thumb(json.loads(self._body())))
            if c == "/api/layers/autoalign" and m == "POST":
                return self._json(layers_auto_align(json.loads(self._body())))
            if c == "/api/geo/auto" and m == "POST":
                return self._json(geo_auto(json.loads(self._body())))
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
            if c == "/api/layers/from-strokes" and m == "POST":
                return self._json(layer_from_strokes(json.loads(self._body())))
            if c == "/api/photos/psd" and m == "POST":
                return self._json(import_psd(q.get("name", ["belge.psd"])[0], self._body()))
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
            if c == "/api/layers/spec" and m == "GET":
                return self._json({"styles": layerfx.STYLES, "modes": layerfx.MODES})
            if c == "/api/layers/merge" and m == "POST":
                return self._json(layers_merge(json.loads(self._body())))
            if c == "/api/layers/flatten" and m == "POST":
                return self._json(layers_flatten(json.loads(self._body())))
            if c == "/api/filters/spec" and m == "GET":
                return self._json(filters.spec_json())
            if c == "/api/filters/thumbs" and m == "GET":
                return self._json(filter_thumbs())
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
    return UPDATE["state"] in ("downloading", "installing") or ai.downloading() or any(not j.get("finished") for j in JOBS.values())


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

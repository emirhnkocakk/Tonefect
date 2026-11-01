#!/usr/bin/env python3
"""Tonefect - yerel sunucu ve uygulama penceresi.

Arayuz (web/ klasoru, React + shadcn/ui) bu sunucuyla konusur; gorsel uretim render.py motorunu kullanir.
Calistir:  python server.py
"""
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

import looks
import render as engine

HERE = engine.HERE
WEB = HERE / "web"
UPLOADS = HERE / "uploads"
THUMBS = UPLOADS / ".thumbs"
SESSION = HERE / "oturum_web.json"
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
            "masks": clean_masks(fx_in.get("masks"))}


def clean_masks(ms):
    """Yerel düzenlemeler (en fazla 8)."""
    out = []
    pt = lambda v, lo=-0.5, hi=1.5: [num(v[0], lo, hi, 0.5), num(v[1], lo, hi, 0.5)] if isinstance(v, list) and len(v) == 2 else [0.5, 0.5]
    for m in (ms if isinstance(ms, list) else [])[:8]:
        if not isinstance(m, dict) or m.get("type") not in ("linear", "radial"):
            continue
        adj_in = m.get("adjust") if isinstance(m.get("adjust"), dict) else {}
        adj = {k: round(num(adj_in.get(k), -1.0, 1.0), 3) for k in engine.MASK_KEYS}
        c = {"type": m["type"], "invert": bool(m.get("invert")), "adjust": {k: v for k, v in adj.items() if v}}
        if m["type"] == "linear":
            c.update(a=pt(m.get("a")), b=pt(m.get("b")))
        else:
            c.update(c=pt(m.get("c")), r=pt(m.get("r"), 0.01, 2.0), feather=round(num(m.get("feather"), 0.0, 1.0, 0.5), 3))
        if c["adjust"]:
            out.append(c)
    return out


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
    }


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
            "straighten": round(num(g.get("straighten"), -45.0, 45.0), 2), **out}


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
            round(fx["amount"], 2), json.dumps([fx["adjust"], fx["texture"], fx["frame"], fx["masks"]], sort_keys=True))


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
        return BASE[key], size, f
    if geo is None:
        base = engine.grade_base(CFG, get_crop(path), path, fx)
    else:
        target = (max(1, round(size[0] * f)), max(1, round(size[1] * f)))
        img = geo_image(path, geo, target)
        base = engine.grade_base(CFG, img, path, fx, engine.canvas_scale(*size) * f)
    BASE[key] = base
    while len(BASE) > 6:
        BASE.pop(next(iter(BASE)))
    return base, size, f


ORIGINAL_FX = {"preset": "b:original", "bw": False, "grain": 0.0, "vignette": 0.0}


def render_preview(d):
    path = photo_path(d["photo"])
    item = clean_item(d)
    want = max(200, min(engine.MAX_SIDE, int(num(d.get("w"), 200, engine.MAX_SIDE, 640))))
    original = bool(d.get("original"))  # önce/sonra: renk, efekt, yazı ve filigran yok
    if original:
        item["fx"] = clean_fx(ORIGINAL_FX)
    with LOCK:
        base, (cw, ch), f = get_base(path, item["fx"], item["geo"], want)
        k = engine.canvas_scale(cw, ch)
        if original:
            img, layout = base, None
        else:
            img, layout = engine.compose(CFG, base, item["text"], item["tone"], item["accent"],
                                         styles=item["styles"], block=item["block"], offsets=item["offsets"],
                                         k=k * f, wm=clean_wm(d["wm"]) if isinstance(d.get("wm"), dict) else WATERMARK,
                                         font=item["font"], textfx=item["textfx"])
    out_w = max(200, min(want, max(1600, base.width)))
    out_h = max(1, round(out_w * base.height / base.width))
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
    fx = {**clean_fx(d.get("fx") or {}), "grain": 0.0, "vignette": 0.0, "adjust": {}, "texture": {}, "frame": {}, "masks": []}
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
    fx = {**clean_fx(d.get("fx") or {}), "grain": 0.0, "vignette": 0.0, "frame": {}, "masks": []}
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


SAMPLE = WEB / "sample.jpg"  # kütüphanedeki önizlemelerin stok görseli
SAMPLE_THUMBS = {}
THUMB_W = 216


def sample_image():
    tw, th = THUMB_W, round(THUMB_W * H / W)
    try:
        return engine.cover_crop(Image.open(SAMPLE), (tw, th))
    except Exception:  # görsel yoksa yumuşak bir gökyüzü/zemin geçişi
        y = np.linspace(0, 1, th, dtype=np.float32)[:, None, None]
        sky = np.array([0.45, 0.62, 0.85], np.float32) * (1 - y) + np.array([0.9, 0.7, 0.5], np.float32) * y
        a = np.where(y > 0.62, np.array([0.3, 0.42, 0.22], np.float32), sky) * np.ones((1, tw, 1), np.float32)
        return Image.fromarray((a * 255).astype(np.uint8), "RGB")


def preset_thumbs():
    """Her hazır ayarın aynı stok görsel üzerindeki önizlemesi; bir kez hesaplanıp saklanır.
    Vinyet ve parazit kullanıcıya ait olduğundan önizlemelerde yok."""
    todo = [p for p in list(PRESETS.values()) if p["id"] not in SAMPLE_THUMBS]
    if todo:
        img = sample_image()
        for p in todo:
            fx = {"bw": p["bw"], "grain": 0.0, "vignette": 0.0, "look": p["look"], "amount": 1.0}
            if p.get("recipe"):
                r = clean_fx({**p["recipe"], "preset": p["recipe"].get("base"), "grain": 0, "vignette": 0})
                fx = {**r, "grain": 0.0, "vignette": 0.0}
            buf = io.BytesIO()
            engine.grade(img, CFG, 0, fx, engine.canvas_scale(*img.size)).save(buf, "JPEG", quality=82)
            SAMPLE_THUMBS[p["id"]] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    return {"thumbs": {k: SAMPLE_THUMBS[k] for k in PRESETS if k in SAMPLE_THUMBS}}


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


def delete_photo(pid):
    p = UPLOADS / Path(pid).name
    (THUMBS / (p.name + ".jpg")).unlink(missing_ok=True)
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


def prune_uploads():
    """Oturumda artık kullanılmayan yüklemeleri siler.
    Arayüz silinen fotoğrafı geri alınabilsin diye hemen silmez; temizlik açılışta yapılır."""
    try:
        data = json.loads(SESSION.read_text(encoding="utf-8"))
        keep = {Path(str(it.get("id", ""))).name for it in data["items"]}
    except Exception:
        return  # oturum okunamıyorsa hiçbir şeye dokunma
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
        # ShellExecute ile başlat: kurulum bizim işlem ağacımızdan ve kapanışımızdan bağımsız çalışır.
        os.startfile(str(dest), "open", f'/SILENT /NORESTART /CLOSEAPPLICATIONS /LOG="{log}"')
        time.sleep(2)
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
    return {"format": e.get("format") if e.get("format") in engine.EXPORT_FORMATS else "jpg",
            "quality": int(num(e.get("quality"), 50, 100, 95)),
            "naming": "original" if e.get("naming") == "original" else "number",
            "exif": bool(e.get("exif"))}


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
                                  fmt=ex["format"], quality=ex["quality"], keep_exif=ex["exif"])
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
            if c == "/api/fonts" and m == "GET":
                return self._json(font_list())
            if c == "/api/auto" and m == "POST":
                return self._json(auto_enhance(json.loads(self._body())))
            if c == "/api/geo/source" and m == "POST":
                return self._json(geo_source(json.loads(self._body())))
            if c == "/api/signature" and m == "PUT":
                return self._json({"signature": save_signature(json.loads(self._body()).get("text"))})
            if c == "/api/session" and m == "GET":
                return self._json(load_session())
            if c == "/api/session" and m == "PUT":
                save_session(self._body())
                return self._json({"ok": True})
            if c == "/api/photos" and m == "POST":
                return self._json(save_photo(q.get("name", ["foto.jpg"])[0], self._body()))
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
            if c == "/api/presets/save" and m == "POST":
                return self._json(save_preset(json.loads(self._body())))
            if c == "/api/presets/import" and m == "POST":
                return self._json(import_presets(q.get("name", [""])[0], self._body()))
            if c.startswith("/api/presets/") and m == "DELETE":
                delete_preset(c.split("/", 3)[3])
                return self._json(preset_list())
            if c == "/api/preview" and m == "POST":
                return self._json(render_preview(json.loads(self._body())))
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
    return UPDATE["state"] in ("downloading", "installing") or any(not j.get("finished") for j in JOBS.values())


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


def running_instance():
    """Zaten çalışan bir Tonefect varsa adresini döndürür."""
    for p in range(8765, 8795):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{p}/api/ping", timeout=0.4) as r:
                if json.loads(r.read().decode("utf-8")).get("app") == "grainline":
                    return f"http://127.0.0.1:{p}/"
        except Exception:
            continue
    return None


def main():
    global PORT
    if "--no-window" not in sys.argv and "NV_PORT" not in os.environ:
        url = running_instance()
        if url:  # ikinci kopya açma, mevcut olana pencere aç
            open_window(url)
            return
    # eski sürümlerden kalan ayrı tarayıcı profili artık kullanılmıyor
    shutil.rmtree(HERE / ".webprofile", ignore_errors=True)
    prune_uploads()
    threading.Thread(target=engine.font_registry, daemon=True).start()  # yazı tipi taraması önceden
    PORT = free_port(int(os.environ.get("NV_PORT", 8765)))
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    url = f"http://127.0.0.1:{PORT}/"
    print(f"Tonefect çalışıyor: {url}")
    print("Kapatmak için uygulamadaki güç düğmesine bas ya da bu pencereyi kapat.")
    if "--no-window" not in sys.argv:
        threading.Timer(0.6, open_window, args=(url,)).start()
    threading.Thread(target=watchdog, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

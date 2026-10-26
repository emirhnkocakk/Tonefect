"""Grainline - hazir renk ayarlari (preset) motoru.

Bir "look" sozlugu fotografa uygulanacak renk islemlerini tarif eder (hepsi istege bagli,
varsayilan etkisiz). Degerler -1..1 araligindadir (pozlama stop cinsindendir):

  exposure, temperature, tint, highlights, shadows, whites, blacks, contrast,
  saturation, vibrance, fade (0..1), bw (bool),
  shadow_tint / mid_tint / highlight_tint: [renk tonu (derece), doygunluk 0..1],
  hsl: {"Orange": [doygunluk, parlaklik], ...},
  curves: {"rgb" | "prm" | "r" | "g" | "b": [[x, y], ...] (0..1)},
  lut_data: 3B LUT dizisi (N, N, N, 3), .cube iceri aktarimindan

Lightroom (.xmp, .lrtemplate, .dng) ve LUT (.cube) dosyalari bu bicime cevrilir.
"""
import colorsys
import io
import json
import re
import uuid
import zipfile
from pathlib import Path

import numpy as np

LUMA = np.array([0.299, 0.587, 0.114], dtype=np.float32)
HUE_BANDS = {"Red": 0, "Orange": 30, "Yellow": 60, "Green": 120,
             "Aqua": 180, "Blue": 240, "Purple": 270, "Magenta": 300}
ADJUST_KEYS = ("exposure", "contrast", "temperature", "saturation")
USER_GROUP = "Kendi ayarların"


# ------------------------------------------------------------------ islemler
def _smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _lum(a):
    return a @ LUMA


def _hue_vec(deg):
    rgb = np.array(colorsys.hsv_to_rgb((deg % 360) / 360.0, 1.0, 1.0), dtype=np.float32)
    return rgb - rgb.mean()


def _hue(a):
    mx, mn = a.max(-1), a.min(-1)
    c = mx - mn
    cc = np.where(c == 0, 1.0, c)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.where(mx == r, ((g - b) / cc) % 6, np.where(mx == g, (b - r) / cc + 2, (r - g) / cc + 4))
    return h * 60.0, c


def apply_lut(a, lut):
    """3B LUT'u trilineer aradegerleme ile uygular. lut[b, g, r] = (R, G, B)."""
    n = lut.shape[0]
    x = np.clip(a, 0.0, 1.0) * (n - 1)
    i0 = np.floor(x).astype(np.int32)
    i1 = np.minimum(i0 + 1, n - 1)
    f = x - i0
    r0, g0, b0 = i0[..., 0], i0[..., 1], i0[..., 2]
    r1, g1, b1 = i1[..., 0], i1[..., 1], i1[..., 2]
    fr, fg, fb = f[..., 0:1], f[..., 1:2], f[..., 2:3]
    c00 = lut[b0, g0, r0] * (1 - fr) + lut[b0, g0, r1] * fr
    c01 = lut[b0, g1, r0] * (1 - fr) + lut[b0, g1, r1] * fr
    c10 = lut[b1, g0, r0] * (1 - fr) + lut[b1, g0, r1] * fr
    c11 = lut[b1, g1, r0] * (1 - fr) + lut[b1, g1, r1] * fr
    c0 = c00 * (1 - fg) + c01 * fg
    c1 = c10 * (1 - fg) + c11 * fg
    return (c0 * (1 - fb) + c1 * fb).astype(np.float32)


def _curve(ch, pts):
    xs, ys = zip(*pts)
    return np.interp(ch, xs, ys).astype(np.float32)


def apply(arr, look):
    """arr: (H, W, 3) float32, 0..1. Yeni dizi dondurur."""
    if not look:
        return arr
    v = lambda k: float(look.get(k) or 0.0)
    a = arr
    if look.get("lut_data") is not None:
        a = apply_lut(a, look["lut_data"])

    if v("exposure"):
        a = a * np.float32(2.0 ** v("exposure"))
    t, ti = v("temperature"), v("tint")
    if t or ti:
        a = a * np.array([1 + 0.10 * t + 0.03 * ti, 1 - 0.08 * ti, 1 - 0.12 * t + 0.03 * ti], np.float32)

    if any(v(k) for k in ("highlights", "shadows", "whites", "blacks")):
        L = _lum(np.clip(a, 0, 1))
        if v("highlights"):
            a = a * (1 + 0.35 * v("highlights") * _smooth(0.45, 1.0, L))[..., None]
        if v("shadows"):
            m = (1 - _smooth(0.0, 0.55, L)) * 0.22 * v("shadows")
            a = a + m[..., None] * (a + 0.08) / (L[..., None] + 0.08)
        if v("whites"):
            a = a + (0.15 * v("whites") * _smooth(0.6, 1.0, L))[..., None]
        if v("blacks"):
            a = a + (0.12 * v("blacks") * (1 - _smooth(0.0, 0.35, L)))[..., None]

    c = v("contrast")
    if c > 0:
        a = np.clip(a, 0, 1)
        a = a + (a * a * (3 - 2 * a) - a) * min(c, 1.0) * 1.3
    elif c < 0:
        a = 0.5 + (a - 0.5) * (1 + 0.6 * c)

    curves = look.get("curves") or {}
    for key in ("prm", "rgb"):
        if curves.get(key):
            a = _curve(np.clip(a, 0, 1), curves[key])
    for i, key in enumerate("rgb"):
        if curves.get(key):
            a = a.copy() if a is arr else a
            a[..., i] = _curve(np.clip(a[..., i], 0, 1), curves[key])

    hsl = look.get("hsl") or {}
    if any(s or l for s, l in hsl.values()):
        a = np.clip(a, 0, 1)
        h, ch = _hue(a)
        S = np.zeros(h.shape, np.float32)
        Lm = np.zeros(h.shape, np.float32)
        for band, (s, l) in hsl.items():
            if band not in HUE_BANDS or not (s or l):
                continue
            d = np.abs(((h - HUE_BANDS[band] + 180) % 360) - 180)
            w = np.clip(1 - d / 40.0, 0, 1)
            S += w * s
            Lm += w * l
        L = _lum(a)[..., None]
        a = L + (a - L) * (1 + S)[..., None]
        a = a + (Lm * 0.25 * np.clip(ch * 3, 0, 1))[..., None]

    sat, vib = v("saturation"), v("vibrance")
    if sat or vib:
        L = _lum(a)[..., None]
        f = np.float32(1 + sat)
        if vib:
            chroma = np.clip(a, 0, 1).max(-1, keepdims=True) - np.clip(a, 0, 1).min(-1, keepdims=True)
            f = f + vib * (1 - np.clip(chroma * 1.5, 0, 1))
        a = L + (a - L) * f

    tints = [(k, look.get(k)) for k in ("shadow_tint", "mid_tint", "highlight_tint")]
    if any(tv and tv[1] for _, tv in tints):
        L = _lum(np.clip(a, 0, 1))
        masks = {"shadow_tint": 1 - _smooth(0.0, 0.6, L),
                 "mid_tint": np.clip(1 - np.abs(L - 0.5) * 2, 0, 1),
                 "highlight_tint": _smooth(0.4, 1.0, L)}
        for k, tv in tints:
            if tv and tv[1]:
                a = a + masks[k][..., None] * _hue_vec(tv[0]) * (0.25 * tv[1])

    if look.get("bw"):
        a = np.repeat(_lum(a)[..., None], 3, axis=-1)

    if v("fade"):
        f = 0.25 * v("fade")
        a = np.clip(a, 0, 1) * (1 - f) + f

    return np.clip(a, 0, 1).astype(np.float32)


def adjust_look(adj):
    """Kullanicinin ince ayar kaydiricilari -> look (hazir ayarin ustune uygulanir)."""
    return {k: adj[k] for k in ADJUST_KEYS if adj.get(k)} if adj else {}


# ------------------------------------------------------------ hazir ayarlar
def _p(id_, name, group, look, grain=0.0, vignette=0.0):
    return {"id": "b:" + id_, "name": name, "group": group, "look": look,
            "bw": bool(look.get("bw")), "grain": grain, "vignette": vignette}


# "bw": arayuzdeki siyah-beyaz anahtarini da acar; renkli ayarlarda kapali olmali.
BUILTIN = [
    _p("original", "Orijinal", "Doğal", {}, 0.0, 0.0),
    _p("natural", "Doğal canlı", "Doğal",
       {"vibrance": 0.3, "contrast": 0.12, "shadows": 0.15, "highlights": -0.15}),
    _p("airy", "Aydınlık ferah", "Doğal",
       {"exposure": 0.3, "contrast": -0.2, "shadows": 0.3, "highlights": -0.3, "saturation": -0.1,
        "temperature": 0.05, "fade": 0.08}),
    _p("portrait", "Sıcak portre", "Doğal",
       {"temperature": 0.15, "tint": 0.05, "vibrance": 0.1, "saturation": -0.05, "highlights": -0.2,
        "hsl": {"Orange": [-0.05, 0.15], "Red": [-0.1, 0.05]}}, 0.2, 0.2),
    _p("pastel", "Pastel", "Doğal",
       {"exposure": 0.2, "contrast": -0.25, "saturation": -0.3, "fade": 0.25,
        "highlight_tint": [330, 0.15], "shadow_tint": [200, 0.12]}, 0.2, 0.0),

    _p("teal_orange", "Teal & Orange", "Sinematik",
       {"contrast": 0.25, "highlights": -0.2, "shadows": 0.1, "vibrance": 0.15,
        "shadow_tint": [190, 0.45], "highlight_tint": [32, 0.35],
        "hsl": {"Orange": [0.15, 0.05], "Blue": [0.1, -0.1], "Aqua": [0.15, 0], "Green": [-0.4, 0]}},
       0.4, 0.6),
    _p("moody", "Karanlık sinema", "Sinematik",
       {"exposure": -0.3, "contrast": 0.25, "highlights": -0.3, "saturation": -0.35, "temperature": -0.1,
        "shadow_tint": [210, 0.3], "fade": 0.08}, 0.7, 1.0),
    _p("bleach", "Bleach bypass", "Sinematik",
       {"saturation": -0.6, "contrast": 0.5, "whites": 0.2, "blacks": -0.25}, 0.5, 0.5),
    _p("golden", "Altın saat", "Sinematik",
       {"temperature": 0.35, "tint": 0.05, "exposure": 0.1, "highlights": -0.15, "shadows": 0.2,
        "vibrance": 0.25, "highlight_tint": [40, 0.3]}, 0.3, 0.3),
    _p("night_blue", "Soğuk mavi", "Sinematik",
       {"temperature": -0.4, "saturation": -0.15, "contrast": 0.18, "shadow_tint": [220, 0.35]},
       0.4, 0.5),

    _p("warm_film", "Sıcak film", "Film",
       {"fade": 0.12, "contrast": -0.05, "temperature": 0.15, "saturation": -0.1, "vibrance": 0.1,
        "shadow_tint": [200, 0.12], "highlight_tint": [32, 0.18],
        "curves": {"rgb": [[0, 0.04], [0.25, 0.23], [0.75, 0.78], [1, 0.97]]}}, 0.8, 0.3),
    _p("cool_film", "Soğuk film", "Film",
       {"temperature": -0.1, "tint": -0.05, "contrast": 0.1, "saturation": -0.05,
        "shadow_tint": [170, 0.22], "highlight_tint": [50, 0.1],
        "hsl": {"Green": [-0.15, -0.05], "Blue": [-0.1, 0]}}, 0.8, 0.3),
    _p("matte", "Mat & soluk", "Film",
       {"fade": 0.32, "contrast": -0.15, "saturation": -0.2, "highlights": -0.1}, 0.5, 0.2),
    _p("vintage", "Vintage 70'ler", "Film",
       {"fade": 0.2, "temperature": 0.3, "tint": 0.05, "saturation": -0.25,
        "shadow_tint": [30, 0.2], "highlight_tint": [50, 0.2],
        "curves": {"b": [[0, 0.08], [1, 0.9]]}}, 1.0, 0.8),
    _p("cross", "Cross process", "Film",
       {"saturation": 0.15, "contrast": 0.15,
        "curves": {"r": [[0, 0], [0.25, 0.18], [0.75, 0.85], [1, 1]],
                   "g": [[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]],
                   "b": [[0, 0.12], [0.5, 0.5], [1, 0.85]]}}, 0.5, 0.4),

    _p("bw_soft", "Yumuşak S/B", "Siyah-beyaz",
       {"bw": True, "contrast": -0.05, "fade": 0.1}, 0.6, 0.3),
    _p("bw_noir", "Noir", "Siyah-beyaz",
       {"bw": True, "contrast": 0.55, "blacks": -0.3, "highlights": -0.1}, 0.9, 1.0),
    _p("bw_silver", "Gümüş", "Siyah-beyaz",
       {"bw": True, "contrast": 0.2, "whites": 0.25, "shadows": 0.2}, 0.3, 0.2),
]
GROUPS = ["Doğal", "Sinematik", "Film", "Siyah-beyaz", USER_GROUP]
# Uygulamanin ilk (eski) gorunumu: render.grade'in klasik yolu, look yok.
CLASSIC = {"id": "", "name": "Grainline klasik", "group": "Sinematik", "look": None,
           "bw": True, "grain": 1.0, "vignette": 1.0}


def meta(p):
    return {k: p[k] for k in ("id", "name", "group", "bw", "grain", "vignette")} | {"user": p["id"].startswith("u:")}


def load_all(user_dir):
    """id -> preset; once klasik ve yerlesik ayarlar, sonra kullanicinin iceri aktardiklari."""
    out = {CLASSIC["id"]: CLASSIC}
    for p in BUILTIN:
        out[p["id"]] = p
    if user_dir.is_dir():
        for f in sorted(user_dir.glob("*.json"), key=lambda f: f.stat().st_mtime):
            try:
                p = json.loads(f.read_text(encoding="utf-8"))
                if p.get("lut"):
                    p["look"]["lut_data"] = np.load(user_dir / Path(p["lut"]).name)
                out[p["id"]] = p
            except Exception:
                continue
    return out


def delete_user(user_dir, pid):
    if not pid.startswith("u:"):
        raise ValueError("Yerleşik ayarlar silinemez")
    stem = pid[2:]
    if not re.fullmatch(r"[0-9a-f]{10}", stem):
        raise ValueError("Geçersiz ayar")
    for f in (user_dir / f"{stem}.json", user_dir / f"{stem}.npy"):
        f.unlink(missing_ok=True)


# ------------------------------------------------------------ iceri aktarma
LR_UNSUPPORTED = {
    "Clarity2012": "Netlik (Clarity)", "Clarity": "Netlik (Clarity)", "Dehaze": "Pus giderme (Dehaze)",
    "Texture": "Doku (Texture)", "Sharpness": "Keskinlik", "LuminanceSmoothing": "Gürültü azaltma",
}


def _num(vals, *keys, default=None):
    for k in keys:
        if k in vals:
            try:
                return float(str(vals[k]).replace("+", ""))
            except ValueError:
                pass
    return default


def _pts(nums):
    nums = [float(n) for n in nums]
    pts = sorted({round(nums[i] / 255, 4): nums[i + 1] / 255 for i in range(0, len(nums) - 1, 2)}.items())
    if len(pts) < 2 or all(abs(x - y) < 1e-3 for x, y in pts):
        return None
    return [[x, round(y, 4)] for x, y in pts]


def lr_to_preset(vals, curves, name):
    """Lightroom/Camera Raw ayar anahtarlari -> (preset, yok sayilan ayarlar)."""
    look, ignored = {}, set()
    one = lambda *k: (_num(vals, *k, default=0.0) or 0.0) / 100.0
    look["exposure"] = max(-3.0, min(3.0, _num(vals, "Exposure2012", "Exposure", default=0.0)))
    look["contrast"] = one("Contrast2012", "Contrast")
    look["highlights"] = one("Highlights2012", "HighlightRecovery")
    look["shadows"] = one("Shadows2012", "Shadows")
    look["whites"] = one("Whites2012")
    look["blacks"] = one("Blacks2012")
    look["saturation"] = one("Saturation")
    look["vibrance"] = one("Vibrance")
    if "IncrementalTemperature" in vals:
        look["temperature"] = one("IncrementalTemperature")
    elif "Temperature" in vals:
        look["temperature"] = max(-1.0, min(1.0, (_num(vals, "Temperature", default=5500) - 5500) / 4000))
    look["tint"] = max(-1.0, min(1.0, one("IncrementalTint", "Tint")))
    if str(vals.get("ConvertToGrayscale", "")).lower() == "true":
        look["bw"] = True

    for key, lr in (("shadow_tint", "Shadow"), ("mid_tint", "Midtone"), ("highlight_tint", "Highlight")):
        hue = _num(vals, f"ColorGrade{lr}Hue", f"SplitToning{lr}Hue", default=0.0)
        sat = _num(vals, f"ColorGrade{lr}Sat", f"SplitToning{lr}Saturation", default=0.0)
        if sat:
            look[key] = [hue, sat / 100.0]

    hsl = {}
    for band in HUE_BANDS:
        s, l = one(f"SaturationAdjustment{band}"), one(f"LuminanceAdjustment{band}")
        if s or l:
            hsl[band] = [s, l]
        if _num(vals, f"HueAdjustment{band}", default=0.0):
            ignored.add("HSL renk tonu kaydırma")
    if hsl:
        look["hsl"] = hsl

    cv = {}
    for lr_key, key in (("ToneCurvePV2012", "rgb"), ("ToneCurvePV2012Red", "r"),
                        ("ToneCurvePV2012Green", "g"), ("ToneCurvePV2012Blue", "b")):
        if curves.get(lr_key):
            pts = _pts(curves[lr_key])
            if pts:
                cv[key] = pts
    prm = [one(f"Parametric{k}") for k in ("Shadows", "Darks", "Lights", "Highlights")]
    if any(prm):
        s1 = (_num(vals, "ParametricShadowSplit", default=25)) / 100
        s2 = (_num(vals, "ParametricMidtoneSplit", default=50)) / 100
        s3 = (_num(vals, "ParametricHighlightSplit", default=75)) / 100
        xs = [s1 / 2, (s1 + s2) / 2, (s2 + s3) / 2, (s3 + 1) / 2]
        cv["prm"] = [[0, 0]] + [[x, min(1, max(0, x + d * 0.12))] for x, d in zip(xs, prm)] + [[1, 1]]
    if cv:
        look["curves"] = cv

    for k, label in LR_UNSUPPORTED.items():
        if _num(vals, k, default=0.0):
            ignored.add(label)
    look = {k: v for k, v in look.items() if v}

    grain = max(0.0, min(1.0, (_num(vals, "GrainAmount", default=0.0)) / 25))
    vig = _num(vals, "PostCropVignetteAmount", "VignetteAmount", default=0.0)
    vignette = max(0.0, min(1.0, -vig / 60)) if vig < 0 else 0.0
    return {"name": name, "look": look, "bw": bool(look.get("bw")), "grain": round(grain, 2),
            "vignette": round(vignette, 2)}, sorted(ignored)


def parse_xmp(text, fallback):
    vals = dict(re.findall(r'crs:(\w+)="([^"]*)"', text))
    vals.update(dict(re.findall(r"<crs:(\w+)>([^<]*)</crs:\1>", text)))
    curves = {m.group(1): re.findall(r"([\d.]+)\s*,\s*([\d.]+)", m.group(2))
              for m in re.finditer(r"<crs:(ToneCurvePV2012(?:Red|Green|Blue)?)>(.*?)</crs:\1>", text, re.S)}
    curves = {k: [n for pair in v for n in pair] for k, v in curves.items()}
    if not any(k.endswith("2012") or k in ("Saturation", "Vibrance", "ConvertToGrayscale") for k in vals):
        raise ValueError("Lightroom ayarı bulunamadı")
    m = re.search(r"<crs:Name>.*?<rdf:li[^>]*>([^<]+)</rdf:li>", text, re.S)
    return lr_to_preset(vals, curves, (m.group(1).strip() if m else "") or fallback)


def parse_lrtemplate(text, fallback):
    body = text.split("settings", 1)[1] if "settings" in text else text
    vals = {k: v for k, v in re.findall(r"\b(\w+)\s*=\s*(-?[\d.]+|true|false)\b", body)}
    curves = {k: re.findall(r"-?[\d.]+", v) for k, v in
              re.findall(r"\b(ToneCurvePV2012(?:Red|Green|Blue)?)\s*=\s*\{([^}]*)\}", body)}
    if not vals:
        raise ValueError("Lightroom ayarı bulunamadı")
    m = re.search(r'internalName\s*=\s*"([^"]+)"', text)
    return lr_to_preset(vals, curves, (m.group(1) if m else "") or fallback)


def parse_dng(data, fallback):
    """Lightroom mobil hazir ayarlari .dng olarak paylasilir; ayarlar gomulu XMP'dedir."""
    s, e = data.find(b"<x:xmpmeta"), data.find(b"</x:xmpmeta>")
    if s < 0 or e < 0:
        raise ValueError("DNG içinde Lightroom ayarı yok")
    return parse_xmp(data[s:e].decode("utf-8", "replace"), fallback)


def parse_cube(text, fallback):
    size, dmin, dmax, vals, title = None, [0.0] * 3, [1.0] * 3, [], ""
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        head = s.split(None, 1)[0].upper()
        if head == "TITLE":
            title = s.split(None, 1)[1].strip().strip('"') if " " in s else ""
        elif head == "LUT_3D_SIZE":
            size = int(s.split()[1])
        elif head == "LUT_1D_SIZE":
            raise ValueError("1B LUT desteklenmiyor (3B .cube gerekli)")
        elif head == "DOMAIN_MIN":
            dmin = [float(x) for x in s.split()[1:4]]
        elif head == "DOMAIN_MAX":
            dmax = [float(x) for x in s.split()[1:4]]
        elif head[0].isdigit() or head[0] in "-.":
            vals.append(s.split()[:3])
    if not size or not 2 <= size <= 129 or len(vals) != size ** 3:
        raise ValueError("Geçersiz .cube dosyası")
    lut = np.array(vals, dtype=np.float32).reshape(size, size, size, 3)
    lo, hi = np.array(dmin, np.float32), np.array(dmax, np.float32)
    lut = np.clip((lut - lo) / np.maximum(hi - lo, 1e-6), 0, 1)
    return {"name": title or fallback, "look": {}, "bw": False, "grain": 0.0, "vignette": 0.0, "_lut": lut}, []


PARSERS = {".xmp": "xmp", ".lrtemplate": "lrt", ".dng": "dng", ".cube": "cube"}
IMPORT_EXT = set(PARSERS) | {".zip"}


def _parse_one(name, data):
    ext, stem = Path(name).suffix.lower(), Path(name).stem[:60]
    kind = PARSERS.get(ext)
    if kind == "dng":
        return parse_dng(data, stem)
    text = data.decode("utf-8-sig", "replace")
    if kind == "xmp":
        return parse_xmp(text, stem)
    if kind == "lrt":
        return parse_lrtemplate(text, stem)
    if kind == "cube":
        return parse_cube(text, stem)
    raise ValueError(f"Desteklenmeyen dosya: {ext or name}")


def _save(user_dir, preset):
    user_dir.mkdir(parents=True, exist_ok=True)
    stem = uuid.uuid4().hex[:10]
    preset = {"id": "u:" + stem, "group": USER_GROUP, **preset}
    preset["name"] = str(preset["name"]).strip()[:60] or "Ayar"
    lut = preset.pop("_lut", None)
    if lut is not None:
        np.save(user_dir / f"{stem}.npy", lut)
        preset["lut"] = f"{stem}.npy"
    (user_dir / f"{stem}.json").write_text(json.dumps(preset, ensure_ascii=False), encoding="utf-8")
    return preset


def import_file(user_dir, name, data):
    """Bir dosyayi (ya da icindeki hazir ayarlarla bir .zip'i) iceri aktarir.
    (kaydedilen ayarlar, uyarilar) dondurur."""
    files = []
    if Path(name).suffix.lower() == ".zip":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                n = info.filename
                if info.is_dir() or "__MACOSX" in n or Path(n).name.startswith("."):
                    continue
                if Path(n).suffix.lower() in PARSERS and info.file_size < 40 * 1024 * 1024:
                    files.append((Path(n).name, z.read(info)))
        if not files:
            raise ValueError("Zip içinde hazır ayar bulunamadı (.xmp, .lrtemplate, .dng, .cube)")
        files = files[:200]
    else:
        files = [(name, data)]

    saved, warns = [], []
    for n, d in files:
        try:
            preset, ignored = _parse_one(n, d)
            saved.append(_save(user_dir, preset))
            if ignored:
                warns.append(f"{preset['name']}: yok sayıldı – {', '.join(ignored)}")
        except Exception as e:
            if len(files) == 1:
                raise ValueError(str(e))
            warns.append(f"{n}: {e}")
    return saved, warns

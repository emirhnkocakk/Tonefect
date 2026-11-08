"""Tonefect - katman turleri, karisim kipleri ve katman stilleri.

Katman turleri: yazi, sekil, dolgu ve bos (boyanabilir) katman dosya degil ayar olarak saklanir, her cozunurlukte
yeniden cizilir. Stiller alfa kanalindan uretilir; boyutlar kisa kenari 1000 piksel olan tuvale goredir.
"""
import math

import numpy as np
from PIL import Image, ImageDraw

import filters

GENERATED = ("text", "shape", "fill", "blank")
N, C, S = filters.N, filters.C, filters.S
MODES = ("normal", "dissolve", "darken", "multiply", "colorburn", "linearburn", "darkercolor", "lighten", "screen", "colordodge", "lineardodge", "lightercolor",
         "overlay", "softlight", "hardlight", "vividlight", "linearlight", "pinlight", "hardmix", "difference", "exclusion", "subtract", "divide", "hue", "saturation", "color", "luminosity")
PATTERNS = ("dots", "stripes", "checker", "hatch")
_PAT = S("kind", "Desen", "dots", ("dots", "Nokta"), ("stripes", "Çizgi"), ("checker", "Dama"), ("hatch", "Tarama"))
STYLES = {
    "shadow": [C("color", "Renk", "#000000"), N("opacity", "Opaklık", 0, 100, 60), N("angle", "Açı", -180, 180, 120), N("dist", "Uzaklık", 0, 200, 12), N("size", "Boyut", 0, 150, 14), N("spread", "Yayılma", 0, 100, 0)],
    "inner": [C("color", "Renk", "#000000"), N("opacity", "Opaklık", 0, 100, 60), N("angle", "Açı", -180, 180, 120), N("dist", "Uzaklık", 0, 200, 8), N("size", "Boyut", 0, 150, 12)],
    "glow": [C("color", "Renk", "#FFE9A8"), N("opacity", "Opaklık", 0, 100, 75), N("size", "Boyut", 0, 150, 24), N("spread", "Yayılma", 0, 100, 15)],
    "iglow": [C("color", "Renk", "#FFE9A8"), N("opacity", "Opaklık", 0, 100, 75), N("size", "Boyut", 0, 150, 18), S("src", "Kaynak", "edge", ("edge", "Kenar"), ("center", "Merkez"))],
    "bevel": [S("style", "Stil", "inner", ("inner", "İç Eğim"), ("emboss", "Kabartma"), ("pillow", "Yastık")), N("depth", "Derinlik", 1, 300, 100), N("size", "Boyut", 1, 100, 8), N("angle", "Açı", -180, 180, 120), C("hi", "Parlak Renk", "#FFFFFF"), N("hiop", "Parlak Opaklık", 0, 100, 75), C("sh", "Gölge Rengi", "#000000"), N("shop", "Gölge Opaklık", 0, 100, 75)],
    "satin": [C("color", "Renk", "#000000"), N("opacity", "Opaklık", 0, 100, 45), N("angle", "Açı", -180, 180, 20), N("dist", "Uzaklık", 1, 200, 12), N("size", "Boyut", 1, 150, 16)],
    "color": [C("color", "Renk", "#E0314A"), N("opacity", "Opaklık", 0, 100, 100)],
    "gradient": [C("a", "Renk 1", "#14102E"), C("b", "Renk 2", "#FFE9A8"), N("angle", "Açı", -180, 180, 90), N("opacity", "Opaklık", 0, 100, 100)],
    "pattern": [_PAT, C("a", "Renk 1", "#000000"), C("b", "Renk 2", "#FFFFFF"), N("scale", "Ölçek", 2, 200, 24), N("opacity", "Opaklık", 0, 100, 100)],
    "stroke": [C("color", "Renk", "#FFFFFF"), N("size", "Boyut", 1, 80, 6), S("pos", "Konum", "out", ("out", "Dışa"), ("center", "Ortaya"), ("in", "İçe")), N("opacity", "Opaklık", 0, 100, 100)],
}


def clean_styles(raw):
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, spec in STYLES.items():
        d = raw.get(key)
        if isinstance(d, dict) and d.get("on"):
            r = {}
            for q in spec:
                v = d.get(q["k"])
                if q["t"] == "n":
                    r[q["k"]] = filters._num(v, q["min"], q["max"], q["def"])
                elif q["t"] == "sel":
                    r[q["k"]] = v if v in [o[0] for o in q["opts"]] else q["def"]
                else:
                    r[q["k"]] = _color(v, q["def"])
            out[key] = r
    return out


def _color(v, d):
    return v.upper() if isinstance(v, str) and len(v) == 7 and v[0] == "#" and all(c in "0123456789abcdefABCDEF" for c in v[1:]) else d


def _rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0


def _pattern(kind, w, h, cell):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    p = max(3.0, cell)
    if kind == "dots":
        m = np.hypot((x % p) - p / 2, (y % p) - p / 2) < p * 0.3
    elif kind == "stripes":
        m = ((x + y) % p) < p * 0.5
    elif kind == "checker":
        m = ((x // p + y // p) % 2) == 0
    else:
        m = (((x + y) % p) < p * 0.18) | (((x - y) % p) < p * 0.18)
    return m.astype(np.float32)


def _ramp(w, h, angle):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    a = math.radians(angle)
    c, s = math.cos(a), math.sin(a)
    t = (x - w / 2) * c - (y - h / 2) * s
    span = max(abs(w * c) + abs(h * s), 1.0)
    return np.clip(t / span + 0.5, 0, 1)


def make(ly, w, h, font_fn):
    """Uretilen katmanin RGBA gorseli (w x h)."""
    kind = ly["kind"]
    if kind == "blank":
        return Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if kind == "fill":
        f = ly.get("fillDef") or {}
        ft = f.get("type", "color")
        c1, c2 = _rgb(f.get("color", "#808080")), _rgb(f.get("color2", "#FFFFFF"))
        if ft == "gradient":
            t = _ramp(w, h, float(f.get("angle", 90)))[..., None]
            a = c1 * (1 - t) + c2 * t
        elif ft == "pattern":
            m = _pattern(f.get("pattern", "dots"), w, h, float(f.get("scale", 0.03)) * min(w, h))[..., None]
            a = c1 * m + c2 * (1 - m)
        else:
            a = np.broadcast_to(c1, (h, w, 3))
        rgba = np.dstack([np.clip(a, 0, 1), np.ones((h, w), np.float32)])
        return Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA")
    if kind == "shape":
        return _shape(ly.get("shapeDef") or {}, w, h)
    return _text(ly.get("textDef") or {}, w, h, font_fn)


def _shape(s, w, h):
    q = 3  # kenar yumusatma icin buyuk cizilip kucultulur
    W, H = min(w * q, 9000), min(h * q, 9000)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    fill = tuple(int(v) for v in _rgb(s.get("color", "#E0314A")) * 255) + (255,)
    sw = int(float(s.get("strokeW", 0)) * min(W, H))
    out = (tuple(int(v) for v in _rgb(s.get("stroke", "#FFFFFF")) * 255) + (255,)) if sw else None
    p = sw // 2 + 1
    kw = {"fill": fill, "outline": out, "width": sw}
    t = s.get("type", "rect")
    if t == "ellipse":
        d.ellipse([p, p, W - p, H - p], **kw)
    elif t == "rect":
        d.rounded_rectangle([p, p, W - p, H - p], radius=int(float(s.get("radius", 0)) * min(W, H) / 2), **kw)
    else:
        cx, cy, rx, ry = W / 2, H / 2, W / 2 - p, H / 2 - p
        if t == "star":
            pts = [(cx + (rx if i % 2 == 0 else rx * 0.42) * math.sin(i * math.pi / 5), cy - (ry if i % 2 == 0 else ry * 0.42) * math.cos(i * math.pi / 5)) for i in range(10)]
        elif t == "triangle":
            pts = [(cx, p), (W - p, H - p), (p, H - p)]
        else:  # altigen
            pts = [(cx + rx * math.cos(i * math.pi / 3), cy + ry * math.sin(i * math.pi / 3)) for i in range(6)]
        d.polygon(pts, fill=fill)
        if sw:
            d.line(pts + pts[:1], fill=out, width=sw, joint="curve")
    return im.resize((w, h), Image.LANCZOS)


def _text(t, w, h, font_fn):
    text = str(t.get("value") or "Metin")
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lo, hi, best = 4, max(8, h * 2), 4

    def box(sz):
        return d.multiline_textbbox((0, 0), text, font=font_fn(t.get("family"), sz, t.get("bold")), spacing=int(sz * 0.2), align=t.get("align", "center"))

    while lo <= hi:  # kutuya sigan en buyuk yazi boyutu
        mid = (lo + hi) // 2
        b = box(mid)
        if b[2] - b[0] <= w and b[3] - b[1] <= h:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    font = font_fn(t.get("family"), best, t.get("bold"))
    b = box(best)
    x = {"left": -b[0], "right": w - b[2]}.get(t.get("align", "center"), (w - (b[2] + b[0])) / 2)
    d.multiline_text((x, (h - (b[3] + b[1])) / 2), text, font=font, fill=tuple(int(v) for v in _rgb(t.get("color", "#FFFFFF")) * 255) + (255,), spacing=int(best * 0.2), align=t.get("align", "center"))
    return im


# ------------------------------------------------------------------ karisim
def _lum(c):
    return c @ np.array([0.3, 0.59, 0.11], np.float32)


def _clip_color(c):
    L = _lum(c)[..., None]
    n, x = c.min(-1, keepdims=True), c.max(-1, keepdims=True)
    c = np.where(n < 0, L + (c - L) * L / np.maximum(L - n, 1e-6), c)
    return np.where(x > 1, L + (c - L) * (1 - L) / np.maximum(x - L, 1e-6), c)


def _set_lum(c, L):
    return _clip_color(c + (L - _lum(c))[..., None])


def _sat(c):
    return c.max(-1) - c.min(-1)


def _set_sat(c, s):
    mx, mn = c.max(-1, keepdims=True), c.min(-1, keepdims=True)
    return (c - mn) * s[..., None] / np.maximum(mx - mn, 1e-6)


def blend_fn(mode, b, s):
    """b: alttaki, s: katman (0..1)."""
    e = 1e-4
    if mode == "darken":
        return np.minimum(b, s)
    if mode == "multiply":
        return b * s
    if mode == "colorburn":
        return np.where(b >= 1 - e, 1.0, np.where(s <= e, 0.0, 1 - np.minimum(1, (1 - b) / np.maximum(s, e))))
    if mode == "linearburn":
        return np.maximum(b + s - 1, 0)
    if mode == "darkercolor":
        return np.where((_lum(s) < _lum(b))[..., None], s, b)
    if mode == "lighten":
        return np.maximum(b, s)
    if mode == "screen":
        return 1 - (1 - b) * (1 - s)
    if mode == "colordodge":
        return np.where(b <= e, 0.0, np.where(s >= 1 - e, 1.0, np.minimum(1, b / np.maximum(1 - s, e))))
    if mode == "lineardodge":
        return np.minimum(b + s, 1)
    if mode == "lightercolor":
        return np.where((_lum(s) > _lum(b))[..., None], s, b)
    if mode == "overlay":
        return np.where(b <= 0.5, 2 * b * s, 1 - 2 * (1 - b) * (1 - s))
    if mode == "hardlight":
        return np.where(s <= 0.5, 2 * b * s, 1 - 2 * (1 - b) * (1 - s))
    if mode == "softlight":
        d = np.where(b <= 0.25, ((16 * b - 12) * b + 4) * b, np.sqrt(np.maximum(b, 0)))
        return np.where(s <= 0.5, b - (1 - 2 * s) * b * (1 - b), b + (2 * s - 1) * (d - b))
    if mode == "vividlight":
        return np.where(s <= 0.5, blend_fn("colorburn", b, np.minimum(2 * s, 1)), blend_fn("colordodge", b, np.clip(2 * s - 1, 0, 1)))
    if mode == "linearlight":
        return np.clip(b + 2 * s - 1, 0, 1)
    if mode == "pinlight":
        return np.where(s <= 0.5, np.minimum(b, 2 * s), np.maximum(b, 2 * s - 1))
    if mode == "hardmix":
        return (blend_fn("vividlight", b, s) >= 0.5).astype(np.float32)
    if mode == "difference":
        return np.abs(b - s)
    if mode == "exclusion":
        return b + s - 2 * b * s
    if mode == "subtract":
        return np.maximum(b - s, 0)
    if mode == "divide":
        return np.minimum(1, b / np.maximum(s, e))
    if mode == "hue":
        return _set_lum(_set_sat(s, _sat(b)), _lum(b))
    if mode == "saturation":
        return _set_lum(_set_sat(b, _sat(s)), _lum(b))
    if mode == "color":
        return _set_lum(s, _lum(b))
    if mode == "luminosity":
        return _set_lum(b, _lum(s))
    return s


def blend_into(base, layer, mode, seed=9):
    """base, layer: RGBA 0..1 (duz). Sonuc RGBA."""
    b, ab = base[..., :3], base[..., 3:]
    s, a = layer[..., :3], layer[..., 3:]
    if mode == "dissolve":
        n = np.random.default_rng(seed).random(a.shape, np.float32)
        a = (n < a).astype(np.float32)
        mode = "normal"
    mixed = s if mode == "normal" else np.clip(blend_fn(mode, b, s), 0, 1).astype(np.float32)
    src = (1 - ab) * s + ab * mixed
    ao = a + ab * (1 - a)
    rgb = (a * src + (1 - a) * ab * b) / np.maximum(ao, 1e-5)
    return np.clip(np.dstack([rgb, ao]), 0, 1).astype(np.float32)


# ------------------------------------------------------------------ stiller
def _over(T, color, a):
    """Premult RGBA tampona rengi alfasiyla ekler."""
    a = np.clip(a, 0, 1)[..., None]
    T[..., :3] = T[..., :3] * (1 - a) + (color if isinstance(color, np.ndarray) and color.ndim == 3 else np.broadcast_to(color, T[..., :3].shape)) * a
    T[..., 3:] = T[..., 3:] * (1 - a) + a


def _shift(a, dx, dy):
    if not dx and not dy:
        return a
    h, w = a.shape
    out = np.zeros_like(a)
    x0, y0 = max(0, dx), max(0, dy)
    x1, y1 = min(w, w + dx), min(h, h + dy)
    if x1 > x0 and y1 > y0:
        out[y0:y1, x0:x1] = a[y0 - dy:y1 - dy, x0 - dx:x1 - dx]
    return out


def _grow(A, r):
    """Yuvarlak genisletme."""
    if r < 1:
        return A
    psf = filters._psf_disc(r)
    return np.clip(filters._fft_conv(A, psf) * float(1 / max(psf.max(), 1e-6)), 0, 1)


def _extent(st, k):
    p = 4.0
    for key, d in st.items():
        p = max(p, (float(d.get("dist", 0)) + float(d.get("size", 0)) * 2.5 + 2) * k)
    return int(p)


def composite(img, layer, ly, gauss, k):
    """Stilli ve/veya karisim kipli katmani alta isler. img, layer: PIL RGBA ayni boyut."""
    W, H = img.size
    bb = layer.getbbox()
    if bb is None:
        return img
    st = ly.get("styles") or {}
    p = _extent(st, k)
    box = (max(0, bb[0] - p), max(0, bb[1] - p), min(W, bb[2] + p), min(H, bb[3] + p))
    L = np.asarray(layer.crop(box), np.float32) / 255.0
    B = np.asarray(img.crop(box), np.float32) / 255.0
    A = L[..., 3]
    T = np.zeros(L.shape, np.float32)
    h, w = A.shape
    ang = lambda d: (math.cos(math.radians(float(d["angle"]))), math.sin(math.radians(float(d["angle"]))))
    if "shadow" in st:
        d = st["shadow"]
        c, s = ang(d)
        r = float(d["size"]) * k
        sp = float(d["spread"]) / 100.0
        m = _grow(A, sp * r)
        _over(T, _rgb(d["color"]), gauss(_shift(m, -round(c * float(d["dist"]) * k), round(s * float(d["dist"]) * k)), max(0.3, r * (1 - sp * 0.8) / 2)) * float(d["opacity"]) / 100.0)
    if "glow" in st:
        d = st["glow"]
        r = float(d["size"]) * k
        _over(T, _rgb(d["color"]), np.clip(gauss(_grow(A, r * float(d["spread"]) / 100.0), max(0.3, r / 2)) * 1.25, 0, 1) * float(d["opacity"]) / 100.0)
    _over(T, L[..., :3], A * float(ly.get("fill", 1.0)))
    if "pattern" in st:
        d = st["pattern"]
        m = _pattern(d["kind"], w, h, float(d["scale"]) * k)[..., None]
        _over(T, _rgb(d["a"]) * m + _rgb(d["b"]) * (1 - m), A * float(d["opacity"]) / 100.0)
    if "gradient" in st:
        d = st["gradient"]
        y0, y1 = bb[1] - box[1], bb[3] - box[1]
        x0, x1 = bb[0] - box[0], bb[2] - box[0]
        t = np.zeros((h, w), np.float32)
        t[y0:y1, x0:x1] = _ramp(x1 - x0, y1 - y0, float(d["angle"]))
        t = t[..., None]
        _over(T, _rgb(d["a"]) * (1 - t) + _rgb(d["b"]) * t, A * float(d["opacity"]) / 100.0)
    if "color" in st:
        _over(T, _rgb(st["color"]["color"]), A * float(st["color"]["opacity"]) / 100.0)
    if "satin" in st:
        d = st["satin"]
        c, s = ang(d)
        dx, dy = round(c * float(d["dist"]) * k), round(s * float(d["dist"]) * k)
        r = max(0.3, float(d["size"]) * k / 2)
        _over(T, _rgb(d["color"]), np.abs(gauss(_shift(A, dx, dy), r) - gauss(_shift(A, -dx, -dy), r)) * A * float(d["opacity"]) / 100.0)
    if "iglow" in st:
        d = st["iglow"]
        r = max(0.3, float(d["size"]) * k / 2)
        edge = np.clip((1 - gauss(A, r)) * 2.2, 0, 1)
        _over(T, _rgb(d["color"]), (edge if d["src"] == "edge" else 1 - edge) * A * float(d["opacity"]) / 100.0)
    if "inner" in st:
        d = st["inner"]
        c, s = ang(d)
        _over(T, _rgb(d["color"]), gauss(_shift(1 - A, round(c * float(d["dist"]) * k) * -1, round(s * float(d["dist"]) * k)), max(0.3, float(d["size"]) * k / 2)) * A * float(d["opacity"]) / 100.0)
    if "bevel" in st:
        d = st["bevel"]
        r = max(0.6, float(d["size"]) * k / 2)
        Z = gauss(A, r)
        gx, gy = np.gradient(Z, axis=1), np.gradient(Z, axis=0)
        c, s = ang(d)
        n = (gx * -c + gy * s) * float(d["depth"]) / 100.0 * r * 2.4
        if d["style"] == "pillow":
            n = n * (1 - 2 * (Z > 0.5))
        m = A if d["style"] != "emboss" else np.clip(Z * 2, 0, 1)
        _over(T, _rgb(d["hi"]), np.clip(n, 0, 1) * m * float(d["hiop"]) / 100.0)
        _over(T, _rgb(d["sh"]), np.clip(-n, 0, 1) * m * float(d["shop"]) / 100.0)
    if "stroke" in st:
        d = st["stroke"]
        r = float(d["size"]) * k
        if d["pos"] == "out":
            m = np.clip(_grow(A, r) - A, 0, 1)
        elif d["pos"] == "in":
            m = np.clip(A - (1 - _grow(1 - A, r)), 0, 1)
        else:
            m = np.clip(_grow(A, r / 2) - (1 - _grow(1 - A, r / 2)), 0, 1)
        _over(T, _rgb(d["color"]), m * float(d["opacity"]) / 100.0)
    rgb = T[..., :3]
    a = T[..., 3] * float(ly.get("opacity", 1.0))
    out = blend_into(B, np.dstack([np.clip(rgb / np.maximum(T[..., 3:], 1e-4), 0, 1), a]), ly.get("mode") or "normal")  # T onceden carpilmis
    res = img.copy()
    res.paste(Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA"), box[:2])
    return res


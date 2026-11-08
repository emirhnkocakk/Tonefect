"""Tonefect - renk ve isik duzenlemeleri (fx["color"]).

Her duzenleme fotografa sabit sirada uygulanir (Photoshop'taki duzenleme katmanlari gibi, ama piksel degil ayar
olarak saklanir). Sunucu (clean_color) yalnizca etkisi olanlari birakir; bos sozluk fotografa dokunmaz.
"""
import colorsys
import math

import numpy as np

import looks

LUMA = looks.LUMA
LUT_LOADER = None   # sunucu: hazir ayar kimligi -> look sozlugu
PHOTO_STATS = None  # sunucu: fotograf kimligi -> ((ort Y, Cb, Cr), (sapma Y, Cb, Cr))
_sm = looks._smooth


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0


def _lum(a):
    return a @ LUMA


def spline_lut(pts, n=1024):
    """Monoton kubik egri (Fritsch-Carlson): tasma yapmaz. Arayuzdeki cizimle ayni formul."""
    xs = np.array([p[0] for p in pts], np.float64)
    ys = np.array([p[1] for p in pts], np.float64)
    grid = np.linspace(0, 1, n)
    if len(xs) < 2:
        return np.interp(grid, xs, ys).astype(np.float32)
    h, d = np.diff(xs), np.diff(ys) / np.diff(xs)
    m = np.r_[d[0], (d[:-1] + d[1:]) / 2, d[-1]]
    for i in range(len(d)):
        if d[i] == 0:
            m[i] = m[i + 1] = 0
        else:
            a, b = m[i] / d[i], m[i + 1] / d[i]
            s = a * a + b * b
            if s > 9:
                t = 3 / math.sqrt(s)
                m[i], m[i + 1] = t * a * d[i], t * b * d[i]
    i = np.clip(np.searchsorted(xs, grid, side="right") - 1, 0, len(h) - 1)
    t = np.clip((grid - xs[i]) / h[i], 0, 1)
    y = (2 * t**3 - 3 * t**2 + 1) * ys[i] + (t**3 - 2 * t**2 + t) * h[i] * m[i] + (-2 * t**3 + 3 * t**2) * ys[i + 1] + (t**3 - t**2) * h[i] * m[i + 1]
    y = np.where(grid < xs[0], ys[0], np.where(grid > xs[-1], ys[-1], y))
    return np.clip(y, 0, 1).astype(np.float32)


def _map(ch, lut):
    return lut[np.clip((ch * (len(lut) - 1) + 0.5).astype(np.int32), 0, len(lut) - 1)]


def _levels(a, lv):
    def f(x, p):
        b, g, w, ob, ow = p
        t = np.clip((x - b) / max(w - b, 1e-3), 0, 1)
        if abs(g - 1) > 1e-3:
            t = np.power(t, 1 / g)
        return ob + (ow - ob) * t
    a = a.copy()
    for i, c in enumerate("rgb"):
        if lv.get(c):
            a[..., i] = f(a[..., i], lv[c])
    return f(a, lv["rgb"]) if lv.get("rgb") else a


def _curves(a, cv):
    a = np.clip(a, 0, 1).copy()
    for i, c in enumerate("rgb"):
        if cv.get(c):
            a[..., i] = _map(a[..., i], spline_lut(cv[c]))
    return _map(a, spline_lut(cv["rgb"])) if cv.get("rgb") else a


def _sat_light(a, s, l):
    if s:
        L = _lum(a)[..., None]
        a = L + (a - L) * (1 + s)
    if l:
        a = a + (1 - a) * l if l > 0 else a * (1 + l)
    return a


def _tone_masks(L, balance=0.0, blend=0.5):
    """Golge, orta ton, parlak maskeleri. balance: sinirlari kaydirir, blend: gecis genisligi."""
    c = 0.5 + 0.25 * balance
    w = 0.12 + 0.5 * blend
    sh = 1 - _sm(c - w, c + w * 0.2, L)
    hi = _sm(c - w * 0.2, c + w, L)
    return sh, np.clip(1 - sh - hi, 0, 1), hi


def _balance(a, c):
    L0 = _lum(a)
    sh, mid, hi = _tone_masks(L0)
    d = np.zeros(a.shape, np.float32)
    for m, key in ((sh, "shadows"), (mid, "mids"), (hi, "highs")):
        v = c.get(key)
        if v:
            d += m[..., None] * (np.array(v, np.float32) - float(np.mean(v))) * 0.3
    a = a + d
    if c.get("preserve", True):
        a = a + (L0 - _lum(a))[..., None]
    return a


def _black_white(a, c):
    """Alti renk agirlikli gri: en dusuk kanal + (orta-dusuk) * ikincil + (yuksek-orta) * birincil."""
    a = np.clip(a, 0, 1)
    idx = np.argsort(a, axis=-1)
    lo, mi, hi = (np.take_along_axis(a, idx[..., i:i + 1], -1)[..., 0] for i in range(3))
    prim = np.array([c["r"], c["g"], c["b"]], np.float32)[idx[..., 2]]
    # iki ust kanalin karisimi: r+g sari, g+b camgobegi, r+b macenta
    sec_tab = np.array([0, c["y"], c["m"], c["c"]], np.float32)
    pair = idx[..., 2] + idx[..., 1]  # 1: r+g, 2: r+b, 3: g+b
    sec = sec_tab[pair]
    g = np.clip(lo + (mi - lo) * sec + (hi - mi) * prim, 0, 1)
    if c.get("tint") and c.get("sat"):
        col = np.array(colorsys.hsv_to_rgb(c.get("hue", 0) / 360.0, float(c["sat"]), 1.0), np.float32)
        return g[..., None] * col / max(float(col @ LUMA), 0.05)
    return np.repeat(g[..., None], 3, -1)


def _selective(a, c):
    a = np.clip(a, 0, 1)
    mx, mn = a.max(-1), a.min(-1)
    mid = a.sum(-1) - mx - mn
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    W = {
        "Red": (mx == r) * (mx - mid), "Green": (mx == g) * (mx != r) * (mx - mid), "Blue": (mx == b) * (mx != r) * (mx != g) * (mx - mid),
        "Cyan": (mn == r) * (mid - mn), "Magenta": (mn == g) * (mn != r) * (mid - mn), "Yellow": (mn == b) * (mn != r) * (mn != g) * (mid - mn),
        "White": np.clip((mn - 0.5) * 2, 0, 1), "Black": np.clip((0.5 - mx) * 2, 0, 1),
        "Neutral": np.clip(1 - np.abs(mx - 0.5) - np.abs(mn - 0.5), 0, 1),
    }
    rel = c.get("relative", True)
    out = a.copy()
    for band, ink in c.get("bands", {}).items():
        w = W[band][..., None]
        ck, mk, yk, k = ink
        v = np.array([ck, mk, yk], np.float32)
        v = np.clip(v + (1 - np.abs(v)) * k, -1, 1)
        d = -v * (a if rel else 1.0)
        out = out + d * w
    return out


def _shadows_highlights(a, c, gauss, short):
    L = np.clip(_lum(a), 1e-3, 1)
    r = max(1.0, short * (0.005 + 0.1 * float(c.get("radius", 0.3))))
    base = gauss(L, r)
    y = L
    if c.get("s"):
        y = y + float(c["s"]) * (1 - _sm(0.0, 0.55, base)) * (0.55 - np.minimum(y, 0.55)) * 1.1
    if c.get("h"):
        y = y - float(c["h"]) * _sm(0.45, 1.0, base) * np.maximum(y - 0.3, 0) * 0.75
    if c.get("mid"):
        y = np.power(np.clip(y, 0, 1), 2.0 ** (-float(c["mid"]) * 0.8))
    k = (y / L)[..., None]
    out = a * k
    col = float(c.get("color") or 0)
    if col:
        Y = _lum(out)[..., None]
        out = Y + (out - Y) * (1 + col * 0.6 * np.abs(k - 1).clip(0, 1) * 2)
    return out


def _hdr(a, c, gauss, short):
    """Yerel ton esleme: logaritmik isikta taban sikisir, ayrinti korunur ya da guclenir."""
    amt = float(c["amount"])
    L = np.clip(_lum(np.clip(a, 0, 1)), 1e-3, 1)
    lg = np.log(L)
    r = max(1.5, short * (0.01 + 0.12 * float(c.get("radius", 0.3))))
    mean = gauss(lg, r)
    var = gauss(lg * lg, r) - mean * mean
    t = var / (var + 0.04)  # kenar koruma: guclu kenarda hale olusmaz
    base = gauss(t, r) * lg + gauss(mean * (1 - t), r)
    detail = lg - base
    m = float(np.median(base))
    lg2 = m + (base - m) * (1 - 0.7 * amt) + detail * (1 + 1.2 * float(c.get("detail", 0.3)) * amt)
    out = a * (np.exp(lg2) / L)[..., None]
    if c.get("sat"):
        Y = _lum(out)[..., None]
        out = Y + (out - Y) * (1 + float(c["sat"]))
    return out


# YCbCr: istatistik aktarimi icin (parlaklik ve renk ayri)
_M = np.array([[0.299, 0.587, 0.114], [-0.169, -0.331, 0.5], [0.5, -0.419, -0.081]], np.float32)
_MI = np.linalg.inv(_M).astype(np.float32)


def color_stats(rgb):
    s = np.clip(rgb.reshape(-1, 3), 0, 1) @ _M.T
    return s.mean(0).tolist(), s.std(0).tolist()


def _match(a, c):
    st = PHOTO_STATS(c["photo"]) if PHOTO_STATS else None
    if not st:
        return a
    ms, ss = np.array(st[0], np.float32), np.array(st[1], np.float32)
    ycc = a @ _M.T
    sample = ycc[::4, ::4].reshape(-1, 3)
    ma, sa = sample.mean(0), np.maximum(sample.std(0), 1e-3)
    tr = (ycc - ma) * (ss / sa) + ms
    tr[..., 0] = ma[0] + (tr[..., 0] - ma[0]) * float(c.get("lum", 1.0)) if abs(float(c.get("lum", 1.0)) - 1) > 1e-3 else tr[..., 0]
    tr[..., 1:] = tr[..., 1:] * float(c.get("sat", 1.0))
    out = tr @ _MI.T
    return a + (out - a) * (1 - float(c.get("fade", 0.0)))


def _replace(a, c):
    t = hex_rgb(c["color"])
    a = np.clip(a, 0, 1)
    # renk farki parlaklik farkindan cok sayilir: gölgedeki ayni renk de secilir
    d = a - t
    Ld = d @ LUMA
    dist = np.sqrt(((d - Ld[..., None]) ** 2).sum(-1) * 2.2 + (Ld * 0.6) ** 2)
    f = 0.03 + 0.75 * float(c.get("fuzz", 0.3))
    w = 1 - _sm(f * 0.5, f, dist)
    out = a
    if c.get("h"):
        out = looks._rotate_hue(out, np.full(a.shape[:2], -math.radians(float(c["h"])), np.float32))
    out = _sat_light(out, float(c.get("s") or 0), float(c.get("l") or 0))
    return a + (out - a) * w[..., None]


def _gradient(a, c):
    stops = c["stops"]
    L = np.clip(_lum(np.clip(a, 0, 1)), 0, 1)
    if c.get("reverse"):
        L = 1 - L
    xs = [s[0] for s in stops]
    cols = np.array([hex_rgb(s[1]) for s in stops], np.float32)
    out = np.dstack([np.interp(L, xs, cols[:, i]) for i in range(3)]).astype(np.float32)
    return a + (out - a) * float(c.get("amount", 1.0))


def _grade(a, c):
    L0 = np.clip(_lum(np.clip(a, 0, 1)), 0, 1)
    sh, mid, hi = _tone_masks(L0, float(c.get("balance") or 0), float(c.get("blend", 0.5)))
    for m, key in ((sh, "shadow"), (mid, "mid"), (hi, "high"), (1.0, "global")):
        v = c.get(key)
        if not v:
            continue
        h, s, l = v
        mm = m[..., None] if not isinstance(m, float) else 1.0
        if s:
            a = a + mm * looks._hue_vec(h) * (0.32 * s)
        if l:
            a = a + mm * (0.22 * l)
    return a


def _lut(a, c):
    look = LUT_LOADER(c["id"]) if LUT_LOADER else None
    if not look:
        return a
    out = looks.apply(np.clip(a, 0, 1), look)
    return a + (out - a) * float(c.get("amount", 1.0))


def apply(arr, c, gauss):
    """arr: (H, W, 3) 0..1, c: temizlenmis fx["color"]. Yeni dizi dondurur."""
    a = arr
    short = min(arr.shape[:2])
    if c.get("wb"):
        t, ti = float(c["wb"].get("temp") or 0), float(c["wb"].get("tint") or 0)
        gain = np.array([2.0 ** (0.6 * t), 2.0 ** (-0.35 * ti), 2.0 ** (-0.6 * t)], np.float32)
        a = a * (gain / float(gain @ LUMA))  # parlaklik yerinde kalir
    if c.get("bc"):
        b, ct = float(c["bc"].get("b") or 0), float(c["bc"].get("c") or 0)
        a = np.clip(a, 0, 1)
        if b:
            a = np.power(a, 2.0 ** (-b * 1.1))
        if ct:
            a = looks.apply(a, {"contrast": ct})
    if c.get("levels"):
        a = _levels(np.clip(a, 0, 1), c["levels"])
    if c.get("curves"):
        a = _curves(a, c["curves"])
    if c.get("shhi"):
        a = _shadows_highlights(a, c["shhi"], gauss, short)
    if c.get("hdr"):
        a = _hdr(a, c["hdr"], gauss, short)
    if c.get("balance"):
        a = _balance(np.clip(a, 0, 1), c["balance"])
    if c.get("hue"):
        h = c["hue"]
        if h.get("h"):
            a = looks._rotate_hue(np.clip(a, 0, 1), np.full(a.shape[:2], -math.radians(float(h["h"])), np.float32))
        a = _sat_light(a, float(h.get("s") or 0), float(h.get("l") or 0))
    if c.get("selective"):
        a = _selective(a, c["selective"])
    if c.get("mixer"):
        m = c["mixer"]
        a = np.clip(a, 0, 1)
        if m.get("mono"):
            v = np.array(m["r"][:3], np.float32)
            a = np.repeat((a @ v + float(m["r"][3]))[..., None], 3, -1)
        else:
            a = np.dstack([a @ np.array(m[k][:3], np.float32) + float(m[k][3]) for k in "rgb"]).astype(np.float32)
    if c.get("replace"):
        a = _replace(a, c["replace"])
    if c.get("match"):
        a = _match(np.clip(a, 0, 1), c["match"])
    if c.get("grade"):
        a = _grade(a, c["grade"])
    if c.get("lut"):
        a = _lut(a, c["lut"])
    if c.get("filter"):
        f = c["filter"]
        d = float(f["density"])
        before = _lum(np.clip(a, 0, 1))
        a = np.clip(a, 0, 1)
        a = a * (1 - d) + a * hex_rgb(f["color"]) * d
        if f.get("preserve", True):
            a = a * (before / np.maximum(_lum(a), 1e-3))[..., None]
    if c.get("bw"):
        a = _black_white(a, c["bw"])
    if c.get("desat"):
        a = np.clip(a, 0, 1)
        a = np.repeat(((a.max(-1) + a.min(-1)) / 2)[..., None], 3, -1)
    if c.get("gradient"):
        a = _gradient(a, c["gradient"])
    if c.get("invert"):
        a = 1 - np.clip(a, 0, 1)
    if c.get("posterize"):
        n = int(c["posterize"]["n"])
        a = np.clip(np.floor(np.clip(a, 0, 1) * n), 0, n - 1) / max(n - 1, 1)
    if c.get("threshold"):
        a = np.repeat((_lum(np.clip(a, 0, 1)) >= float(c["threshold"]["level"]))[..., None].astype(np.float32), 3, -1)
    return np.clip(a, 0, 1).astype(np.float32)


def auto_levels(a, kind):
    """Otomatik Ton / Kontrast / Renk -> duzenlenebilir duzey degerleri."""
    a = np.clip(a, 0, 1).reshape(-1, 3)

    def entry(b, w, g=1.0):
        return [round(float(b), 3), round(float(g), 3), round(float(max(w, b + 0.05)), 3), 0.0, 1.0]

    if kind == "contrast":  # tum kanallara ayni germe: renkler degismez
        return {"rgb": entry(np.percentile(a.min(1), 0.3), np.percentile(a.max(1), 99.7))}
    lo, hi = np.percentile(a, 0.3, axis=0), np.percentile(a, 99.7, axis=0)
    if kind == "tone":
        return {c: entry(lo[i], hi[i]) for i, c in enumerate("rgb")}
    # renk: germe + orta tonlardaki renk kaymasini gama ile notrle
    t = np.clip((a - lo) / np.maximum(hi - lo, 0.05), 1e-3, 1)
    L = t @ LUMA
    mids = t[(L > 0.25) & (L < 0.75)]
    means = mids.mean(0) if len(mids) > 100 else t.mean(0)
    target = float(means @ LUMA)
    out = {}
    for i, c in enumerate("rgb"):
        g = math.log(max(float(means[i]), 1e-3)) / math.log(max(target, 1e-3))
        out[c] = entry(lo[i], hi[i], max(0.7, min(1.4, 1 + (g - 1) * 0.5)))  # yarim duzeltme: sicak isik tamamen silinmez
    return out

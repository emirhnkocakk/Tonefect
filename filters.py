"""Tonefect - filtreler (fx["filters"]): sirayla uygulanan, her an degistirilebilen filtre yigini.

Her filtre {"kind", parametreler, "amount": 0..1, "areaMask": secim (istege bagli)}.
Yaricap ve boyutlar kisa kenari 1000 piksel olan gorsele gore verilir: onizleme ve tam boyut ayni gorunur.
SPEC arayuze de gonderilir; kaydiricilar tek yerden tanimlanir.
"""
import json
import math
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import looks

LUMA = looks.LUMA
IMAGE_LOADER = None  # sunucu: fotograf kimligi -> PIL RGB
_sm = looks._smooth


def N(k, label, lo, hi, d, step=1):
    return {"k": k, "label": label, "t": "n", "min": lo, "max": hi, "def": d, "step": step}


def S(k, label, d, *opts):
    return {"k": k, "label": label, "t": "sel", "def": d, "opts": [list(o) for o in opts]}


def C(k, label, d):
    return {"k": k, "label": label, "t": "color", "def": d}


def B(k, label, d=False):
    return {"k": k, "label": label, "t": "bool", "def": d}


def P(k="c", label="Merkez", d=(0.5, 0.5)):
    return {"k": k, "label": label, "t": "point", "def": list(d)}


SEED = {"k": "seed", "label": "Yeniden Oluştur", "t": "seed", "def": 1}


# ------------------------------------------------------------------ yardimcilar
class Ctx:
    def __init__(self, a, gauss, matte, k=None):
        self.H, self.W = a.shape[:2]
        self.short = min(self.H, self.W)
        self.k = k if k else self.short / 1000.0
        # cok kucuk yaricapta kutu bulanikligi hic etki etmez; en az bir komsuluk bulanir
        self.g = lambda x, s: x if s < 0.3 else gauss(x, max(s, 0.9))
        self.matte = matte

    def grid(self):
        Y, X = np.mgrid[0:self.H, 0:self.W].astype(np.float32)
        return X, Y


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255.0


def remap(a, X, Y, edge="clamp"):
    H, W = a.shape[:2]
    if edge == "wrap":
        X, Y = np.mod(X, W), np.mod(Y, H)
    else:
        X, Y = np.clip(X, 0, W - 1), np.clip(Y, 0, H - 1)
    x0, y0 = np.floor(X).astype(np.int32), np.floor(Y).astype(np.int32)
    x0, y0 = np.clip(x0, 0, W - 1), np.clip(y0, 0, H - 1)
    x1, y1 = (x0 + 1) % W if edge == "wrap" else np.minimum(x0 + 1, W - 1), (y0 + 1) % H if edge == "wrap" else np.minimum(y0 + 1, H - 1)
    fx, fy = (X - x0).astype(np.float32), (Y - y0).astype(np.float32)
    if a.ndim == 3:
        fx, fy = fx[..., None], fy[..., None]
    return (a[y0, x0] * (1 - fx) + a[y0, x1] * fx) * (1 - fy) + (a[y1, x0] * (1 - fx) + a[y1, x1] * fx) * fy


def _pil(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")


def _arr(im):
    return np.asarray(im, np.float32) / 255.0


def _box(a, r):
    """Kutu bulaniklastirma (kumulatif toplam)."""
    r = int(r)
    if r < 1:
        return a
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis, dtype=np.float32)
        n = a.shape[axis]
        hi, lo = [slice(None)] * a.ndim, [slice(None)] * a.ndim
        hi[axis], lo[axis] = slice(2 * r + 1, 2 * r + 1 + n), slice(0, n)
        a = (c[tuple(hi)] - c[tuple(lo)]) * np.float32(1 / (2 * r + 1))
    return a


def _fft_conv(a, psf):
    """Evrisim: kenar tasmasi olmasin diye goruntu uzatilir."""
    ph, pw = psf.shape
    p = (ph // 2 + 1, pw // 2 + 1)
    b = np.pad(a, ((p[0], p[0]), (p[1], p[1])) + (((0, 0),) if a.ndim == 3 else ()), mode="edge")
    h, w = b.shape[:2]
    P_ = np.zeros((h, w), np.float32)
    P_[:ph, :pw] = psf
    P_ = np.roll(P_, (-(ph // 2), -(pw // 2)), (0, 1))
    F = np.fft.rfft2(P_)
    if a.ndim == 3:
        out = np.dstack([np.fft.irfft2(np.fft.rfft2(b[..., i]) * F, s=(h, w)) for i in range(3)])
    else:
        out = np.fft.irfft2(np.fft.rfft2(b) * F, s=(h, w))
    return out[p[0]:-p[0], p[1]:-p[1]].astype(np.float32)


def _psf_line(length, angle):
    n = max(3, int(length) | 1)
    im = Image.new("L", (n * 4, n * 4), 0)
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    m = n * 2
    ImageDraw.Draw(im).line([m - c * length * 2, m + s * length * 2, m + c * length * 2, m - s * length * 2], fill=255, width=3)
    k = np.asarray(im.resize((n, n), Image.BILINEAR), np.float32)
    return k / max(float(k.sum()), 1e-6)


def _psf_disc(r):
    n = int(r) * 2 + 3
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) - (n - 1) / 2
    k = np.clip(r + 0.5 - np.hypot(x, y), 0, 1)
    return k / max(float(k.sum()), 1e-6)


def _var_blur(a, m, R, c):
    """Yerine gore degisen bulaniklik: m 0..1."""
    out = a
    v = np.clip(m, 0, 1)[..., None] * 4
    for i, f in enumerate((0.125, 0.25, 0.5, 1.0)):
        w = np.clip(v - i, 0, 1)
        out = out * (1 - w) + c.g(a, max(0.5, R * f)) * w
    return out


def _guided(a, r, eps, c):
    mean = c.g(a, r)
    v = c.g(a * a, r) - mean * mean
    t = v / (v + eps)
    return c.g(t, r) * a + c.g(mean * (1 - t), r)


def _median(a, r):
    r = int(r)
    if r < 1:
        return a
    im = _pil(a)
    if r > 3:  # buyuk yaricap: kucultulmus gorselde hesapla
        f = 3.0 / r
        small = im.resize((max(3, round(im.width * f)), max(3, round(im.height * f))), Image.BILINEAR).filter(ImageFilter.MedianFilter(7))
        return _arr(small.resize(im.size, Image.BICUBIC))
    return _arr(im.filter(ImageFilter.MedianFilter(2 * r + 1)))


def _noise(rng, c):
    """Piksel gurultusu: taneler cozunurlukle birlikte buyur."""
    f = max(1.0, c.k)
    h, w = max(1, round(c.H / f)), max(1, round(c.W / f))
    n = rng.normal(0, 1, (h, w, 3)).astype(np.float32)
    if (h, w) == (c.H, c.W):
        return n
    return np.dstack([np.asarray(Image.fromarray(n[..., i], "F").resize((c.W, c.H), Image.BILINEAR), np.float32) for i in range(3)])


def _fbm(rng, c, base=4, octaves=6):
    """Fraktal bulut gurultusu; desen goruntu cozunurlugunden bagimsizdir."""
    out, amp, ar = np.zeros((c.H, c.W), np.float32), 1.0, c.W / c.H
    for o in range(octaves):
        cells = base * 2 ** o
        h, w = max(2, round(cells / max(ar, 1))) + 2, max(2, round(cells * min(ar, 1))) + 2
        if ar > 1:
            h, w = cells + 2, round(cells * ar) + 2
        else:
            h, w = round(cells / ar) + 2, cells + 2
        n = Image.fromarray(rng.random((h, w), np.float32), "F").resize((c.W, c.H), Image.BICUBIC)
        out += np.asarray(n, np.float32) * amp
        amp *= 0.55
    lo, hi = np.percentile(out[::3, ::3], (1, 99))
    return np.clip((out - lo) / max(float(hi - lo), 1e-4), 0, 1)


_JIT = np.random.default_rng(77).random((1024, 1024, 2), np.float32)


def _voronoi(c, cell):
    """Duzensiz hucreler: her piksel icin en yakin nokta (sx, sy), uzaklik ve hucre numarasi."""
    X, Y = c.grid()
    gx, gy = X / cell, Y / cell
    ix, iy = np.floor(gx).astype(np.int32), np.floor(gy).astype(np.int32)
    best, bx, by = np.full(X.shape, 1e9, np.float32), np.zeros(X.shape, np.float32), np.zeros(X.shape, np.float32)
    idx = np.zeros(X.shape, np.int64)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx, ny = ix + dx, iy + dy
            j = _JIT[ny % 1024, nx % 1024]
            px, py = nx + j[..., 0], ny + j[..., 1]
            d = (gx - px) ** 2 + (gy - py) ** 2
            m = d < best
            best[m], bx[m], by[m], idx[m] = d[m], px[m], py[m], ((ny[m] + 2) * 100003 + nx[m] + 2)
    return bx * cell, by * cell, np.sqrt(best) * cell, idx


def _cell_mean(a, idx):
    _, inv = np.unique(idx, return_inverse=True)
    inv = inv.reshape(idx.shape)
    n = np.maximum(np.bincount(inv.ravel()), 1)
    means = np.stack([np.bincount(inv.ravel(), weights=a[..., i].ravel()) / n for i in range(3)], -1).astype(np.float32)
    return means[inv]


def _kuwahara(a, r, c):
    """Kenar koruyan boya etkisi: dort komsu bolgeden en duzgunun rengi."""
    r = max(1, int(r))
    L = a @ LUMA
    q = r // 2 + 1
    mean, lm, l2 = _box(a, q), _box(L, q), _box(L * L, q)
    var = l2 - lm * lm
    opts = [(-q, -q), (-q, q), (q, -q), (q, q)]
    Vs = np.stack([np.roll(var, s, (0, 1)) for s in opts], 0)
    Ms = np.stack([np.roll(mean, s, (0, 1)) for s in opts], 0)
    pick = np.argmin(Vs, 0)
    return np.take_along_axis(Ms, pick[None, ..., None].repeat(3, -1), 0)[0]


def _radial_pass(a, fn):
    """Az ornekle puruzsuz sonuc: 4 ornekli gecis, adimi 4'e bolerek uc kez."""
    size = 1.0
    for _ in range(3):
        total = 0
        for j in range(4):
            X, Y = fn(((j + 0.5) / 4 - 0.5) * size)
            total = total + remap(a, X, Y)
        a = total / 4
        size /= 4
    return a


def _polar_c(p, c):
    cx, cy = p.get("c", (0.5, 0.5))
    X, Y = c.grid()
    return X - cx * c.W, Y - cy * c.H, cx * c.W, cy * c.H


# ------------------------------------------------------------------ bulaniklastirma
def gaussian(a, p, c):
    return c.g(a, max(0.3, p["r"] * c.k))


def boxblur(a, p, c):
    return _box(a, max(1, round(p["r"] * c.k)))


def motion(a, p, c):
    return _fft_conv(a, _psf_line(max(2.0, p["d"] * c.k), p["angle"]))


def radial(a, p, c):
    dx, dy, cx, cy = _polar_c(p, c)
    amt = p["amount"] / 100.0
    if p["mode"] == "spin":
        def fn(t):
            th = t * amt * 1.2
            co, si = math.cos(th), math.sin(th)
            return cx + dx * co - dy * si, cy + dx * si + dy * co
    else:
        def fn(t):
            s = 1 + t * amt * 0.7
            return cx + dx * s, cy + dy * s
    # buyuk gorselde kucuk kopyada hesaplanir (bulanik sonuc ayrinti gerektirmez), merkez keskin kalir
    f = min(1.0, 900.0 / max(c.W, c.H))
    if f >= 1:
        return _radial_pass(a, fn)
    size = (max(8, round(c.W * f)), max(8, round(c.H * f)))
    small = _arr(_pil(a).resize(size, Image.BILINEAR))
    Ys, Xs = np.mgrid[0:size[1], 0:size[0]].astype(np.float32)
    dx, dy, cx, cy = Xs - cx * f, Ys - cy * f, cx * f, cy * f
    out = _arr(_pil(_radial_pass(small, fn)).resize((c.W, c.H), Image.BICUBIC))
    X, Y = c.grid()
    m = _sm(0.0, 0.2, np.hypot(X - cx / f, Y - cy / f) / c.short)[..., None]
    return a * (1 - m) + out * m


def lens(a, p, c):
    r = max(1.0, p["r"] * c.k)
    gamma = 1.0 + 3.0 * p["bright"] / 100.0
    out = np.power(np.clip(_fft_conv(np.power(np.clip(a, 0, 1), gamma), _psf_disc(r)), 0, 1), 1 / gamma)
    depth = p["depth"]
    if depth == "subject" and c.matte:
        keep = np.asarray(c.matte((c.W, c.H)), np.float32)
        keep = c.g(keep, r * 0.4)[..., None]
        return out * (1 - keep) + a * keep
    if depth == "center":
        dx, dy, _, _ = _polar_c(p, c)
        m = _sm(p["focus"] / 100.0, p["focus"] / 100.0 + 0.3, np.hypot(dx, dy) / c.short)[..., None]
        return a * (1 - m) + out * m
    return out


def field(a, p, c):
    pins = p.get("pins") or [[0.5, 0.5, p["r"]]]
    X, Y = c.grid()
    w, s = np.zeros(X.shape, np.float32), np.zeros(X.shape, np.float32)
    for x, y, r in pins:
        d = 1.0 / (((X - x * c.W) ** 2 + (Y - y * c.H) ** 2) / c.short ** 2 + 0.002) ** 1.5
        w += d
        s += d * r
    R = max(1.0, max(q[2] for q in pins) * c.k)
    return _var_blur(a, (s / w) / max(1.0, max(q[2] for q in pins)), R, c)


def iris(a, p, c):
    dx, dy, _, _ = _polar_c(p, c)
    ang = math.radians(p["angle"])
    u, v = dx * math.cos(ang) + dy * math.sin(ang), -dx * math.sin(ang) + dy * math.cos(ang)
    rx, ry = max(1.0, p["rx"] / 100.0 * c.short), max(1.0, p["ry"] / 100.0 * c.short)
    d = np.hypot(u / rx, v / ry)
    return _var_blur(a, _sm(p["feather"] / 100.0, 1.0, d), max(1.0, p["r"] * c.k), c)


def tilt(a, p, c):
    dx, dy, _, _ = _polar_c(p, c)
    ang = math.radians(p["angle"])
    d = np.abs(-dx * math.sin(ang) + dy * math.cos(ang)) / c.short
    f = p["focus"] / 100.0
    return _var_blur(a, _sm(f, f + max(p["trans"] / 100.0, 0.01), d), max(1.0, p["r"] * c.k), c)


def surface(a, p, c):
    return _guided(a, max(1.0, p["r"] * c.k), (p["thr"] / 255.0) ** 2, c)


def smartblur(a, p, c):
    out = _guided(a, max(1.0, p["r"] * c.k), (p["thr"] / 255.0) ** 2, c)
    if p["mode"] == "normal":
        return out
    L = a @ LUMA
    e = np.clip(np.abs(L - c.g(L, max(0.8, 1.2 * c.k))) * 14, 0, 1)
    e = (e > 0.5).astype(np.float32)[..., None]
    return e.repeat(3, -1) if p["mode"] == "edge" else out * (1 - e) + e


# ------------------------------------------------------------------ keskinlestirme
def _usm(a, amount, r, c, thr=0.0):
    L = a @ LUMA
    d = L - c.g(L, max(0.5, r * c.k))
    if thr:
        d = d * _sm(thr * 0.5, thr, np.abs(d))
    return a + (d * amount)[..., None]


def smartsharp(a, p, c):
    L = a @ LUMA
    amt = p["amount"] / 100.0
    r = max(0.5, p["r"] * c.k)
    d = L - c.g(L, r)
    if p["remove"] == "lens":
        d = d + (c.g(L, r) - c.g(L, r * 2.2)) * 0.6
    n = p["noise"] / 100.0 * 0.05
    if n:
        d = d * _sm(n * 0.5, n * 1.5, np.abs(c.g(d, 0.7)))
    return a + np.clip(d * amt, -0.3, 0.3)[..., None]  # asiri parlak hale olusmaz


def unsharp(a, p, c):
    return _usm(a, p["amount"] / 100.0, p["r"], c, p["thr"] / 255.0)


def sharpen(a, p, c):
    return _usm(a, 0.8, 0.9, c)


def sharpmore(a, p, c):
    return _usm(a, 1.8, 1.0, c)


def sharpedges(a, p, c):
    L = a @ LUMA
    e = np.clip((np.abs(L - c.g(L, max(1.0, 2.0 * c.k))) - 0.015) * 16, 0, 1)
    return a + ((L - c.g(L, max(0.6, 0.9 * c.k))) * 2.2 * e)[..., None]


def shake(a, p, c):
    """Titreme azaltma: verilen yon ve uzunluktaki hareket icin Wiener ters evrisimi (yalniz parlaklikta)."""
    L = a @ LUMA
    psf = _psf_line(max(3.0, p["len"] * c.k), p["angle"])
    pad = psf.shape[0] + 8
    b = np.pad(L, pad, mode="reflect")
    h, w = b.shape
    P_ = np.zeros((h, w), np.float32)
    P_[:psf.shape[0], :psf.shape[1]] = psf
    P_ = np.roll(P_, (-(psf.shape[0] // 2), -(psf.shape[1] // 2)), (0, 1))
    F = np.fft.rfft2(P_)
    nsr = 0.0005 + (1 - p["strength"] / 100.0) * 0.05
    out = np.fft.irfft2(np.fft.rfft2(b) * np.conj(F) / (np.abs(F) ** 2 + nsr), s=(h, w))[pad:-pad, pad:-pad].astype(np.float32)
    return a + np.clip(out - L, -0.4, 0.4)[..., None]


# ------------------------------------------------------------------ bozma
def displace(a, p, c):
    im = IMAGE_LOADER(p["photo"]) if p.get("photo") and IMAGE_LOADER else None
    L = _arr(im.convert("L").resize((c.W, c.H), Image.BILINEAR)) if im else c.g(a @ LUMA, 3 * c.k)
    X, Y = c.grid()
    d = (L - 0.5) * 2
    return remap(a, X + d * p["h"] * c.k, Y + d * p["v"] * c.k, p["edge"])


def _round_uv(p, c):
    dx, dy, cx, cy = _polar_c(p, c)
    rx, ry = c.W / 2.0, c.H / 2.0
    u, v = dx / rx, dy / ry
    return u, v, np.hypot(u, v), rx, ry, cx, cy


def pinch(a, p, c):
    u, v, r, rx, ry, cx, cy = _round_uv(p, c)
    amt = p["amount"] / 100.0
    f = np.where((r < 1) & (r > 0), np.power(np.sin(np.pi * 0.5 * np.minimum(r, 1)), amt), 1.0).astype(np.float32)
    return remap(a, cx + u * f * rx, cy + v * f * ry)


def spherize(a, p, c):
    u, v, r, rx, ry, cx, cy = _round_uv(p, c)
    amt = p["amount"] / 100.0
    if p["mode"] == "h":
        v = v * 0
    elif p["mode"] == "v":
        u = u * 0
    rr = np.hypot(u, v)
    safe = np.clip(rr, 1e-4, 1)
    bulge = np.arcsin(safe) / (np.pi / 2) / safe
    f = np.where(rr < 1, 1 + (bulge - 1) * amt if amt >= 0 else 1 + (1 / np.maximum(bulge, 1e-3) - 1) * -amt, 1.0).astype(np.float32)
    dx, dy, cx, cy = _polar_c(p, c)
    if p["mode"] == "h":
        return remap(a, cx + dx * f, cy + dy)
    if p["mode"] == "v":
        return remap(a, cx + dx, cy + dy * f)
    return remap(a, cx + dx * f, cy + dy * f)


def twirl(a, p, c):
    u, v, r, rx, ry, cx, cy = _round_uv(p, c)
    th = np.radians(p["angle"]) * np.clip(1 - r, 0, 1) ** 2
    co, si = np.cos(th), np.sin(th)
    return remap(a, cx + (u * co - v * si) * rx, cy + (u * si + v * co) * ry)


def polar(a, p, c):
    X, Y = c.grid()
    W, H = c.W, c.H
    cx, cy = W / 2.0, H / 2.0
    if p["mode"] == "r2p":  # dikdortgen -> kutupsal
        dx, dy = (X - cx) / cx, (Y - cy) / cy
        r = np.hypot(dx, dy)
        th = np.arctan2(dx, -dy)
        return remap(a, np.mod(th / (2 * np.pi), 1) * (W - 1), np.clip(r, 0, 1) * (H - 1))
    th = X / (W - 1) * 2 * np.pi
    r = Y / (H - 1)
    return remap(a, cx + np.sin(th) * r * cx, cy - np.cos(th) * r * cy)


def ripple(a, p, c):
    X, Y = c.grid()
    amt = p["amount"] / 100.0 * 12 * c.k
    wl = {"s": 16, "m": 34, "l": 70}[p["size"]] * c.k
    return remap(a, X + amt * np.sin(Y * 2 * np.pi / wl), Y + amt * np.sin(X * 2 * np.pi / wl))


def shear(a, p, c):
    X, Y = c.grid()
    t = Y / max(c.H - 1, 1)
    d = np.sin(t * np.pi * p["waves"]) if p["shape"] == "s" else t * 2 - 1
    return remap(a, X + d * p["amount"] * c.k, Y, p["edge"])


def wave(a, p, c):
    X, Y = c.grid()
    wl = max(2.0, p["wl"] * c.k)
    rng = np.random.default_rng(int(p["seed"]))
    ph = float(rng.random()) * 2 * np.pi

    def f(t):
        s = np.sin(t * 2 * np.pi / wl + ph)
        return np.sign(s) if p["type"] == "square" else (2 / np.pi) * np.arcsin(s) if p["type"] == "tri" else s
    return remap(a, X + f(Y) * p["h"] * c.k, Y + f(X) * p["v"] * c.k, p["edge"])


def zigzag(a, p, c):
    dx, dy, cx, cy = _polar_c(p, c)
    r = np.hypot(dx, dy) / (c.short / 2.0)
    amt = p["amount"] / 100.0
    osc = np.sin(r * p["ridges"] * 2 * np.pi) * np.clip(1 - r, 0, 1)
    if p["style"] == "around":
        th = osc * amt * 0.8
        co, si = np.cos(th), np.sin(th)
        return remap(a, cx + dx * co - dy * si, cy + dx * si + dy * co)
    if p["style"] == "out":
        f = 1 + osc * amt * 0.25
        return remap(a, cx + dx * f, cy + dy * f)
    th = osc * amt * 0.6
    f = 1 + osc * amt * 0.15
    co, si = np.cos(th), np.sin(th)
    return remap(a, cx + (dx * co - dy * si) * f, cy + (dx * si + dy * co) * f)


def _keystone(a, X, Y, v, h, c):
    """Dikey ve yatay perspektif: eksene gore olcek."""
    cx, cy = c.W / 2.0, c.H / 2.0
    dx, dy = X - cx, Y - cy
    w = 1 + v * dy / c.H + h * dx / c.W
    return cx + dx / w, cy + dy / w


def lenscor(a, p, c):
    X, Y = c.grid()
    cx, cy = c.W / 2.0, c.H / 2.0
    dx, dy = X - cx, Y - cy
    R2 = (dx * dx + dy * dy) / (cx * cx + cy * cy)
    f = 1 + p["dist"] / 100.0 * 0.5 * R2
    SX, SY = cx + dx * f, cy + dy * f
    SX, SY = _keystone(a, SX, SY, p["v"] / 100.0, p["h"] / 100.0, c)
    ca = p["ca"] / 100.0 * 0.012
    if ca:
        out = np.dstack([remap(a[..., 0], cx + (SX - cx) * (1 + ca), cy + (SY - cy) * (1 + ca)), remap(a[..., 1], SX, SY), remap(a[..., 2], cx + (SX - cx) * (1 - ca), cy + (SY - cy) * (1 - ca))])
    else:
        out = remap(a, SX, SY)
    vig = p["vig"] / 100.0
    if vig:
        out = out * (1 + vig * R2 * R2 * 0.8)[..., None]
    return out


def perspective(a, p, c):
    X, Y = c.grid()
    SX, SY = _keystone(a, X, Y, p["v"] / 100.0, p["h"] / 100.0, c)
    s = p["scale"] / 100.0
    cx, cy = c.W / 2.0, c.H / 2.0
    return remap(a, cx + (SX - cx) / s, cy + (SY - cy) / s)


def wideangle(a, p, c):
    """Balik gozu -> duz izdusum: ozel kisit cizgileri yok, tum kare icin duzeltir."""
    X, Y = c.grid()
    cx, cy = c.W / 2.0, c.H / 2.0
    dx, dy = X - cx, Y - cy
    diag = math.hypot(cx, cy)
    amt = max(p["amount"] / 100.0, 1e-3)
    r = np.hypot(dx, dy) / diag
    fov = amt * 1.5
    src = np.arctan(r * math.tan(fov)) / fov if p["mode"] == "fix" else np.tan(r * fov) / math.tan(fov)
    f = (src / np.maximum(r, 1e-4)).astype(np.float32) * (100.0 / p["scale"])
    return remap(a, cx + dx * f, cy + dy * f)


def liquify(a, p, c):
    """Sivilastir: darbeler kaba bir kayma alanina islenir, sonuc tum cozunurluklerde ayni olur."""
    strokes = p.get("strokes") or []
    if not strokes:
        return a
    long_ = 384
    gw, gh = (long_, max(8, round(long_ * c.H / c.W))) if c.W >= c.H else (max(8, round(long_ * c.W / c.H)), long_)
    fx, fy = np.zeros((gh, gw), np.float32), np.zeros((gh, gw), np.float32)
    short = min(gw, gh)
    for st in strokes:
        R = max(2.0, st["size"] * short / 2.0)
        rate = st["rate"]
        pts = st["pts"]
        prev = None
        for x, y in pts:
            cx, cy = x * gw, y * gh
            x0, x1 = max(0, int(cx - R) - 1), min(gw, int(cx + R) + 2)
            y0, y1 = max(0, int(cy - R) - 1), min(gh, int(cy + R) + 2)
            if x1 > x0 and y1 > y0:
                Yg, Xg = np.mgrid[y0:y1, x0:x1].astype(np.float32)
                vx, vy = Xg - cx, Yg - cy
                w = np.clip(1 - (vx * vx + vy * vy) / (R * R), 0, 1) ** 2
                tool = st["tool"]
                if tool == "rec":
                    k = 1 - w * rate * 0.5
                    fx[y0:y1, x0:x1] *= k
                    fy[y0:y1, x0:x1] *= k
                else:
                    if tool == "push":
                        if prev is None:
                            prev = (cx, cy)
                            continue
                        dx, dy = (cx - prev[0]) * w, (cy - prev[1]) * w
                    elif tool in ("cw", "ccw"):
                        s = (0.14 if tool == "cw" else -0.14) * rate
                        dx, dy = -vy * s * w, vx * s * w
                    else:
                        s = (-0.09 if tool == "pucker" else 0.09) * rate
                        dx, dy = vx * s * w, vy * s * w
                    # eski kaymayi yeni konumdan oku: ust uste darbeler birikir
                    sx, sy = Xg - dx, Yg - dy
                    fx[y0:y1, x0:x1], fy[y0:y1, x0:x1] = remap(fx, sx, sy)[...] + dx, remap(fy, sx, sy)[...] + dy
            prev = (cx, cy)
    ux = np.asarray(Image.fromarray(fx, "F").resize((c.W, c.H), Image.BICUBIC), np.float32) * (c.W / gw)
    uy = np.asarray(Image.fromarray(fy, "F").resize((c.W, c.H), Image.BICUBIC), np.float32) * (c.H / gh)
    X, Y = c.grid()
    return remap(a, X - ux, Y - uy)


# ------------------------------------------------------------------ gurultu
def addnoise(a, p, c):
    rng = np.random.default_rng(int(p["seed"]))
    n = _noise(rng, c)
    if p["dist"] == "uniform":
        n = np.clip(n / 2.0, -1, 1) * 1.2
    if p["mono"]:
        n = np.repeat(n[..., :1], 3, -1)
    return a + n * p["amount"] / 100.0 * 0.35


def despeckle(a, p, c):
    L = a @ LUMA
    smooth = _median(a, max(1, round(1.2 * c.k)))
    e = np.clip((np.abs(L - c.g(L, max(1.5, 2.5 * c.k))) - 0.03) * 12, 0, 1)[..., None]  # kenarlar korunur
    return smooth * (1 - e) + a * e


def dustscr(a, p, c):
    m = _median(a, max(1, round(p["r"] * c.k)))
    d = np.abs(a - m).max(-1)
    t = p["thr"] / 255.0
    w = _sm(t, t + 0.02, d)[..., None]
    return a * (1 - w) + m * w


def median(a, p, c):
    return _median(a, max(1, round(p["r"] * c.k)))


def reducenoise(a, p, c):
    k = p["strength"] / 100.0
    L = (a @ LUMA)[..., None]
    C = a - L
    keep = p["detail"] / 100.0
    L2 = _guided(L, max(1.0, 3 * c.k), (0.01 + 0.09 * k * (1 - 0.7 * keep)) ** 2, c)
    C2 = C + (c.g(C, max(1.0, 6 * c.k)) - C) * (p["color"] / 100.0)
    out = L + (L2 - L) * min(1.0, k * 1.4) + C2
    if p["sharp"]:
        out = _usm(out, p["sharp"] / 100.0 * 1.2, 1.0, c)
    return out


# ------------------------------------------------------------------ pikselle
def halftone(a, p, c):
    cell = max(3.0, p["cell"] * c.k)
    X, Y = c.grid()
    ang = {0: 15, 1: 75, 2: 0}
    src = c.g(a, cell * 0.35)
    out = np.zeros(a.shape, np.float32)
    for i in range(3):
        th = math.radians(ang[i])
        co, si = math.cos(th), math.sin(th)
        u, v = (X * co + Y * si) / cell, (-X * si + Y * co) / cell
        iu, iv = np.round(u), np.round(v)
        cxx, cyy = (iu * co - iv * si) * cell, (iu * si + iv * co) * cell
        ink = 1 - src[np.clip(cyy.astype(np.int32), 0, c.H - 1), np.clip(cxx.astype(np.int32), 0, c.W - 1), i]
        d = np.hypot(u - iu, v - iv)
        out[..., i] = 1 - np.clip((np.sqrt(np.clip(ink, 0, 1)) * 0.6 - d) * cell * 0.7 + 0.5, 0, 1)
    return out


def crystallize(a, p, c):
    _, _, _, idx = _voronoi(c, max(3.0, p["cell"] * c.k))
    return _cell_mean(a, idx)


def facet(a, p, c):
    return _kuwahara(_median(a, max(1, round(1.5 * c.k))), max(2, round(p["r"] * c.k)), c)


def fragment(a, p, c):
    X, Y = c.grid()
    r = max(1.0, p["r"] * c.k)
    return sum(remap(a, X + dx * r, Y + dy * r) for dx, dy in ((-1, -1), (1, -1), (-1, 1), (1, 1))) / 4


def mezzotint(a, p, c):
    rng = np.random.default_rng(int(p["seed"]))
    size = {"fine": 1.0, "med": 2.0, "coarse": 4.0}[p["type"]] * max(1.0, c.k)
    h, w = max(1, round(c.H / size)), max(1, round(c.W / size))
    n = rng.random((h, w, 3), np.float32)
    n = np.dstack([np.asarray(Image.fromarray(n[..., i], "F").resize((c.W, c.H), Image.NEAREST), np.float32) for i in range(3)])
    return (a > n).astype(np.float32)


def mosaic(a, p, c):
    cell = max(2.0, p["cell"] * c.k)
    im = _pil(a)
    size = (max(1, round(c.W / cell)), max(1, round(c.H / cell)))
    return _arr(im.resize(size, Image.BOX).resize((c.W, c.H), Image.NEAREST))


def pointillize(a, p, c):
    cell = max(3.0, p["cell"] * c.k)
    sx, sy, d, _ = _voronoi(c, cell)
    col = c.g(a, cell * 0.3)[np.clip(sy.astype(np.int32), 0, c.H - 1), np.clip(sx.astype(np.int32), 0, c.W - 1)]
    m = np.clip((cell * 0.62 - d) + 0.5, 0, 1)[..., None]
    return hex_rgb(p["bg"]) * (1 - m) + col * m


# ------------------------------------------------------------------ olustur
def clouds(a, p, c):
    n = _fbm(np.random.default_rng(int(p["seed"])), c)[..., None]
    return hex_rgb(p["c1"]) * (1 - n) + hex_rgb(p["c2"]) * n


def diffclouds(a, p, c):
    n = _fbm(np.random.default_rng(int(p["seed"])), c)[..., None]
    return np.abs(a - n)


def fibers(a, p, c):
    rng = np.random.default_rng(int(p["seed"]))
    w, h = max(4, round(c.W / (1.6 * max(c.k, 0.3)))), max(3, round(14 + 40 * (1 - p["var"] / 100.0) / 3))
    n = np.asarray(Image.fromarray(rng.random((h, w), np.float32), "F").resize((c.W, c.H), Image.BICUBIC), np.float32)
    n = 0.5 + (n - 0.5) * (0.6 + p["strength"] / 100.0 * 2.4)
    n = np.clip(n, 0, 1)[..., None]
    return hex_rgb(p["c1"]) * (1 - n) + hex_rgb(p["c2"]) * n


def flare(a, p, c):
    cx, cy = p["c"][0] * c.W, p["c"][1] * c.H
    X, Y = c.grid()
    dx, dy = X - cx, Y - cy
    r = np.hypot(dx, dy) / c.short
    b = p["bright"] / 100.0
    warm = np.array([1.0, 0.86, 0.66], np.float32)
    add = (np.exp(-(r / 0.06) ** 2) * 1.6 + np.exp(-r / 0.22) * 0.55)[..., None] * warm
    th = np.arctan2(dy, dx)
    if p["type"] != "prime":
        rays = np.abs(np.cos(th * 3)) ** 40 + 0.6 * np.abs(np.sin(th * 7 + 0.5)) ** 60
        add = add + (rays * np.exp(-r / 0.2) * 0.55)[..., None] * warm
    ghosts = {"zoom": ((0.45, 0.04, (0.3, 0.8, 0.6)), (0.8, 0.09, (0.7, 0.4, 0.9)), (1.25, 0.05, (0.3, 0.5, 1.0)), (1.6, 0.13, (0.9, 0.5, 0.3)), (1.95, 0.03, (0.4, 1.0, 0.5))),
              "35": ((0.6, 0.06, (0.6, 0.5, 1.0)), (1.3, 0.1, (1.0, 0.6, 0.4)), (1.8, 0.04, (0.4, 0.9, 0.7))),
              "105": ((0.7, 0.14, (0.9, 0.7, 0.5)), (1.5, 0.2, (0.5, 0.7, 1.0))), "prime": ()}[p["type"]]
    ax, ay = c.W / 2.0 - cx, c.H / 2.0 - cy
    for t, size, col in ghosts:
        d = np.hypot(X - (cx + ax * t), Y - (cy + ay * t)) / c.short
        add = add + (np.clip((size - d) / (size * 0.25), 0, 1) * 0.16)[..., None] * np.array(col, np.float32)
    return 1 - (1 - np.clip(a, 0, 1)) * (1 - np.clip(add * b, 0, 1))


def lighting(a, p, c):
    X, Y = c.grid()
    L = c.g(a @ LUMA, max(0.8, 1.2 * c.k))
    h = p["bump"] / 100.0 * 6.0 * c.k
    gx, gy = np.gradient(L, axis=1) * h * 10, np.gradient(L, axis=0) * h * 10
    nz = 1.0
    nl = np.sqrt(gx * gx + gy * gy + nz * nz)
    cx, cy = p["c"][0] * c.W, p["c"][1] * c.H
    col = hex_rgb(p["color"])
    amb = p["amb"] / 100.0
    if p["type"] == "dir":
        ang = math.radians(p["angle"])
        lx, ly, lz = math.cos(ang) * 0.6, -math.sin(ang) * 0.6, 0.8
        fall = 1.0
    else:
        dx, dy = cx - X, cy - Y
        dz = c.short * 0.35
        ln = np.sqrt(dx * dx + dy * dy + dz * dz)
        lx, ly, lz = dx / ln, dy / ln, dz / ln
        R = np.hypot(dx, dy) / (p["radius"] / 100.0 * c.short)
        fall = np.clip(1 - R * R, 0, 1) if p["type"] == "spot" else 1 / (1 + 0.6 * R * R)
    diff = np.clip((-gx * lx - gy * ly + nz * lz) / nl, 0, 1) * fall
    return a * (amb + (diff * p["int"] / 100.0 * 1.6)[..., None] * col)


# ------------------------------------------------------------------ stilize
def diffuse(a, p, c):
    rng = np.random.default_rng(int(p["seed"]))
    X, Y = c.grid()
    n = _noise(rng, c)
    r = max(1.0, p["r"] * c.k)
    s = remap(a, X + np.clip(n[..., 0], -1.5, 1.5) * r, Y + np.clip(n[..., 1], -1.5, 1.5) * r)
    if p["mode"] == "dark":
        return np.minimum(a, s)
    if p["mode"] == "light":
        return np.maximum(a, s)
    return s


def emboss(a, p, c):
    ang = math.radians(p["angle"])
    h = max(0.7, p["h"] * c.k)
    X, Y = c.grid()
    s = remap(a, X + math.cos(ang) * h, Y - math.sin(ang) * h)
    d = (a - s) * p["amount"] / 100.0 * 3
    if p["color"]:
        return a + d
    return 0.5 + np.repeat((d @ LUMA)[..., None], 3, -1)


def extrude(a, p, c):
    size = max(6, round(p["size"] * c.k))
    depth = p["depth"] / 100.0
    im = _pil(a)
    W, H = c.W, c.H
    rng = np.random.default_rng(int(p["seed"]))
    small = _arr(im.resize((max(1, W // size), max(1, H // size)), Image.BOX))
    h, w = small.shape[:2]
    canvas = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(canvas)
    cx, cy = W / 2.0, H / 2.0
    order = sorted(((-math.hypot((i + 0.5) * size - cx, (j + 0.5) * size - cy), i, j) for j in range(h) for i in range(w)))
    for _, i, j in order:
        col = small[j, i]
        lvl = float(col @ LUMA) if p["by"] == "level" else float(rng.random())
        x0, y0, x1, y1 = i * size, j * size, (i + 1) * size, (j + 1) * size
        s = lvl * depth * 0.6
        fx0, fy0 = x0 + (x0 - cx) * s, y0 + (y0 - cy) * s
        fx1, fy1 = x1 + (x1 - cx) * s, y1 + (y1 - cy) * s
        base = tuple(int(v * 255) for v in col)
        for quad, shade in (([(x0, y0), (x1, y0), (fx1, fy0), (fx0, fy0)], 0.75), ([(x0, y1), (x1, y1), (fx1, fy1), (fx0, fy1)], 0.5), ([(x0, y0), (x0, y1), (fx0, fy1), (fx0, fy0)], 0.62), ([(x1, y0), (x1, y1), (fx1, fy1), (fx1, fy0)], 0.62)):
            d.polygon(quad, fill=tuple(int(v * shade) for v in base))
        d.rectangle([fx0, fy0, fx1, fy1], fill=base)
    return _arr(canvas)


def findedges(a, p, c):
    b = c.g(a, max(0.5, 0.7 * c.k))
    gx, gy = np.gradient(b, axis=1), np.gradient(b, axis=0)
    return 1 - np.clip(np.hypot(gx, gy) * 7 / max(c.k, 0.4), 0, 1)


def oil(a, p, c):
    out = _kuwahara(a, max(2, round((p["style"] / 100.0) * 9 * c.k + 1)), c)
    out = c.g(out, p["clean"] / 100.0 * 1.2 * c.k)
    rng = np.random.default_rng(3)
    L = out @ LUMA
    bristle = _fbm(rng, c, base=int(40 / max(p["scale"] / 100.0, 0.2)), octaves=2) * p["bristle"] / 100.0 * 0.05
    Lb = c.g(L, max(0.8, 1.2 * c.k)) + bristle
    ang = math.radians(p["angle"])
    gx, gy = np.gradient(Lb, axis=1), np.gradient(Lb, axis=0)
    shade = (gx * math.cos(ang) - gy * math.sin(ang)) * p["shine"] / 100.0 * 14 * max(c.k, 0.4)
    return out + np.clip(shade, -0.3, 0.3)[..., None]


def solarize(a, p, c):
    t = p["thr"] / 255.0
    return np.where(a > t, 1 - a, a)


def tiles(a, p, c):
    n = int(p["n"])
    W, H = c.W, c.H
    size = max(4, W // max(n, 1))
    rng = np.random.default_rng(int(p["seed"]))
    im = _pil(a)
    fill = p["fill"]
    if fill == "inv":
        bg = _pil(1 - a)
    elif fill == "photo":
        bg = im.copy()
    else:
        bg = Image.new("RGB", (W, H), tuple(int(v * 255) for v in hex_rgb(p["bg"])))
    off = p["off"] / 100.0 * size
    for y in range(0, H, size):
        for x in range(0, W, size):
            dx, dy = rng.integers(-int(off) - 1, int(off) + 2, 2) if off >= 1 else (0, 0)
            bg.paste(im.crop((x, y, min(W, x + size), min(H, y + size))), (x + int(dx), y + int(dy)))
    return _arr(bg)


def wind(a, p, c):
    rng = np.random.default_rng(int(p["seed"]))
    d = 1 if p["dir"] == "right" else -1
    L = a @ LUMA
    prob = {"wind": 0.5, "blast": 0.85, "stagger": 0.35}[p["method"]]
    length = max(4, int({"wind": 40, "blast": 90, "stagger": 60}[p["method"]] * c.k))
    seeds = (np.abs(L - np.roll(L, d, 1)) > 0.08) & (rng.random(L.shape, np.float32) < prob)
    seeds[:, 0], seeds[:, -1] = False, False
    if p["method"] == "stagger":
        seeds &= np.repeat(rng.random((c.H, 1), np.float32) < 0.5, c.W, 1)
    out, col = a.copy(), a.copy()
    for s in range(length):
        seeds = np.roll(seeds, d, 1)
        col = np.roll(col, d, 1)
        keep = rng.random((c.H, 1), np.float32) > 0.012
        seeds &= keep
        w = (1 - s / length) * 0.9
        out[seeds] = out[seeds] * (1 - w) + col[seeds] * w
    return out


def highpass(a, p, c):
    return 0.5 + a - c.g(a, max(0.5, p["r"] * c.k))


def custom(a, p, c):
    k = np.array(p["kernel"], np.float32).reshape(5, 5)
    return _fft_conv(a, k) / max(abs(p["scale"]), 1e-3) + p["offset"] / 255.0


EDGE = S("edge", "Kenar", "clamp", ("clamp", "Uzat"), ("wrap", "Sar"))
SPEC = {
    "gaussian": (gaussian, [N("r", "Yarıçap", 0.5, 120, 8, 0.5)]),
    "boxblur": (boxblur, [N("r", "Yarıçap", 1, 120, 8)]),
    "motion": (motion, [N("angle", "Açı", -180, 180, 0), N("d", "Uzaklık", 2, 300, 40)]),
    "radial": (radial, [N("amount", "Miktar", 1, 100, 12), S("mode", "Yöntem", "spin", ("spin", "Dönme"), ("zoom", "Yakınlaşma")), P()]),
    "lens": (lens, [N("r", "Yarıçap", 1, 80, 14), N("bright", "Parlak Noktalar", 0, 100, 40), S("depth", "Derinlik", "none", ("none", "Tüm Görsel"), ("center", "Odak Noktası"), ("subject", "Konu Net (Yapay Zekâ)")), N("focus", "Net Alan", 2, 90, 25), P()]),
    "field": (field, [N("r", "Bulanıklık", 1, 80, 25), {"k": "pins", "label": "Noktalar", "t": "pins", "def": []}]),
    "iris": (iris, [N("r", "Bulanıklık", 1, 80, 25), N("rx", "Genişlik", 3, 150, 35), N("ry", "Yükseklik", 3, 150, 35), N("angle", "Açı", -90, 90, 0), N("feather", "Geçiş", 0, 95, 45), P()]),
    "tilt": (tilt, [N("r", "Bulanıklık", 1, 80, 25), N("focus", "Net Bant", 1, 80, 12), N("trans", "Geçiş", 1, 80, 18), N("angle", "Açı", -90, 90, 0), P()]),
    "surface": (surface, [N("r", "Yarıçap", 1, 60, 10), N("thr", "Eşik", 2, 255, 30)]),
    "smartblur": (smartblur, [N("r", "Yarıçap", 1, 60, 6), N("thr", "Eşik", 2, 255, 40), S("mode", "Kip", "normal", ("normal", "Normal"), ("edge", "Yalnızca Kenar"), ("overlay", "Kenarları Bindir"))]),
    "smartsharp": (smartsharp, [N("amount", "Miktar", 1, 500, 120), N("r", "Yarıçap", 0.3, 20, 1.5, 0.1), N("noise", "Gürültü Azalt", 0, 100, 15), S("remove", "Giderilen", "gauss", ("gauss", "Gauss Bulanıklığı"), ("lens", "Lens Bulanıklığı"))]),
    "unsharp": (unsharp, [N("amount", "Miktar", 1, 500, 120), N("r", "Yarıçap", 0.3, 60, 1.5, 0.1), N("thr", "Eşik", 0, 255, 0)]),
    "shake": (shake, [N("angle", "Titreme Yönü", -90, 90, 0), N("len", "Titreme Uzunluğu", 3, 80, 12), N("strength", "Güç", 0, 100, 70)]),
    "sharpen": (sharpen, []),
    "sharpedges": (sharpedges, []),
    "sharpmore": (sharpmore, []),
    "displace": (displace, [N("h", "Yatay", -200, 200, 30), N("v", "Dikey", -200, 200, 30), EDGE, {"k": "photo", "label": "Harita Görseli", "t": "photo", "def": ""}]),
    "pinch": (pinch, [N("amount", "Miktar", -100, 100, 50), P()]),
    "polar": (polar, [S("mode", "Yön", "r2p", ("r2p", "Dikdörtgenden Kutupsala"), ("p2r", "Kutupsaldan Dikdörtgene"))]),
    "ripple": (ripple, [N("amount", "Miktar", 1, 300, 80), S("size", "Boyut", "m", ("s", "Küçük"), ("m", "Orta"), ("l", "Büyük"))]),
    "shear": (shear, [N("amount", "Miktar", -300, 300, 60), N("waves", "Bükülme", 1, 6, 1), S("shape", "Biçim", "s", ("s", "Eğri"), ("line", "Düz")), EDGE]),
    "spherize": (spherize, [N("amount", "Miktar", -100, 100, 70), S("mode", "Kip", "n", ("n", "Normal"), ("h", "Yalnızca Yatay"), ("v", "Yalnızca Dikey")), P()]),
    "twirl": (twirl, [N("angle", "Açı", -720, 720, 120), P()]),
    "wave": (wave, [N("wl", "Dalga Boyu", 4, 400, 80), N("h", "Yatay", 0, 200, 15), N("v", "Dikey", 0, 200, 15), S("type", "Tür", "sin", ("sin", "Sinüs"), ("tri", "Üçgen"), ("square", "Kare")), EDGE, SEED]),
    "zigzag": (zigzag, [N("amount", "Miktar", 1, 100, 40), N("ridges", "Sırt", 1, 20, 6), S("style", "Stil", "pond", ("pond", "Su Halkası"), ("out", "Merkezden Dışa"), ("around", "Merkez Çevresinde")), P()]),
    "lenscor": (lenscor, [N("dist", "Bozulma", -100, 100, 0), N("ca", "Renk Saçağı", -100, 100, 0), N("vig", "Vinyet", -100, 100, 0), N("v", "Dikey Perspektif", -100, 100, 0), N("h", "Yatay Perspektif", -100, 100, 0)]),
    "liquify": (liquify, [{"k": "strokes", "label": "Darbeler", "t": "strokes", "def": []}]),
    "perspective": (perspective, [N("v", "Dikey", -100, 100, 25), N("h", "Yatay", -100, 100, 0), N("scale", "Ölçek", 50, 200, 100)]),
    "addnoise": (addnoise, [N("amount", "Miktar", 1, 100, 25), S("dist", "Dağılım", "gauss", ("gauss", "Gauss"), ("uniform", "Düzgün")), B("mono", "Tek Renkli"), SEED]),
    "despeckle": (despeckle, []),
    "dustscr": (dustscr, [N("r", "Yarıçap", 1, 40, 3), N("thr", "Eşik", 0, 128, 18)]),
    "median": (median, [N("r", "Yarıçap", 1, 60, 3)]),
    "reducenoise": (reducenoise, [N("strength", "Güç", 0, 100, 50), N("detail", "Detay Koru", 0, 100, 50), N("color", "Renk Gürültüsü", 0, 100, 60), N("sharp", "Keskinlik", 0, 100, 15)]),
    "halftone": (halftone, [N("cell", "Nokta Boyutu", 4, 80, 14)]),
    "crystallize": (crystallize, [N("cell", "Hücre Boyutu", 4, 200, 24)]),
    "facet": (facet, [N("r", "Yarıçap", 2, 30, 5)]),
    "fragment": (fragment, [N("r", "Kayma", 1, 40, 5)]),
    "mezzotint": (mezzotint, [S("type", "Tür", "med", ("fine", "İnce"), ("med", "Orta"), ("coarse", "Kaba")), SEED]),
    "mosaic": (mosaic, [N("cell", "Kare Boyutu", 2, 200, 18)]),
    "pointillize": (pointillize, [N("cell", "Hücre Boyutu", 4, 120, 16), C("bg", "Zemin", "#FFFFFF")]),
    "clouds": (clouds, [C("c1", "Renk 1", "#000000"), C("c2", "Renk 2", "#FFFFFF"), SEED]),
    "diffclouds": (diffclouds, [SEED]),
    "fibers": (fibers, [N("var", "Değişkenlik", 1, 100, 40), N("strength", "Güç", 1, 100, 45), C("c1", "Renk 1", "#000000"), C("c2", "Renk 2", "#FFFFFF"), SEED]),
    "flare": (flare, [N("bright", "Parlaklık", 10, 300, 100), S("type", "Objektif", "zoom", ("zoom", "50-300 mm Zoom"), ("35", "35 mm"), ("105", "105 mm"), ("prime", "Sinema Sabit")), P(d=(0.3, 0.3))]),
    "lighting": (lighting, [S("type", "Işık", "spot", ("spot", "Spot"), ("point", "Nokta"), ("dir", "Yönlü")), N("int", "Yoğunluk", 0, 200, 70), N("amb", "Ortam Işığı", 0, 100, 35), N("radius", "Yarıçap", 10, 200, 70), N("bump", "Doku Derinliği", 0, 100, 15), N("angle", "Açı", -180, 180, 45), C("color", "Renk", "#FFF2DC"), P()]),
    "diffuse": (diffuse, [N("r", "Yarıçap", 1, 40, 4), S("mode", "Kip", "normal", ("normal", "Normal"), ("dark", "Yalnızca Koyu"), ("light", "Yalnızca Açık")), SEED]),
    "emboss": (emboss, [N("angle", "Açı", -180, 180, 135), N("h", "Yükseklik", 1, 30, 3), N("amount", "Miktar", 1, 300, 100), B("color", "Rengi Koru")]),
    "extrude": (extrude, [N("size", "Blok Boyutu", 8, 120, 30), N("depth", "Derinlik", 5, 100, 50), S("by", "Derinlik Kaynağı", "level", ("level", "Parlaklığa Göre"), ("random", "Rastgele")), SEED]),
    "findedges": (findedges, []),
    "oil": (oil, [N("style", "Stilizasyon", 5, 100, 40), N("clean", "Temizlik", 0, 100, 30), N("scale", "Fırça Ölçeği", 20, 100, 60), N("bristle", "Kıl Detayı", 0, 100, 40), N("shine", "Parlaklık", 0, 100, 40), N("angle", "Işık Açısı", -180, 180, 135)]),
    "solarize": (solarize, [N("thr", "Eşik", 1, 254, 128)]),
    "tiles": (tiles, [N("n", "Karo Sayısı", 2, 60, 10), N("off", "Kayma", 0, 100, 12), S("fill", "Boşluk", "color", ("color", "Renk"), ("inv", "Ters Görüntü"), ("photo", "Görselin Kendisi")), C("bg", "Renk", "#000000"), SEED]),
    "wind": (wind, [S("method", "Yöntem", "wind", ("wind", "Rüzgâr"), ("blast", "Patlama"), ("stagger", "Sarsıntı")), S("dir", "Yön", "right", ("right", "Sağa"), ("left", "Sola")), SEED]),
    "highpass": (highpass, [N("r", "Yarıçap", 0.5, 120, 6, 0.5)]),
    "wideangle": (wideangle, [N("amount", "Miktar", 5, 100, 40), S("mode", "Düzeltme", "fix", ("fix", "Balık Gözünü Düzelt"), ("add", "Balık Gözü Ekle")), N("scale", "Ölçek", 50, 200, 100)]),
    "custom": (custom, [{"k": "kernel", "label": "Matris", "t": "kernel", "def": [0, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, -1, 5, -1, 0, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0]}, N("scale", "Ölçek", 1, 100, 1), N("offset", "Kaydırma", -255, 255, 0)]),
}
MAX_STACK = 16


def spec_json():
    return {k: v[1] for k, v in SPEC.items()}


def _num(v, lo, hi, d):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return d
    return d if v != v else max(lo, min(hi, v))


def clean_one(raw, file_ok):
    """Arayuzden gelen filtre -> dogrulanmis ayarlar (yoksa None)."""
    kind = raw.get("kind")
    if kind not in SPEC or raw.get("off"):
        return None
    out = {"kind": kind, "amount": round(_num(raw.get("amount"), 0, 1, 1), 3)}
    if not out["amount"]:
        return None
    for q in SPEC[kind][1]:
        k, t, v = q["k"], q["t"], raw.get(q["k"])
        if t in ("n", "seed"):
            out[k] = round(_num(v, q.get("min", 0), q.get("max", 2 ** 31 - 1), q["def"]), 3)
        elif t == "sel":
            out[k] = v if v in [o[0] for o in q["opts"]] else q["def"]
        elif t == "bool":
            out[k] = bool(v)
        elif t == "color":
            out[k] = v.upper() if isinstance(v, str) and len(v) == 7 and v[0] == "#" and all(ch in "0123456789abcdefABCDEF" for ch in v[1:]) else q["def"]
        elif t == "point":
            out[k] = [round(_num(v[0], -0.5, 1.5, q["def"][0]), 4), round(_num(v[1], -0.5, 1.5, q["def"][1]), 4)] if isinstance(v, list) and len(v) == 2 else q["def"]
        elif t == "photo":
            out[k] = v if isinstance(v, str) and v and file_ok(v) else ""
        elif t == "kernel":
            out[k] = [round(_num(x, -999, 999, 0), 3) for x in v[:25]] if isinstance(v, list) and len(v) == 25 else q["def"]
        elif t == "pins":
            out[k] = [[round(_num(p[0], 0, 1, 0.5), 4), round(_num(p[1], 0, 1, 0.5), 4), round(_num(p[2], 0, 80, 20), 2)] for p in (v if isinstance(v, list) else [])[:12] if isinstance(p, list) and len(p) == 3]
        elif t == "strokes":
            st = []
            for s in (v if isinstance(v, list) else [])[:400]:
                if isinstance(s, dict) and s.get("tool") in ("push", "cw", "ccw", "pucker", "bloat", "rec") and isinstance(s.get("pts"), list):
                    pts = [[round(_num(p[0], -0.5, 1.5, 0), 4), round(_num(p[1], -0.5, 1.5, 0), 4)] for p in s["pts"][:1500] if isinstance(p, list) and len(p) >= 2]
                    if pts:
                        st.append({"tool": s["tool"], "size": round(_num(s.get("size"), 0.01, 1, 0.2), 4), "rate": round(_num(s.get("rate"), 0.02, 1, 0.5), 3), "pts": pts})
            out[k] = st
    return out


_LAST = {"base": None, "sigs": [], "outs": []}  # onizleme: alttaki filtreler degismediyse yeniden hesaplanmaz
_CACHE_PIXELS = 4_000_000


def apply(arr, stack, gauss, mask_fn, matte, k=None):
    """arr: (H, W, 3) 0..1, stack: temizlenmis liste."""
    c = Ctx(arr, gauss, matte, k)
    cacheable = arr.shape[0] * arr.shape[1] <= _CACHE_PIXELS
    base = (arr.shape, zlib.crc32((arr[::11, ::11] * 255).astype(np.uint8).tobytes()), k)
    sigs = [json.dumps(f, sort_keys=True) for f in stack]
    a, start = arr, 0
    outs = []
    if cacheable and _LAST["base"] == base:
        for i, s in enumerate(sigs):
            if i < len(_LAST["sigs"]) and _LAST["sigs"][i] == s:
                a, start = _LAST["outs"][i], i + 1
                outs.append(a)
            else:
                break
    for f in stack[start:]:
        out = np.clip(SPEC[f["kind"]][0](np.clip(a, 0, 1), f, c), 0, 1).astype(np.float32)
        w = float(f["amount"])
        if f.get("areaMask"):
            w = mask_fn(f["areaMask"])[..., None] * w
        a = out if isinstance(w, float) and w >= 1 else a + (out - a) * w
        outs.append(a)
    if cacheable:
        _LAST.update(base=base, sigs=sigs, outs=outs)
    return a

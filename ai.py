"""Tonefect - yapay zeka ile konu secimi (bilgisayarda calisir, foto disari cikmaz).

Model: rembg projesinin isnet-general-use.onnx (insan, hayvan, nesne). Kurulum dosyasina eklenmez;
kullanici ilk kullanimda onay verince bir kez indirilir ve SHA-256 ile dogrulanir.
Bir fotografin konu maskesi (0..255 gri, EXIF yonu uygulanmis tam kare) bir kez hesaplanip diske yazilir.
"""
import hashlib
import threading
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

MODEL_NAME = "isnet-general-use.onnx"
MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
MODEL_SHA256 = "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a"
MODEL_SIZE = 178_648_008
INPUT = 1024
MATTE_MAX = 2048  # saklanan maskenin en uzun kenari

STATE = {"state": "idle", "done": 0, "total": MODEL_SIZE, "error": ""}
_session = None
_lock = threading.Lock()


def model_path(root):
    return Path(root) / "models" / MODEL_NAME


def installed(root):
    p = model_path(root)
    return p.is_file() and p.stat().st_size == MODEL_SIZE


def download(root):
    """Modeli indirir (arka planda cagrilir); STATE ilerlemeyi tutar."""
    dest = model_path(root)
    tmp = dest.with_suffix(".part")
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        STATE.update(state="downloading", done=0, total=MODEL_SIZE, error="")
        h = hashlib.sha256()
        req = urllib.request.Request(MODEL_URL, headers={"User-Agent": "Tonefect"})
        with urllib.request.urlopen(req, timeout=30) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(512 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                h.update(chunk)
                STATE["done"] += len(chunk)
        if h.hexdigest() != MODEL_SHA256:
            raise RuntimeError("İndirilen model doğrulanamadı (dosya bozuk ya da değişmiş).")
        tmp.replace(dest)
        STATE.update(state="ready")
    except Exception as e:
        tmp.unlink(missing_ok=True)
        STATE.update(state="error", error=str(e))


def status(root):
    if installed(root) and STATE["state"] != "downloading":
        return {"state": "ready", "done": MODEL_SIZE, "total": MODEL_SIZE, "error": "", "size": MODEL_SIZE}
    return {**STATE, "size": MODEL_SIZE}


def _get_session(root):
    global _session
    with _lock:
        if _session is None:
            if not installed(root):
                raise RuntimeError("Yapay zekâ modeli kurulu değil.")
            import onnxruntime as ort  # gecikmeli: uygulama acilisini yavaslatmasin
            opts = ort.SessionOptions()
            opts.log_severity_level = 3
            _session = ort.InferenceSession(str(model_path(root)), opts, providers=["CPUExecutionProvider"])
        return _session


def predict(root, img):
    """img: RGB PIL. Konu maskesi (L, img boyutunda) dondurur."""
    sess = _get_session(root)
    x = np.asarray(img.convert("RGB").resize((INPUT, INPUT), Image.BILINEAR), np.float32)
    x = x / max(float(x.max()), 1e-6) - 0.5  # rembg isnet normalizasyonu: (x/max - 0.5) / 1.0
    x = x.transpose(2, 0, 1)[None]
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    lo, hi = float(out.min()), float(out.max())
    out = fill_holes((out - lo) / max(hi - lo, 1e-6))
    return Image.fromarray((out * 255).astype(np.uint8), "L").resize(img.size, Image.BILINEAR)


def fill_holes(a, grid=256):
    """Konunun icinde kalan bosluklari (kenara degmeyen arka plan adalari) doldurur;
    model ornegin ekose gomlegin beyaz karelerini arka plan sanabiliyor."""
    h, w = a.shape
    small = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((grid, grid), Image.BILINEAR)) > 127
    outside = np.zeros_like(small)
    stack = [(y, x) for y in range(grid) for x in (0, grid - 1) if not small[y, x]]
    stack += [(y, x) for x in range(grid) for y in (0, grid - 1) if not small[y, x]]
    for y, x in stack:
        outside[y, x] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < grid and 0 <= nx < grid and not small[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                stack.append((ny, nx))
    holes = ~small & ~outside
    if not holes.any():
        return a
    up = np.asarray(Image.fromarray(holes.astype(np.uint8) * 255).resize((w, h), Image.BILINEAR), np.float32) / 255
    return np.maximum(a, up)


def matte_for(root, photo_path, cache_dir):
    """Fotografin konu maskesi (EXIF yonu uygulanmis tam kare oraninda, en fazla 2048 px). Diskte onbelleklenir."""
    cache = Path(cache_dir) / (Path(photo_path).name + ".png")
    if cache.is_file():
        return Image.open(cache).convert("L")
    with Image.open(photo_path) as im:
        im.draft("RGB", (MATTE_MAX, MATTE_MAX))
        img = ImageOps.exif_transpose(im).convert("RGB")
    if max(img.size) > MATTE_MAX:
        img.thumbnail((MATTE_MAX, MATTE_MAX), Image.LANCZOS)
    matte = predict(root, img)
    cache.parent.mkdir(parents=True, exist_ok=True)
    matte.save(cache, "PNG")
    return matte

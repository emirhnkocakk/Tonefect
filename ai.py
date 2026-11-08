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

MODELS = {
    "isnet": {"name": "isnet-general-use.onnx", "size": 178_648_008,
              "url": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
              "sha256": "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a"},
    # LaMa: nesne silme ve bosluk doldurma (Apache-2.0)
    "lama": {"name": "lama_fp32.onnx", "size": 208_044_816,
             "url": "https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx",
             "sha256": "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6"},
}
INPUT = 1024
LAMA_INPUT = 512
MATTE_MAX = 2048  # saklanan maskenin en uzun kenari

STATES = {k: {"state": "idle", "done": 0, "total": m["size"], "error": ""} for k, m in MODELS.items()}
STATE = STATES["isnet"]
_sessions = {}
_lock = threading.Lock()


def model_path(root, model="isnet"):
    return Path(root) / "models" / MODELS[model]["name"]


def installed(root, model="isnet"):
    p = model_path(root, model)
    return p.is_file() and p.stat().st_size == MODELS[model]["size"]


def downloading():
    return any(st["state"] == "downloading" for st in STATES.values())


def download(root, model="isnet"):
    """Modeli indirir (arka planda cagrilir); STATES ilerlemeyi tutar."""
    m, st = MODELS[model], STATES[model]
    dest = model_path(root, model)
    tmp = dest.with_suffix(".part")
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        st.update(state="downloading", done=0, total=m["size"], error="")
        h = hashlib.sha256()
        req = urllib.request.Request(m["url"], headers={"User-Agent": "Tonefect"})
        with urllib.request.urlopen(req, timeout=30) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(512 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                h.update(chunk)
                st["done"] += len(chunk)
        if h.hexdigest() != m["sha256"]:
            raise RuntimeError("İndirilen model doğrulanamadı (dosya bozuk ya da değişmiş).")
        tmp.replace(dest)
        st.update(state="ready")
    except Exception as e:
        tmp.unlink(missing_ok=True)
        st.update(state="error", error=str(e))


def status(root, model="isnet"):
    size = MODELS[model]["size"]
    if installed(root, model) and STATES[model]["state"] != "downloading":
        return {"state": "ready", "done": size, "total": size, "error": "", "size": size}
    return {**STATES[model], "size": size}


def _get_session(root, model="isnet"):
    with _lock:
        if model not in _sessions:
            if not installed(root, model):
                raise RuntimeError("Yapay zekâ modeli kurulu değil.")
            import onnxruntime as ort  # gecikmeli: uygulama acilisini yavaslatmasin
            opts = ort.SessionOptions()
            opts.log_severity_level = 3
            _sessions[model] = ort.InferenceSession(str(model_path(root, model)), opts, providers=["CPUExecutionProvider"])
        return _sessions[model]


def warm(root, model):
    """Modeli arka planda belleğe alır (ilk yükleme ~20 sn sürebilir)."""
    try:
        _get_session(root, model)
    except Exception:
        pass


def lama_fill(root, rgb, hole):
    """rgb: H x W x 3 (0..1), hole: H x W bool. LaMa ile doldurulmus H x W x 3 (0..1) dondurur."""
    sess = _get_session(root, "lama")
    h, w = hole.shape
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((LAMA_INPUT, LAMA_INPUT), Image.LANCZOS)
    mask = Image.fromarray(hole.astype(np.uint8) * 255).resize((LAMA_INPUT, LAMA_INPUT), Image.BILINEAR)
    x = np.asarray(img, np.float32).transpose(2, 0, 1)[None] / 255.0
    m = (np.asarray(mask, np.float32)[None, None] > 25).astype(np.float32)  # kenar pikselleri de maskeye girsin
    names = [i.name for i in sess.get_inputs()]
    out = sess.run(None, {names[0]: x, names[1]: m})[0][0].transpose(1, 2, 0)
    res = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)
    return np.asarray(res, np.float32) / 255.0


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

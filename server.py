#!/usr/bin/env python3
"""Grainline - yerel sunucu ve uygulama penceresi.

Arayuz (web/ klasoru, React + shadcn/ui) bu sunucuyla konusur; gorsel uretim render.py motorunu kullanir.
Calistir:  python server.py        (NegansVision.bat bunu yapar)
"""
import base64
import io
import json
import mimetypes
import os
import re
import socket
import subprocess
import sys
import threading
import time
import traceback
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

if sys.stdout is None:  # exe (konsolsuz) modunda
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

from PIL import Image, ImageOps

import render as engine

HERE = engine.HERE
WEB = HERE / "web"
UPLOADS = HERE / "uploads"
THUMBS = UPLOADS / ".thumbs"
SESSION = HERE / "oturum_web.json"
DEFAULT_OUT = HERE / "output"

CFG = json.loads((HERE / "brand.json").read_text(encoding="utf-8"))
W, H = CFG["canvas"]["width"], CFG["canvas"]["height"]
TONES = list(CFG["tones"].keys())
ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".webp"}
WEIGHTS = set(engine.WEIGHT_ALIASES.keys())

LOCK = threading.Lock()
CROP, BASE, JOBS = {}, {}, {}
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


def clean_item(d):
    text = " ".join(str(d.get("text", "")).split())
    tone = d.get("tone") if d.get("tone") in TONES else TONES[0]
    fx_in = d.get("fx") or {}
    fx = {"bw": bool(fx_in.get("bw", True)),
          "grain": max(0.0, min(2.0, float(fx_in.get("grain", 1.0)))),
          "vignette": max(0.0, min(2.0, float(fx_in.get("vignette", 1.0))))}
    block = d.get("block") or [0, 0]
    offsets = {str(k): (float(v[0]), float(v[1])) for k, v in (d.get("offsets") or {}).items()}
    return {
        "text": text, "tone": tone, "accent": str(d.get("accent", "")).strip(),
        "styles": clean_styles(d.get("styles"), len(text.split())),
        "fx": fx, "block": (float(block[0]), float(block[1])), "offsets": offsets,
    }


def get_base(path, fx):
    key = (str(path), fx["bw"], round(fx["grain"], 2), round(fx["vignette"], 2))
    if key in BASE:
        BASE[key] = BASE.pop(key)
        return BASE[key]
    crop = CROP.pop(str(path), None) or engine.load_cropped(CFG, path)
    CROP[str(path)] = crop
    while len(CROP) > 8:
        CROP.pop(next(iter(CROP)))
    base = engine.grade_base(CFG, crop, path, fx)
    BASE[key] = base
    while len(BASE) > 6:
        BASE.pop(next(iter(BASE)))
    return base


def render_preview(d):
    path = photo_path(d["photo"])
    item = clean_item(d)
    with LOCK:
        base = get_base(path, item["fx"])
        img, layout = engine.compose(CFG, base, item["text"], item["tone"], item["accent"],
                                     styles=item["styles"], block=item["block"], offsets=item["offsets"])
    out_w = max(200, min(1080, int(d.get("w", 640))))
    im = img.convert("RGB").resize((out_w, round(out_w * H / W)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=88)
    boxes = [{"idx": b["idx"], "box": [round(v, 1) for v in b["box"]]}
             for b in (layout["boxes"] if layout else [])]
    return {"image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
            "boxes": boxes, "size": layout["size"] if layout else 0, "w": W, "h": H}


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
    for k in [k for k in BASE if k[0] == str(p)]:
        BASE.pop(k, None)
    CROP.pop(str(p), None)


def load_session():
    try:
        data = json.loads(SESSION.read_text(encoding="utf-8"))
    except Exception:
        return {}
    data["items"] = [it for it in data.get("items", []) if (UPLOADS / Path(it.get("id", "")).name).is_file()]
    return data


# ------------------------------------------------------------------ uretim isi
def run_job(jid, d):
    job = JOBS[jid]
    try:
        out_dir = Path(d.get("outDir") or DEFAULT_OUT)
        if not out_dir.is_absolute():
            out_dir = HERE / out_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        job["outDir"] = str(out_dir)
        manifest = []
        for i, raw in enumerate(d["items"], start=1):
            try:
                item = clean_item(raw)
                path = photo_path(raw["id"])
                out = out_dir / f"{i:03d}_{Path(raw.get('name', path.name)).stem[:40] or 'foto'}.jpg"
                engine.render_one(CFG, path, item["text"], item["tone"], item["accent"], out,
                                  styles=item["styles"], fx=item["fx"], block=item["block"],
                                  offsets=item["offsets"])
                manifest.append({
                    "image": raw.get("name", path.name), "text": item["text"], "tone": item["tone"],
                    "accent_word": item["accent"],
                    "caption": "", "output": str(out)})
                job["files"].append({"name": out.name, "text": item["text"]})
            except Exception as e:
                job["errors"].append(f"{raw.get('name', '?')}: {e}")
            job["done"] = i
        (out_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        job["errors"].append(f"{e}")
        traceback.print_exc()
    job["finished"] = True


def open_folder(path):
    p = Path(path)
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
    server_version = "NegansVision"

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
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

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
                    "limits": CFG.get("limits", {}),
                    "fontWarn": missing, "outDir": str(DEFAULT_OUT)})
            if c == "/api/session" and m == "GET":
                return self._json(load_session())
            if c == "/api/session" and m == "PUT":
                tmp = SESSION.with_suffix(".tmp")
                tmp.write_bytes(self._body())
                tmp.replace(SESSION)
                return self._json({"ok": True})
            if c == "/api/photos" and m == "POST":
                return self._json(save_photo(q.get("name", ["foto.jpg"])[0], self._body()))
            if c.startswith("/api/photos/") and m == "DELETE":
                delete_photo(c.rsplit("/", 1)[1])
                return self._json({"ok": True})
            if c.startswith("/api/thumb/") and m in ("GET", "HEAD"):
                t = THUMBS / (Path(c.rsplit("/", 1)[1]).name + ".jpg")
                return self._file(t, cache=True) if t.is_file() else self._err(404, "yok")
            if c == "/api/preview" and m == "POST":
                return self._json(render_preview(json.loads(self._body())))
            if c == "/api/generate" and m == "POST":
                d = json.loads(self._body())
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
                subprocess.Popen([str(exe), f"--app={url}", "--window-size=1380,900", "--no-first-run",
                                  f"--user-data-dir={HERE / '.webprofile'}"])
                return
            except OSError:
                continue
    webbrowser.open(url)


def main():
    global PORT
    PORT = free_port(int(os.environ.get("NV_PORT", 8765)))
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    url = f"http://127.0.0.1:{PORT}/"
    print(f"Grainline çalışıyor: {url}")
    print("Kapatmak için uygulamadaki güç düğmesine bas ya da bu pencereyi kapat.")
    if "--no-window" not in sys.argv:
        threading.Timer(0.6, open_window, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

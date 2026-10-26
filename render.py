#!/usr/bin/env python3
"""NEGAN'S VISION - gorsel uretim scripti.

Kullanim:
  python render.py                      # queue.csv'deki tum satirlari isle
  python render.py --queue queue.csv --input input --output output
  python render.py --image input/a.jpg --text "Your sentence." --tone quiet --accent "sentence"
"""
import argparse
import csv
import json
import re
import sys
import zlib
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

# .exe olarak paketlenirse dosyalar (brand.json, fonts) exe'nin yaninda aranir
HERE = (Path(sys.executable).resolve().parent if getattr(sys, "frozen", False)
        else Path(__file__).resolve().parent)

FALLBACK_FONTS = {
    "quiet": ["DejaVuSerif.ttf", "DejaVuSans.ttf"],
    "hard": ["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"],
    "signature": ["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"],
}


# ----------------------------------------------------------------- yardimcilar
def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def load_font(cfg, role, size):
    candidates = [cfg["fonts"].get(role, "")] + FALLBACK_FONTS.get(role, [])
    for c in candidates:
        if not c:
            continue
        p = Path(c)
        if not p.is_absolute():
            p = HERE / p
        for attempt in (str(p), c):
            try:
                return ImageFont.truetype(attempt, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


def font_was_fallback(cfg, role):
    p = Path(cfg["fonts"].get(role, ""))
    if not p.is_absolute():
        p = HERE / p
    return not p.exists()


# ------------------------------------------------------------- gorsel isleme
def cover_crop(img, size, focus=(0.5, 0.5)):
    """4:5'e doldurarak kirp (EXIF yonunu duzelt)."""
    img = ImageOps.exif_transpose(img).convert("RGB")
    return ImageOps.fit(img, size, method=Image.LANCZOS, centering=focus)


def grade(img, cfg, seed, fx=None):
    """fx: {"bw": bool, "grain": 0..1+ (carpan), "vignette": 0..1+ (carpan)}"""
    s = dict(cfg["image"])
    if fx:
        if not fx.get("bw", True):
            s["saturation"] = s.get("color_saturation", 0.85)
        s["grain"] = s["grain"] * float(fx.get("grain", 1.0))
        s["vignette"] = s["vignette"] * float(fx.get("vignette", 1.0))
    arr = np.asarray(img, dtype=np.float32) / 255.0
    gray = (arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
    arr = gray + (arr - gray) * s["saturation"]
    arr = (arr - 0.5) * s["contrast"] + 0.5
    arr = arr * s["brightness"]

    h, w = arr.shape[:2]
    if s["vignette"] > 0:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
        arr = arr * (1.0 - s["vignette"] * r ** 2)[..., None]

    if s["grain"] > 0:
        rng = np.random.default_rng(seed)
        noise = rng.normal(0.0, s["grain"], (h, w)).astype(np.float32)
        noise_img = Image.fromarray(np.clip(noise * 2 * 127.5 + 127.5, 0, 255).astype(np.uint8), "L")
        noise_img = noise_img.filter(ImageFilter.GaussianBlur(0.6))
        noise = (np.asarray(noise_img, dtype=np.float32) - 127.5) / 127.5 * 1.6
        arr = arr + noise[..., None]

    return Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGB")


# --------------------------------------------------------------------- yazi
def word_width(font, word, tracking):
    if tracking == 0:
        return font.getlength(word)
    return sum(font.getlength(c) + tracking for c in word) - tracking


def wrap(words, font, tracking, max_w):
    space = font.getlength(" ") + tracking
    lines, cur, cur_w = [], [], 0.0
    for wd in words:
        ww = word_width(font, wd, tracking)
        add = ww if not cur else space + ww
        if cur and cur_w + add > max_w:
            lines.append(cur)
            cur, cur_w = [wd], ww
        else:
            cur.append(wd)
            cur_w += add
    if cur:
        lines.append(cur)
    return lines


def draw_word(draw, x, y, word, font, fill, tracking, anchor="la"):
    if tracking == 0:
        draw.text((x, y), word, font=font, fill=fill, anchor=anchor)
        return
    for c in word:
        draw.text((x, y), c, font=font, fill=fill, anchor=anchor)
        x += font.getlength(c) + tracking


def norm(w):
    return re.sub(r"[^\w']", "", w).lower()


WEIGHT_CHAIN = ["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold",
                "Bold", "ExtraBold", "Black"]
WEIGHT_ALIASES = {"thin": "Thin", "extralight": "ExtraLight", "light": "Light",
                  "regular": "Regular", "medium": "Medium", "semibold": "SemiBold",
                  "bold": "Bold", "extrabold": "ExtraBold", "black": "Black"}
_font_cache = {}


def font_for(cfg, role, size, weight=None, italic=False):
    """Aile (Montserrat/Cormorant) icinde istenen kalinlik ve italik fontu bul.
    Istenen kalinlik dosyasi yoksa en yakin olani kullanir."""
    size = max(6, int(round(size)))
    if not weight and not italic:
        return load_font(cfg, role, size)
    base = Path(cfg["fonts"].get(role, ""))
    if not base.is_absolute():
        base = HERE / base
    stem = base.stem
    family, _, default_w = stem.rpartition("-")
    if not family:
        return load_font(cfg, role, size)
    want = WEIGHT_ALIASES.get((weight or "").lower()) or (default_w if default_w in WEIGHT_CHAIN else "Regular")
    key = (str(base.parent), family, want, bool(italic), size)
    if key in _font_cache:
        return _font_cache[key]
    idx = WEIGHT_CHAIN.index(want)
    order = sorted(range(len(WEIGHT_CHAIN)), key=lambda i: (abs(i - idx), i > idx))
    font = None
    for use_italic in ([True, False] if italic else [False]):
        for i in order:
            w = WEIGHT_CHAIN[i]
            name = f"{family}-{('Italic' if w == 'Regular' else w + 'Italic') if use_italic else w}.ttf"
            p = base.parent / name
            if p.exists():
                try:
                    font = ImageFont.truetype(str(p), size)
                    break
                except OSError:
                    continue
        if font:
            break
    if font is None:
        font = load_font(cfg, role, size)
    _font_cache[key] = font
    return font


TR_CHARS = set("çğıöşüÇĞİÖŞÜ")


def to_upper(text, turkish):
    """Turkce metinde i -> İ ve ı -> I olmali (str.upper 'bir' kelimesini 'BIR' yapar)."""
    if turkish:
        text = text.replace("i", "İ").replace("ı", "I")
    return text.upper()


def build_specs(text, accent_word, styles, uppercase):
    """Her kelime icin stil: color, weight, italic, size(carpan). styles kelime sirasina gore liste."""
    accent_norm = norm(accent_word) if accent_word else None
    turkish = bool(TR_CHARS & set(text))
    specs = []
    for i, w in enumerate(text.split()):
        st = (styles[i] if styles and i < len(styles) and styles[i] else {})
        specs.append({
            "text": to_upper(w, turkish) if uppercase else w,
            "color": st.get("color"),
            "weight": st.get("weight"),
            "italic": bool(st.get("italic")),
            "scale": float(st.get("size") or 1.0),
            "accent": bool(accent_norm and norm(w) == accent_norm),
        })
    return specs


def wrap_idx(widths, space, max_w):
    lines, cur, cur_w = [], [], 0.0
    for i, ww in enumerate(widths):
        add = ww if not cur else space + ww
        if cur and cur_w + add > max_w:
            lines.append(cur)
            cur, cur_w = [i], ww
        else:
            cur.append(i)
            cur_w += add
    if cur:
        lines.append(cur)
    return lines


def layout_text(cfg, tone_name, specs, W, H):
    """Kelimelerin (kaydirma oncesi) konumlarini hesapla."""
    t = cfg["tones"][tone_name]
    margin = int(W * cfg["layout"]["margin_ratio"])
    max_w = W - 2 * margin
    max_h = int(H * t["max_height_ratio"])

    size = t["font_size_start"]
    while True:
        fonts, widths = [], []
        for sp in specs:
            sz = size * sp["scale"]
            f = font_for(cfg, tone_name, sz, sp["weight"], sp["italic"])
            tr = t["tracking_em"] * sz
            fonts.append((f, tr))
            widths.append(word_width(f, sp["text"], tr))
        space = font_for(cfg, tone_name, size).getlength(" ") + t["tracking_em"] * size
        lines = wrap_idx(widths, space, max_w)
        line_hs = [max(size * specs[i]["scale"] for i in ln) * t["line_spacing"] for ln in lines]
        block_h = sum(line_hs)
        if (len(lines) <= t["max_lines"] and block_h <= max_h) or size <= t["font_size_min"]:
            break
        size -= 2

    top = (H - block_h) / 2 if t["position"] == "center" else H * 0.86 - block_h
    words, y = [], top
    for ln, lh in zip(lines, line_hs):
        total = sum(widths[i] for i in ln) + space * (len(ln) - 1)
        x = margin if t["align"] == "left" else (W - total) / 2
        ascent = max(fonts[i][0].getmetrics()[0] for i in ln)
        for i in ln:
            f, tr = fonts[i]
            words.append({"idx": i, "text": specs[i]["text"], "font": f, "tracking": tr,
                          "x": x, "base": y + ascent, "w": widths[i],
                          "color": specs[i]["color"], "accent": specs[i]["accent"]})
            x += widths[i] + space
        y += lh
    return {"size": size, "top": top, "margin": margin, "words": words,
            "accent_line": t["accent_line"], "boxes": []}


def draw_layout(cfg, layout, W, H, block=(0, 0), offsets=None):
    """Yerlesimi cizer. block: tum metnin kaymasi, offsets: kelime bazli kayma (px)."""
    offsets = offsets or {}
    block = block or (0, 0)
    text_rgb = hex_to_rgb(cfg["colors"]["text"])
    accent_rgb = hex_to_rgb(cfg["colors"]["accent"])
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    boxes = []
    for w in layout["words"]:
        ox, oy = offsets.get(str(w["idx"]), (0, 0))
        x = w["x"] + block[0] + ox
        yb = w["base"] + block[1] + oy
        rgb = hex_to_rgb(w["color"]) if w["color"] else (accent_rgb if w["accent"] else text_rgb)
        draw_word(d, x, yb, w["text"], w["font"], rgb + (255,), w["tracking"], anchor="ls")
        asc, desc = w["font"].getmetrics()
        boxes.append({"idx": w["idx"], "box": (x, yb - asc, x + w["w"], yb + desc)})
    if layout["accent_line"]:
        ly = int(layout["top"] - 34 + block[1])
        lx = layout["margin"] + block[0]
        d.rectangle([lx, ly, lx + 84, ly + 2], fill=accent_rgb + (255,))
    layout["boxes"] = boxes
    return layer


def add_shadow(layer, radius=14, strength=0.65):
    alpha = layer.split()[3].filter(ImageFilter.GaussianBlur(radius))
    alpha = alpha.point(lambda v: int(min(255, v * strength * 1.6)))
    shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    shadow.putalpha(alpha)
    return Image.alpha_composite(shadow, layer)


def signature_layer(cfg, W, H):
    s = cfg["signature"]
    font = load_font(cfg, "signature", s["size"])
    tracking = s["tracking_em"] * s["size"]
    text = cfg["brand"]["signature_text"].upper()
    w = word_width(font, text, tracking)
    margin = int(W * cfg["layout"]["margin_ratio"])
    x = W - margin - w
    y = H - int(H * s["bottom_margin_ratio"]) - s["size"]
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rgb = hex_to_rgb(cfg["colors"]["text"])
    draw_word(ImageDraw.Draw(layer), x, y, text, font, rgb + (int(255 * s["opacity"]),), tracking)
    return layer


# ------------------------------------------------------------------ ana akis
def load_cropped(cfg, image_path):
    W, H = cfg["canvas"]["width"], cfg["canvas"]["height"]
    return cover_crop(Image.open(image_path), (W, H))


def grade_base(cfg, cropped, image_path, fx=None):
    seed = zlib.crc32(str(Path(image_path).name).encode())
    return grade(cropped, cfg, seed, fx).convert("RGBA")


def make_base(cfg, image_path, fx=None):
    """Fotografi kirp + siyah-beyaz/vinyet/gren uygula (yazi yok)."""
    return grade_base(cfg, load_cropped(cfg, image_path), image_path, fx)


def compose(cfg, base, text, tone, accent_word="", styles=None, block=(0, 0), offsets=None):
    """Hazir zemine yazi ve imzayi ekle. (gorsel, yerlesim) dondurur; yazi yoksa yerlesim None."""
    W, H = base.size
    layout, img = None, base
    if text.strip():
        specs = build_specs(text, accent_word, styles, cfg["tones"][tone]["uppercase"])
        layout = layout_text(cfg, tone, specs, W, H)
        layer = draw_layout(cfg, layout, W, H, block, offsets)
        img = Image.alpha_composite(img, add_shadow(layer))
    img = Image.alpha_composite(img, signature_layer(cfg, W, H))
    return img, layout


def render_one(cfg, image_path, text, tone, accent_word, out_path,
               styles=None, fx=None, block=(0, 0), offsets=None):
    out_path = Path(out_path)
    base = make_base(cfg, image_path, fx)
    img, layout = compose(cfg, base, text, tone, accent_word, styles, block, offsets)
    size = layout["size"] if layout else 0
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, "JPEG", quality=95, subsampling=0)
    return size


def check_row(cfg, row):
    warns = []
    n = len(row["text"].split())
    if n > cfg["limits"]["max_words"]:
        warns.append(f"{n} kelime (onerilen en fazla {cfg['limits']['max_words']})")
    if row.get("accent_word") and norm(row["accent_word"]) not in [norm(w) for w in row["text"].split()]:
        warns.append(f"accent_word '{row['accent_word']}' metinde yok")
    if row["tone"] not in cfg["tones"]:
        warns.append(f"bilinmeyen ton '{row['tone']}' (quiet/hard)")
    return warns


IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def natural_key(p):
    """01, 2, 10 gibi adlari dogru sirala (2, 10'dan once gelir)."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", p.name)]


def parse_texts(path):
    """texts.txt satiri:  ton | metin | vurgu_kelimesi   (ton ve vurgu opsiyonel)"""
    rows = []
    for n, line in enumerate(Path(path).read_text(encoding="utf-8-sig").splitlines(), start=1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) == 1:
            tone, text, accent = "quiet", parts[0], ""
        elif len(parts) == 2:
            tone, text, accent = parts[0], parts[1], ""
        else:
            tone, text, accent = parts[0], parts[1], parts[2]
        rows.append({"tone": tone.lower(), "text": text, "accent_word": accent, "line": n})
    return rows


def run_texts(cfg, args):
    in_dir, out_dir = Path(args.input), Path(args.output)
    photos = sorted((p for p in in_dir.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXT),
                    key=natural_key) if in_dir.exists() else []
    rows = parse_texts(args.texts)

    if not photos:
        sys.exit(f"[hata] {in_dir} icinde fotograf yok.")
    if len(photos) != len(rows):
        sys.exit(f"[hata] {len(photos)} fotograf ama {len(rows)} metin var. "
                 f"Eski fotograflar input klasorunde kaldiysa tasi ya da --archive kullan.")

    bad = [r for r in rows if r["tone"] not in cfg["tones"]]
    if bad:
        for r in bad:
            print(f"[hata] texts.txt satir {r['line']}: bilinmeyen ton '{r['tone']}' "
                  f"({'/'.join(cfg['tones'])})")
        sys.exit(1)

    sched = cfg.get("schedule", {})
    hh, mm = (int(x) for x in sched.get("time", "20:00").split(":"))
    start = (datetime.strptime(args.start, "%Y-%m-%d") if args.start
             else datetime.now() + timedelta(days=1))
    start = start.replace(hour=hh, minute=mm, second=0, microsecond=0)

    manifest = []
    for i, (photo, row) in enumerate(zip(photos, rows), start=1):
        for w in check_row(cfg, row):
            print(f"[uyari] metin satiri {row['line']}: {w}")
        out = out_dir / f"{i:03d}_{photo.stem}.jpg"
        size = render_one(cfg, photo, row["text"], row["tone"], row["accent_word"], out)
        publish_at = (start + timedelta(days=i - 1)).strftime("%Y-%m-%d %H:%M")
        print(f"ok  {out.name}  ({row['tone']}, font {size}px, {publish_at})")
        manifest.append({"image": photo.name, "text": row["text"], "tone": row["tone"],
                         "accent_word": row["accent_word"], "publish_at": publish_at,
                         "caption": "", "output": str(out)})

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.archive:
        arch = in_dir / "kullanilanlar"
        arch.mkdir(exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d")
        for p in photos:
            target = arch / p.name
            if target.exists():
                target = arch / f"{stamp}_{p.name}"
            p.rename(target)
        print(f"{len(photos)} fotograf {arch} klasorune tasindi.")

    print(f"\n{len(manifest)} gorsel hazir. Liste: {out_dir / 'manifest.json'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(HERE / "brand.json"))
    ap.add_argument("--queue", default=str(HERE / "queue.csv"))
    ap.add_argument("--input", default=str(HERE / "input"))
    ap.add_argument("--output", default=str(HERE / "output"))
    ap.add_argument("--image")
    ap.add_argument("--text")
    ap.add_argument("--tone", default="quiet")
    ap.add_argument("--accent", default="")
    ap.add_argument("--out")
    ap.add_argument("--texts", default=str(HERE / "texts.txt"))
    ap.add_argument("--csv", action="store_true", help="texts.txt varken bile queue.csv kullan")
    ap.add_argument("--start", help="ilk paylasim tarihi YYYY-MM-DD (varsayilan: yarin)")
    ap.add_argument("--archive", action="store_true",
                    help="islenen fotograflari input/kullanilanlar klasorune tasi")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))

    for role in ("quiet", "hard", "signature"):
        if font_was_fallback(cfg, role):
            print(f"[uyari] '{role}' fontu bulunamadi, sistem fontu kullaniliyor: {cfg['fonts'][role]}")

    # tek gorsel onizleme modu
    if args.image:
        if not args.text:
            sys.exit("--image ile birlikte --text gerekli")
        out = Path(args.out or Path(args.output) / "preview.jpg")
        size = render_one(cfg, args.image, args.text, args.tone, args.accent, out)
        print(f"ok -> {out} (font {size}px)")
        return

    # texts.txt modu: fotograflar ad sirasina gore metinlerle eslesir
    if Path(args.texts).exists() and not args.csv:
        run_texts(cfg, args)
        return

    # kuyruk modu (queue.csv)
    qpath = Path(args.queue)
    if not qpath.exists():
        sys.exit(f"Kuyruk dosyasi yok: {qpath}")
    out_dir = Path(args.output)
    manifest, errors = [], 0

    with open(qpath, newline="", encoding="utf-8-sig") as f:
        for i, row in enumerate(csv.DictReader(f), start=1):
            row = {k: (v or "").strip() for k, v in row.items()}
            img_path = Path(args.input) / row["image"]
            if not img_path.exists():
                print(f"[hata] satir {i}: gorsel yok -> {img_path}")
                errors += 1
                continue
            for w in check_row(cfg, row):
                print(f"[uyari] satir {i}: {w}")
            if row["tone"] not in cfg["tones"]:
                errors += 1
                continue
            out = out_dir / f"{i:03d}_{Path(row['image']).stem}.jpg"
            size = render_one(cfg, img_path, row["text"], row["tone"], row.get("accent_word", ""), out)
            print(f"ok  {out.name}  ({row['tone']}, font {size}px)")
            manifest.append({**row, "output": str(out)})

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n{len(manifest)} gorsel hazir, {errors} hata. Liste: {out_dir / 'manifest.json'}")


if __name__ == "__main__":
    main()

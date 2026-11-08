"""Photoshop PSD dosyasi okuma ve yazma (ek kutuphane gerektirmez).

Okuma: RGB, gri ve CMYK; 8 ve 16 bit; katmanlar, gruplar, opaklik, karisim kipi, gorunurluk, kirpma maskesi.
Katman maskesi alfaya islenir. Ayar katmani, katman stili gibi piksel tasimayan bilgiler uyari olarak bildirilir.
Yazma: 8 bit RGB, katmanli, RLE sikistirmali.
"""
import io
import struct
import zlib

import numpy as np
from PIL import Image

# Tonefect karisim kipi -> PSD anahtari
BLEND = {"normal": b"norm", "dissolve": b"diss", "darken": b"dark", "multiply": b"mul ", "colorburn": b"idiv", "linearburn": b"lbrn", "darkercolor": b"dkCl",
         "lighten": b"lite", "screen": b"scrn", "colordodge": b"div ", "lineardodge": b"lddg", "lightercolor": b"lgCl", "overlay": b"over", "softlight": b"sLit",
         "hardlight": b"hLit", "vividlight": b"vLit", "linearlight": b"lLit", "pinlight": b"pLit", "hardmix": b"hMix", "difference": b"diff", "exclusion": b"smud",
         "subtract": b"fsub", "divide": b"fdiv", "hue": b"hue ", "saturation": b"sat ", "color": b"colr", "luminosity": b"lum "}
BLEND_IN = {v: k for k, v in BLEND.items()}
ADJUST_KEYS = {b"levl", b"curv", b"brit", b"blnc", b"hue2", b"hue ", b"selc", b"mixr", b"grdm", b"phfl", b"expA", b"blwh", b"vibA", b"post", b"thrs", b"nvrt", b"clrL", b"SoCo", b"GdFl", b"PtFl"}
EFFECT_KEYS = {b"lrFX", b"lfx2", b"lmfx"}
SIGS = (b"8BIM", b"8B64")


# ------------------------------------------------------------------ okuma
def _unpack_bits(b, want):
    out = bytearray()
    i, n = 0, len(b)
    while i < n and len(out) < want:
        c = b[i]
        i += 1
        if c < 128:
            out += b[i:i + c + 1]
            i += c + 1
        elif c > 128:
            out += bytes((b[i],)) * (257 - c)
            i += 1
    return bytes(out[:want]).ljust(want, b"\0")


def _to8(raw, w, h, depth):
    """Ham bayt -> h x w uint8 dizi (16 bitin yuksek bayti)."""
    if depth == 16:
        return (np.frombuffer(raw, ">u2", w * h).reshape(h, w) >> 8).astype(np.uint8)
    return np.frombuffer(raw, np.uint8, w * h).reshape(h, w)


def _channel(b, comp, w, h, depth):
    """Tek kanalin verisi (sikistirma baytlari haric)."""
    size = depth // 8
    want = w * h * size
    if comp == 0:
        return _to8(bytes(b[:want]).ljust(want, b"\0"), w, h, depth)
    if comp == 1:
        counts = struct.unpack(f">{h}H", b[:h * 2])
        pos, rows = h * 2, []
        for c in counts:
            rows.append(_unpack_bits(b[pos:pos + c], w * size))
            pos += c
        return _to8(b"".join(rows), w, h, depth)
    if comp in (2, 3):
        raw = zlib.decompress(bytes(b))
        if comp == 3:  # satir ici fark kodlamasi
            a = np.frombuffer(raw, ">u2" if depth == 16 else np.uint8, w * h).reshape(h, w)
            raw = np.cumsum(a, axis=1, dtype=a.dtype).astype(">u2" if depth == 16 else np.uint8).tobytes()
        return _to8(raw, w, h, depth)
    raise ValueError("PSD: bilinmeyen sıkıştırma")


def _rgb(ch, mode, w, h):
    """Kanallar -> h x w x 3. CMYK dosyada ters saklanir: 255 = murekkep yok."""
    get = lambda i: ch.get(i, np.zeros((h, w), np.uint8))
    if mode == 1:
        g = get(0)
        return np.dstack([g, g, g])
    if mode == 4:
        k = get(3).astype(np.float32) / 255.0
        return np.dstack([(get(i) * k + 0.5).astype(np.uint8) for i in range(3)])
    return np.dstack([get(0), get(1), get(2)])


def _parse_layers(data, pos, depth, mode, warn):
    """Katman kayitlari ve kanal verileri; alttan uste liste."""
    count = abs(struct.unpack_from(">h", data, pos)[0])
    pos += 2
    recs = []
    for _ in range(count):
        t, l, b, r, nch = struct.unpack_from(">4iH", data, pos)
        pos += 18
        chans = []
        for _c in range(nch):
            cid, clen = struct.unpack_from(">hI", data, pos)
            chans.append((cid, clen))
            pos += 6
        key = data[pos + 4:pos + 8]
        op, clip, flags = struct.unpack_from(">BBB", data, pos + 8)
        extra = struct.unpack_from(">I", data, pos + 12)[0]
        pos += 16
        end = pos + extra
        rec = {"t": t, "l": l, "b": b, "r": r, "chans": chans, "key": key, "op": op, "clip": clip, "flags": flags, "mask": None, "sect": 0, "uname": None, "adj": False, "fx": False}
        mlen = struct.unpack_from(">I", data, pos)[0]
        pos += 4
        if mlen >= 18:
            rec["mask"] = struct.unpack_from(">4iBB", data, pos)
        pos += mlen
        pos += 4 + struct.unpack_from(">I", data, pos)[0]  # karisim araliklari
        n = data[pos]
        rec["name"] = bytes(data[pos + 1:pos + 1 + n]).decode("mac_roman", "replace")
        pos += ((1 + n + 3) // 4) * 4
        while pos + 12 <= end:
            if bytes(data[pos:pos + 4]) not in SIGS:
                pos += 1
                continue
            k = bytes(data[pos + 4:pos + 8])
            ln = struct.unpack_from(">I", data, pos + 8)[0]
            body = data[pos + 12:pos + 12 + ln]
            if k == b"luni" and ln >= 4:
                c = struct.unpack_from(">I", body, 0)[0]
                rec["uname"] = bytes(body[4:4 + c * 2]).decode("utf-16-be", "replace").rstrip("\0")
            elif k in (b"lsct", b"lsdk") and ln >= 4:
                rec["sect"] = struct.unpack_from(">I", body, 0)[0]
            elif k in ADJUST_KEYS:
                rec["adj"] = True
            elif k in EFFECT_KEYS:
                rec["fx"] = True
            pos += 12 + ln
        pos = end
        recs.append(rec)

    layers, stack, groups = [], [], []
    skipped_adj = skipped_fx = 0
    for rec in recs:
        w, h = rec["r"] - rec["l"], rec["b"] - rec["t"]
        ch = {}
        for cid, clen in rec["chans"]:
            comp = struct.unpack_from(">H", data, pos)[0]
            body = data[pos + 2:pos + clen]
            pos += clen
            cw, ch_h = w, h
            if cid == -2 and rec["mask"]:
                mt, ml, mb, mr = rec["mask"][:4]
                cw, ch_h = mr - ml, mb - mt
            if cid < -2 or cw <= 0 or ch_h <= 0 or clen <= 2:
                continue
            ch[cid] = _channel(body, comp, cw, ch_h, depth)
        name = rec["uname"] or rec["name"]
        if rec["sect"] == 3:
            stack.append([])
            continue
        if rec["sect"] in (1, 2):
            members = stack.pop() if stack else []
            g = {"id": f"g{len(groups) + 1}", "name": name, "hidden": bool(rec["flags"] & 2)}
            groups.append(g)
            for ly in members:
                ly.setdefault("group", g["id"])
            if stack:
                stack[-1].extend(members)
            continue
        skipped_adj += rec["adj"]
        skipped_fx += rec["fx"]
        if w <= 0 or h <= 0:
            continue
        rgb = _rgb(ch, mode, w, h)
        alpha = ch.get(-1, np.full((h, w), 255, np.uint8))
        if rec["mask"] and -2 in ch and not rec["mask"][5] & 2:
            mt, ml, mb, mr, dflt, _ = rec["mask"]
            full = np.full((h, w), dflt, np.uint8)
            x0, y0, x1, y1 = max(ml, rec["l"]), max(mt, rec["t"]), min(mr, rec["r"]), min(mb, rec["b"])
            if x1 > x0 and y1 > y0:
                full[y0 - rec["t"]:y1 - rec["t"], x0 - rec["l"]:x1 - rec["l"]] = ch[-2][y0 - mt:y1 - mt, x0 - ml:x1 - ml]
            alpha = ((alpha.astype(np.uint16) * full + 127) // 255).astype(np.uint8)
        ly = {"name": name, "left": rec["l"], "top": rec["t"], "right": rec["r"], "bottom": rec["b"], "image": Image.fromarray(np.dstack([rgb, alpha]), "RGBA"),
              "opaque": int(alpha.min()) == 255, "opacity": rec["op"] / 255.0, "mode": BLEND_IN.get(rec["key"], "normal"), "hidden": bool(rec["flags"] & 2), "clip": rec["clip"] != 0}
        layers.append(ly)
        if stack:
            stack[-1].append(ly)
    if skipped_adj:
        warn.append(f"{skipped_adj} ayar veya dolgu katmanı aktarılamadı; görünüm Photoshop'takinden farklı olabilir.")
    if skipped_fx:
        warn.append(f"{skipped_fx} katmanın stili (gölge, kontur gibi) aktarılamadı.")
    return layers, groups


def read(data):
    """PSD baytlari -> {width, height, layers (alttan uste), groups, composite (RGB), warnings}."""
    if data[:4] != b"8BPS":
        raise ValueError("Bu dosya geçerli bir PSD değil.")
    ver, _, nch, h, w, depth, mode = struct.unpack_from(">H6sHIIHH", data, 4)
    if ver != 1:
        raise ValueError("PSB (büyük belge) dosyaları henüz desteklenmiyor; Photoshop'ta PSD olarak kaydet.")
    if depth not in (8, 16) or mode not in (1, 3, 4):
        names = {0: "Bitmap", 2: "Indexed", 7: "Multichannel", 8: "Duotone", 9: "Lab"}
        raise ValueError(f"Bu PSD türü desteklenmiyor ({names.get(mode, 'RGB')}, {depth} bit). Photoshop'ta 8 bit RGB olarak kaydet.")
    view = memoryview(data)
    pos = 26
    pos += 4 + struct.unpack_from(">I", data, pos)[0]  # renk kipi verisi
    pos += 4 + struct.unpack_from(">I", data, pos)[0]  # kaynaklar
    llen = struct.unpack_from(">I", data, pos)[0]
    start = pos + 4
    warn, layers, groups = [], [], []
    if llen:
        ilen = struct.unpack_from(">I", data, start)[0]
        if ilen:
            layers, groups = _parse_layers(view, start + 4, depth, mode, warn)
        # 16 bit katmanlar global maskeden sonra Lr16 blogundadir
        p = start + 4 + ilen
        if p + 4 <= start + llen:
            p += 4 + struct.unpack_from(">I", data, p)[0]
        while p + 12 <= start + llen:
            if data[p:p + 4] not in SIGS:
                p += 1
                continue
            k, ln = data[p + 4:p + 8], struct.unpack_from(">I", data, p + 8)[0]
            if k in (b"Lr16", b"Lr32") and not layers and ln:
                layers, groups = _parse_layers(view, p + 12, depth, mode, warn)
            p += 12 + ln
    pos = start + llen
    comp = struct.unpack_from(">H", data, pos)[0]
    pos += 2
    size = depth // 8
    ch = {}
    use = min(nch, {1: 1, 3: 3, 4: 4}[mode])
    if comp == 0:
        for i in range(use):
            ch[i] = _to8(bytes(view[pos:pos + w * h * size]), w, h, depth)
            pos += w * h * size
    else:
        counts = struct.unpack_from(f">{nch * h}H", data, pos)
        pos += nch * h * 2
        for i in range(use):
            rows = []
            for c in counts[i * h:(i + 1) * h]:
                rows.append(_unpack_bits(view[pos:pos + c], w * size))
                pos += c
            ch[i] = _to8(b"".join(rows), w, h, depth)
    return {"width": w, "height": h, "layers": layers, "groups": groups, "composite": Image.fromarray(_rgb(ch, mode, w, h), "RGB"), "warnings": warn}


# ------------------------------------------------------------------ yazma
def _pack_row(row):
    """PackBits; yalnizca 3+ tekrarlar icin dongu doner, fotograflarda hizlidir."""
    n = len(row)
    edges = np.flatnonzero(row[1:] != row[:-1]) + 1
    starts = np.concatenate(([0], edges))
    lens = np.concatenate((edges, [n])) - starts
    keep = lens >= 3
    data = row.tobytes()
    out = bytearray()

    def literal(a, b):
        while a < b:
            k = min(b - a, 128)
            out.append(k - 1)
            out.extend(data[a:a + k])
            a += k

    lit = 0
    for s, ln in zip(starts[keep].tolist(), lens[keep].tolist()):
        literal(lit, s)
        lit = s + ln
        while ln > 0:
            k = min(ln, 128)
            if k == 1:
                out.extend((0, data[s]))
            else:
                out.extend((257 - k, data[s]))
            ln -= k
    literal(lit, n)
    return bytes(out)


def _rle(a):
    """h x w dizi -> (satir uzunluklari, veri)."""
    rows = [_pack_row(r) for r in a]
    return struct.pack(f">{len(rows)}H", *[len(r) for r in rows]), b"".join(rows)


def _pad(b, n):
    return b + b"\0" * (-len(b) % n)


def _tag(key, body):
    body = _pad(body, 2)
    return b"8BIM" + key + struct.pack(">I", len(body)) + body


def _record(name, rect, channels, key, opacity, clip, flags, tags=b""):
    t, l, b, r = rect
    head = struct.pack(">4iH", t, l, b, r, len(channels))
    for cid, ln in channels:
        head += struct.pack(">hI", cid, ln)
    short = name.encode("mac_roman", "replace")[:255]
    pas = _pad(bytes((len(short),)) + short, 4)
    uni = name.encode("utf-16-be")
    extra = struct.pack(">II", 0, 0) + pas + _tag(b"luni", struct.pack(">I", len(uni) // 2) + uni) + tags
    return head + b"8BIM" + key + struct.pack(">BBBB", opacity, clip, flags, 0) + struct.pack(">I", len(extra)) + extra


def _layer_block(ly, W, H):
    """Tek katmanin kaydi ve kanal verisi."""
    img = ly["image"].convert("RGBA")
    box = img.getchannel("A").getbbox()
    op = max(0, min(255, round(float(ly.get("opacity", 1.0)) * 255)))
    key = BLEND.get(ly.get("mode") or "normal", b"norm")
    flags = (2 if ly.get("hidden") else 0) | 8  # bit 3: PS 5.0+
    clip = 1 if ly.get("clip") else 0
    if not box:
        return _record(ly["name"], (0, 0, 0, 0), [(-1, 2), (0, 2), (1, 2), (2, 2)], key, op, clip, flags), b"\0\0" * 4
    a = np.asarray(img.crop(box))
    blobs, chans = [], []
    for cid, idx in ((-1, 3), (0, 0), (1, 1), (2, 2)):
        counts, body = _rle(a[..., idx])
        blob = b"\0\1" + counts + body
        blobs.append(blob)
        chans.append((cid, len(blob)))
    return _record(ly["name"], (box[1], box[0], box[3], box[2]), chans, key, op, clip, flags), b"".join(blobs)


def write(path, width, height, layers, composite, dpi=None):
    """layers: alttan uste [{name, image (RGBA, tuval boyutunda), opacity, mode, hidden, clip, group}]; composite: birlesik gorsel."""
    records, pixels = [], []
    empty = [(-1, 2), (0, 2), (1, 2), (2, 2)]
    blank = b"\0\0" * 4
    i, n = 0, len(layers)
    add = lambda r, p: (records.append(r), pixels.append(p))
    while i < n:
        g = layers[i].get("group")
        if not g:
            add(*_layer_block(layers[i], width, height))
            i += 1
            continue
        # grup: altta kapanis, ustte klasor kaydi
        add(_record("</Layer group>", (0, 0, 0, 0), empty, b"norm", 255, 0, 8 | 16, _tag(b"lsct", struct.pack(">I", 3))), blank)
        while i < n and layers[i].get("group") == g:
            add(*_layer_block(layers[i], width, height))
            i += 1
        add(_record(g, (0, 0, 0, 0), empty, b"pass", 255, 0, 8 | 16, _tag(b"lsct", struct.pack(">I4s4s", 1, b"8BIM", b"pass"))), blank)

    info = _pad(struct.pack(">h", len(records)) + b"".join(records) + b"".join(pixels), 2)
    section = struct.pack(">I", len(info)) + info + struct.pack(">I", 0)

    res = b""
    if dpi:
        fixed = int(dpi) << 16
        res = b"8BIM" + struct.pack(">H", 1005) + b"\0\0" + struct.pack(">I", 16) + struct.pack(">IHHIHH", fixed, 1, 1, fixed, 1, 1)

    flat = composite.convert("RGBA")
    bg = Image.new("RGB", flat.size, (255, 255, 255))
    bg.paste(flat, mask=flat.getchannel("A"))
    arr = np.asarray(bg)
    counts, bodies = [], []
    for c in range(3):
        cnt, body = _rle(arr[..., c])
        counts.append(cnt)
        bodies.append(body)

    buf = io.BytesIO()
    buf.write(b"8BPS" + struct.pack(">H6sHIIHH", 1, b"\0" * 6, 3, height, width, 8, 3))
    buf.write(struct.pack(">I", 0))
    buf.write(struct.pack(">I", len(res)) + res)
    buf.write(struct.pack(">I", len(section)) + section)
    buf.write(b"\0\1" + b"".join(counts) + b"".join(bodies))
    with open(path, "wb") as f:
        f.write(buf.getvalue())

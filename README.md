<p align="center"><img src="assets/logo.png" width="112" alt="Tonefect logo"></p>

<h1 align="center">Tonefect</h1>
<p align="center"><i>one-click colour & effects for your photos</i></p>

**English** · [Türkçe](#türkçe)

Tonefect (formerly Grainline) is a small desktop photo editor: one-click colour looks and effects, crop and resize at the original size, local adjustments, and optional text and watermark for quote / social posts. Everything runs on your computer.

## Features
- **One-click colour library** – natural, cinematic, film and black & white looks shown on a sample photo, with intensity. Save your own looks, and import Lightroom presets (.xmp, .lrtemplate, mobile .dng) and LUTs (.cube), even as a .zip pack.
- **Auto enhance** – fixes exposure, tone range, highlights/shadows and contrast in one click; the values stay editable.
- **Light & colour** – exposure, contrast, highlights, shadows, whites, blacks, fade, temperature, tint, vibrance, saturation and an 8-colour HSL mixer (hue, saturation, luminance).
- **Detail** – sharpening, clarity and noise reduction.
- **Local adjustments** – linear and radial masks with their own light/colour/clarity, dragged right on the photo.
- **Crop & size** – original size or any ratio (1:1, 4:5, 9:16, 16:9 …), rotate, flip, straighten, output size presets or custom width × height.
- **Effects** – black & white, film grain, vignette, light leaks, bloom, dust & scratches, and frames (solid, Polaroid, film strip, inner line).
- **Before/after & zoom** – split view or hold to compare; zoom up to 1:1 and beyond.
- **Text (optional)** – per-word colour/weight/italic/size, any installed font, shadow, outline, letter and line spacing; drag with smart guides.
- **Watermark (optional)** – any corner, centre or tiled, with opacity and size.
- **Copy / paste settings**, undo/redo, themes (Tonefect, light, classic gold, cyberpunk, retro, pixel).
- **Export** – JPEG, PNG or WebP with quality, numbered or original names, optional EXIF (location always removed), all photos or just one.

## Download (Windows)
Get `Tonefect-Setup.exe` from the [Releases](../../releases) page and run it (no admin rights needed). Then open **Tonefect** from the Start menu or desktop. No Python needed.

## Run from source
```bash
pip install -r requirements.txt
python server.py
```
The installer is built automatically by GitHub Actions (`.github/workflows/release.yml`) whenever a `v*` tag is pushed.

## Branding
All branding (name, handle, colours, fonts, sizes) lives in `brand.json`.

## Developing the UI
```bash
cd webui
npm install
npm run build        # then copy webui/dist to ./web
```
`npm run dev` proxies `/api` to a running `server.py` (default port 8791, set with `NV_PORT`).

## Architecture
- `render.py` – Pillow + numpy rendering engine (grading, grain, layout, per-word styles).
- `looks.py` – colour presets, Lightroom/LUT import.
- `server.py` – standard-library HTTP server: preview/generate API, photo uploads, session autosave. Only accepts `127.0.0.1` requests.
- `webui/` – React source; `web/` – built UI that the server serves.

---

# Türkçe

Tonefect (eski adıyla Grainline) küçük bir masaüstü fotoğraf düzenleyicisidir: tek tıkla renk görünümleri ve efektler, orijinal boyutta kırpma ve boyutlandırma, yerel düzenlemeler ve söz/sosyal medya paylaşımları için isteğe bağlı yazı ve filigran. Her şey bilgisayarında çalışır.

## Özellikler
- **Tek tıkla renk kütüphanesi** – doğal, sinematik, film ve siyah-beyaz görünümler örnek fotoğraf üzerinde, yoğunluk ayarıyla. Kendi görünümlerini kaydet; Lightroom ayarlarını (.xmp, .lrtemplate, mobil .dng) ve LUT'ları (.cube), .zip paketi olarak bile içe aktar.
- **Otomatik iyileştirme** – pozlama, ton aralığı, parlak alan/gölge ve kontrastı tek tıkla düzeltir; değerler sonra değiştirilebilir.
- **Işık ve renk** – pozlama, kontrast, parlak alanlar, gölgeler, beyazlar, siyahlar, soldurma, sıcaklık, renk tonu, canlılık, doygunluk ve 8 renkli HSL karıştırıcı.
- **Detay** – keskinlik, netlik ve gürültü azaltma.
- **Yerel düzenlemeler** – kendi ışık/renk/netlik ayarları olan degrade ve dairesel maskeler; doğrudan fotoğrafın üzerinde sürüklenir.
- **Kırp ve boyut** – orijinal boyut ya da her oran (1:1, 4:5, 9:16, 16:9 …), döndür, çevir, eğim düzelt, hazır ya da elle genişlik × yükseklik.
- **Efektler** – siyah-beyaz, film greni, vinyet, ışık sızıntısı, ışıma, toz ve çizik ile çerçeveler (düz, Polaroid, film şeridi, ince çizgi).
- **Önce/sonra ve yakınlaştırma** – bölünmüş görünüm ya da basılı tutarak karşılaştır; %100 ve üstüne yakınlaştır.
- **Yazı (isteğe bağlı)** – kelime bazında renk/kalınlık/italik/boyut, bilgisayardaki her yazı tipi, gölge, kontur, harf ve satır aralığı; akıllı kılavuzlarla sürükle.
- **Filigran (isteğe bağlı)** – köşeler, orta ya da döşeme; opaklık ve boyut.
- **Ayarları kopyala/yapıştır**, geri al/yinele, temalar (Tonefect, gündüz, klasik altın, cyberpunk, retro, pixel).
- **Dışa aktarma** – JPEG, PNG ya da WebP, kalite, numaralı ya da orijinal ad, isteğe bağlı EXIF (konum her zaman silinir), tüm fotoğraflar ya da tek fotoğraf.

## İndir (Windows)
[Releases](../../releases) sayfasından `Tonefect-Setup.exe` dosyasını indirip çalıştır (yönetici izni gerekmez). Kurulumdan sonra Başlat menüsü ya da masaüstünden **Tonefect**'i aç. Python gerekmez.

## Kaynaktan çalıştırma
```bash
pip install -r requirements.txt
python server.py
```
Kurulum dosyası, `v*` etiketi pushlandığında GitHub Actions (`.github/workflows/release.yml`) tarafından otomatik derlenir.

## Marka ayarları
İsim, kullanıcı adı, renkler, fontlar ve boyutlar `brand.json` içindedir.

## Arayüzü geliştirmek
```bash
cd webui
npm install
npm run build        # sonra webui/dist içeriğini ./web klasörüne kopyala
```

## Mimari
- `render.py` – Pillow + numpy çizim motoru (renk işleme, grain, yerleşim, kelime stilleri).
- `looks.py` – hazır renk ayarları, Lightroom/LUT içe aktarma.
- `server.py` – standart kütüphane HTTP sunucusu: önizleme/üretim API'si, fotoğraf yükleme, oturum kaydı. Yalnızca `127.0.0.1` isteklerini kabul eder.
- `webui/` – React kaynağı; `web/` – sunucunun servis ettiği derlenmiş arayüz.

## License / Lisans
MIT (code). Bundled fonts (Cormorant Garamond, Montserrat) are under SIL OFL; licences are in `fonts/`. / Kod MIT, dahil edilen fontlar (Cormorant Garamond, Montserrat) SIL OFL lisanslıdır, lisanslar `fonts/` içindedir.

The sample photo used for preset previews (`webui/public/sample.jpg`) is [Narrow Streets of Genoa](https://commons.wikimedia.org/wiki/File:Narrow_Streets_of_Genoa_(Unsplash).jpg) from Unsplash, CC0. / Hazır ayar önizlemelerindeki örnek fotoğraf (`webui/public/sample.jpg`) Unsplash kaynaklı [Narrow Streets of Genoa](https://commons.wikimedia.org/wiki/File:Narrow_Streets_of_Genoa_(Unsplash).jpg), CC0 lisanslıdır.

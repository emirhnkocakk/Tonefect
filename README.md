# Basic Photo Editor

**English** · [Türkçe](#türkçe)

A small desktop-style tool that turns your photos and short quotes into dark, cinematic, Instagram-ready images (4:5, 1080×1350). Built for quote / motivation pages: it renders the text, film grain, vignette and a brand signature, and schedules a publish time for every image.

## Features
- **Live preview** – what you see is exactly what gets exported.
- **Per-word styling** – colour, weight (Light → ExtraBold), italic and size for any word, via a floating format bar.
- **Drag to place** – move the whole text block or single words; snaps to the centre, arrow keys for fine tuning.
- **Photo effects** – black & white on/off, film grain and vignette sliders, apply to all photos.
- **Two tones** – *quiet* (serif, lower third) and *hard* (bold, centred, uppercase), plus an accent word.
- **Batch export** – numbered JPEGs and a `manifest.json` with a publish date/time for each image.
- **Modern UI** – React + Tailwind + shadcn/ui, served by a tiny local Python server (nothing leaves your computer).

## Quick start (Windows)
1. Install Python 3.10+.
2. Download the fonts (free, SIL OFL) into `fonts/` – see `fonts/README.txt`.
3. Double-click `NegansVision.bat` (installs `Pillow` and `numpy` on first run).

Or manually:
```bash
pip install -r requirements.txt
python server.py
```
Make a standalone `.exe` with `exe_olustur.bat` (PyInstaller). Output appears in `dist/NegansVision/`.

## Branding
All branding (name, handle, colours, fonts, sizes, schedule time) lives in `brand.json`.

## Developing the UI
```bash
cd webui
npm install
npm run build        # then copy webui/dist to ./web
```
`npm run dev` proxies `/api` to a running `server.py` (default port 8791, set with `NV_PORT`).

## Architecture
- `render.py` – Pillow + numpy rendering engine (grading, grain, layout, per-word styles).
- `server.py` – standard-library HTTP server: preview/generate API, photo uploads, session autosave. Only accepts `127.0.0.1` requests.
- `webui/` – React source; `web/` – built UI that the server serves.

---

# Türkçe

Fotoğraflarını ve kısa sözlerini koyu, sinematik, Instagram'a hazır görsellere (4:5, 1080×1350) dönüştüren küçük bir masaüstü aracı. Söz/motivasyon sayfaları için yapıldı: yazıyı, film greni, vinyet ve marka imzasını ekler, her görsel için paylaşım zamanı planlar.

## Özellikler
- **Canlı önizleme** – ekranda gördüğün, dışa aktarılanla birebir aynıdır.
- **Kelime bazlı stil** – her kelimeye renk, kalınlık (İnce → Ekstra), italik ve boyut; yüzen biçim çubuğuyla.
- **Sürükleyerek yerleştirme** – tüm metni ya da tek tek kelimeleri taşı; ortaya mıknatıs gibi yapışır, ok tuşlarıyla ince ayar.
- **Fotoğraf efektleri** – siyah-beyaz aç/kapat, grain ve vinyet kaydırıcıları, hepsine uygula.
- **İki ton** – *sessiz* (serif, alt üçte bir) ve *sert* (kalın, ortalı, büyük harf) ve vurgu kelimesi.
- **Toplu üretim** – numaralı JPEG'ler ve her görsel için paylaşım tarihi/saati içeren `manifest.json`.
- **Modern arayüz** – React + Tailwind + shadcn/ui; küçük bir yerel Python sunucusuyla çalışır (hiçbir şey bilgisayarından çıkmaz).

## Hızlı başlangıç (Windows)
1. Python 3.10+ kur.
2. Fontları (ücretsiz, SIL OFL) `fonts/` klasörüne indir – bkz. `fonts/README.txt`.
3. `NegansVision.bat` dosyasına çift tıkla (ilk açılışta `Pillow` ve `numpy` kurulur).

Ya da elle:
```bash
pip install -r requirements.txt
python server.py
```
`exe_olustur.bat` ile tek başına çalışan `.exe` üretebilirsin (PyInstaller). Çıktı `dist/NegansVision/` içinde olur.

## Marka ayarları
İsim, kullanıcı adı, renkler, fontlar, boyutlar ve paylaşım saati `brand.json` içindedir.

## Arayüzü geliştirmek
```bash
cd webui
npm install
npm run build        # sonra webui/dist içeriğini ./web klasörüne kopyala
```

## Mimari
- `render.py` – Pillow + numpy çizim motoru (renk işleme, grain, yerleşim, kelime stilleri).
- `server.py` – standart kütüphane HTTP sunucusu: önizleme/üretim API'si, fotoğraf yükleme, oturum kaydı. Yalnızca `127.0.0.1` isteklerini kabul eder.
- `webui/` – React kaynağı; `web/` – sunucunun servis ettiği derlenmiş arayüz.

## License / Lisans
MIT (code). Fonts are under their own SIL OFL licences. / Kod MIT, fontlar kendi SIL OFL lisanslarına tabidir.

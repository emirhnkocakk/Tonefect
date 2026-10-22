<p align="center"><img src="assets/logo.svg" width="112" alt="Grainline logo"></p>

<h1 align="center">Grainline</h1>
<p align="center"><i>basic-photo-editor</i></p>

**English** · [Türkçe](#türkçe)

A small desktop-style tool that turns your photos and short quotes into dark, cinematic, Instagram-ready images (4:5, 1080×1350). Built for quote / motivation pages: it renders the text, film grain, vignette and a brand signature, and exports numbered JPEGs.

## Features
- **Live preview** – what you see is exactly what gets exported.
- **Per-word styling** – colour, weight (Light → ExtraBold), italic and size for any word, via a floating format bar.
- **Drag to place** – move the whole text block or single words. Canva-style smart guides snap to the centre, margins and to the centres/edges of neighbouring words; arrow keys for fine tuning.
- **Auto-update** – the installed app announces new releases on start and updates itself in one click.
- **Settings menu** – output folder, signature text, defaults for new photos, smart guides on/off.
- **Photo effects** – black & white on/off, film grain and vignette sliders, apply to all photos.
- **Two tones** – *quiet* (serif, lower third) and *hard* (bold, centred, uppercase), plus an accent word.
- **Batch export** – numbered JPEGs plus a `manifest.json` describing each image.
- **Modern UI** – React + Tailwind + shadcn/ui, served by a tiny local Python server (nothing leaves your computer).

## Download (Windows)
Get `Grainline-Setup.exe` from the [Releases](../../releases) page and run it (no admin rights needed). Then open **Grainline** from the Start menu or desktop. No Python needed.

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
- `server.py` – standard-library HTTP server: preview/generate API, photo uploads, session autosave. Only accepts `127.0.0.1` requests.
- `webui/` – React source; `web/` – built UI that the server serves.

---

# Türkçe

Fotoğraflarını ve kısa sözlerini koyu, sinematik, Instagram'a hazır görsellere (4:5, 1080×1350) dönüştüren küçük bir masaüstü aracı. Söz/motivasyon sayfaları için yapıldı: yazıyı, film greni, vinyet ve marka imzasını ekler ve numaralı JPEG'ler olarak dışa aktarır.

## Özellikler
- **Canlı önizleme** – ekranda gördüğün, dışa aktarılanla birebir aynıdır.
- **Kelime bazlı stil** – her kelimeye renk, kalınlık (İnce → Ekstra), italik ve boyut; yüzen biçim çubuğuyla.
- **Sürükleyerek yerleştirme** – tüm metni ya da tek tek kelimeleri taşı. Canva tarzı akıllı kılavuz çizgileri ortaya, kenar boşluklarına ve yan kelimelerin merkez/kenarlarına yapışır; ok tuşlarıyla ince ayar.
- **Otomatik güncelleme** – kurulu uygulama açılışta yeni sürümü duyurur ve tek tıkla kendini günceller.
- **Ayarlar menüsü** – çıktı klasörü, imza yazısı, yeni fotoğraf varsayılanları, akıllı kılavuzları aç/kapat.
- **Fotoğraf efektleri** – siyah-beyaz aç/kapat, grain ve vinyet kaydırıcıları, hepsine uygula.
- **İki ton** – *sessiz* (serif, alt üçte bir) ve *sert* (kalın, ortalı, büyük harf) ve vurgu kelimesi.
- **Toplu üretim** – numaralı JPEG'ler ve her görseli anlatan `manifest.json`.
- **Modern arayüz** – React + Tailwind + shadcn/ui; küçük bir yerel Python sunucusuyla çalışır (hiçbir şey bilgisayarından çıkmaz).

## İndir (Windows)
[Releases](../../releases) sayfasından `Grainline-Setup.exe` dosyasını indirip çalıştır (yönetici izni gerekmez). Kurulumdan sonra Başlat menüsü ya da masaüstünden **Grainline**'ı aç. Python gerekmez.

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
- `server.py` – standart kütüphane HTTP sunucusu: önizleme/üretim API'si, fotoğraf yükleme, oturum kaydı. Yalnızca `127.0.0.1` isteklerini kabul eder.
- `webui/` – React kaynağı; `web/` – sunucunun servis ettiği derlenmiş arayüz.

## License / Lisans
MIT (code). Bundled fonts (Cormorant Garamond, Montserrat) are under SIL OFL; licences are in `fonts/`. / Kod MIT, dahil edilen fontlar (Cormorant Garamond, Montserrat) SIL OFL lisanslıdır, lisanslar `fonts/` içindedir.

import {
  Activity, Aperture, Blend, Circle, CircleDot, CircleOff, Contrast, Droplet, Droplets, Eclipse, Film, Filter, Flame, Gauge, Layers2, Moon, Palette, Paintbrush, Pipette, Replace, ScanLine, SlidersHorizontal, Spline, Sun, SunDim, SunMedium, Sunset, Thermometer, Wand2, Waves,
} from "lucide-react"
import type { ColorEdits, ColorToolId } from "@/types"

// Renk ve Işık kategorisi: sol araç kutusu, üst menü ve panel aynı listeyi kullanır.
export type ColorEntry = { cmd: string; label: string; en: string; section: string; icon: typeof Sun; tool?: ColorToolId; hint?: string; grid?: boolean }

const c = (t: ColorToolId, row?: string) => `color:tool:${t}${row ? ":" + row : ""}`

export const COLOR_TOOLS: ColorEntry[] = [
  { cmd: c("basic"), label: "Işık ve Renk", en: "Basic Adjustments", section: "Işık", icon: SlidersHorizontal, tool: "basic", grid: true, hint: "Pozlama, kontrast, renk ve detay ayarları." },
  { cmd: c("bc"), label: "Parlaklık ve Kontrast", en: "Brightness / Contrast", section: "Işık", icon: SunMedium, tool: "bc", grid: true, hint: "Görselin genel parlaklığı ve kontrastı." },
  { cmd: c("levels"), label: "Seviyeler", en: "Levels", section: "Işık", icon: Activity, tool: "levels", grid: true, hint: "Siyah noktayı, orta tonları ve beyaz noktayı ayarla; kanal kanal da çalışır." },
  { cmd: c("curves"), label: "Eğriler", en: "Curves", section: "Işık", icon: Spline, tool: "curves", grid: true, hint: "Eğriye tıkla nokta ekle, sürükle. Çift tıkla: noktayı sil." },
  { cmd: c("basic", "exposure"), label: "Pozlama", en: "Exposure", section: "Işık", icon: Sun },
  { cmd: c("shhi"), label: "Gölgeler ve Parlak Alanlar", en: "Shadows / Highlights", section: "Işık", icon: Eclipse, tool: "shhi", grid: true, hint: "Çevresine bakarak koyu yerleri açar, patlayan yerleri geri getirir." },
  { cmd: c("hdr"), label: "HDR Tonlama", en: "HDR Toning", section: "Işık", icon: Aperture, tool: "hdr", grid: true, hint: "Yerel ton eşleme: geniş ışık aralığını sıkıştırır, ayrıntıyı öne çıkarır." },
  { cmd: c("basic", "highlights"), label: "Parlak Alan Düzenleme", en: "Highlights", section: "Işık", icon: SunDim },
  { cmd: c("basic", "midtones"), label: "Orta Ton Düzenleme", en: "Midtones", section: "Işık", icon: CircleDot },
  { cmd: c("basic", "shadows"), label: "Gölge Düzenleme", en: "Shadows", section: "Işık", icon: Moon },

  { cmd: c("wb"), label: "Beyaz Dengesi", en: "White Balance", section: "Renk", icon: Pipette, tool: "wb", grid: true, hint: "Damlalıkla görselde gri olması gereken bir yere tıkla ya da hazır ışık seç." },
  { cmd: c("wb", "temp"), label: "Renk Sıcaklığı", en: "Color Temperature", section: "Renk", icon: Thermometer },
  { cmd: c("wb", "tint"), label: "Tint", en: "Tint", section: "Renk", icon: Droplet },
  { cmd: c("basic", "vibrance"), label: "Canlılık", en: "Vibrance", section: "Renk", icon: Droplets },
  { cmd: c("hue"), label: "Ton ve Doygunluk", en: "Hue / Saturation", section: "Renk", icon: Palette, tool: "hue", grid: true, hint: "Tüm görselin tonu, doygunluğu ve açıklığı; altta renk renk ayar." },
  { cmd: c("balance"), label: "Renk Dengesi", en: "Color Balance", section: "Renk", icon: Blend, tool: "balance", grid: true, hint: "Gölge, orta ton ve parlak alanlara ayrı renk kaydırması." },
  { cmd: c("grade"), label: "Renk Derecelendirme", en: "Color Grading", section: "Renk", icon: Film, tool: "grade", grid: true, hint: "Tekerlekte rengi seç, merkezden uzaklık yoğunluğu belirler." },
  { cmd: c("selective"), label: "Seçici Renk", en: "Selective Color", section: "Renk", icon: Filter, tool: "selective", grid: true, hint: "Seçtiğin renk ailesindeki camgöbeği, macenta, sarı ve siyah oranı." },
  { cmd: c("mixer"), label: "Kanal Karıştırıcı", en: "Channel Mixer", section: "Renk", icon: Layers2, tool: "mixer", grid: true, hint: "Her çıkış kanalını kaynak kanalların karışımından kur." },
  { cmd: c("filter"), label: "Fotoğraf Filtresi", en: "Photo Filter", section: "Renk", icon: Sunset, tool: "filter", grid: true, hint: "Objektif önüne takılan renkli filtre gibi." },
  { cmd: c("lut"), label: "Renk Arama (LUT)", en: "Color Lookup", section: "Renk", icon: Gauge, tool: "lut", grid: true, hint: "Hazır görünümü ya da .cube LUT dosyasını düzenlemelerin üstüne uygula." },
  { cmd: c("match"), label: "Renk Eşleştirme", en: "Match Color", section: "Renk", icon: Waves, tool: "match", grid: true, hint: "Başka bir fotoğrafın renk ve ışık karakterini bu fotoğrafa taşır." },
  { cmd: c("replace"), label: "Rengi Değiştir", en: "Replace Color", section: "Renk", icon: Replace, tool: "replace", grid: true, hint: "Damlalıkla rengi seç, yalnızca o rengin tonunu değiştir." },

  { cmd: c("bw"), label: "Siyah Beyaz", en: "Black & White", section: "Dönüşüm", icon: Contrast, tool: "bw", grid: true, hint: "Her rengin griye dönerken ne kadar açık olacağını seç." },
  { cmd: c("desat"), label: "Doygunluğu Kaldır", en: "Desaturate", section: "Dönüşüm", icon: CircleOff, tool: "desat", grid: true, hint: "Rengi tamamen kaldırır." },
  { cmd: c("gradient"), label: "Degrade Eşleme", en: "Gradient Map", section: "Dönüşüm", icon: Paintbrush, tool: "gradient", grid: true, hint: "Koyudan açığa tonları degradenin renkleriyle boyar." },
  { cmd: c("invert"), label: "Tersine Çevir", en: "Invert", section: "Dönüşüm", icon: Circle, tool: "invert", grid: true, hint: "Negatif görüntü." },
  { cmd: c("posterize"), label: "Posterleştir", en: "Posterize", section: "Dönüşüm", icon: ScanLine, tool: "posterize", grid: true, hint: "Her kanalı belirli sayıda tona indirir." },
  { cmd: c("threshold"), label: "Eşik", en: "Threshold", section: "Dönüşüm", icon: Flame, tool: "threshold", grid: true, hint: "Görseli yalnızca siyah ve beyaza ayırır." },

  { cmd: "color:auto:tone", label: "Otomatik Ton", en: "Auto Tone", section: "Otomatik", icon: Wand2 },
  { cmd: "color:auto:contrast", label: "Otomatik Kontrast", en: "Auto Contrast", section: "Otomatik", icon: Wand2 },
  { cmd: "color:auto:color", label: "Otomatik Renk", en: "Auto Color", section: "Otomatik", icon: Wand2 },
  { cmd: "color:library", label: "Renk Görünümleri", en: "Color Presets", section: "Otomatik", icon: Palette },
]

export const COLOR_ICON = Palette
export const COLOR_SECTIONS = [...new Set(COLOR_TOOLS.map((t) => t.section))]
export const COLOR_GRID = COLOR_TOOLS.filter((t) => t.grid)

// Menüden seçilince hemen uygulananlar (Photoshop'ta olduğu gibi)
export const COLOR_ON: Partial<ColorEdits> = {
  invert: { on: true }, desat: { on: true }, posterize: { on: true, n: 4 }, threshold: { on: true, level: 0.5 }, bw: { on: true },
  gradient: { on: true, stops: [[0, "#14102E"], [0.5, "#C2476B"], [1, "#FFE9A8"]], amount: 1 },
}

const nz = (o: object | undefined) => !!o && Object.values(o).some((v) => typeof v === "number" && v !== 0)

/** Bu düzenleme görsele etki ediyor mu (nokta göstergesi ve katman listesi için). */
export function colorActive(id: ColorToolId, e: ColorEdits): boolean {
  switch (id) {
    case "basic": return false
    case "wb": return nz(e.wb)
    case "bc": return nz(e.bc)
    case "hue": return nz(e.hue)
    case "shhi": return !!(e.shhi?.s || e.shhi?.h || e.shhi?.mid)
    case "hdr": return !!e.hdr?.amount
    case "filter": return !!e.filter?.density
    case "invert": case "desat": case "bw": case "posterize": case "threshold": case "gradient": return !!e[id]?.on
    case "mixer": return !!e.mixer && (!!e.mixer.mono || JSON.stringify([e.mixer.r ?? [1, 0, 0, 0], e.mixer.g ?? [0, 1, 0, 0], e.mixer.b ?? [0, 0, 1, 0]]) !== "[[1,0,0,0],[0,1,0,0],[0,0,1,0]]")
    case "lut": return !!e.lut?.id
    case "selective": return Object.values(e.selective?.bands ?? {}).some((v) => v.some(Boolean))
    case "balance": return [e.balance?.shadows, e.balance?.mids, e.balance?.highs].some((v) => v?.some(Boolean))
    case "levels": return Object.values(e.levels ?? {}).some((v) => v && JSON.stringify(v) !== "[0,1,1,0,1]")
    case "curves": return Object.values(e.curves ?? {}).some((v) => v && v.some(([x, y]) => Math.abs(x - y) > 1e-3))
    case "match": return !!e.match?.photo
    case "replace": return !!(e.replace?.h || e.replace?.s || e.replace?.l)
    case "grade": return [e.grade?.shadow, e.grade?.mid, e.grade?.high, e.grade?.global].some((v) => v && (v[1] || v[2]))
  }
}
export const colorSummary = (e: ColorEdits | undefined) => (e ? COLOR_GRID.filter((t) => colorActive(t.tool!, e)).map((t) => t.label) : [])

/** Monoton kübik eğri: sunucudaki adjustments.spline_lut ile aynı formül. */
export function splineAt(pts: [number, number][], n = 128): number[] {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const k = pts.length - 1
  const h = xs.slice(1).map((x, i) => x - xs[i])
  const d = ys.slice(1).map((y, i) => (y - ys[i]) / h[i])
  const m = [d[0], ...d.slice(1).map((v, i) => (d[i] + v) / 2), d[k - 1]]
  d.forEach((v, i) => {
    if (v === 0) m[i] = m[i + 1] = 0
    else {
      const a = m[i] / v
      const b = m[i + 1] / v
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * v
        m[i + 1] = t * b * v
      }
    }
  })
  return Array.from({ length: n + 1 }, (_, q) => {
    const x = q / n
    if (x <= xs[0]) return ys[0]
    if (x >= xs[k]) return ys[k]
    let i = 0
    while (i < k - 1 && x >= xs[i + 1]) i++
    const t = (x - xs[i]) / h[i]
    const y = (2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] + (t ** 3 - 2 * t ** 2 + t) * h[i] * m[i] + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] + (t ** 3 - t ** 2) * h[i] * m[i + 1]
    return Math.min(1, Math.max(0, y))
  })
}

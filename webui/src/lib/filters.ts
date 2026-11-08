import { Blend, Camera, Cloud, Droplets, Frame, Image as ImageIcon, LayoutGrid, Scissors, Sparkles, Stars, Waves, Wand2, Zap, CircleDot } from "lucide-react"
import { api } from "@/lib/api"
import type { FilterItem } from "@/types"

// Efekt ve Filtreler kategorisi: sol araç kutusu, üst menü ve galeri aynı listeyi kullanır.
export type FilterEntry = { cmd: string; label: string; en: string; section: string; icon: typeof Blend; kind?: string; hint?: string }

const add = (kind: string, label: string, en: string, section: string, icon: typeof Blend, hint?: string): FilterEntry => ({ cmd: `filter:add:${kind}`, kind, label, en, section, icon, hint })
const B = "Bulanıklaştırma"
const K = "Keskinleştirme"
const D = "Bozma"
const G = "Gürültü"
const X = "Pikselleştirme"
const R = "Oluşturma"
const S = "Stilize"
const O = "Diğer Filtreler"

export const FILTER_TOOLS: FilterEntry[] = [
  add("gaussian", "Gauss Bulanıklığı", "Gaussian Blur", B, Droplets),
  add("boxblur", "Kutu Bulanıklığı", "Box Blur", B, Droplets),
  add("motion", "Hareket Bulanıklığı", "Motion Blur", B, Droplets),
  add("radial", "Radyal Bulanıklık", "Radial Blur", B, Droplets, "Merkezi önizlemede sürükle."),
  add("lens", "Lens Bulanıklığı", "Lens Blur", B, Droplets, "Yuvarlak bokeh. Konu Net için yapay zekâ modeli kurulu olmalı."),
  add("field", "Alan Bulanıklığı", "Field Blur", B, Droplets, "Önizlemeye tıklayarak nokta ekle, her noktanın bulanıklığını aşağıdan ayarla."),
  add("iris", "İris Bulanıklığı", "Iris Blur", B, Droplets, "Net kalacak alanın merkezini önizlemede sürükle."),
  add("tilt", "Tilt-Shift", "Tilt-Shift", B, Droplets, "Net bandın yerini önizlemede sürükle."),
  add("surface", "Yüzey Bulanıklığı", "Surface Blur", B, Droplets, "Kenarları koruyarak yumuşatır."),
  add("smartblur", "Akıllı Bulanıklık", "Smart Blur", B, Droplets),

  add("smartsharp", "Akıllı Keskinleştirme", "Smart Sharpen", K, Zap),
  add("unsharp", "Keskinlik Maskesi", "Unsharp Mask", K, Zap),
  add("shake", "Titreme Azaltma", "Shake Reduction", K, Zap, "Titremenin yönünü ve uzunluğunu sen gir; görselde en net sonucu veren değerleri ara."),
  add("sharpen", "Keskinleştir", "Sharpen", K, Zap),
  add("sharpedges", "Kenarları Keskinleştir", "Sharpen Edges", K, Zap),
  add("sharpmore", "Daha Fazla Keskinleştir", "Sharpen More", K, Zap),

  add("displace", "Yer Değiştir", "Displace", D, Waves, "Harita görseli seçmezsen fotoğrafın kendi ışığı kullanılır."),
  add("pinch", "Sıkıştır", "Pinch", D, Waves),
  add("polar", "Kutupsal Koordinatlar", "Polar Coordinates", D, Waves),
  add("ripple", "Dalgacık", "Ripple", D, Waves),
  add("shear", "Yamult", "Shear", D, Waves),
  add("spherize", "Küreleştir", "Spherize", D, Waves),
  add("twirl", "Girdap", "Twirl", D, Waves),
  add("wave", "Dalga", "Wave", D, Waves),
  add("zigzag", "Zikzak", "ZigZag", D, Waves),
  add("lenscor", "Lens Düzeltme", "Lens Correction", D, Waves),
  add("liquify", "Sıvılaştır", "Liquify", D, Waves, "Önizlemede fırçayla it, döndür, sık ya da şişir. Parmağını kaldırınca uygulanır."),
  add("perspective", "Perspektif", "Perspective", D, Waves),

  add("addnoise", "Gürültü Ekle", "Add Noise", G, CircleDot),
  add("despeckle", "Benek Giderme", "Despeckle", G, CircleDot),
  add("dustscr", "Toz ve Çizik", "Dust & Scratches", G, CircleDot),
  add("median", "Ortanca", "Median", G, CircleDot),
  add("reducenoise", "Gürültü Azalt", "Reduce Noise", G, CircleDot),

  add("halftone", "Renkli Yarım Ton", "Color Halftone", X, LayoutGrid),
  add("crystallize", "Kristalleştir", "Crystallize", X, LayoutGrid),
  add("facet", "Yüzeyle", "Facet", X, LayoutGrid),
  add("fragment", "Parçala", "Fragment", X, LayoutGrid),
  add("mezzotint", "Mezzotint", "Mezzotint", X, LayoutGrid),
  add("mosaic", "Mozaik", "Mosaic", X, LayoutGrid),
  add("pointillize", "Noktacılık", "Pointillize", X, LayoutGrid),

  add("clouds", "Bulutlar", "Clouds", R, Cloud),
  add("diffclouds", "Fark Bulutları", "Difference Clouds", R, Cloud),
  add("fibers", "Lifler", "Fibers", R, Cloud),
  add("flare", "Lens Parlaması", "Lens Flare", R, Cloud, "Işığın yerini önizlemede sürükle."),
  add("lighting", "Işık Efektleri", "Lighting Effects", R, Cloud, "Işığın yerini önizlemede sürükle."),

  add("diffuse", "Dağıt", "Diffuse", S, Stars),
  add("emboss", "Kabartma", "Emboss", S, Stars),
  add("extrude", "Çıkıntı", "Extrude", S, Stars),
  add("findedges", "Kenarları Bul", "Find Edges", S, Stars),
  add("oil", "Yağlı Boya", "Oil Paint", S, Stars),
  add("solarize", "Solarize", "Solarize", S, Stars),
  add("tiles", "Karolar", "Tiles", S, Stars),
  add("wind", "Rüzgâr", "Wind", S, Stars),

  { cmd: "color:tool:basic", label: "Camera Raw Filtresi", en: "Camera Raw Filter", section: O, icon: Camera },
  add("wideangle", "Uyarlanabilir Geniş Açı", "Adaptive Wide Angle", O, Camera),
  { cmd: "filter:vanish", label: "Kaybolma Noktası", en: "Vanishing Point", section: O, icon: Camera },
  { cmd: "filter:gallery", label: "Filtre Galerisi", en: "Filter Gallery", section: O, icon: ImageIcon },
  { cmd: "filter:ai", label: "Yapay Zekâ Filtreleri", en: "Neural Filters", section: O, icon: Wand2 },
  add("highpass", "Yüksek Geçiş", "High Pass", O, Camera),
  add("custom", "Özel Filtre", "Custom Filter", O, Camera, "5x5 matris: her piksel komşularının ağırlıklı toplamı olur."),

  { cmd: "fx:effects", label: "Efektler", en: "Effects", section: "Efektler", icon: Sparkles },
  { cmd: "fx:background", label: "Arka Plan", en: "Background", section: "Efektler", icon: Scissors },
  { cmd: "tool:frame", label: "Çerçeve", en: "Frame", section: "Efektler", icon: Frame },
]

export const FX_ICON = Sparkles
export const FILTER_SECTIONS = [...new Set(FILTER_TOOLS.map((t) => t.section))]
export const FILTER_GALLERY = FILTER_TOOLS.filter((t) => t.kind)
export const GALLERY_SECTIONS = [...new Set(FILTER_GALLERY.map((t) => t.section))]
export const filterEntry = (kind: string) => FILTER_GALLERY.find((t) => t.kind === kind)
export const filterLabel = (kind: string) => filterEntry(kind)?.label ?? kind

// önizleme üzerinde tutamaç isteyen filtreler
export const POINT_KINDS = new Set(["radial", "lens", "iris", "tilt", "pinch", "spherize", "twirl", "zigzag", "flare", "lighting"])
export const POINT_DEFAULT: Record<string, [number, number]> = { flare: [0.3, 0.3] }

export type ParamSpec = { k: string; label: string; t: "n" | "sel" | "color" | "bool" | "point" | "seed" | "photo" | "kernel" | "pins" | "strokes"; def: any; min?: number; max?: number; step?: number; opts?: [string, string][] }
export type FilterSpec = Record<string, ParamSpec[]>

let specPromise: Promise<FilterSpec> | null = null
export const loadFilterSpec = () => (specPromise ??= api.filterSpec())

export function newFilter(kind: string, spec: FilterSpec): FilterItem {
  const f: FilterItem = { id: Math.random().toString(36).slice(2, 9), kind, amount: 1 }
  for (const p of spec[kind] ?? []) f[p.k] = p.t === "seed" ? Math.floor(Math.random() * 1e6) : structuredClone(p.def)
  return f
}
export type LiquifyTool = { tool: "push" | "cw" | "ccw" | "pucker" | "bloat" | "rec"; size: number; rate: number }

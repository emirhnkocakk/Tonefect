import {
  Bandage, Brush, Circle, Cloud, Droplet, Droplets, Eraser, Feather, FlipHorizontal2, Gauge, Grid2x2, History, Image as ImageIcon, Layers2, Maximize2, Move3d, Paintbrush, PaintBucket, Palette,
  Pencil, Replace, RotateCw, Scaling, Shapes, SlidersHorizontal, Sparkle, Spline, Sun, WandSparkles, Wind,
} from "lucide-react"
import type { BrushSettings, BrushTool } from "@/types"

// Fırça ve Çizim kategorisi: sol araç kutusu, üst menü ve panel aynı listeyi kullanır.
export type BrushEntry = { cmd: string; label: string; en: string; section: string; icon: typeof Brush; key?: string; tool?: BrushTool; hint?: string }

export const BRUSH_TOOLS: BrushEntry[] = [
  { cmd: "brush:tool:brush", label: "Fırça", en: "Brush Tool", section: "Çizim", icon: Paintbrush, key: "B", tool: "brush", hint: "Boya. Alt+tıkla: fotoğraftan renk al. [ ve ]: boyut." },
  { cmd: "brush:tool:pencil", label: "Kurşun Kalem", en: "Pencil Tool", section: "Çizim", icon: Pencil, key: "N", tool: "pencil", hint: "Yumuşak kenarı olmayan sert çizgi." },
  { cmd: "brush:tool:replace", label: "Renk Değiştirme", en: "Color Replacement Tool", section: "Çizim", icon: Replace, tool: "replace", hint: "Fırçanın altındaki rengi seçili renkle değiştirir; ışık ve gölge kalır. Toleransla ayarla." },
  { cmd: "brush:tool:mixer", label: "Karıştırıcı Fırça", en: "Mixer Brush Tool", section: "Çizim", icon: Wind, tool: "mixer", hint: "Fotoğraftaki renkleri ıslak boya gibi sürükleyip karıştırır." },
  { cmd: "brush:tool:erase", label: "Silgi", en: "Eraser Tool", section: "Silgi", icon: Eraser, key: "E", tool: "erase", hint: "Boyayı ve fotoğrafı şeffaf yapar. Yalnızca boyayı silmek için anahtarı aç." },
  { cmd: "brush:tool:bgerase", label: "Arka Plan Silgisi", en: "Background Eraser Tool", section: "Silgi", icon: PaintBucket, tool: "bgerase", hint: "Yalnızca fırçanın ortasındaki renge benzeyen pikselleri siler." },
  { cmd: "brush:tool:magic", label: "Sihirli Silgi", en: "Magic Eraser Tool", section: "Silgi", icon: WandSparkles, tool: "magic", hint: "Tıkla: o renkteki alan şeffaf olur." },
  { cmd: "brush:tool:remove", label: "Kaldırma Aracı", en: "Remove Tool", section: "Silgi", icon: Bandage, key: "J", tool: "remove", hint: "Silmek istediğin nesnenin üzerini boya; çevresindeki dokuyla kapanır." },
  { cmd: "brush:tool:history", label: "Geçmiş Fırçası", en: "History Brush Tool", section: "Geçmiş", icon: History, key: "Y", tool: "history", hint: "Boyadığın yer düzenlenmemiş orijinal fotoğrafa döner." },
  { cmd: "brush:tool:arthistory", label: "Sanatsal Geçmiş Fırçası", en: "Art History Brush Tool", section: "Geçmiş", icon: Sparkle, tool: "arthistory", hint: "Orijinal fotoğrafı resim fırçası lekeleriyle yeniden boyar." },

  { cmd: "brush:group:all", label: "Fırça Hazır Ayarları", en: "Brush Presets", section: "Fırça Türleri", icon: Grid2x2 },
  { cmd: "brush:sec:tips", label: "Özel Fırçalar", en: "Custom Brushes", section: "Fırça Türleri", icon: ImageIcon },
  { cmd: "brush:group:texture", label: "Dokulu Fırçalar", en: "Texture Brushes", section: "Fırça Türleri", icon: Layers2 },
  { cmd: "brush:group:pattern", label: "Desenli Fırçalar", en: "Pattern Brushes", section: "Fırça Türleri", icon: Shapes },
  { cmd: "brush:group:scatter", label: "Saçılan Fırçalar", en: "Scatter Brushes", section: "Fırça Türleri", icon: Cloud },
  { cmd: "brush:group:wet", label: "Islak Boya Fırçaları", en: "Wet Media Brushes", section: "Fırça Türleri", icon: Droplets },
  { cmd: "brush:group:dry", label: "Kuru Boya Fırçaları", en: "Dry Media Brushes", section: "Fırça Türleri", icon: Feather },

  { cmd: "brush:sec:settings", label: "Fırça Ayarları", en: "Brush Settings", section: "Ayarlar", icon: SlidersHorizontal },
  { cmd: "brush:sec:size", label: "Boyut", en: "Brush Size", section: "Ayarlar", icon: Maximize2 },
  { cmd: "brush:sec:hard", label: "Sertlik", en: "Brush Hardness", section: "Ayarlar", icon: Circle },
  { cmd: "brush:sec:opacity", label: "Opaklık", en: "Brush Opacity", section: "Ayarlar", icon: Sun },
  { cmd: "brush:sec:flow", label: "Akış", en: "Brush Flow", section: "Ayarlar", icon: Droplet },
  { cmd: "brush:sec:smooth", label: "Yumuşatma", en: "Brush Smoothing", section: "Ayarlar", icon: Spline },
  { cmd: "brush:sec:spacing", label: "Aralık", en: "Brush Spacing", section: "Ayarlar", icon: Scaling },
  { cmd: "brush:sec:angle", label: "Açı", en: "Brush Angle", section: "Ayarlar", icon: RotateCw },
  { cmd: "brush:sec:round", label: "Yuvarlaklık", en: "Brush Roundness", section: "Ayarlar", icon: FlipHorizontal2 },
  { cmd: "brush:sec:press", label: "Basınç Hassasiyeti", en: "Pressure Sensitivity", section: "Ayarlar", icon: Gauge },

  { cmd: "brush:sec:dual", label: "Çift Fırça", en: "Dual Brush", section: "Dinamikler", icon: Brush },
  { cmd: "brush:sec:shape", label: "Şekil Dinamiği", en: "Shape Dynamics", section: "Dinamikler", icon: Move3d },
  { cmd: "brush:sec:color", label: "Renk Dinamiği", en: "Color Dynamics", section: "Dinamikler", icon: Palette },
]

export const BRUSH_SECTIONS = [...new Set(BRUSH_TOOLS.map((t) => t.section))]
export const BRUSH_MODES = BRUSH_TOOLS.filter((t) => t.tool)

export const DEFAULT_BRUSH: BrushSettings = {
  size: 0.03, hard: 0.8, opacity: 1, flow: 1, spacing: 0.15, angle: 0, round: 1, sizeJ: 0, minD: 0, angleJ: 0, roundJ: 0, hueJ: 0, satJ: 0, briJ: 0, fgbgJ: 0, scatter: 0, count: 1,
  wet: 0, dry: 0, texDepth: 0.6, tol: 0.3, pickup: 0.5, load: 0, dualSize: 0.5, dualScatter: 0, dualHard: 0.8, pressSize: false, pressOpacity: false, paintOnly: false, contiguous: true,
  color: "#000000", color2: "#FFFFFF", tip: "round", tex: "", pattern: "", dual: false,
  amount: 0.5, range: "mid", sponge: "desat", vib: false, finger: false, stamp: "", stampScale: 0.2, aligned: true,
}

export type BrushPreset = { id: string; name: string; group: string; tool?: BrushTool; b: Partial<BrushSettings> }

// fırçanın biçimi; renk ve boyut kullanıcıda kalır
export const BRUSH_PRESETS: BrushPreset[] = [
  { id: "soft", name: "Yumuşak Yuvarlak", group: "basic", b: { hard: 0, flow: 0.5, spacing: 0.1 } },
  { id: "hard", name: "Sert Yuvarlak", group: "basic", b: { hard: 1 } },
  { id: "ink", name: "Mürekkep", group: "basic", b: { hard: 1, pressSize: true, spacing: 0.05, round: 0.8, angle: 35 } },
  { id: "marker", name: "Keçeli Kalem", group: "basic", b: { hard: 0.9, opacity: 0.8, round: 0.35, angle: 45, spacing: 0.06 } },
  { id: "pencil", name: "Kurşun Kalem", group: "basic", tool: "pencil", b: { hard: 1, spacing: 0.08 } },
  { id: "canvas", name: "Kanvas", group: "texture", b: { tex: "canvas", texDepth: 0.9, hard: 0.7 } },
  { id: "paper", name: "Kâğıt Dokusu", group: "texture", b: { tex: "paper", texDepth: 0.85, hard: 0.5, flow: 0.7 } },
  { id: "noise", name: "Benekli", group: "texture", b: { tex: "noise", texDepth: 1, hard: 0.6 } },
  { id: "dots", name: "Noktalı Desen", group: "pattern", b: { pattern: "dots", hard: 1 } },
  { id: "stripes", name: "Çizgili Desen", group: "pattern", b: { pattern: "stripes", hard: 1 } },
  { id: "checker", name: "Damalı Desen", group: "pattern", b: { pattern: "checker", hard: 1 } },
  { id: "hatch", name: "Tarama Deseni", group: "pattern", b: { pattern: "hatch", hard: 1 } },
  { id: "spray", name: "Sprey", group: "scatter", b: { hard: 0.3, scatter: 1.2, count: 8, spacing: 0.5, sizeJ: 0.9, minD: 0.05, flow: 0.5 } },
  { id: "confetti", name: "Konfeti", group: "scatter", b: { hard: 1, scatter: 2.5, count: 3, spacing: 0.9, sizeJ: 0.7, minD: 0.2, hueJ: 1, roundJ: 0.7, angleJ: 1 } },
  { id: "dust", name: "Toz", group: "scatter", b: { hard: 0.6, scatter: 3, count: 6, spacing: 0.7, sizeJ: 1, minD: 0.02, flow: 0.7 } },
  { id: "water", name: "Suluboya", group: "wet", b: { wet: 0.85, flow: 0.35, hard: 0.2, tex: "paper", texDepth: 0.45, spacing: 0.08 } },
  { id: "oil", name: "Yağlı Boya", group: "wet", b: { wet: 0.5, hard: 0.7, tex: "canvas", texDepth: 0.5, round: 0.5, angle: 30, spacing: 0.05 } },
  { id: "wash", name: "Lavi", group: "wet", b: { wet: 1, flow: 0.2, hard: 0, opacity: 0.8, spacing: 0.08 } },
  { id: "chalk", name: "Tebeşir", group: "dry", b: { dry: 0.55, hard: 0.8, tex: "paper", texDepth: 0.5 } },
  { id: "charcoal", name: "Karakalem", group: "dry", b: { dry: 0.42, hard: 0.6, round: 0.55, angle: 60, spacing: 0.06 } },
  { id: "drybrush", name: "Kuru Fırça", group: "dry", b: { dry: 0.8, hard: 0.9, round: 0.4, spacing: 0.05, dual: true, dualSize: 0.3, dualScatter: 0.6 } },
]
export const PRESET_GROUPS: [string, string][] = [
  ["all", "Tümü"], ["basic", "Temel"], ["texture", "Dokulu"], ["pattern", "Desenli"], ["scatter", "Saçılan"], ["wet", "Islak"], ["dry", "Kuru"],
]

/** Hazır ayarı uygula: renk, boyut, uç ve kullanıcı tercihleri korunur, biçim sıfırlanıp yenilenir. */
export function applyPreset(cur: BrushSettings, p: Partial<BrushSettings>): BrushSettings {
  const { size, color, color2, tol, contiguous, paintOnly, pickup, load, opacity } = cur
  return { ...DEFAULT_BRUSH, size, color, color2, tol, contiguous, paintOnly, pickup, load, opacity, ...p }
}

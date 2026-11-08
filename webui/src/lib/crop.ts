import { Building2, Crop, Eraser, Expand, FlipHorizontal2, Grid2x2, MousePointer2, Ratio, Ruler, Scaling, Sparkles, Spline } from "lucide-react"

// Kırpma ve Dilimleme kategorisi: sol araç kutusu ve üst menü aynı listeyi kullanır.
export type CropEntry = { cmd: string; label: string; en: string; section: string; icon: typeof Crop; key?: string; sticky?: boolean }

export const CROP_TOOLS: CropEntry[] = [
  { cmd: "tool:crop:ratio", label: "Kırp", en: "Crop", section: "Kırpma", icon: Crop, key: "C" },
  { cmd: "tool:crop:custom", label: "En-Boy Oranı", en: "Crop to Aspect Ratio", section: "Kırpma", icon: Ratio },
  { cmd: "crop:persp", label: "Perspektif Kırpma", en: "Perspective Crop", section: "Kırpma", icon: Spline },
  { cmd: "tool:crop:ca", label: "İçeriğe Duyarlı Kırp", en: "Content-Aware Crop", section: "Kırpma", icon: Sparkles },
  { cmd: "crop:line", label: "Düzeltme Aracı", en: "Straighten", section: "Düzeltme", icon: Ruler },
  { cmd: "tool:crop:edges", label: "Kenarları Düzelt", en: "Trim Edges", section: "Düzeltme", icon: Eraser },
  { cmd: "tool:crop:upright", label: "Perspektifi Düzelt", en: "Perspective Correction", section: "Düzeltme", icon: Building2 },
  { cmd: "tool:crop:rotate", label: "Döndür ve Çevir", en: "Rotate and Flip", section: "Düzeltme", icon: FlipHorizontal2 },
  { cmd: "slice:draw", label: "Dilim", en: "Slice", section: "Dilimleme", icon: Grid2x2, key: "K" },
  { cmd: "slice:select", label: "Dilim Seçimi", en: "Slice Select", section: "Dilimleme", icon: MousePointer2 },
  { cmd: "tool:crop:size", label: "Görüntü Boyutu", en: "Image Size", section: "Boyut", icon: Scaling },
  { cmd: "tool:crop:canvas", label: "Tuval Boyutu", en: "Canvas Size", section: "Boyut", icon: Expand },
]

export const CROP_SECTIONS = [...new Set(CROP_TOOLS.map((t) => t.section))]

import {
  Bandage, Blend, CircleOff, Droplets, Eraser, Feather, Layers, PaintBucket, PenTool, Scan, ScanFace, ScissorsLineDashed, SlidersHorizontal, Sparkles, SquareDashed, User, UserX, WandSparkles,
} from "lucide-react"

// Silme ve Arka Plan kategorisi: sol araç kutusu, üst menü ve panel aynı listeyi kullanır.
export type EraseEntry = { cmd: string; label: string; en: string; section: string; icon: typeof Eraser; key?: string }

export const ERASE_TOOLS: EraseEntry[] = [
  { cmd: "brush:tool:erase", label: "Silgi", en: "Eraser Tool", section: "Silgi", icon: Eraser },
  { cmd: "brush:tool:bgerase", label: "Arka Plan Silgisi", en: "Background Eraser Tool", section: "Silgi", icon: PaintBucket },
  { cmd: "brush:tool:magic", label: "Sihirli Silgi", en: "Magic Eraser Tool", section: "Silgi", icon: WandSparkles },
  { cmd: "brush:tool:remove", label: "Kaldırma Aracı", en: "Remove Tool", section: "Silgi", icon: Bandage, key: "J" },
  { cmd: "erase:bg", label: "Arka Planı Kaldır", en: "Remove Background", section: "Arka Plan", icon: ScissorsLineDashed },
  { cmd: "erase:colorkey", label: "Arka Planı Şeffaflaştır", en: "Make Background Transparent", section: "Arka Plan", icon: CircleOff },
  { cmd: "sel:subject", label: "Konuyu Seç", en: "Select Subject", section: "Arka Plan", icon: User },
  { cmd: "sel:refine", label: "Seç ve Maskele", en: "Select and Mask", section: "Arka Plan", icon: SlidersHorizontal },
  { cmd: "tool:erase:edge", label: "Kenar İyileştir", en: "Refine Edge", section: "Arka Plan", icon: Feather },
  { cmd: "tool:erase:defringe", label: "Renk Saçağını Temizle", en: "Defringe", section: "Arka Plan", icon: Droplets },
  { cmd: "erase:fill", label: "İçeriğe Duyarlı Dolgu", en: "Content-Aware Fill", section: "Doldurma", icon: Sparkles },
  { cmd: "erase:gen", label: "Üretken Dolgu", en: "Generative Fill", section: "Doldurma", icon: WandSparkles },
  { cmd: "erase:gaps", label: "Boşlukları Doldur", en: "Fill Gaps", section: "Doldurma", icon: Scan },
  { cmd: "erase:object", label: "Nesne Kaldırma", en: "Object Removal", section: "Doldurma", icon: ScanFace },
  { cmd: "erase:people", label: "İstenmeyen Kişi veya Nesneleri Silme", en: "Remove People and Objects", section: "Doldurma", icon: UserX },
  { cmd: "erase:layermask", label: "Katman Maskesi", en: "Layer Mask", section: "Maskeler", icon: Layers },
  { cmd: "tool:erase:clip", label: "Kırpma Maskesi", en: "Clipping Mask", section: "Maskeler", icon: Blend },
  { cmd: "erase:vector", label: "Vektör Maske", en: "Vector Mask", section: "Maskeler", icon: PenTool },
]

export const ERASE_ICON = SquareDashed
export const ERASE_SECTIONS = [...new Set(ERASE_TOOLS.map((t) => t.section))]

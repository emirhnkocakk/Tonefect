import {
  Brush, Circle, Cloud, Contrast, CopyCheck, Eraser, FolderOpen, Focus, Frame, Lasso, Magnet, Maximize2, Minimize2, Minus, MoreVertical,
  Pipette, Pentagon, Save, ScanSearch, SlidersHorizontal, Sprout, Square, Sparkles, Spline, User, Image as ImageIcon, Wand2, Droplets,
} from "lucide-react"
import type { SelectTool } from "@/types"

// Selection Tool kategorisi: sol araç kutusu, üst menü ve panel aynı listeyi kullanır.
// draw: fotoğrafın üzerinde kullanılan araç; action: tek tıkla uygulanan komut.
export type SelectEntry = {
  id: string
  label: string
  en: string // Photoshop'taki adı
  section: string
  icon: typeof Square
  draw?: SelectTool["mode"]
  key?: string
  hint?: string
}

export const SELECT_TOOLS: SelectEntry[] = [
  { id: "rect", label: "Dikdörtgen Seçim", en: "Rectangular Marquee", section: "Çerçeve", icon: Square, draw: "rect", key: "M", hint: "Sürükleyerek dikdörtgen bir alan seç." },
  { id: "ellipse", label: "Elips Seçim", en: "Elliptical Marquee", section: "Çerçeve", icon: Circle, draw: "ellipse", hint: "Sürükleyerek oval bir alan seç." },
  { id: "row", label: "Tek Satır", en: "Single Row Marquee", section: "Çerçeve", icon: Minus, draw: "row", hint: "Tıkladığın yerde 1 piksellik yatay çizgi seçilir." },
  { id: "col", label: "Tek Sütun", en: "Single Column Marquee", section: "Çerçeve", icon: MoreVertical, draw: "col", hint: "Tıkladığın yerde 1 piksellik dikey çizgi seçilir." },
  { id: "lasso", label: "Kement", en: "Lasso", section: "Kement", icon: Lasso, draw: "lasso", key: "L", hint: "Seçmek istediğin alanın çevresini elle çiz." },
  { id: "poly", label: "Çokgen Kement", en: "Polygonal Lasso", section: "Kement", icon: Pentagon, draw: "poly", hint: "Köşelere tek tek tıkla. Başlangıca tıkla ya da çift tıkla: kapat. Esc: vazgeç, Backspace: son köşeyi sil." },
  { id: "magnetic", label: "Manyetik Kement", en: "Magnetic Lasso", section: "Kement", icon: Magnet, draw: "magnetic", hint: "Nesnenin kenarı boyunca kabaca çiz; çizgi en yakın kenara yapışır." },
  { id: "object", label: "Nesne Seçimi", en: "Object Selection", section: "Akıllı", icon: ScanSearch, draw: "object", hint: "Nesnenin çevresine bir kutu çiz; kutudaki nesne bulunur." },
  { id: "quick", label: "Hızlı Seçim", en: "Quick Selection", section: "Akıllı", icon: Sparkles, draw: "quick", hint: "Fırça gibi boya; seçim benzer renklerde kenara kadar büyür." },
  { id: "wand", label: "Sihirli Değnek", en: "Magic Wand", section: "Akıllı", icon: Wand2, draw: "wand", key: "W", hint: "Bir yere tıkla: benzer renkteki bölge seçilir." },
  { id: "brush", label: "Seçim Fırçası", en: "Selection Brush", section: "Akıllı", icon: Brush, draw: "brush", hint: "Seçime eklemek için boya." },
  { id: "erase", label: "Seçim Silgisi", en: "Selection Eraser", section: "Akıllı", icon: Eraser, draw: "erase", hint: "Seçimden çıkarmak için boya." },

  { id: "subject", label: "Konuyu Seç", en: "Select Subject", section: "Otomatik", icon: User },
  { id: "background", label: "Arka Planı Seç", en: "Select Background", section: "Otomatik", icon: ImageIcon },
  { id: "sky", label: "Gökyüzünü Seç", en: "Select Sky", section: "Otomatik", icon: Cloud },
  { id: "range", label: "Renk Aralığı", en: "Color Range", section: "Otomatik", icon: Pipette, draw: "range", hint: "Bir renge tıkla: resmin her yerinde o renk yumuşak geçişle seçilir. Her tıklama yeni renk ekler." },
  { id: "focus", label: "Odak Alanı", en: "Focus Area", section: "Otomatik", icon: Focus },

  { id: "refine", label: "Seç ve Maskele", en: "Select and Mask", section: "Düzenle", icon: SlidersHorizontal },
  { id: "invert", label: "Ters Çevir", en: "Inverse", section: "Düzenle", icon: Contrast },
  { id: "expand", label: "Genişlet", en: "Expand", section: "Düzenle", icon: Maximize2 },
  { id: "contract", label: "Daralt", en: "Contract", section: "Düzenle", icon: Minimize2 },
  { id: "feather", label: "Kenar Yumuşat", en: "Feather", section: "Düzenle", icon: Droplets },
  { id: "smooth", label: "Pürüzsüzleştir", en: "Smooth", section: "Düzenle", icon: Spline },
  { id: "border", label: "Kenarlık", en: "Border", section: "Düzenle", icon: Frame },
  { id: "grow", label: "Büyüt", en: "Grow", section: "Düzenle", icon: Sprout },
  { id: "similar", label: "Benzerleri Seç", en: "Similar", section: "Düzenle", icon: CopyCheck },

  { id: "save", label: "Seçimi Kaydet", en: "Save Selection", section: "Kaydet", icon: Save },
  { id: "load", label: "Seçimi Yükle", en: "Load Selection", section: "Kaydet", icon: FolderOpen },
]

export const SELECT_SECTIONS = [...new Set(SELECT_TOOLS.map((t) => t.section))]
export const selectEntry = (id: string) => SELECT_TOOLS.find((t) => t.id === id)

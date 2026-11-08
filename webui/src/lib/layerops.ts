import type { ImgLayer, LayerComp } from "@/types"

// Katman sistemi: üst menü ve özellikler paneli aynı listeyi kullanır. off: Tonefect'te karşılığı olmayan.
export type LayerEntry = { cmd: string; label: string; en: string; section: string; off?: boolean }

const OP = "Katman İşlemleri"
const TY = "Katman Türleri"
const ST = "Katman Stilleri"
const MK = "Maskeler"

export const LAYER_TOOLS: LayerEntry[] = [
  { cmd: "layer:new:blank", label: "Yeni Katman", en: "New Layer", section: OP },
  { cmd: "layer:dup", label: "Katmanı Çoğalt", en: "Duplicate Layer", section: OP },
  { cmd: "layer:del", label: "Katmanı Sil", en: "Delete Layer", section: OP },
  { cmd: "layer:rename", label: "Katmanı Yeniden Adlandır", en: "Rename Layer", section: OP },
  { cmd: "layer:group", label: "Katmanları Grupla", en: "Group Layers", section: OP },
  { cmd: "layer:ungroup", label: "Grubu Çöz", en: "Ungroup Layers", section: OP },
  { cmd: "layer:merge", label: "Katmanları Birleştir", en: "Merge Layers", section: OP },
  { cmd: "layer:mergevis", label: "Görünenleri Birleştir", en: "Merge Visible", section: OP },
  { cmd: "layer:flatten", label: "Görüntüyü Düzleştir", en: "Flatten Image", section: OP },
  { cmd: "layer:link", label: "Katmanları Bağla", en: "Link Layers", section: OP },
  { cmd: "layer:lock", label: "Katmanı Kilitle", en: "Lock Layers", section: OP },
  { cmd: "layer:unlock", label: "Kilidi Aç", en: "Unlock Layers", section: OP },
  { cmd: "layer:toggle", label: "Gizle / Göster", en: "Hide / Show Layers", section: OP },
  { cmd: "layer:sec:comps", label: "Katman Kompozisyonları", en: "Layer Comps", section: OP },
  { cmd: "layer:sec:opacity", label: "Katman Opaklığı", en: "Layer Opacity", section: OP },
  { cmd: "layer:sec:fill", label: "Dolgu Opaklığı", en: "Fill Opacity", section: OP },
  { cmd: "layer:sec:blend", label: "Karışım Kipleri", en: "Blend Modes", section: OP },
  { cmd: "layer:filter", label: "Katman Filtreleme", en: "Layer Filtering", section: OP },
  { cmd: "layer:sec:label", label: "Katman Renk Etiketleri", en: "Layer Color Labels", section: OP },

  { cmd: "layer:new:blank", label: "Piksel Katmanı", en: "Pixel Layer", section: TY },
  { cmd: "layer:new:text", label: "Metin Katmanı", en: "Text Layer", section: TY },
  { cmd: "layer:new:shape", label: "Şekil Katmanı", en: "Shape Layer", section: TY },
  { cmd: "layer:new:adjust", label: "Ayar Katmanı", en: "Adjustment Layer", section: TY },
  { cmd: "layer:new:fill", label: "Dolgu Katmanı", en: "Fill Layer", section: TY },
  { cmd: "layer:smart", label: "Akıllı Nesne", en: "Smart Object", section: TY },
  { cmd: "layer:base", label: "Arka Plan Katmanı", en: "Background Layer", section: TY },
  { cmd: "layer:none:video", label: "Video Katmanı (Desteklenmiyor)", en: "Video Layer", section: TY, off: true },
  { cmd: "layer:none:3d", label: "3B Katman (Desteklenmiyor)", en: "3D Layer", section: TY, off: true },

  { cmd: "layer:style:shadow", label: "Alt Gölge", en: "Drop Shadow", section: ST },
  { cmd: "layer:style:inner", label: "İç Gölge", en: "Inner Shadow", section: ST },
  { cmd: "layer:style:glow", label: "Dış Işıma", en: "Outer Glow", section: ST },
  { cmd: "layer:style:iglow", label: "İç Işıma", en: "Inner Glow", section: ST },
  { cmd: "layer:style:bevel", label: "Eğim ve Kabartma", en: "Bevel & Emboss", section: ST },
  { cmd: "layer:style:satin", label: "Saten", en: "Satin", section: ST },
  { cmd: "layer:style:color", label: "Renk Kaplaması", en: "Color Overlay", section: ST },
  { cmd: "layer:style:gradient", label: "Degrade Kaplaması", en: "Gradient Overlay", section: ST },
  { cmd: "layer:style:pattern", label: "Desen Kaplaması", en: "Pattern Overlay", section: ST },
  { cmd: "layer:style:stroke", label: "Kontur", en: "Stroke", section: ST },

  { cmd: "erase:layermask", label: "Katman Maskesi", en: "Layer Mask", section: MK },
  { cmd: "erase:vector", label: "Vektör Maske", en: "Vector Mask", section: MK },
  { cmd: "layer:clip", label: "Kırpma Maskesi", en: "Clipping Mask", section: MK },
  { cmd: "layer:quickmask", label: "Hızlı Maske", en: "Quick Mask", section: MK },
  { cmd: "layer:sec:density", label: "Maske Yoğunluğu", en: "Density Mask", section: MK },
  { cmd: "layer:smartmask", label: "Akıllı Filtre Maskesi", en: "Smart Filter Mask", section: MK },
  { cmd: "layer:adjmask", label: "Ayar Katmanı Maskesi", en: "Adjustment Layer Mask", section: MK },
]
export const LAYER_SECTIONS = [...new Set(LAYER_TOOLS.map((t) => t.section))]
export const STYLE_NAMES = LAYER_TOOLS.filter((t) => t.section === ST).map((t) => [t.cmd.slice(12), t.label, t.en] as [string, string, string])

export const BLEND_GROUPS: [string, [string, string][]][] = [
  ["", [["normal", "Normal"], ["dissolve", "Çözülme"]]],
  ["Koyulaştır", [["darken", "Koyulaştır"], ["multiply", "Çarp"], ["colorburn", "Renk Yak"], ["linearburn", "Doğrusal Yak"], ["darkercolor", "Daha Koyu Renk"]]],
  ["Aydınlat", [["lighten", "Aydınlat"], ["screen", "Ekran"], ["colordodge", "Renk Aç"], ["lineardodge", "Doğrusal Aç"], ["lightercolor", "Daha Açık Renk"]]],
  ["Kontrast", [["overlay", "Bindirme"], ["softlight", "Yumuşak Işık"], ["hardlight", "Sert Işık"], ["vividlight", "Canlı Işık"], ["linearlight", "Doğrusal Işık"], ["pinlight", "Nokta Işık"], ["hardmix", "Sert Karışım"]]],
  ["Fark", [["difference", "Fark"], ["exclusion", "Dışlama"], ["subtract", "Çıkar"], ["divide", "Böl"]]],
  ["Renk", [["hue", "Renk Tonu"], ["saturation", "Doygunluk"], ["color", "Renk"], ["luminosity", "Parlaklık"]]],
]
export const LABELS: [string, string][] = [["red", "#E5484D"], ["orange", "#F2862E"], ["yellow", "#F1D02C"], ["green", "#46A758"], ["blue", "#3E63DD"], ["violet", "#8E4EC6"], ["gray", "#8A8A92"]]
export const labelColor = (k?: string) => LABELS.find(([n]) => n === k)?.[1]

export const newId = () => Math.random().toString(36).slice(2, 9)

/** Yazının kaplayacağı oran: kutu yazıya göre kurulur, sunucu yazıyı kutuya sığdırır. */
export function textRatio(value: string, family?: string | null, bold?: boolean) {
  const g = document.createElement("canvas").getContext("2d")!
  g.font = `${bold ? "bold " : ""}100px ${family ? `"${family}"` : "sans-serif"}`
  const lines = (value || "Metin").split("\n")
  const w = Math.max(...lines.map((l) => g.measureText(l || " ").width), 1)
  return (lines.length * 125 + 10) / (w + 20)
}

const base = (name: string, W: number, H: number): ImgLayer => ({ id: newId(), photo: "", name, x: 0.5, y: 0.5, w: 1, ar: H / W, rot: 0, opacity: 1, flipH: false, cutout: false })

export function createLayer(kind: "blank" | "text" | "shape" | "fill" | "adjust", W: number, H: number, n: number): ImgLayer {
  const b = base("", W, H)
  switch (kind) {
    case "blank": return { ...b, kind, name: `Katman ${n}` }
    case "text": {
      const textDef = { value: "Metin", color: "#FFFFFF", align: "center" as const, bold: true }
      return { ...b, kind, name: `Metin ${n}`, w: 0.5, ar: textRatio("Metin", null, true), textDef }
    }
    case "shape": return { ...b, kind, name: `Şekil ${n}`, w: 0.35, ar: W / H < 1 ? 1 : 1, shapeDef: { type: "rect", color: "#E0314A", stroke: "#FFFFFF", strokeW: 0, radius: 0 } }
    case "fill": return { ...b, kind, name: `Dolgu ${n}`, opacity: 0.6, fillDef: { type: "color", color: "#3E63DD", color2: "#FFE9A8", angle: 90, pattern: "dots", scale: 0.03 } }
    case "adjust": return { ...b, kind, name: `Ayar ${n}`, adjust: {} }
  }
}

/** Kompozisyon: katmanların görünürlüğü, konumu ve görünüşü. */
export function takeComp(name: string, layers: ImgLayer[], hidden: string[]): LayerComp {
  return { id: newId(), name, hidden: [...hidden], layers: Object.fromEntries(layers.map((l) => [l.id, { x: l.x, y: l.y, w: l.w, rot: l.rot, sy: l.sy, opacity: l.opacity, fill: l.fill, mode: l.mode, styles: l.styles }])) }
}

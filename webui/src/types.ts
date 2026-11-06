export type Style = { color?: string; weight?: string; italic?: boolean; size?: number }
export type Adjust = {
  exposure?: number
  contrast?: number
  highlights?: number
  shadows?: number
  whites?: number
  blacks?: number
  fade?: number // 0..1
  temperature?: number
  tint?: number
  vibrance?: number
  saturation?: number
  sharpen?: number // 0..1
  clarity?: number
  denoise?: number // 0..1
  levels?: [number, number] // otomatik iyileştirmenin ton germe noktaları (siyah, beyaz)
  hsl?: Record<string, [number, number, number]> // renk -> [doygunluk, parlaklık, renk tonu], -1..1
}
// preset: hazır renk ayarı ("" = Tonefect klasik), amount: yoğunluk 0..1, adjust: ince ayar -1..1
export type Texture = { leak?: number; variant?: number; bloom?: number; dust?: number } // 0..1, variant 0..3
export type Frame = { style: "solid" | "polaroid" | "film" | "line"; size: number; color: string | null }
// Yerel düzenleme. Koordinatlar tuvale göre 0..1; degradede a'da tam etki, b'de sıfır.
export type MaskAdjust = Partial<Record<"exposure" | "contrast" | "highlights" | "shadows" | "temperature" | "tint" | "saturation" | "clarity", number>>
// Akıllı seçim adımları: piksel değil adım saklanır, her çözünürlükte yeniden hesaplanır.
export type SelectOp =
  | { kind: "wand"; p: [number, number]; tol: number; contiguous: boolean; add: boolean }
  | { kind: "brush"; pts: [number, number][]; r: number; hard: number; add: boolean }
  | { kind: "subject"; add: boolean; inverse: boolean } // yapay zekâ konu maskesi; inverse: arka plan
export type SelectTool = { mode: "wand" | "brush" | "erase"; tol: number; contiguous: boolean; size: number; hard: number }
export type Mask = {
  id: string
  type: "linear" | "radial" | "select"
  ops?: SelectOp[]
  a?: [number, number]
  b?: [number, number]
  c?: [number, number]
  r?: [number, number]
  feather?: number
  invert: boolean
  fill?: boolean // seçim taşındı: arkada kalan yer çevreden doldurulur
  adjust: MaskAdjust
}
export type Fx = {
  bw: boolean
  grain: number
  vignette: number
  preset?: string
  amount?: number
  adjust?: Adjust
  texture?: Texture
  frame?: Frame // yoksa çerçeve yok
  masks?: Mask[]
  background?: Background // yapay zekâ ile arka plan
}
export type Background = { mode?: "remove" | "color" | "blur"; color?: string; blur?: number }
export type AiStatus = { state: "idle" | "downloading" | "ready" | "error"; done: number; total: number; error: string; size: number }
// recipe: kendi kaydedilen ayar; seçilince bu değerler fotoğrafa kopyalanır
export type Recipe = { base: string; amount: number; adjust: Adjust; bw: boolean }
export type PresetMeta = { id: string; name: string; group: string; bw: boolean; grain: number; vignette: number; user: boolean; recipe?: Recipe }
export type Offsets = Record<string, [number, number]>
export type Mode = "block" | "word"

// Kırpma/döndürme/boyut. crop: [x, y, w, h] 0..1 (null = orana göre ortalanmış); outW/outH null = doğal boyut
export type Geo = {
  aspect: string
  crop: [number, number, number, number] | null
  rotate: number
  flipH: boolean
  flipV: boolean
  straighten: number
  outW: number | null
  outH: number | null
  lock?: boolean // çıktı boyutu kırpma oranına kilitli (varsayılan); false = esnetme
  canvas?: CanvasExt | null // tuval boyutu: fotoğrafın çevresine boşluk
  persp?: [number, number][] | null
  fit?: "content" | null // oran değişince kırpmak yerine içeriğe duyarlı ölçekle // perspektif kırpma: 4 köşe (0..1), döndürülmüş görselde
}
// w/h: son tuval (px), anchor: fotoğrafın yeri (0..1), color: "#RRGGBB" ya da "transparent"
export type CanvasExt = { w: number; h: number; anchor: [number, number]; color: string }
// shadow: 0..1 (varsayılan 0.65), outline: 0..1, tracking: em eklentisi, leading: satır aralığı çarpanı
export type TextFx = { shadow?: number; outline?: number; outlineColor?: string; tracking?: number; leading?: number }
export type Watermark = { enabled: boolean; text: string; position: string; opacity: number; size: number }

// Görsel katmanı (birleştirme): x, y merkez (0..1 tuval), w: genişlik (tuvalin oranı), ar: yükseklik/genişlik
export type ImgLayer = {
  id: string
  photo: string
  name: string
  x: number
  y: number
  w: number
  ar: number
  rot: number
  opacity: number
  flipH: boolean
  cutout: boolean // yapay zekâ ile konuyu kes
}

export type Item = {
  id: string
  name: string
  src?: [number, number] // kaynak fotoğrafın boyutu (EXIF yönü uygulanmış)
  geo?: Geo | null // yoksa eski davranış: 1080x1350
  font?: string | null // yazı tipi ailesi; yoksa tonun kendi yazı tipi
  hidden?: string[] // gizlenen katmanlar (lib/layers.ts); önizlemede ve dışa aktarmada atlanır
  textFx?: TextFx
  layers?: ImgLayer[] // fotoğrafın üstündeki görseller (yazının altında)
  text: string
  tone: string
  accent: string
  styles: Style[]
  block: [number, number]
  offsets: Offsets
  fx: Fx
}

export type Config = {
  canvas: { w: number; h: number }
  tones: string[]
  brand: { name: string; handle: string; signature_text: string }
  limits: { max_words?: number }
  version: string
  quitOnClose: boolean
  updateFailed?: { target: string; log: string } | null
  fontWarn: string[]
  outDir: string
  watermark: Watermark
}

export type ProjectMeta = { id: string; name: string; updated: number; count: number; size: [number, number] | null; preset: string | null }

export type Box = { idx: number; box: [number, number, number, number] }

export type PreviewData = {
  image: string
  boxes: Box[]
  size: number
  w: number
  h: number
  k: number // kaydırma birimi (1080x1350 tuval pikseli) -> tuval pikseli
  photo: string
  used: { text: string; block: [number, number]; offsets: Offsets }
}

export type Job = {
  total: number
  done: number
  files: { name: string; text: string }[]
  errors: string[]
  finished: boolean
  outDir: string
}

export type ColorMode = "rgb" | "gray" | "cmyk" | "bitmap" | "indexed" | "lab"
export type ExportOpts = { format: "jpg" | "png" | "webp" | "tiff"; quality: number; naming: "number" | "original"; exif: boolean; color?: ColorMode; dpi?: number | null }

export type Settings = {
  outDir: string
  tone: string
  fx: Fx
  guides: boolean
  export?: ExportOpts
  aspect?: string // yeni fotoğrafların oranı: "original" ya da "insta" (4:5, 1080x1350)
  theme?: string
  v?: number // ayar biçimi sürümü (eski kayıtları bir kez dönüştürmek için)
}

export type UpdateInfo = {
  current: string
  latest: string
  newer: boolean
  notes: string
  page: string
  canInstall: boolean
  size: number
  error: string
}

export type UpdateStatus = { state: "idle" | "downloading" | "installing" | "error"; done: number; total: number; error: string }

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
export type Mask = {
  id: string
  type: "linear" | "radial"
  a?: [number, number]
  b?: [number, number]
  c?: [number, number]
  r?: [number, number]
  feather?: number
  invert: boolean
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
}
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
}
// shadow: 0..1 (varsayılan 0.65), outline: 0..1, tracking: em eklentisi, leading: satır aralığı çarpanı
export type TextFx = { shadow?: number; outline?: number; outlineColor?: string; tracking?: number; leading?: number }
export type Watermark = { enabled: boolean; text: string; position: string; opacity: number; size: number }

export type Item = {
  id: string
  name: string
  src?: [number, number] // kaynak fotoğrafın boyutu (EXIF yönü uygulanmış)
  geo?: Geo | null // yoksa eski davranış: 1080x1350
  font?: string | null // yazı tipi ailesi; yoksa tonun kendi yazı tipi
  textFx?: TextFx
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

export type ExportOpts = { format: "jpg" | "png" | "webp"; quality: number; naming: "number" | "original"; exif: boolean }

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

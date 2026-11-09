export type Style = { color?: string; weight?: string; italic?: boolean; size?: number }
export type Adjust = {
  exposure?: number
  contrast?: number
  highlights?: number
  shadows?: number
  midtones?: number
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
// Selection Tool adımları: piksel değil adım saklanır, her çözünürlükte sırayla yeniden hesaplanır.
type Combine = { add: boolean; intersect?: boolean }
type Box4 = [number, number, number, number]
export type SelectOp =
  | ({ kind: "wand"; p: [number, number]; tol: number; contiguous: boolean } & Combine)
  | ({ kind: "brush"; pts: [number, number][]; r: number; hard: number } & Combine)
  | ({ kind: "quick"; pts: [number, number][]; r: number; tol: number } & Combine)
  | ({ kind: "subject"; inverse: boolean } & Combine) // yapay zekâ konu maskesi; inverse: arka plan
  | ({ kind: "rect" | "ellipse" | "object"; box: Box4 } & Combine)
  | ({ kind: "row"; y: number } & Combine)
  | ({ kind: "col"; x: number } & Combine)
  | ({ kind: "poly" | "magnetic"; pts: [number, number][] } & Combine)
  | ({ kind: "range"; p: [number, number]; tol: number } & Combine)
  | ({ kind: "focus"; amt: number } & Combine)
  | ({ kind: "sky" } & Combine)
  | { kind: "invert" }
  | { kind: "expand" | "contract" | "feather" | "smooth" | "border"; amt: number } // amt: kısa kenara oranla
  | { kind: "grow" | "similar"; tol: number }
export type SelectCombo = "add" | "sub" | "intersect"
export type SelectTool = {
  mode: "rect" | "ellipse" | "row" | "col" | "lasso" | "poly" | "magnetic" | "object" | "quick" | "wand" | "brush" | "erase" | "range"
  tol: number
  contiguous: boolean
  size: number
  hard: number
  combine: SelectCombo
  amt: number // Seçimi Düzenle miktarı (px)
  noObject?: boolean // çerçeve ve kement çizimi nesneye dönüşmesin, seçim olarak kalsın
  cutObject?: boolean // nesne yerinden kesilsin, boşluk çevreden dolsun
  focus: number
}
export type SavedSelection = { id: string; name: string; ops: SelectOp[]; feather: number; refine?: Mask["refine"] }
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
  refine?: { edge?: number; smooth?: number; shift?: number; contrast?: number } // Seç ve Maskele
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
  retouch?: Retouch // otomatik cilt, frekans ayırma, fotoğraf onarımı
  color?: ColorEdits // renk ve ışık düzenlemeleri
  filters?: FilterItem[] // sırayla uygulanan filtreler
}
export type FilterItem = { id: string; kind: string; amount: number; off?: boolean; area?: string; [param: string]: any }
export type ColorToolId = "basic" | "wb" | "bc" | "levels" | "curves" | "shhi" | "hdr" | "hue" | "balance" | "grade" | "selective" | "mixer" | "filter" | "lut" | "match" | "replace" | "bw" | "desat" | "gradient" | "invert" | "posterize" | "threshold"
type Lv = [number, number, number, number, number] // siyah, gama, beyaz, çıkış siyahı, çıkış beyazı
type Hsl3 = [number, number, number]
export type ColorEdits = {
  wb?: { temp?: number; tint?: number }
  bc?: { b?: number; c?: number }
  levels?: { rgb?: Lv; r?: Lv; g?: Lv; b?: Lv }
  curves?: { rgb?: [number, number][]; r?: [number, number][]; g?: [number, number][]; b?: [number, number][] }
  shhi?: { s?: number; h?: number; mid?: number; radius?: number; color?: number }
  hdr?: { amount?: number; radius?: number; detail?: number; sat?: number }
  hue?: { h?: number; s?: number; l?: number }
  balance?: { shadows?: Hsl3; mids?: Hsl3; highs?: Hsl3; preserve?: boolean }
  grade?: { shadow?: Hsl3; mid?: Hsl3; high?: Hsl3; global?: Hsl3; balance?: number; blend?: number }
  selective?: { bands?: Record<string, [number, number, number, number]>; relative?: boolean }
  mixer?: { r?: [number, number, number, number]; g?: [number, number, number, number]; b?: [number, number, number, number]; mono?: boolean }
  filter?: { color?: string; density?: number; preserve?: boolean }
  lut?: { id?: string; amount?: number }
  match?: { photo?: string; lum?: number; sat?: number; fade?: number }
  replace?: { color?: string; fuzz?: number; h?: number; s?: number; l?: number }
  bw?: { on?: boolean; r?: number; y?: number; g?: number; c?: number; b?: number; m?: number; tint?: boolean; hue?: number; sat?: number }
  desat?: { on?: boolean }
  invert?: { on?: boolean }
  posterize?: { on?: boolean; n?: number }
  threshold?: { on?: boolean; level?: number }
  gradient?: { on?: boolean; stops?: [number, string][]; amount?: number; reverse?: boolean }
}
export type Background = { mode?: "remove" | "color" | "blur"; color?: string; blur?: number; edge?: number; defringe?: number }
export type AiStatus = { state: "idle" | "downloading" | "ready" | "error"; done: number; total: number; error: string; size: number }
// recipe: kendi kaydedilen ayar; seçilince bu değerler fotoğrafa kopyalanır
export type Recipe = { base: string; amount: number; adjust: Adjust; bw: boolean; color?: ColorEdits }
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
  ca?: boolean // içeriğe duyarlı kırpma: boş köşeler dolar, çerçeve fotoğrafın dışına taşabilir
  keystone?: { v: number; h: number } | null // perspektifi düzelt kaydırıcıları (persp'i üretir)
  fit?: "content" | null // oran değişince kırpmak yerine içeriğe duyarlı ölçekle // perspektif kırpma: 4 köşe (0..1), döndürülmüş görselde
}
// w/h: son tuval (px), anchor: fotoğrafın yeri (0..1), color: "#RRGGBB" ya da "transparent"
export type CanvasExt = { w: number; h: number; anchor: [number, number]; color: string }
// shadow: 0..1 (varsayılan 0.65), outline: 0..1, tracking: em eklentisi, leading: satır aralığı çarpanı
export type TextFx = { color?: string; shadow?: number; outline?: number; outlineColor?: string; tracking?: number; leading?: number }
export type Watermark = { enabled: boolean; text: string; position: string; opacity: number; size: number }

// Görsel katmanı (birleştirme): x, y merkez (0..1 tuval), w: genişlik (tuvalin oranı), ar: yükseklik/genişlik
export type PenTool = "pen" | "free" | "add" | "del" | "convert" | "path" | "direct"
export type PathNode = { p: [number, number]; in?: [number, number] | null; out?: [number, number] | null }
export type VPath = { id: string; name: string; closed: boolean; nodes: PathNode[] }
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
  off?: boolean // yalnızca PSD yazarken: gizli katman
  tint?: string // nesneye verilen renk
  fx?: Partial<Fx> // bu katmana özel renk, filtre ve efektler
  base?: boolean // ana fotoğrafın kendisi ya da kopyası: renk ve efektler uygulanmış haliyle çizilir
  // dönüşüm (kutuya göre 0..1): sy dikey ölçek, corners köşe kaymaları, warp 4x4, pwarp 3x2 düğüm, pins kukla pimleri
  sy?: number
  corners?: [number, number][]
  warp?: [number, number][]
  pwarp?: [number, number][]
  pins?: { p: [number, number]; q: [number, number] }[]
  blend?: boolean // otomatik harmanla
  clip?: boolean // kırpma maskesi: alttaki katmanın dolu yerlerinde görünür
  defringe?: number
  mask?: { ops: { kind: "brush"; pts: [number, number][]; r: number; hard: number; add: boolean }[]; invert?: boolean; off?: boolean; density?: number; feather?: number } // katman maskesi
  vector?: { kind: "rect" | "ellipse"; box: [number, number, number, number] } | { kind: "path"; pts: [number, number][] } // vektör maske
  // katman sistemi
  kind?: "blank" | "text" | "shape" | "fill" | "adjust" // yoksa görsel katmanı
  mode?: string // karışım kipi
  fill?: number // dolgu opaklığı: stilleri etkilemez
  styles?: Record<string, { on?: boolean; [k: string]: unknown }>
  group?: string
  link?: string
  locked?: boolean
  lockPos?: boolean // yalnızca konum kilitli: taşınamaz ve dönüştürülemez, ama düzenlenebilir
  label?: string
  smart?: boolean
  paint?: { strokes: Stroke[] }
  textDef?: { value: string; family?: string | null; color: string; align: "left" | "center" | "right"; bold?: boolean }
  shapeDef?: { type: string; pts?: [number, number][]; color: string; stroke: string; strokeW: number; radius: number }
  fillDef?: { type: "color" | "gradient" | "pattern"; color: string; color2: string; angle: number; pattern: string; scale: number; from?: [number, number]; to?: [number, number]; radial?: boolean }
  adjust?: ColorEdits
}
export type LayerGroup = { id: string; name: string; open: boolean }
export type LayerComp = { id: string; name: string; hidden: string[]; layers: Record<string, Partial<ImgLayer>> }
export type XformMode = "move" | "free" | "scale" | "rotate" | "skew" | "distort" | "perspective" | "warp" | "puppet" | "pwarp"

// Dilim: son tuvale göre 0..1 kutu
export type Slice = { id: string; x: number; y: number; w: number; h: number; name?: string }

// Fırça ve çizim: boya piksel değil darbe olarak saklanır
export type BrushTool = "brush" | "pencil" | "replace" | "mixer" | "erase" | "bgerase" | "magic" | "history" | "arthistory" | "remove" | "fillgaps" | "colorkey" | "spot" | "heal" | "patch" | "camove" | "clone" | "patstamp" | "dodge" | "burn" | "sponge" | "blur" | "sharpen" | "smudge" | "freq" | "wrinkle" | "skin" | "blemish" | "teeth" | "eye" | "redeye"
export type MaskPaintTool = { paint: "hide" | "show"; size: number; hard: number; shape: "rect" | "ellipse" | "path" }
export type BrushSettings = {
  size: number // kısa kenara oranla
  hard: number; opacity: number; flow: number; spacing: number; angle: number; round: number
  sizeJ: number; minD: number; angleJ: number; roundJ: number; hueJ: number; satJ: number; briJ: number; fgbgJ: number
  scatter: number; count: number; wet: number; dry: number; texDepth: number; tol: number; pickup: number; load: number
  dualSize: number; dualScatter: number; dualHard: number
  pressSize: boolean; pressOpacity: boolean; paintOnly: boolean; contiguous: boolean; dual: boolean
  color: string; color2: string; tip: string; tex: string; pattern: string
  // rötuş araçları
  amount: number; range: "shadows" | "mid" | "high"; sponge: "desat" | "sat"; vib: boolean; finger: boolean; stamp: string; stampScale: number; aligned: boolean
}
export type Stroke = { tool: BrushTool; pts: [number, number, number][]; seed: number; b: BrushSettings; src?: [number, number]; mode?: string }
export type CloneSource = { pt: [number, number]; off: [number, number] | null } // off: hizalı kaynağın darbeler arası sabit kaydırması
export type Retouch = {
  smooth?: number; tone?: number; blemish?: number; texture?: number; area?: string
  fsLow?: number; fsHigh?: number; fsRadius?: number; fsSkin?: boolean
  scratch?: number; denoise?: number; fade?: number; cast?: number; sharp?: number
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
  groups?: LayerGroup[]
  comps?: LayerComp[]
  textAfter?: string // yazının hemen altındaki katman; yoksa en üstte
  paths?: VPath[] // Kalem ile çizilen yollar; çıktıda görünmez
  selections?: SavedSelection[] // Selection Tool: kaydedilen seçimler
  slices?: Slice[] // dilimleme
  paint?: { strokes: Stroke[] } // fırça darbeleri
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
export type ExportOpts = { format: "jpg" | "png" | "webp" | "tiff" | "psd"; quality: number; naming: "number" | "original"; exif: boolean; color?: ColorMode; dpi?: number | null }

export type Settings = {
  outDir: string
  tone: string
  fx: Fx
  guides: boolean
  export?: ExportOpts
  brushes?: { presets: { id: string; name: string; group: string; tool?: BrushTool; b: Partial<BrushSettings> }[]; tips: { id: string; photo: string; name: string }[] }
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

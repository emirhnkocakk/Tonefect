export type Style = { color?: string; weight?: string; italic?: boolean; size?: number }
export type Adjust = { exposure?: number; contrast?: number; temperature?: number; saturation?: number }
// preset: hazır renk ayarı ("" = Tonefect klasik), amount: yoğunluk 0..1, adjust: ince ayar -1..1
export type Fx = { bw: boolean; grain: number; vignette: number; preset?: string; amount?: number; adjust?: Adjust }
export type PresetMeta = { id: string; name: string; group: string; bw: boolean; grain: number; vignette: number; user: boolean }
export type Offsets = Record<string, [number, number]>
export type Mode = "block" | "word"

export type Item = {
  id: string
  name: string
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
}

export type Box = { idx: number; box: [number, number, number, number] }

export type PreviewData = {
  image: string
  boxes: Box[]
  size: number
  w: number
  h: number
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

export type Settings = {
  outDir: string
  tone: string
  fx: Fx
  guides: boolean
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

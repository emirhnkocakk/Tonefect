export type Style = { color?: string; weight?: string; italic?: boolean; size?: number }
export type Fx = { bw: boolean; grain: number; vignette: number }
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

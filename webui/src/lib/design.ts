import type { ImgLayer } from "@/types"

// Görsel katmanlarının tuval pikselindeki kutuları; hizalama ve dağıtma Photoshop'taki gibi:
// tek katman tuvale, birden çok katman seçimin sınırına göre hizalanır.
export type Box = { l: number; t: number; r: number; b: number }

const UNIT: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
type M3 = number[]

/** Birim kareyi dörtgene götüren matris (render._unit_homography). */
function unitH(q: [number, number][]): M3 {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3
  const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3
  const den = dx1 * dy2 - dx2 * dy1 || 1e-9
  const g = (sx * dy2 - dx2 * sy) / den
  const h = (dx1 * sy - sx * dy1) / den
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]
}
const applyH = (m: M3, u: number, v: number): [number, number] => {
  const d = m[6] * u + m[7] * v + m[8] || 1e-6
  return [(m[0] * u + m[1] * v + m[2]) / d, (m[3] * u + m[4] * v + m[5]) / d]
}
function invert(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g
  const det = a * A + b * B + c * C || 1e-9
  return [A / det, (c * h - b * i) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, (c * d - a * f) / det, C / det, (b * g - a * h) / det, (a * e - b * d) / det]
}
const cornerM = (ly: ImgLayer) => (ly.corners ? unitH(UNIT.map(([u, v], i) => [u + ly.corners![i][0], v + ly.corners![i][1]])) : null)
const boxOf = (ly: ImgLayer, W: number) => [ly.w * W, ly.w * W * ly.ar * (ly.sy ?? 1)]

export const identityGrid = (rows: number, cols: number): [number, number][] =>
  Array.from({ length: rows * cols }, (_, i) => [(i % cols) / (cols - 1), Math.floor(i / cols) / (rows - 1)])

/** Katman içi (u, v) noktasının tuvaldeki yeri (render.layer_mesh). */
export function layerPt(ly: ImgLayer, W: number, H: number, u: number, v: number): [number, number] {
  const m = cornerM(ly)
  const [pu, pv] = m ? applyH(m, u, v) : [u, v]
  const [bw, bh] = boxOf(ly, W)
  const x = (pu - 0.5) * bw
  const y = (pv - 0.5) * bh
  const a = (ly.rot * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a) + ly.x * W, x * Math.sin(a) + y * Math.cos(a) + ly.y * H]
}

/** Ekran kaymasının kutu birimindeki karşılığı. */
export function localDelta(ly: ImgLayer, W: number, _H: number, dx: number, dy: number): [number, number] {
  const a = (-ly.rot * Math.PI) / 180
  const [bw, bh] = boxOf(ly, W)
  return [(dx * Math.cos(a) - dy * Math.sin(a)) / bw, (dx * Math.sin(a) + dy * Math.cos(a)) / bh]
}

/** Tuval noktasının katman içi (u, v) karşılığı. */
export function layerUV(ly: ImgLayer, W: number, H: number, x: number, y: number): [number, number] {
  const [lu, lv] = localDelta(ly, W, H, x - ly.x * W, y - ly.y * H)
  const m = cornerM(ly)
  return m ? applyH(invert(m), lu + 0.5, lv + 0.5) : [lu + 0.5, lv + 0.5]
}

/** Dönüştürülmüş katmanın eksene paralel sınır kutusu (tuval pikseli). */
export function layerBox(ly: ImgLayer, W: number, H: number): Box {
  const p = UNIT.map(([u, v]) => layerPt(ly, W, H, u, v))
  return { l: Math.min(...p.map((q) => q[0])), t: Math.min(...p.map((q) => q[1])), r: Math.max(...p.map((q) => q[0])), b: Math.max(...p.map((q) => q[1])) }
}

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"

export function align(layers: ImgLayer[], ids: string[], kind: AlignKind, W: number, H: number): ImgLayer[] {
  const sel = layers.filter((l) => ids.includes(l.id))
  if (!sel.length) return layers
  const boxes = sel.map((l) => layerBox(l, W, H))
  const ref: Box = sel.length === 1
    ? { l: 0, t: 0, r: W, b: H }
    : { l: Math.min(...boxes.map((b) => b.l)), t: Math.min(...boxes.map((b) => b.t)), r: Math.max(...boxes.map((b) => b.r)), b: Math.max(...boxes.map((b) => b.b)) }
  return layers.map((ly) => {
    if (!ids.includes(ly.id)) return ly
    const b = layerBox(ly, W, H)
    let dx = 0
    let dy = 0
    if (kind === "left") dx = ref.l - b.l
    if (kind === "right") dx = ref.r - b.r
    if (kind === "hcenter") dx = (ref.l + ref.r) / 2 - (b.l + b.r) / 2
    if (kind === "top") dy = ref.t - b.t
    if (kind === "bottom") dy = ref.b - b.b
    if (kind === "vcenter") dy = (ref.t + ref.b) / 2 - (b.t + b.b) / 2
    return { ...ly, x: ly.x + dx / W, y: ly.y + dy / H }
  })
}

/** Eşit aralıkla dağıt (en az 3 katman): uçtakiler yerinde kalır, aradaki boşluklar eşitlenir. */
export function distribute(layers: ImgLayer[], ids: string[], axis: "h" | "v", W: number, H: number): ImgLayer[] {
  const sel = layers.filter((l) => ids.includes(l.id)).map((l) => ({ l, b: layerBox(l, W, H) }))
  if (sel.length < 3) return layers
  const lo = (b: Box) => (axis === "h" ? b.l : b.t)
  const hi = (b: Box) => (axis === "h" ? b.r : b.b)
  sel.sort((a, b) => lo(a.b) - lo(b.b))
  const span = hi(sel[sel.length - 1].b) - lo(sel[0].b)
  const total = sel.reduce((s, x) => s + hi(x.b) - lo(x.b), 0)
  const gap = (span - total) / (sel.length - 1)
  const moved = new Map<string, number>()
  let pos = lo(sel[0].b)
  for (const x of sel) {
    moved.set(x.l.id, pos - lo(x.b))
    pos += hi(x.b) - lo(x.b) + gap
  }
  return layers.map((ly) => {
    const d = moved.get(ly.id)
    if (d == null) return ly
    return axis === "h" ? { ...ly, x: ly.x + d / W } : { ...ly, y: ly.y + d / H }
  })
}

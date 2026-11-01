import type { ImgLayer } from "@/types"

// Görsel katmanlarının tuval pikselindeki kutuları; hizalama ve dağıtma Photoshop'taki gibi:
// tek katman tuvale, birden çok katman seçimin sınırına göre hizalanır.
export type Box = { l: number; t: number; r: number; b: number }

/** Döndürülmüş katmanın eksene paralel sınır kutusu (tuval pikseli). */
export function layerBox(ly: ImgLayer, W: number, H: number): Box {
  const w = ly.w * W
  const h = w * ly.ar
  const a = (ly.rot * Math.PI) / 180
  const hw = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2
  const hh = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * h) / 2
  const cx = ly.x * W
  const cy = ly.y * H
  return { l: cx - hw, t: cy - hh, r: cx + hw, b: cy + hh }
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

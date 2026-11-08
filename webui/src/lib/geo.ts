import type { Geo } from "@/types"

// render.py geo_plan ile aynı hesap: tuvalin boyutunu önizleme gelmeden bilmek için.
export const MAX_SIDE = 12000
export const LEGACY_SIZE: [number, number] = [1080, 1350]

export const ASPECTS: [string, string, string?][] = [
  ["original", "Orijinal"],
  ["free", "Serbest"],
  ["1:1", "Kare", "1:1"],
  ["4:5", "Portre", "4:5 · Instagram"],
  ["9:16", "Hikâye", "9:16"],
  ["16:9", "Geniş", "16:9"],
  ["3:2", "Fotoğraf", "3:2"],
  ["2:3", "Dikey", "2:3"],
  ["4:3", "Klasik", "4:3"],
  ["3:4", "Klasik Dikey", "3:4"],
  ["5:4", "Baskı", "5:4"],
  ["21:9", "Sinema", "21:9"],
]

export const CA_SCALE = 1.5 // render.CA_SCALE: içeriğe duyarlı kırpmada taşma payı

export const SIZE_PRESETS: [string, number | null][] = [
  ["Orijinal", null],
  ["4K", 3840],
  ["2K", 2048],
  ["1080", 1080],
]

export function newGeo(aspect = "original"): Geo {
  return { aspect, crop: null, rotate: 0, flipH: false, flipV: false, straighten: 0, outW: null, outH: null }
}

/** Eski fotoğraflar (geo yok): 1080x1350, ortadan kırpılmış — aynı sonucu veren geo. */
export const legacyGeo = (): Geo => ({ ...newGeo("4:5"), outW: LEGACY_SIZE[0], outH: LEGACY_SIZE[1] })

export function ratioOf(aspect: string): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect)
  return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : null
}

function inner(w: number, h: number, deg: number): [number, number] {
  if (!deg) return [w, h]
  const a = (Math.abs(deg) * Math.PI) / 180
  const sa = Math.sin(a)
  const ca = Math.cos(a)
  const long = Math.max(w, h)
  const short = Math.min(w, h)
  if (short <= 2 * sa * ca * long || Math.abs(sa - ca) < 1e-10) {
    const x = 0.5 * short
    return w >= h ? [x / sa, x / ca] : [x / ca, x / sa]
  }
  const cos2a = ca * ca - sa * sa
  return [(w * ca - h * sa) / cos2a, (h * ca - w * sa) / cos2a]
}

/** Döndürme/düzeltme sonrası kırpılabilir alan (tam piksel). */
export function innerSize(geo: Geo, src: [number, number]): [number, number] {
  let [w, h] = geo.rotate % 180 ? [src[1], src[0]] : src
  if (geo.persp) [w, h] = perspSize(geo.persp, w, h)
  if (geo.ca) {
    const a = (Math.abs(geo.straighten || 0) * Math.PI) / 180
    return [(w * Math.cos(a) + h * Math.sin(a)) * CA_SCALE, (w * Math.sin(a) + h * Math.cos(a)) * CA_SCALE]
  }
  return inner(w, h, geo.straighten || 0)
}

/** render.persp_size: dörtgenin düzeltilmiş boyutu. */
export function perspSize(q: [number, number][], w: number, h: number): [number, number] {
  const p = q.map(([x, y]) => [x * w, y * h])
  const d = (a: number, b: number) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1])
  return [Math.max(16, Math.round((d(0, 1) + d(3, 2)) / 2)), Math.max(16, Math.round((d(0, 3) + d(1, 2)) / 2))]
}

/** Kırpma kutusu (0..1). crop yoksa orana göre ortalanmış en büyük kutu. */
export function cropOf(geo: Geo, iw: number, ih: number): [number, number, number, number] {
  if (geo.crop) return geo.crop
  const base = geo.ca ? 1 / CA_SCALE : 1
  let cw = base
  let ch = base
  const r = geo.fit === "content" ? null : ratioOf(geo.aspect)
  if (r) {
    if (iw / ih > r) cw = (base * r * ih) / iw
    else ch = (base * iw) / r / ih
  }
  return [(1 - cw) / 2, (1 - ch) / 2, cw, ch]
}

/** Kırpma kutusunun en-boy kilidi (0..1 biriminde w/h); serbestse null. */
export function lockRatio(geo: Geo, iw: number, ih: number): number | null {
  if (geo.aspect === "free" || geo.fit === "content") return null
  if (geo.aspect === "original") return 1
  const r = ratioOf(geo.aspect)
  return r ? (r * ih) / iw : null
}

export function naturalSize(geo: Geo, src: [number, number]): [number, number] {
  const [iw, ih] = innerSize(geo, src)
  const c = cropOf(geo, iw, ih)
  const n: [number, number] = [Math.max(1, Math.round(c[2] * iw)), Math.max(1, Math.round(c[3] * ih))]
  const r = ratioOf(geo.aspect)
  if (geo.fit === "content" && r) return n[0] / n[1] > r ? [Math.max(1, Math.round(n[1] * r)), n[1]] : [n[0], Math.max(1, Math.round(n[0] / r))]
  return n
}

/** Son tuval boyutu (tuval genişletmesi dahil). */
export function canvasSize(geo: Geo | null | undefined, src?: [number, number] | null): [number, number] | null {
  if (geo?.canvas) return [geo.canvas.w, geo.canvas.h]
  return photoSize(geo, src)
}

/** Fotoğrafın tuval içindeki yeri (0..1): [x, y, w, h] (render.canvas_plan). */
export function photoRect(geo: Geo | null | undefined, src?: [number, number] | null): [number, number, number, number] {
  const p = photoSize(geo, src)
  const c = geo?.canvas
  if (!c || !p) return [0, 0, 1, 1]
  return [(Math.round((c.w - p[0]) * c.anchor[0])) / c.w, Math.round((c.h - p[1]) * c.anchor[1]) / c.h, p[0] / c.w, p[1] / c.h]
}

/** Fotoğrafın çıktı boyutu (kırpma + ölçek; tuval genişletmesi hariç). */
export function photoSize(geo: Geo | null | undefined, src?: [number, number] | null): [number, number] | null {
  if (!geo) return LEGACY_SIZE
  if (!src) return null
  const clamp = (v: number) => Math.max(16, Math.min(MAX_SIDE, Math.round(v)))
  if (geo.outW && geo.outH) return [clamp(geo.outW), clamp(geo.outH)]
  const n = naturalSize(geo, src)
  return [clamp(n[0]), clamp(n[1])]
}

/** Yazı/filigran ölçeği: 1080x1350 tuvalde 1 (render.canvas_scale). */
export const canvasScale = (w: number, h: number) => Math.sqrt((w * h) / (1080 * 1350))

/** Perspektifi Düzelt: v > 0 üst, v < 0 alt; h > 0 sol, h < 0 sağ kenar daraltılır (fotoğrafın içinde kalır). */
export function keystoneQuad(v: number, h: number): [number, number][] {
  const a = Math.max(v, 0) * 0.4
  const b = Math.max(-v, 0) * 0.4
  const c = Math.max(h, 0) * 0.4
  const d = Math.max(-h, 0) * 0.4
  return [[a, c], [1 - a, d], [1 - b, 1 - d], [b, 1 - c]]
}

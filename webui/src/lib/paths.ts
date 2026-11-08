import { CircleMinus, CirclePlus, MousePointer2, MousePointerClick, PenLine, PenTool, Spline } from "lucide-react"
import type { PathNode, PenTool as PenMode, VPath } from "@/types"

// Kalem ve Yollar: düğümler tuvale göre 0..1; kontrol kolları düğümden bağımsız mutlak konumdur.
type Pt = [number, number]
export const PEN_TOOLS: { id: PenMode; cmd: string; label: string; en: string; icon: typeof PenTool; group: "pen" | "select"; hint: string }[] = [
  { id: "pen", cmd: "pen:tool:pen", label: "Kalem", en: "Pen Tool", icon: PenTool, group: "pen", hint: "Tıkla: köşe. Sürükle: eğri. İlk noktaya tıkla: kapat. Enter: bitir. Backspace: son noktayı sil. Ctrl: nokta taşı, Alt: nokta dönüştür." },
  { id: "free", cmd: "pen:tool:free", label: "Serbest Kalem", en: "Freeform Pen Tool", icon: PenLine, group: "pen", hint: "Sürükleyerek çiz; noktalar otomatik yerleşir." },
  { id: "add", cmd: "pen:tool:add", label: "Nokta Ekle", en: "Add Anchor Point Tool", icon: CirclePlus, group: "pen", hint: "Yolun üzerine tıkla: şekil bozulmadan nokta eklenir." },
  { id: "del", cmd: "pen:tool:del", label: "Nokta Sil", en: "Delete Anchor Point Tool", icon: CircleMinus, group: "pen", hint: "Silmek istediğin noktaya tıkla." },
  { id: "convert", cmd: "pen:tool:convert", label: "Nokta Dönüştür", en: "Convert Point Tool", icon: Spline, group: "pen", hint: "Eğri noktaya tıkla: köşe olur. Köşeden sürükle: eğri olur. Kolu sürükle: iki kol bağımsız hareket eder." },
  { id: "path", cmd: "pen:tool:path", label: "Yol Seçimi", en: "Path Selection Tool", icon: MousePointer2, group: "select", hint: "Yola tıkla ve bütün olarak sürükle. Delete: yolu sil." },
  { id: "direct", cmd: "pen:tool:direct", label: "Doğrudan Seçim", en: "Direct Selection Tool", icon: MousePointerClick, group: "select", hint: "Noktaları ve kontrol kollarını sürükle." },
]

export const newPathId = () => Math.random().toString(36).slice(2, 9)
const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return [w[0] * a[0] + w[1] * c1[0] + w[2] * c2[0] + w[3] * b[0], w[0] * a[1] + w[1] * c1[1] + w[2] * c2[1] + w[3] * b[1]]
}

const segCount = (p: VPath) => (p.closed ? p.nodes.length : Math.max(0, p.nodes.length - 1))
const segEnds = (p: VPath, i: number): [PathNode, PathNode] => [p.nodes[i], p.nodes[(i + 1) % p.nodes.length]]
const isLine = (a: PathNode, b: PathNode) => !a.out && !b.in

/** SVG yol verisi (ekran pikseli). */
export function pathD(p: VPath, w: number, h: number): string {
  if (!p.nodes.length) return ""
  const f = (q: Pt) => `${q[0] * w} ${q[1] * h}`
  let d = `M ${f(p.nodes[0].p)}`
  for (let i = 0; i < segCount(p); i++) {
    const [a, b] = segEnds(p, i)
    d += isLine(a, b) ? ` L ${f(b.p)}` : ` C ${f(a.out ?? a.p)} ${f(b.in ?? b.p)} ${f(b.p)}`
  }
  return p.closed ? d + " Z" : d
}

/** Yolu kırık çizgiye çevirir (seçim, maske, kontur için). */
export function flatten(p: VPath, steps = 20): Pt[] {
  if (!p.nodes.length) return []
  const out: Pt[] = [p.nodes[0].p]
  for (let i = 0; i < segCount(p); i++) {
    const [a, b] = segEnds(p, i)
    if (isLine(a, b)) out.push(b.p)
    else for (let k = 1; k <= steps; k++) out.push(cubic(a.p, a.out ?? a.p, b.in ?? b.p, b.p, k / steps))
  }
  return out
}

/** Nokta sayısını sınırlar (sunucudaki üst sınırlar için). */
export function capPoints(pts: Pt[], max: number): Pt[] {
  if (pts.length <= max) return pts
  const k = (pts.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * k)])
}

/** Ekrandaki noktaya en yakın yol parçası: i. parça ve t konumu. */
export function nearest(p: VPath, x: number, y: number, w: number, h: number): { i: number; t: number; dist: number } | null {
  let best: { i: number; t: number; dist: number } | null = null
  for (let i = 0; i < segCount(p); i++) {
    const [a, b] = segEnds(p, i)
    for (let k = 0; k <= 40; k++) {
      const t = k / 40
      const q = cubic(a.p, a.out ?? a.p, b.in ?? b.p, b.p, t)
      const dist = Math.hypot(q[0] * w - x, q[1] * h - y)
      if (!best || dist < best.dist) best = { i, t, dist }
    }
  }
  return best
}

/** De Casteljau: eğri biçimi değişmeden nokta ekler. */
export function splitAt(p: VPath, i: number, t: number): VPath {
  const [a, b] = segEnds(p, i)
  const c1 = a.out ?? a.p
  const c2 = b.in ?? b.p
  const nodes = p.nodes.map((n) => ({ ...n }))
  let mid: PathNode
  if (isLine(a, b)) mid = { p: lerp(a.p, b.p, t) }
  else {
    const q1 = lerp(a.p, c1, t)
    const q2 = lerp(c1, c2, t)
    const q3 = lerp(c2, b.p, t)
    const r1 = lerp(q1, q2, t)
    const r2 = lerp(q2, q3, t)
    nodes[i].out = q1
    nodes[(i + 1) % nodes.length].in = q3
    mid = { p: lerp(r1, r2, t), in: r1, out: r2 }
  }
  nodes.splice(i + 1, 0, mid)
  return { ...p, nodes }
}

/** Ramer-Douglas-Peucker: serbest çizimi az sayıda noktaya indirir (ekran pikseli toleransıyla). */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts
  const [a, b] = [pts[0], pts[pts.length - 1]]
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  let max = 0
  let at = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / len
    if (d > max) (max = d), (at = i)
  }
  if (max <= tol) return [a, b]
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)]
}

/** Serbest kalem: ekran noktalarından yumuşak yol. */
export function freeformNodes(screen: Pt[], w: number, h: number): { nodes: PathNode[]; closed: boolean } {
  let pts = simplify(screen, 3)
  const closed = pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 12
  if (closed) pts = pts.slice(0, -1)
  const n = pts.length
  const rel = (q: Pt): Pt => [q[0] / w, q[1] / h]
  const nodes = pts.map((q, i) => {
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
    const dx = (next[0] - prev[0]) / 6
    const dy = (next[1] - prev[1]) / 6
    return { p: rel(q), in: rel([q[0] - dx, q[1] - dy]), out: rel([q[0] + dx, q[1] + dy]) }
  })
  return { nodes, closed }
}

const K = 0.5523
/** Seçimden yol: dikdörtgen, elips ve çokgen seçimler. Koordinatlar çağıranda tuvale çevrilir. */
export function nodesFromBox(kind: "rect" | "ellipse", [x0, y0, x1, y1]: [number, number, number, number]): PathNode[] {
  if (kind === "rect") return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => ({ p: p as Pt }))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = (x1 - x0) / 2
  const ry = (y1 - y0) / 2
  return [
    { p: [cx, y0], in: [cx - rx * K, y0], out: [cx + rx * K, y0] },
    { p: [x1, cy], in: [x1, cy - ry * K], out: [x1, cy + ry * K] },
    { p: [cx, y1], in: [cx + rx * K, y1], out: [cx - rx * K, y1] },
    { p: [x0, cy], in: [x0, cy + ry * K], out: [x0, cy - ry * K] },
  ]
}

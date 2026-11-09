import { useRef, useState } from "react"
import { RotateCcw } from "lucide-react"
import { identityGrid, layerPt, layerUV, localDelta } from "@/lib/design"
import type { ImgLayer, XformMode } from "@/types"

type Props = {
  layers: ImgLayer[]
  sel: string[]
  setSel: (ids: string[]) => void
  onChange: (layers: ImgLayer[]) => void
  w: number // ekrandaki tuval boyutu
  h: number
  mode: XformMode
  onDone?: (before: ImgLayer, after: ImgLayer) => void // Dönüşümü Tekrarla için
  colorBar?: { color: string; set: (hex: string | undefined) => void; canClear: boolean } | null
}

const QUICK = ["#E01010", "#F08C00", "#FFD500", "#2EA043", "#1E6FE0", "#7B2FFF", "#FFFFFF", "#000000"]
const BAR_W = 262

type Pt = [number, number]
type Handle = { kind: "scale" | "rotate" | "corner" | "edgeSkew"; u: number; v: number }
type Drag =
  | { kind: "move"; sx: number; sy: number; start: ImgLayer[]; snap: boolean }
  | { kind: "handle"; h: Handle; id: string; start: ImgLayer; p0: Pt; ctrl: boolean }
  | { kind: "node"; id: string; start: ImgLayer; field: "warp" | "pwarp"; i: number; p0: Pt }
  | { kind: "pin"; id: string; start: ImgLayer; i: number; p0: Pt }

const SNAP = 6 // px: tuvalin ortasına yapışma
const CORNERS: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
const EDGES: Pt[] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]
const ZERO: Pt[] = [[0, 0], [0, 0], [0, 0], [0, 0]]
const cornerIndex = (u: number, v: number) => CORNERS.findIndex((c) => c[0] === u && c[1] === v)

/** Taşıma ve Dönüştürme: seçili araca göre tutamaçlar. Sonuç sunucuda çizilir, burada yalnızca kılavuzlar var. */
export function LayerOverlay({ layers, sel, setSel, onChange, w, h, mode, onDone, colorBar }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [guide, setGuide] = useState<{ x: boolean; y: boolean }>({ x: false, y: false })

  const local = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const capture = (e: React.PointerEvent) => {
    e.stopPropagation()
    ref.current?.setPointerCapture(e.pointerId)
  }
  const put = (id: string, p: Partial<ImgLayer>) => onChange(layers.map((l) => (l.id === id ? { ...l, ...p } : l)))

  const downLayer = (ly: ImgLayer) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    const only = sel.length === 1 && sel[0] === ly.id
    if (mode === "puppet" && only) {
      const [u, v] = layerUV(ly, w, h, ...local(e))
      const pins = [...(ly.pins ?? []), { p: [u, v] as Pt, q: [u, v] as Pt }]
      const next = { ...ly, pins }
      put(ly.id, { pins })
      drag.current = { kind: "pin", id: ly.id, start: next, i: pins.length - 1, p0: local(e) }
      return
    }
    let ids = sel
    if (e.shiftKey) ids = sel.includes(ly.id) ? sel.filter((x) => x !== ly.id) : [...sel, ly.id]
    else if (!sel.includes(ly.id)) ids = [ly.id]
    setSel(ids)
    drag.current = { kind: "move", sx: e.clientX, sy: e.clientY, start: layers, snap: ids.length === 1 }
  }
  const downHandle = (ly: ImgLayer, hd: Handle) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    drag.current = { kind: "handle", h: hd, id: ly.id, start: ly, p0: local(e), ctrl: e.ctrlKey || e.metaKey }
  }
  const downNode = (ly: ImgLayer, field: "warp" | "pwarp", i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    const pts = ly[field] ?? (field === "warp" ? identityGrid(4, 4) : identityGrid(2, 3))
    drag.current = { kind: "node", id: ly.id, start: { ...ly, [field]: pts }, field, i, p0: local(e) }
  }
  const downPin = (ly: ImgLayer, i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    if (e.altKey) return put(ly.id, { pins: ly.pins!.filter((_, j) => j !== i) })
    drag.current = { kind: "pin", id: ly.id, start: ly, i, p0: local(e) }
  }

  const applyHandle = (d: Extract<Drag, { kind: "handle" }>, p: Pt, shift: boolean) => {
    const s = d.start
    const { u, v } = d.h
    const cx = s.x * w
    const cy = s.y * h
    const edge = u === 0.5 || v === 0.5
    let kind = d.h.kind
    if (d.ctrl && kind === "scale") kind = edge ? "edgeSkew" : "corner"
    if (kind === "rotate") {
      const ang = (q: Pt) => (Math.atan2(q[1] - cy, q[0] - cx) * 180) / Math.PI
      let deg = s.rot + ang(p) - ang(d.p0)
      if (shift) deg = Math.round(deg / 15) * 15
      return put(d.id, { rot: Math.round((((deg + 540) % 360) - 180) * 10) / 10 })
    }
    if (kind === "scale") {
      const [lx, ly] = localDelta(s, w, h, p[0] - cx, p[1] - cy)
      const [ox, oy] = localDelta(s, w, h, d.p0[0] - cx, d.p0[1] - cy)
      const fx = Math.abs(ox) > 1e-3 ? Math.abs(lx / ox) : 1
      const fy = Math.abs(oy) > 1e-3 ? Math.abs(ly / oy) : 1
      const sy = s.sy ?? 1
      const clampW = (v2: number) => Math.max(0.02, Math.min(5, v2))
      const clampY = (v2: number) => Math.max(0.02, Math.min(20, v2))
      if (v === 0.5) return put(d.id, { w: clampW(s.w * fx), sy: clampY(sy / fx) }) // sağ/sol kenar: yükseklik sabit
      if (u === 0.5) return put(d.id, { sy: clampY(sy * fy) }) // üst/alt kenar
      if (shift) return put(d.id, { w: clampW(s.w * fx), sy: clampY((sy * fy) / fx) })
      const f = Math.hypot(p[0] - cx, p[1] - cy) / Math.max(4, Math.hypot(d.p0[0] - cx, d.p0[1] - cy))
      return put(d.id, { w: clampW(s.w * f) })
    }
    const [du, dv] = localDelta(s, w, h, p[0] - d.p0[0], p[1] - d.p0[1])
    const c = (s.corners ?? ZERO).map((q) => [...q] as Pt)
    if (kind === "edgeSkew") {
      // kenar boyunca kaydır: iki köşe birlikte
      if (v === 0.5) [cornerIndex(u, 0), cornerIndex(u, 1)].forEach((i) => (c[i][1] += dv))
      else [cornerIndex(0, v), cornerIndex(1, v)].forEach((i) => (c[i][0] += du))
    } else if (mode === "perspective") {
      // baskın yönde: aynı kenardaki diğer köşe ters yöne
      const i = cornerIndex(u, v)
      if (Math.abs(du) >= Math.abs(dv)) {
        c[i][0] += du
        c[cornerIndex(1 - u, v)][0] -= du
      } else {
        c[i][1] += dv
        c[cornerIndex(u, 1 - v)][1] -= dv
      }
    } else {
      const i = cornerIndex(u, v)
      c[i][0] += du
      c[i][1] += dv
    }
    put(d.id, { corners: c })
  }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === "move") {
      const ids = new Set(sel)
      let dx = (e.clientX - d.sx) / w
      let dy = (e.clientY - d.sy) / h
      let gx = false
      let gy = false
      if (d.snap && !e.altKey) {
        const one = d.start.find((l) => ids.has(l.id))!
        if (Math.abs((one.x + dx - 0.5) * w) < SNAP) (dx = 0.5 - one.x), (gx = true)
        if (Math.abs((one.y + dy - 0.5) * h) < SNAP) (dy = 0.5 - one.y), (gy = true)
      }
      setGuide({ x: gx, y: gy })
      return onChange(d.start.map((l) => (ids.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l)))
    }
    const p = local(e)
    if (d.kind === "handle") return applyHandle(d, p, e.shiftKey)
    const [du, dv] = localDelta(d.start, w, h, p[0] - d.p0[0], p[1] - d.p0[1])
    if (d.kind === "node") {
      const pts = d.start[d.field]!.map((q, i) => (i === d.i ? ([q[0] + du, q[1] + dv] as Pt) : q))
      return put(d.id, { [d.field]: pts, [d.field === "warp" ? "pwarp" : "warp"]: undefined }) // aynı anda tek ızgara
    }
    put(d.id, { pins: d.start.pins!.map((q, i) => (i === d.i ? { ...q, q: [q.q[0] + du, q.q[1] + dv] as Pt } : q)) })
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    setGuide({ x: false, y: false })
    if (!d || !onDone) return
    if (d.kind === "move") {
      const a = d.start.find((l) => l.id === sel[0])
      const b = layers.find((l) => l.id === sel[0])
      if (a && b && sel.length === 1 && (a.x !== b.x || a.y !== b.y)) onDone(a, b)
    } else if (d.kind !== "pin") {
      const b = layers.find((l) => l.id === d.id)
      if (b && b !== d.start) onDone(d.start, b)
    }
  }

  const handles = (): Handle[] => {
    const c = (kind: Handle["kind"]) => CORNERS.map(([u, v]) => ({ kind, u, v }))
    const e = (kind: Handle["kind"]) => EDGES.map(([u, v]) => ({ kind, u, v }))
    switch (mode) {
      case "move": return c("scale")
      case "free":
      case "scale": return [...c("scale"), ...e("scale")]
      case "rotate": return c("rotate")
      case "skew": return e("edgeSkew")
      case "distort":
      case "perspective": return c("corner")
      default: return []
    }
  }
  const showRotate = mode === "move" || mode === "free" || mode === "rotate"
  const pt = (ly: ImgLayer, u: number, v: number) => layerPt(ly, w, h, u, v)
  const pts = (ly: ImgLayer) => CORNERS.map(([u, v]) => pt(ly, u, v).join(",")).join(" ")
  const hStyle = { fill: "white", stroke: "rgba(0,0,0,0.45)", strokeWidth: 1, style: { cursor: "pointer" } }

  // Tıklanan nesnenin hemen üstünde renk çubuğu
  const picked = layers.filter((l) => sel.includes(l.id))
  const bar = colorBar && picked.length > 0 ? (() => {
    const all = picked.flatMap((l) => CORNERS.map(([u, v]) => pt(l, u, v)))
    const xs = all.map((p) => p[0])
    const ys = all.map((p) => p[1])
    const left = Math.max(0, Math.min(w - BAR_W, (Math.min(...xs) + Math.max(...xs)) / 2 - BAR_W / 2))
    const above = Math.min(...ys) - 44
    const top = above >= 0 ? above : Math.min(h - 36, Math.max(...ys) + 10)
    return { left, top: Math.max(0, top) }
  })() : null

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-30"
      onPointerDown={(e) => e.button === 0 && !e.shiftKey && setSel([])}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      style={{ touchAction: "none" }}
    >
      {guide.x && <div className="pointer-events-none absolute inset-y-0 w-px bg-[#ff3d9a]" style={{ left: w / 2 }} />}
      {guide.y && <div className="pointer-events-none absolute inset-x-0 h-px bg-[#ff3d9a]" style={{ top: h / 2 }} />}
      <svg width={w} height={h} className="absolute inset-0 overflow-visible">
        {layers.map((ly) => {
          const on = sel.includes(ly.id)
          const single = on && sel.length === 1
          return (
            <g key={ly.id}>
              <polygon
                points={pts(ly)}
                onPointerDown={downLayer(ly)}
                fill="transparent"
                stroke={on ? "hsl(var(--primary))" : "rgba(255,255,255,0.6)"}
                strokeWidth={on ? 2 : 1}
                strokeDasharray={on ? undefined : "4 3"}
                style={{ cursor: mode === "puppet" && single ? "copy" : "move" }}
              >
                <title>{ly.name}</title>
              </polygon>
              {single && handles().map((hd) => {
                const [x, y] = pt(ly, hd.u, hd.v)
                return <rect key={`${hd.kind}${hd.u}${hd.v}`} x={x - 5} y={y - 5} width={10} height={10} rx={2} {...hStyle} onPointerDown={downHandle(ly, hd)} />
              })}
              {single && showRotate && (() => {
                const [tx, ty] = pt(ly, 0.5, 0)
                const a = ((ly.rot - 90) * Math.PI) / 180
                // tuvali dolduran katmanda tutamaç görünür alanın dışına taşmasın: içeri alınır
                const reach = ty + Math.sin(a) * 26 < 10 ? -26 : 26
                const rx = tx + Math.cos(a) * reach
                const ry = ty + Math.sin(a) * reach
                return (
                  <>
                    <line x1={tx} y1={ty} x2={rx} y2={ry} stroke="hsl(var(--primary))" className="pointer-events-none" />
                    <circle cx={rx} cy={ry} r={7} fill="hsl(var(--primary))" stroke="white" strokeWidth={2} style={{ cursor: "grab" }} onPointerDown={downHandle(ly, { kind: "rotate", u: 0.5, v: 0 })}>
                      <title>Döndür (Shift: 15°)</title>
                    </circle>
                  </>
                )
              })()}
              {single && (mode === "warp" || mode === "pwarp") && (() => {
                const field = mode
                const [rows, cols] = mode === "warp" ? [4, 4] : [2, 3]
                const g = ly[field] ?? identityGrid(rows, cols)
                const at = (r: number, c: number) => pt(ly, g[r * cols + c][0], g[r * cols + c][1])
                const lines: [Pt, Pt][] = []
                for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
                  if (c + 1 < cols) lines.push([at(r, c), at(r, c + 1)])
                  if (r + 1 < rows) lines.push([at(r, c), at(r + 1, c)])
                }
                return (
                  <>
                    {lines.map(([a, b], i) => <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="white" strokeOpacity={0.7} className="pointer-events-none" />)}
                    {g.map(([u, v], i) => {
                      const [x, y] = pt(ly, u, v)
                      return <circle key={i} cx={x} cy={y} r={5.5} {...hStyle} onPointerDown={downNode(ly, field, i)} />
                    })}
                  </>
                )
              })()}
              {single && mode === "puppet" && ly.pins?.map((q, i) => {
                const [x, y] = pt(ly, q.q[0], q.q[1])
                return <circle key={i} cx={x} cy={y} r={6} fill="hsl(var(--primary))" stroke="white" strokeWidth={2} style={{ cursor: "grab" }} onPointerDown={downPin(ly, i)} />
              })}
            </g>
          )
        })}
      </svg>
      {bar && colorBar && (
        <div className="absolute z-10 flex items-center gap-1 rounded-md border bg-popover px-1.5 py-1 shadow-xl" style={{ left: bar.left, top: bar.top, width: BAR_W }} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} role="toolbar" aria-label="Nesne rengi">
          <label className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-sm border" style={{ background: colorBar.color }} title="Renk seç">
            <input aria-label="Nesne rengi" type="color" value={colorBar.color.toLowerCase()} onChange={(e) => colorBar.set(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {QUICK.map((c) => <button key={c} aria-label={`Renk ${c}`} onClick={() => colorBar.set(c)} className="h-5 w-5 shrink-0 rounded-full border border-foreground/30 transition-transform hover:scale-110" style={{ background: c }} />)}
          {colorBar.canClear && <button aria-label="Rengi kaldır" title="Rengi Kaldır" onClick={() => colorBar.set(undefined)} className="ml-auto text-muted-foreground hover:text-foreground"><RotateCcw className="h-3.5 w-3.5" /></button>}
        </div>
      )}
    </div>
  )
}

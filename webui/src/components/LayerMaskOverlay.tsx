import { useEffect, useRef, useState } from "react"
import { layerPt, layerUV } from "@/lib/design"
import type { ImgLayer, MaskPaintTool } from "@/types"

type Pt = [number, number]
type Props = {
  layer: ImgLayer
  mode: "layermask" | "vector"
  tool: MaskPaintTool
  onChange: (p: Partial<ImgLayer>) => void
  w: number // ekrandaki tuval boyutu
  h: number
}

const CORNERS: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
const round = ([u, v]: Pt): Pt => [Math.round(u * 1e4) / 1e4, Math.round(v * 1e4) / 1e4]
const CLOSE_PX = 9

/** Seçili görsel katmanına maske: fırçayla gizle/göster ya da vektör şekil çiz. Koordinatlar katmana ait, katman taşınınca maske de gider. */
export function LayerMaskOverlay({ layer, mode, tool, onChange, w, h }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [stroke, setStroke] = useState<{ pts: Pt[]; add: boolean } | null>(null)
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null)
  const [path, setPath] = useState<Pt[] | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const bw = layer.w * w
  const bh = bw * layer.ar * (layer.sy ?? 1)
  const rUV = tool.size // kısa kenara oranla
  const rPx = rUV * Math.min(bw, bh)

  const uv = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return layerUV(layer, w, h, e.clientX - r.left, e.clientY - r.top)
  }
  const screen = (p: Pt) => layerPt(layer, w, h, p[0], p[1])
  const pathRef = useRef({ path, close: () => {} })
  const closePath = (pts = path) => {
    if (pts && pts.length >= 3) onChange({ vector: { kind: "path", pts: pts.map(round) } })
    setPath(null)
  }
  pathRef.current = { path, close: closePath }
  useEffect(() => {
    if (!path) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPath(null)
      else if (e.key === "Enter") pathRef.current.close()
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [!!path]) // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const p = uv(e)
    if (mode === "vector" && tool.shape === "path") {
      if (!path) return setPath([p])
      const [x0, y0] = screen(path[0])
      const [x1, y1] = screen(p)
      if (path.length >= 3 && Math.hypot(x1 - x0, y1 - y0) < CLOSE_PX) return closePath()
      return setPath([...path, p])
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (mode === "vector") setDrag({ a: p, b: p })
    else setStroke({ pts: [p], add: (tool.paint === "show") !== e.altKey })
  }
  const move = (e: React.PointerEvent) => {
    const p = uv(e)
    setCursor(p)
    if (drag) setDrag({ ...drag, b: p })
    if (stroke) {
      const a = screen(stroke.pts[stroke.pts.length - 1])
      const b = screen(p)
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= Math.max(2, rPx * 0.25)) setStroke({ ...stroke, pts: [...stroke.pts, p] })
    }
  }
  const up = () => {
    if (stroke) {
      const mk = layer.mask ?? { ops: [] }
      onChange({ mask: { ...mk, ops: [...mk.ops, { kind: "brush", pts: stroke.pts.map(round), r: rUV, hard: tool.hard, add: stroke.add }] } })
      setStroke(null)
    }
    if (drag) {
      const box = [...round([Math.min(drag.a[0], drag.b[0]), Math.min(drag.a[1], drag.b[1])]), ...round([Math.max(drag.a[0], drag.b[0]), Math.max(drag.a[1], drag.b[1])])] as [number, number, number, number]
      if (box[2] - box[0] > 0.01 && box[3] - box[1] > 0.01) onChange({ vector: { kind: tool.shape as "rect" | "ellipse", box } })
      setDrag(null)
    }
  }

  const poly = (pts: Pt[]) => pts.map((p) => screen(p).join(",")).join(" ")
  const ants = { fill: "none", stroke: "white", strokeWidth: 1.25, strokeDasharray: "5 4", style: { filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95))" } }
  const painting = mode === "layermask"
  const v = layer.vector
  const c = cursor ? screen(cursor) : null
  return (
    <div
      ref={ref}
      className="absolute inset-0 z-30"
      style={{ cursor: painting ? "none" : "crosshair", touchAction: "none" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => setCursor(null)}
      onDoubleClick={() => path && closePath(path.slice(0, -1))}
    >
      <svg width={w} height={h} className="pointer-events-none absolute inset-0 overflow-visible">
        <polygon points={poly(CORNERS)} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
        {v?.kind === "path" && <polygon points={poly(v.pts)} {...ants} />}
        {(v?.kind === "rect" || v?.kind === "ellipse") && <polygon points={poly(v.kind === "rect" ? ([[v.box[0], v.box[1]], [v.box[2], v.box[1]], [v.box[2], v.box[3]], [v.box[0], v.box[3]]] as Pt[]) : Array.from({ length: 48 }, (_, i) => [
          (v.box[0] + v.box[2]) / 2 + ((v.box[2] - v.box[0]) / 2) * Math.cos((i / 48) * 6.2832),
          (v.box[1] + v.box[3]) / 2 + ((v.box[3] - v.box[1]) / 2) * Math.sin((i / 48) * 6.2832),
        ] as Pt))} {...ants} />}
        {drag && <polygon points={poly([[drag.a[0], drag.a[1]], [drag.b[0], drag.a[1]], [drag.b[0], drag.b[1]], [drag.a[0], drag.b[1]]])} {...ants} />}
        {path && (
          <>
            <polyline points={poly(cursor ? [...path, cursor] : path)} {...ants} />
            {path.map((p, i) => {
              const [x, y] = screen(p)
              return <circle key={i} cx={x} cy={y} r={i === 0 ? 4.5 : 2.5} fill={i === 0 ? "hsl(var(--primary))" : "white"} stroke="rgba(0,0,0,0.6)" />
            })}
          </>
        )}
        {stroke && <polyline points={poly(stroke.pts)} fill="none" stroke={stroke.add ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)"} strokeWidth={rPx * 2} strokeLinecap="round" strokeLinejoin="round" />}
        {painting && c && <circle cx={c[0]} cy={c[1]} r={rPx} fill="none" stroke="white" strokeWidth={1.25} style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.9))" }} />}
      </svg>
    </div>
  )
}

import { useRef, useState } from "react"
import type { ImgLayer } from "@/types"

type Props = {
  layers: ImgLayer[]
  sel: string[]
  setSel: (ids: string[]) => void
  onChange: (layers: ImgLayer[]) => void
  w: number // ekrandaki tuval boyutu
  h: number
}

type Drag =
  | { kind: "move"; sx: number; sy: number; start: ImgLayer[]; snap: boolean }
  | { kind: "scale"; id: string; cx: number; cy: number; d0: number; start: ImgLayer }
  | { kind: "rotate"; id: string; cx: number; cy: number; start: ImgLayer }

const SNAP = 6 // px: tuvalin ortasına yapışma

/** Tasarım aracında görsel katmanlarını sürükle (taşı), köşeden boyutlandır, üstteki tutamaçla döndür. */
export function LayerOverlay({ layers, sel, setSel, onChange, w, h }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [guide, setGuide] = useState<{ x: boolean; y: boolean }>({ x: false, y: false })

  const local = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const capture = (e: React.PointerEvent) => {
    e.stopPropagation()
    ref.current?.setPointerCapture(e.pointerId)
  }

  const downLayer = (ly: ImgLayer) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    let ids = sel
    if (e.shiftKey) ids = sel.includes(ly.id) ? sel.filter((x) => x !== ly.id) : [...sel, ly.id]
    else if (!sel.includes(ly.id)) ids = [ly.id]
    setSel(ids)
    drag.current = { kind: "move", sx: e.clientX, sy: e.clientY, start: layers, snap: ids.length === 1 }
  }
  const downHandle = (ly: ImgLayer, kind: "scale" | "rotate") => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    const [px, py] = local(e)
    const cx = ly.x * w
    const cy = ly.y * h
    drag.current = kind === "scale"
      ? { kind, id: ly.id, cx, cy, d0: Math.max(4, Math.hypot(px - cx, py - cy)), start: ly }
      : { kind, id: ly.id, cx, cy, start: ly }
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
      onChange(d.start.map((l) => (ids.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l)))
    } else if (d.kind === "scale") {
      const [px, py] = local(e)
      const f = Math.hypot(px - d.cx, py - d.cy) / d.d0
      onChange(layers.map((l) => (l.id === d.id ? { ...l, w: Math.max(0.02, Math.min(5, d.start.w * f)) } : l)))
    } else {
      const [px, py] = local(e)
      let deg = (Math.atan2(py - d.cy, px - d.cx) * 180) / Math.PI + 90
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      deg = ((deg + 540) % 360) - 180
      onChange(layers.map((l) => (l.id === d.id ? { ...l, rot: Math.round(deg * 10) / 10 } : l)))
    }
  }
  const up = () => {
    drag.current = null
    setGuide({ x: false, y: false })
  }

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
      {layers.map((ly) => {
        const bw = ly.w * w
        const bh = bw * ly.ar
        const on = sel.includes(ly.id)
        return (
          <div
            key={ly.id}
            onPointerDown={downLayer(ly)}
            className={on ? "absolute cursor-move outline outline-2 outline-primary" : "absolute cursor-move outline-dashed outline-1 outline-white/60 hover:outline-primary/80"}
            style={{ left: ly.x * w - bw / 2, top: ly.y * h - bh / 2, width: bw, height: bh, transform: `rotate(${ly.rot}deg)` }}
            title={`${ly.name} · sürükle: taşı (Alt: yapışmadan) · Shift+tıkla: çoklu seç`}
          >
            {on && sel.length === 1 && (
              <>
                {[[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => (
                  <div
                    key={`${x}${y}`}
                    onPointerDown={downHandle(ly, "scale")}
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-black/40 bg-white shadow"
                    style={{ left: `${x * 100}%`, top: `${y * 100}%`, cursor: x === y ? "nwse-resize" : "nesw-resize" }}
                  />
                ))}
                <div className="pointer-events-none absolute left-1/2 top-0 h-5 w-px -translate-y-full bg-primary" />
                <div
                  onPointerDown={downHandle(ly, "rotate")}
                  title="Döndür (Shift: 15°)"
                  className="absolute left-1/2 top-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-[26px] cursor-grab rounded-full border-2 border-white bg-primary shadow"
                />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

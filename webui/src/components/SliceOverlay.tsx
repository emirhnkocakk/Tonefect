import { useEffect, useRef, useState } from "react"
import type { Slice } from "@/types"

type Props = {
  slices: Slice[]
  tool: "draw" | "select"
  sel: string | null
  setSel: (id: string | null) => void
  onChange: (s: Slice[]) => void
  w: number // ekrandaki tuval boyutu
  h: number
}
type Pt = [number, number]
type Drag =
  | { kind: "new"; a: Pt; b: Pt }
  | { kind: "move"; id: string; p: Pt; start: Slice }
  | { kind: "size"; id: string; anchor: Pt } // karşı köşe sabit

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const rect = (a: Pt, b: Pt) => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) })

/** Dilim aracı: sürükleyerek dilim çiz. Dilim Seçimi: tıkla seç, sürükle taşı, köşeden boyutlandır, Delete ile sil. */
export function SliceOverlay({ slices, tool, sel, setSel, onChange, w, h }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const latest = useRef({ slices, sel, onChange, setSel })
  latest.current = { slices, sel, onChange, setSel }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      const c = latest.current
      if ((e.key === "Delete" || e.key === "Backspace") && c.sel) {
        e.preventDefault()
        c.onChange(c.slices.filter((s) => s.id !== c.sel))
        c.setSel(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const norm = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]
  }
  const begin = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    ref.current?.setPointerCapture(e.pointerId)
    setDrag(d)
  }
  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const p = norm(e)
    if (drag.kind === "new") return setDrag({ ...drag, b: p })
    if (drag.kind === "move") {
      const s = drag.start
      onChange(slices.map((x) => (x.id === drag.id ? { ...x, x: clamp(s.x + p[0] - drag.p[0], 0, 1 - s.w), y: clamp(s.y + p[1] - drag.p[1], 0, 1 - s.h) } : x)))
    } else onChange(slices.map((x) => (x.id === drag.id ? { ...x, ...rect(drag.anchor, p) } : x)))
  }
  const up = () => {
    if (drag?.kind === "new") {
      const r = rect(drag.a, drag.b)
      if (r.w * w > 5 && r.h * h > 5) {
        const s: Slice = { id: Math.random().toString(36).slice(2, 9), ...r }
        onChange([...slices, s])
        setSel(s.id)
      }
    }
    setDrag(null)
  }

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-30"
      style={{ cursor: tool === "draw" ? "crosshair" : "default", touchAction: "none" }}
      onPointerDown={(e) => {
        if (tool === "draw") {
          const p = norm(e)
          begin(e, { kind: "new", a: p, b: p })
        } else if (e.button === 0) setSel(null)
      }}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {slices.map((s, i) => {
        const on = s.id === sel
        return (
          <div
            key={s.id}
            onPointerDown={(e) => {
              if (tool !== "select") return // Dilim aracında üstüne yeni dilim çizilebilir
              setSel(s.id)
              begin(e, { kind: "move", id: s.id, p: norm(e), start: s })
            }}
            className={on ? "absolute cursor-move outline outline-2 outline-primary" : "absolute outline-dashed outline-1 outline-white/80"}
            style={{ left: s.x * w, top: s.y * h, width: s.w * w, height: s.h * h, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45)", background: on ? "hsl(var(--primary) / 0.12)" : undefined, pointerEvents: tool === "select" ? "auto" : "none" }}
          >
            <span className="absolute left-0 top-0 max-w-full truncate rounded-br bg-black/70 px-1.5 py-px text-[10px] font-semibold text-white">{s.name || String(i + 1).padStart(2, "0")}</span>
            {on && tool === "select" &&
              ([[0, 0], [1, 0], [1, 1], [0, 1]] as Pt[]).map(([x, y]) => (
                <div
                  key={`${x}${y}`}
                  onPointerDown={(e) => begin(e, { kind: "size", id: s.id, anchor: [s.x + (1 - x) * s.w, s.y + (1 - y) * s.h] })}
                  className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-black/40 bg-white shadow"
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, cursor: x === y ? "nwse-resize" : "nesw-resize" }}
                />
              ))}
          </div>
        )
      })}
      {drag?.kind === "new" && (() => {
        const r = rect(drag.a, drag.b)
        return <div className="pointer-events-none absolute border border-dashed border-white" style={{ left: r.x * w, top: r.y * h, width: r.w * w, height: r.h * h, boxShadow: "0 0 0 1px rgba(0,0,0,0.5)" }} />
      })()}
    </div>
  )
}

import { useEffect, useRef, useState } from "react"
import { POINT_DEFAULT, POINT_KINDS, type LiquifyTool } from "@/lib/filters"
import type { FilterItem } from "@/types"

type Props = { w: number; h: number; filter: FilterItem; set: (p: Partial<FilterItem>) => void; liquify: LiquifyTool }
type Pt = [number, number]

const hasOverlay = (f: FilterItem) => POINT_KINDS.has(f.kind) || f.kind === "field" || f.kind === "liquify"
export { hasOverlay as filterHasOverlay }

/** Seçili filtrenin önizleme üzerindeki denetimleri: merkez tutamacı, alan noktaları, Sıvılaştır fırçası. */
export function FilterOverlay({ w, h, filter: f, set, liquify }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<number | "c" | null>(null)
  const [hover, setHover] = useState<Pt | null>(null)
  const stroke = useRef<Pt[] | null>(null)
  const timer = useRef<number>()
  const last = useRef<Pt>([0, 0])
  useEffect(() => () => window.clearInterval(timer.current), [])

  const norm = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect()
    return [Math.round(((e.clientX - r.left) / r.width) * 1e4) / 1e4, Math.round(((e.clientY - r.top) / r.height) * 1e4) / 1e4]
  }
  const grab = (e: React.PointerEvent, what: number | "c") => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = what
  }
  const movePin = (p: Pt) => {
    const w0 = drag.current
    if (w0 === "c") set({ c: p })
    else if (typeof w0 === "number") set({ pins: ((f.pins ?? []) as [number, number, number][]).map((q, i) => (i === w0 ? [p[0], p[1], q[2]] : q)) })
  }

  if (f.kind === "liquify") {
    const finish = () => {
      window.clearInterval(timer.current)
      const pts = stroke.current
      stroke.current = null
      if (pts?.length) set({ strokes: [...((f.strokes ?? []) as unknown[]), { tool: liquify.tool, size: liquify.size, rate: liquify.rate, pts }] })
    }
    const r = (liquify.size * Math.min(w, h)) / 2
    return (
      <div
        ref={box}
        className="absolute inset-0 z-30 overflow-hidden rounded-xl"
        style={{ cursor: "none", touchAction: "none" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          e.preventDefault()
          ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
          const p = norm(e)
          last.current = p
          stroke.current = [p]
          // döndürme, sıkma, şişirme: basılı tutulduğu sürece etki eder
          if (liquify.tool !== "push") timer.current = window.setInterval(() => stroke.current?.push(last.current), 70)
        }}
        onPointerMove={(e) => {
          const p = norm(e)
          setHover(p)
          last.current = p
          const st = stroke.current
          if (!st) return
          const l = st[st.length - 1]
          if (Math.hypot((p[0] - l[0]) * w, (p[1] - l[1]) * h) >= Math.max(3, r * 0.12) && st.length < 1500) st.push(p)
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={() => setHover(null)}
      >
        <svg width={w} height={h} className="pointer-events-none absolute inset-0">
          {hover && <circle cx={hover[0] * w} cy={hover[1] * h} r={Math.max(2, r)} fill="none" stroke="#fff" strokeWidth={1.25} style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95))" }} />}
        </svg>
      </div>
    )
  }

  const pins = (f.pins ?? []) as [number, number, number][]
  const isField = f.kind === "field"
  const center = (f.c ?? POINT_DEFAULT[f.kind] ?? [0.5, 0.5]) as Pt
  // bileşen değil düz işlev: sürüklerken her çizimde yeniden kurulup yakalamayı kaybetmesin
  const handle = (p: Pt, what: number | "c", r = 8) => (
    <div
      key={String(what)}
      className="absolute cursor-grab touch-none rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.7)]"
      style={{ left: p[0] * w - r, top: p[1] * h - r, width: r * 2, height: r * 2, background: "hsl(var(--primary) / 0.55)", pointerEvents: "auto" }}
      onPointerDown={(e) => grab(e, what)}
      onPointerMove={(e) => drag.current !== null && movePin(norm(e))}
      onPointerUp={() => (drag.current = null)}
    />
  )
  return (
    <div
      ref={box}
      className={"absolute inset-0 z-30 overflow-hidden rounded-xl " + (isField ? "cursor-crosshair" : "pointer-events-none")}
      onPointerDown={(e) => {
        if (!isField || e.button !== 0 || pins.length >= 12) return
        e.stopPropagation()
        const p = norm(e)
        set({ pins: [...pins, [p[0], p[1], Number(f.r) || 25]] })
      }}
    >
      {isField ? pins.map((q, i) => handle([q[0], q[1]], i)) : handle(center, "c")}
    </div>
  )
}

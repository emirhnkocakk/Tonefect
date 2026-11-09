import { useRef, useState } from "react"
import type { DrawTool } from "@/lib/draw"

type Pt = [number, number]
type Props = {
  w: number // ekrandaki tuval boyutu
  h: number
  tool: DrawTool
  color: string
  color2: string
  onDraw: (tool: DrawTool, a: Pt, b: Pt) => void
}

const LINEAR = new Set<DrawTool>(["line", "gradient", "radial"])

/** Şekil, Çizgi, Degrade ve Boya Kovası: sürükleme (kovada tıklama) tuval oranlarıyla (0..1) bildirilir. */
export function DrawOverlay({ w, h, tool, color, color2, onDraw }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null)

  const at = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }
  // Shift: şekillerde eşit kenar, çizgide ve degradede 45 derecelik açılar
  const constrain = (a: Pt, b: Pt, shift: boolean): Pt => {
    if (!shift) return b
    const dx = (b[0] - a[0]) * w
    const dy = (b[1] - a[1]) * h
    if (LINEAR.has(tool)) {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
      const len = Math.hypot(dx, dy)
      return [a[0] + (Math.cos(ang) * len) / w, a[1] + (Math.sin(ang) * len) / h]
    }
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    return [a[0] + (Math.sign(dx || 1) * side) / w, a[1] + (Math.sign(dy || 1) * side) / h]
  }

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const p = at(e)
    if (tool === "bucket") return onDraw(tool, p, p)
    ref.current?.setPointerCapture(e.pointerId)
    setDrag({ a: p, b: p })
  }
  const move = (e: React.PointerEvent) => drag && setDrag({ a: drag.a, b: constrain(drag.a, at(e), e.shiftKey) })
  const up = () => {
    if (drag) onDraw(tool, drag.a, drag.b)
    setDrag(null)
  }

  let shape: React.ReactNode = null
  if (drag) {
    const [ax, ay, bx, by] = [drag.a[0] * w, drag.a[1] * h, drag.b[0] * w, drag.b[1] * h]
    const x = Math.min(ax, bx), y = Math.min(ay, by), bw = Math.abs(bx - ax), bh = Math.abs(by - ay)
    const cx = x + bw / 2, cy = y + bh / 2
    const st = { fill: color, fillOpacity: 0.55, stroke: "white", strokeWidth: 1, vectorEffect: "non-scaling-stroke" as const }
    const poly = (pts: Pt[]) => <polygon points={pts.map((p) => p.join(",")).join(" ")} {...st} />
    if (LINEAR.has(tool)) {
      shape = (
        <>
          {tool === "radial" && <circle cx={ax} cy={ay} r={Math.hypot(bx - ax, by - ay)} fill="none" stroke="white" strokeDasharray="4 3" />}
          <line x1={ax} y1={ay} x2={bx} y2={by} stroke="black" strokeOpacity={0.6} strokeWidth={3} />
          <line x1={ax} y1={ay} x2={bx} y2={by} stroke="white" strokeWidth={1.5} />
          {tool !== "line" && <><circle cx={ax} cy={ay} r={5} fill={color} stroke="white" /><circle cx={bx} cy={by} r={5} fill={color2} stroke="white" /></>}
        </>
      )
    } else if (tool === "ellipse") shape = <ellipse cx={cx} cy={cy} rx={bw / 2} ry={bh / 2} {...st} />
    else if (tool === "triangle") shape = poly([[cx, y], [x + bw, y + bh], [x, y + bh]])
    else if (tool === "polygon") shape = poly(Array.from({ length: 6 }, (_, i) => [cx + (bw / 2) * Math.cos((i * Math.PI) / 3), cy + (bh / 2) * Math.sin((i * Math.PI) / 3)] as Pt))
    else if (tool === "star") shape = poly(Array.from({ length: 10 }, (_, i) => {
      const k = i % 2 === 0 ? 1 : 0.42
      return [cx + (bw / 2) * k * Math.sin((i * Math.PI) / 5), cy - (bh / 2) * k * Math.cos((i * Math.PI) / 5)] as Pt
    }))
    else shape = <rect x={x} y={y} width={bw} height={bh} rx={tool === "round" ? Math.min(bw, bh) * 0.15 : 0} {...st} />
  }

  return (
    <div ref={ref} className="absolute inset-0 z-30" style={{ cursor: tool === "bucket" ? "cell" : "crosshair", touchAction: "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} role="application" aria-label="Çizim alanı">
      {drag && <svg className="pointer-events-none absolute inset-0" width={w} height={h}>{shape}</svg>}
    </div>
  )
}

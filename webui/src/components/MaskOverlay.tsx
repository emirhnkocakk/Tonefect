import { useEffect, useRef, useState } from "react"
import type { Mask } from "@/types"

type Props = {
  mask: Mask
  w: number // ekrandaki sahne boyutu (px)
  h: number
  show: boolean // kırmızı maske görünümü
  onChange: (p: Partial<Mask>) => void
}

type Pt = [number, number]
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** render.mask_weight ile aynı hesap (görselleştirme için, düşük çözünürlükte). */
function weight(m: Mask, x: number, y: number, W: number, H: number) {
  let wgt: number
  if (m.type === "linear") {
    const [ax, ay] = [m.a![0] * W, m.a![1] * H]
    const [dx, dy] = [m.b![0] * W - ax, m.b![1] * H - ay]
    const t = ((x - ax) * dx + (y - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-6)
    wgt = 1 - smooth(0, 1, t)
  } else {
    const d = Math.hypot((x - m.c![0] * W) / Math.max(m.r![0] * W, 1), (y - m.c![1] * H) / Math.max(m.r![1] * H, 1))
    const f = Math.max(0.02, m.feather ?? 0.5)
    wgt = 1 - smooth(1 - f, 1, d)
  }
  return m.invert ? 1 - wgt : wgt
}

export function MaskOverlay({ mask, w, h, show, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ kind: string; start: Mask; sx: number; sy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const visible = show || dragging

  // kırmızı maske görünümü
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !visible) return
    const cw = 160
    const ch = Math.max(1, Math.round((cw * h) / w))
    cv.width = cw
    cv.height = ch
    const ctx = cv.getContext("2d")!
    const img = ctx.createImageData(cw, ch)
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const a = weight(mask, x + 0.5, y + 0.5, cw, ch)
        const i = (y * cw + x) * 4
        img.data[i] = 255
        img.data[i + 1] = 40
        img.data[i + 2] = 60
        img.data[i + 3] = Math.round(a * 115)
      }
    ctx.putImageData(img, 0, 0)
  }, [mask, w, h, visible])

  const start = (kind: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { kind, start: mask, sx: e.clientX, sy: e.clientY }
    setDragging(true)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.sx) / w
    const dy = (e.clientY - d.sy) / h
    const s = d.start
    const add = (p: Pt): Pt => [p[0] + dx, p[1] + dy]
    if (d.kind === "a") onChange({ a: add(s.a!) })
    else if (d.kind === "b") onChange({ b: add(s.b!) })
    else if (d.kind === "ab") onChange({ a: add(s.a!), b: add(s.b!) })
    else if (d.kind === "c") onChange({ c: add(s.c!) })
    else if (d.kind === "rx") onChange({ r: [Math.max(0.02, s.r![0] + dx), s.r![1]] })
    else if (d.kind === "ry") onChange({ r: [s.r![0], Math.max(0.02, s.r![1] + dy)] })
  }
  const end = () => {
    drag.current = null
    setDragging(false)
  }

  const handle = (x: number, y: number, kind: string, cursor: string, big = false) => (
    <circle
      cx={x}
      cy={y}
      r={big ? 8 : 6}
      className="fill-white stroke-black/50"
      strokeWidth={1.5}
      style={{ cursor, pointerEvents: "all" }}
      onPointerDown={start(kind)}
    />
  )

  let shapes: React.ReactNode
  if (mask.type === "linear") {
    const A: Pt = [mask.a![0] * w, mask.a![1] * h]
    const B: Pt = [mask.b![0] * w, mask.b![1] * h]
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1
    const n: Pt = [-(B[1] - A[1]) / len, (B[0] - A[0]) / len] // dik yön
    const L = Math.hypot(w, h) * 2
    const line = (p: Pt, dashed: boolean) => (
      <line
        x1={p[0] - n[0] * L} y1={p[1] - n[1] * L} x2={p[0] + n[0] * L} y2={p[1] + n[1] * L}
        stroke="white" strokeWidth={1.5} strokeDasharray={dashed ? "6 5" : undefined}
        style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.8))" }}
      />
    )
    const M: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]
    shapes = (
      <>
        {line(A, false)}
        {line(B, true)}
        <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke="white" strokeOpacity={0.6} strokeWidth={1} />
        {handle(A[0], A[1], "a", "move")}
        {handle(B[0], B[1], "b", "move")}
        {handle(M[0], M[1], "ab", "grab", true)}
      </>
    )
  } else {
    const [cx, cy] = [mask.c![0] * w, mask.c![1] * h]
    const [rx, ry] = [mask.r![0] * w, mask.r![1] * h]
    const f = 1 - Math.max(0.02, mask.feather ?? 0.5)
    shapes = (
      <>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="white" strokeWidth={1.5} style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.8))" }} />
        <ellipse cx={cx} cy={cy} rx={rx * f} ry={ry * f} fill="none" stroke="white" strokeOpacity={0.7} strokeWidth={1} strokeDasharray="5 5" />
        {handle(cx, cy, "c", "grab", true)}
        {handle(cx + rx, cy, "rx", "ew-resize")}
        {handle(cx, cy + ry, "ry", "ns-resize")}
      </>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-xl">
      {visible && <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />}
      <svg
        ref={svgRef}
        width={w}
        height={h}
        className="absolute inset-0 overflow-visible"
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {shapes}
      </svg>
    </div>
  )
}

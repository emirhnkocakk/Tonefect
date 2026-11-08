import { useEffect, useRef, useState } from "react"
import type { BrushSettings, BrushTool, CloneSource, Stroke } from "@/types"

type Props = {
  w: number // ekrandaki tuval boyutu
  h: number
  tool: BrushTool
  brush: BrushSettings
  smoothing: number
  setBrush: (p: Partial<BrushSettings>) => void
  onStroke: (s: Stroke) => void
  preview: string | null // Alt+tıkla renk almak ve canlı izi silmek için
  source?: CloneSource | null // iyileştirme ve klonlama kaynağı
  setSource?: (s: CloneSource | null) => void
  armed?: boolean // sonraki tıklama kaynağı seçer
  setArmed?: (v: boolean) => void
  onNeedSource?: () => void
}

type Pt = [number, number, number]
const toHex = (v: number) => v.toString(16).padStart(2, "0")
const hexA = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`
const SPECIAL: BrushTool[] = ["replace", "mixer", "erase", "bgerase", "history", "arthistory", "remove", "spot", "heal", "clone", "dodge", "burn", "sponge", "blur", "sharpen", "smudge", "freq", "wrinkle", "skin", "blemish", "teeth", "eye", "redeye"]

/** Fırça: basılıyken canlı iz çizilir; bırakınca darbe sunucuda tam kalitede işlenir. */
export function BrushOverlay({ w, h, tool, brush, smoothing, setBrush, onStroke, preview, source, setSource, armed, setArmed, onNeedSource }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stroke = useRef<{ pts: Pt[]; sx: number; sy: number; off?: [number, number] } | null>(null)
  const needsSource = tool === "heal" || tool === "clone"
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const r = (brush.size * Math.min(w, h)) / 2
  const stateRef = useRef({ brush, setBrush })
  stateRef.current = { brush, setBrush }

  // sonuç sunucudan gelince canlı iz silinir
  useEffect(() => {
    if (stroke.current) return
    const c = canvasRef.current
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height)
  }, [preview])

  // [ ] boyut, X renkleri değiştir, D varsayılan renkler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.ctrlKey || e.metaKey || (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"))) return
      const { brush: b, setBrush: set } = stateRef.current
      if (e.key === "[") set({ size: Math.max(0.001, b.size * 0.85) })
      else if (e.key === "]") set({ size: Math.min(0.6, b.size * 1.18) })
      else if (e.key.toLowerCase() === "x") set({ color: b.color2, color2: b.color })
      else if (e.key.toLowerCase() === "d") set({ color: "#000000", color2: "#FFFFFF" })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const norm = (e: { clientX: number; clientY: number }): [number, number] => {
    const b = boxRef.current!.getBoundingClientRect()
    return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height]
  }
  const pressure = (e: React.PointerEvent | PointerEvent) => (e.pointerType === "pen" ? Math.max(0.02, e.pressure) : 1)

  const pick = (x: number, y: number) => {
    if (!preview) return
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = img.width
      c.height = img.height
      const g = c.getContext("2d")!
      g.drawImage(img, 0, 0)
      const d = g.getImageData(Math.min(img.width - 1, Math.round(x * img.width)), Math.min(img.height - 1, Math.round(y * img.height)), 1, 1).data
      setBrush({ color: `#${toHex(d[0])}${toHex(d[1])}${toHex(d[2])}`.toUpperCase() })
    }
    img.src = preview
  }

  const seg = (a: Pt, b: Pt) => {
    const g = canvasRef.current?.getContext("2d")
    if (!g) return
    g.lineCap = "round"
    g.lineJoin = "round"
    g.lineWidth = Math.max(1, 2 * r * (brush.pressSize ? b[2] : 1))
    g.strokeStyle = SPECIAL.includes(tool) ? "rgba(255,255,255,0.55)" : brush.color
    g.beginPath()
    g.moveTo(a[0] * w, a[1] * h)
    g.lineTo(b[0] * w, b[1] * h)
    g.stroke()
  }
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const [x, y] = norm(e)
    if (needsSource && (e.altKey || armed)) {
      setSource?.({ pt: [x, y], off: null })
      setArmed?.(false)
      return
    }
    if (e.altKey) return pick(x, y)
    if (tool === "magic" || tool === "redeye") return onStroke({ tool, pts: [[x, y, 1]], seed: tool === "magic" ? 0 : Math.floor(Math.random() * 2 ** 31), b: brush })
    let off: [number, number] | undefined
    if (needsSource) {
      if (!source) return onNeedSource?.()
      off = brush.aligned && source.off ? source.off : [source.pt[0] - x, source.pt[1] - y]
      if (brush.aligned && !source.off) setSource?.({ ...source, off })
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p: Pt = [x, y, pressure(e)]
    stroke.current = { pts: [p], sx: x, sy: y, off }
    seg(p, p)
  }
  const move = (e: React.PointerEvent) => {
    setCursor(norm(e))
    const st = stroke.current
    if (!st) return
    const events = (e.nativeEvent.getCoalescedEvents?.() ?? []) as PointerEvent[]
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y] = norm(ev)
      // yumuşatma: imleci gecikmeli izler, el titremesi kaybolur
      const k = 1 - smoothing * 0.92
      st.sx += (x - st.sx) * k
      st.sy += (y - st.sy) * k
      const last = st.pts[st.pts.length - 1]
      if (Math.hypot((st.sx - last[0]) * w, (st.sy - last[1]) * h) < 1.5 || st.pts.length >= 6000) continue
      const p: Pt = [Math.round(st.sx * 1e5) / 1e5, Math.round(st.sy * 1e5) / 1e5, Math.round(pressure(ev) * 1000) / 1000]
      seg(last, p)
      st.pts.push(p)
    }
  }
  const up = () => {
    const st = stroke.current
    stroke.current = null
    if (st) onStroke({ tool, pts: st.pts, seed: Math.floor(Math.random() * 2 ** 31), b: brush, ...(st.off ? { src: [Math.round(st.off[0] * 1e5) / 1e5, Math.round(st.off[1] * 1e5) / 1e5] as [number, number] } : {}) })
  }

  return (
    <div
      ref={boxRef}
      className="absolute inset-0 z-30 overflow-hidden rounded-xl"
      style={{ cursor: "none", touchAction: "none" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => setCursor(null)}
    >
      <canvas ref={canvasRef} width={Math.round(w)} height={Math.round(h)} className="pointer-events-none absolute inset-0 h-full w-full" style={{ opacity: SPECIAL.includes(tool) ? 1 : brush.opacity * Math.max(0.35, brush.flow) }} />
      <svg width={w} height={h} className="pointer-events-none absolute inset-0">
        {needsSource && source && (() => {
          // hizalıysa kaynak imleçle birlikte gezer, değilse darbe başlayana kadar yerinde durur
          const off = stroke.current?.off ?? source.off
          const p = off && cursor ? [cursor[0] + off[0], cursor[1] + off[1]] : source.pt
          const [x, y] = [p[0] * w, p[1] * h]
          return (
            <g stroke="#fff" strokeWidth={1.25} style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95))" }}>
              <circle cx={x} cy={y} r={Math.max(4, r)} fill="none" strokeDasharray="3 3" />
              <path d={`M${x - 6} ${y}H${x + 6}M${x} ${y - 6}V${y + 6}`} />
            </g>
          )
        })()}
        {cursor && armed && <path d={`M${cursor[0] * w - 10} ${cursor[1] * h}H${cursor[0] * w + 10}M${cursor[0] * w} ${cursor[1] * h - 10}V${cursor[1] * h + 10}`} stroke="#fff" strokeWidth={1.5} style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95))" }} />}
        {cursor && (
          <ellipse
            cx={cursor[0] * w}
            cy={cursor[1] * h}
            rx={Math.max(1.5, r)}
            ry={Math.max(1.5, r * brush.round)}
            transform={`rotate(${brush.angle} ${cursor[0] * w} ${cursor[1] * h})`}
            fill="none"
            stroke={hexA("#FFFFFF", 0.95)}
            strokeWidth={1.25}
            style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95))" }}
          />
        )}
      </svg>
    </div>
  )
}

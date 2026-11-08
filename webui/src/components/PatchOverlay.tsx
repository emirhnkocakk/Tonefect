import { useEffect, useId, useRef, useState } from "react"
import type { BrushSettings, BrushTool, Stroke } from "@/types"

type Props = {
  w: number
  h: number
  tool: BrushTool // patch | camove
  mode: string // patch: source | dest, camove: move | extend
  brush: BrushSettings
  onStroke: (s: Stroke) => void
  preview: string | null
}
type Pt = [number, number]

const inside = (p: Pt, poly: Pt[]) => {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}
const pathOf = (poly: Pt[], w: number, h: number) => poly.map(([x, y]) => `${x * w},${y * h}`).join(" ")

/** Yama ve İçeriğe Duyarlı Taşıma: alanı çiz, içinden tutup sürükle, bırakınca uygulanır. */
export function PatchOverlay({ w, h, tool, mode, brush, onStroke, preview }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [poly, setPoly] = useState<Pt[]>([])
  const [ready, setReady] = useState(false)
  const [drag, setDrag] = useState<{ start: Pt; d: Pt } | null>(null)
  const [hover, setHover] = useState(false)
  const drawing = useRef(false)
  const clip = useId().replace(/:/g, "")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setPoly([])
      setReady(false)
      setDrag(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  // araç ya da fotoğraf değişince yarım seçim kalmasın
  useEffect(() => {
    setPoly([])
    setReady(false)
  }, [tool])

  const norm = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = norm(e)
    if (ready && inside(p, poly)) return setDrag({ start: p, d: [0, 0] })
    drawing.current = true
    setReady(false)
    setPoly([p])
  }
  const move = (e: React.PointerEvent) => {
    const p = norm(e)
    if (drag) return setDrag({ ...drag, d: [p[0] - drag.start[0], p[1] - drag.start[1]] })
    if (drawing.current) {
      setPoly((a) => {
        const l = a[a.length - 1]
        return a.length >= 1500 || Math.hypot((p[0] - l[0]) * w, (p[1] - l[1]) * h) < 3 ? a : [...a, p]
      })
      return
    }
    setHover(ready && inside(p, poly))
  }
  const up = (e: React.PointerEvent) => {
    if (drawing.current) {
      drawing.current = false
      if (poly.length >= 3) setReady(true)
      else setPoly([])
      return
    }
    if (!drag) return
    const p = norm(e) // son hareket henüz çizilmemiş olabilir: bırakılan yer esas alınır
    const [dx, dy]: Pt = [p[0] - drag.start[0], p[1] - drag.start[1]]
    setDrag(null)
    if (Math.hypot(dx * w, dy * h) < 3) return
    // Hedef kipi: seçili alan oraya kopyalanır, yani düzeltilen yer sürüklenen konumdur
    const dest = tool === "patch" && mode === "dest"
    const pts = (dest ? poly.map(([x, y]) => [x + dx, y + dy]) : poly).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5, 1] as [number, number, number])
    onStroke({ tool, pts, seed: Math.floor(Math.random() * 2 ** 31), b: brush, src: dest ? [-dx, -dy] : [dx, dy], ...(tool === "camove" && mode === "extend" ? { mode: "extend" } : {}) })
    setPoly([])
    setReady(false)
  }

  // Yamada alan yerinde kalır, içine kaynak görünür; taşımada alan parmakla birlikte gider
  const stays = tool === "patch" && mode !== "dest"
  const dpx: Pt = drag ? [drag.d[0] * w, drag.d[1] * h] : [0, 0]
  return (
    <div
      ref={box}
      className="absolute inset-0 z-30 overflow-hidden rounded-xl"
      style={{ cursor: drag ? "grabbing" : hover ? "move" : "crosshair", touchAction: "none" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <svg width={w} height={h} className="pointer-events-none absolute inset-0">
        <defs><clipPath id={clip}><polygon points={pathOf(poly, w, h)} /></clipPath></defs>
        {drag && preview && (
          <g transform={stays ? undefined : `translate(${dpx[0]} ${dpx[1]})`}>
            <g clipPath={`url(#${clip})`}>
              <image href={preview} x={stays ? -dpx[0] : 0} y={stays ? -dpx[1] : 0} width={w} height={h} preserveAspectRatio="none" />
            </g>
          </g>
        )}
        {poly.length > 1 && (
          <>
            <polygon points={pathOf(poly, w, h)} fill="none" stroke="rgba(0,0,0,0.75)" strokeWidth={1.2} />
            <polygon points={pathOf(poly, w, h)} fill="none" stroke="#fff" strokeWidth={1.2} strokeDasharray="5 4" />
          </>
        )}
        {drag && (
          <g transform={`translate(${dpx[0]} ${dpx[1]})`}>
            <polygon points={pathOf(poly, w, h)} fill="none" stroke="#fff" strokeWidth={1} strokeDasharray="3 3" opacity={0.85} />
          </g>
        )}
      </svg>
    </div>
  )
}

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { api } from "@/lib/api"
import type { Geo, Mask, SelectOp, SelectTool } from "@/types"

type Props = {
  mask: Mask
  w: number // ekrandaki sahne boyutu (px)
  h: number
  photo: string
  geo: Geo | null
  tool: SelectTool
  onChange: (p: Partial<Mask>) => void
}
type Pt = [number, number]

/** Akıllı seçim: sihirli değnekle tıkla, fırça/silgiyle boya. Seçim sunucuda hesaplanıp kırmızı gösterilir. */
export function SelectOverlay({ mask, w, h, photo, geo, tool, onChange }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stroke, setStroke] = useState<{ pts: Pt[]; add: boolean } | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const ops = mask.ops ?? []
  const viewKey = JSON.stringify([photo, geo, ops, mask.feather, mask.invert, Math.round(w / 100)])

  // seçimin kırmızı görünümü (adımlar değişince yeniden hesaplanır)
  useEffect(() => {
    if (!ops.length) return setView(null)
    let alive = true
    setBusy(true)
    const t = setTimeout(() => {
      api
        .maskView({ photo, geo, mask: { ...mask, adjust: {} }, w: Math.min(1200, Math.round(w)) })
        .then((r) => alive && setView(r.image))
        .catch(() => {})
        .finally(() => alive && setBusy(false))
    }, 100)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey])

  const norm = (e: React.PointerEvent): Pt => {
    const r = boxRef.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }
  const push = (op: SelectOp) => onChange({ ops: [...ops, op] })
  const r = tool.size * Math.min(w, h) // fırça yarıçapı (ekran px)

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const p = norm(e)
    if (tool.mode === "wand") {
      push({ kind: "wand", p, tol: tool.tol, contiguous: tool.contiguous, add: !e.altKey })
      return
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    setStroke({ pts: [p], add: (tool.mode === "brush") !== e.altKey })
  }
  const move = (e: React.PointerEvent) => {
    const p = norm(e)
    setCursor(p)
    if (!stroke) return
    const last = stroke.pts[stroke.pts.length - 1]
    if (Math.hypot((p[0] - last[0]) * w, (p[1] - last[1]) * h) >= Math.max(2, r * 0.25)) setStroke({ ...stroke, pts: [...stroke.pts, p] })
  }
  const up = () => {
    if (stroke) push({ kind: "brush", pts: stroke.pts.map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]), r: tool.size, hard: tool.hard, add: stroke.add })
    setStroke(null)
  }

  const brushy = tool.mode !== "wand"
  return (
    <div
      ref={boxRef}
      className="absolute inset-0 z-30 overflow-hidden rounded-xl"
      style={{ cursor: brushy ? "none" : "crosshair", touchAction: "none" }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={() => setCursor(null)}
    >
      {view && <img src={view} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />}
      <svg width={w} height={h} className="pointer-events-none absolute inset-0">
        {stroke && (
          <polyline
            points={stroke.pts.map(([x, y]) => `${x * w},${y * h}`).join(" ")}
            fill="none"
            stroke={stroke.add ? "rgba(255,40,70,0.45)" : "rgba(255,255,255,0.45)"}
            strokeWidth={r * 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {brushy && cursor && (
          <circle cx={cursor[0] * w} cy={cursor[1] * h} r={r} fill="none" stroke="white" strokeWidth={1.5} style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.9))" }} />
        )}
      </svg>
      {busy && (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> seçim
        </div>
      )}
    </div>
  )
}

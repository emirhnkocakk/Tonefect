import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { api } from "@/lib/api"
import type { Geo, Mask, SelectCombo, SelectOp, SelectTool } from "@/types"

type Props = {
  mask: Mask
  w: number // ekrandaki sahne boyutu (px)
  h: number
  photo: string
  geo: Geo | null
  tool: SelectTool
  onChange: (p: Partial<Mask>, drawn?: boolean) => void
}
type Pt = [number, number]
type Drag = { start: Pt; end: Pt; combo: Combo }
type Combo = { add: boolean; intersect?: boolean }

const round = ([x, y]: Pt): Pt => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const BOX_MODES = ["rect", "ellipse", "object"]
const PATH_MODES = ["lasso", "magnetic"]
const PAINT_MODES = ["brush", "erase", "quick"]
const CLOSE_PX = 9 // çokgende başlangıç noktasına bu kadar yaklaşınca kapanır

const comboOf = (mode: SelectCombo): Combo => (mode === "intersect" ? { add: true, intersect: true } : { add: mode === "add" })

/** Selection Tool'un fotoğraf üzerindeki kısmı. Seçim sunucuda hesaplanıp kırmızı gösterilir. */
export function SelectOverlay({ mask, w, h, photo, geo, tool, onChange }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [empty, setEmpty] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null) // dikdörtgen, elips, nesne kutusu
  const [stroke, setStroke] = useState<{ pts: Pt[]; combo: Combo } | null>(null) // fırça ve kement
  const [poly, setPoly] = useState<{ pts: Pt[]; combo: Combo } | null>(null) // çokgen kement
  const [cursor, setCursor] = useState<Pt | null>(null)
  const ops = mask.ops ?? []
  const viewKey = JSON.stringify([photo, geo, ops, mask.feather, mask.invert, mask.refine, Math.round(w / 100)])
  const mode = tool.mode

  // seçimin kırmızı görünümü (adımlar değişince yeniden hesaplanır)
  useEffect(() => {
    if (!ops.length) {
      setView(null)
      setEmpty(false)
      return
    }
    let alive = true
    setBusy(true)
    const t = setTimeout(() => {
      api
        .maskView({ photo, geo, mask: { ...mask, adjust: {} }, w: Math.min(1200, Math.round(w)) })
        .then((r) => {
          if (!alive) return
          setView(r.image)
          setEmpty(r.coverage === 0)
        })
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
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]
  }
  // Shift ya da Alt basılıyken seçim birleştiriliyor demektir: nesneye dönüşmez
  const held = useRef(false)
  const push = (op: SelectOp) => onChange({ ops: [...ops, op] }, !held.current)
  // Photoshop kısayolları: Shift ekler, Alt çıkarır, ikisi birden kesiştirir
  const combo = (e: React.PointerEvent): Combo => comboOf(e.shiftKey && e.altKey ? "intersect" : e.altKey ? "sub" : e.shiftKey ? "add" : tool.combine)
  const r = tool.size * Math.min(w, h) // fırça yarıçapı (ekran px)

  const closePoly = (p = poly) => {
    if (p && p.pts.length >= 3) push({ kind: "poly", pts: p.pts.map(round), ...p.combo })
    setPoly(null)
  }
  // çokgen: Enter kapatır, Esc vazgeçer, Backspace son köşeyi siler
  const polyRef = useRef({ poly, closePoly })
  polyRef.current = { poly, closePoly }
  useEffect(() => {
    if (!poly) return
    const onKey = (e: KeyboardEvent) => {
      const cur = polyRef.current
      if (e.key === "Escape") setPoly(null)
      else if (e.key === "Enter") cur.closePoly()
      else if (e.key === "Backspace" && cur.poly) setPoly(cur.poly.pts.length > 1 ? { ...cur.poly, pts: cur.poly.pts.slice(0, -1) } : null)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [!!poly]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPoly(null), [mode])

  const down = (e: React.PointerEvent) => {
    held.current = e.shiftKey || e.altKey
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const p = norm(e)
    const c = combo(e)
    if (mode === "wand") return push({ kind: "wand", p, tol: tool.tol, contiguous: tool.contiguous, ...c })
    if (mode === "range") return push({ kind: "range", p, tol: tool.tol, ...c })
    if (mode === "row" || mode === "col") {
      // tek piksellik çizgi kenar yumuşatmayla kaybolmasın
      return onChange({ ops: [...ops, mode === "row" ? { kind: "row", y: p[1], ...c } : { kind: "col", x: p[0], ...c }], feather: 0 })
    }
    if (mode === "poly") {
      if (!poly) return setPoly({ pts: [p], combo: c })
      const first = poly.pts[0]
      if (poly.pts.length >= 3 && Math.hypot((p[0] - first[0]) * w, (p[1] - first[1]) * h) < CLOSE_PX) return closePoly()
      return setPoly({ ...poly, pts: [...poly.pts, p] })
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (BOX_MODES.includes(mode)) setDrag({ start: p, end: p, combo: c })
    else setStroke({ pts: [p], combo: mode === "erase" ? { add: e.altKey } : c })
  }
  const move = (e: React.PointerEvent) => {
    const p = norm(e)
    setCursor(p)
    if (drag) setDrag({ ...drag, end: p })
    if (!stroke) return
    const last = stroke.pts[stroke.pts.length - 1]
    const step = PATH_MODES.includes(mode) ? 3 : Math.max(2, r * 0.25)
    if (Math.hypot((p[0] - last[0]) * w, (p[1] - last[1]) * h) >= step && stroke.pts.length < 1500) setStroke({ ...stroke, pts: [...stroke.pts, p] })
  }
  const up = () => {
    if (drag) {
      const { start: a, end: b, combo: c } = drag
      if (Math.abs(a[0] - b[0]) * w > 3 && Math.abs(a[1] - b[1]) * h > 3) {
        const box = [...round([Math.min(a[0], b[0]), Math.min(a[1], b[1])]), ...round([Math.max(a[0], b[0]), Math.max(a[1], b[1])])] as [number, number, number, number]
        push({ kind: mode as "rect" | "ellipse" | "object", box, ...c })
      }
    }
    if (stroke) {
      const pts = stroke.pts.map(round)
      if (PATH_MODES.includes(mode)) {
        if (pts.length >= 3) push({ kind: mode === "lasso" ? "poly" : "magnetic", pts, ...stroke.combo })
      } else if (mode === "quick") push({ kind: "quick", pts, r: tool.size, tol: tool.tol, ...stroke.combo })
      else push({ kind: "brush", pts, r: tool.size, hard: tool.hard, ...stroke.combo })
    }
    setDrag(null)
    setStroke(null)
  }

  const brushy = PAINT_MODES.includes(mode)
  const line = (pts: Pt[]) => pts.map(([x, y]) => `${x * w},${y * h}`).join(" ")
  const ants = { fill: "none", stroke: "white", strokeWidth: 1.25, strokeDasharray: "5 4", style: { filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95))" } }
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
      onDoubleClick={() => mode === "poly" && closePoly(poly && { ...poly, pts: poly.pts.slice(0, -1) })}
    >
      {view && <img src={view} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />}
      <svg width={w} height={h} className="pointer-events-none absolute inset-0">
        {drag && (() => {
          const x = Math.min(drag.start[0], drag.end[0]) * w
          const y = Math.min(drag.start[1], drag.end[1]) * h
          const bw = Math.abs(drag.start[0] - drag.end[0]) * w
          const bh = Math.abs(drag.start[1] - drag.end[1]) * h
          return mode === "ellipse" ? <ellipse cx={x + bw / 2} cy={y + bh / 2} rx={bw / 2} ry={bh / 2} {...ants} /> : <rect x={x} y={y} width={bw} height={bh} {...ants} />
        })()}
        {stroke && PATH_MODES.includes(mode) && <polyline points={line(stroke.pts)} {...ants} />}
        {stroke && brushy && (
          <polyline
            points={line(stroke.pts)}
            fill="none"
            stroke={stroke.combo.add ? "rgba(255,40,70,0.45)" : "rgba(255,255,255,0.45)"}
            strokeWidth={r * 2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {poly && (
          <>
            <polyline points={line(cursor ? [...poly.pts, cursor] : poly.pts)} {...ants} />
            {poly.pts.map(([x, y], i) => (
              <circle key={i} cx={x * w} cy={y * h} r={i === 0 ? 4.5 : 2.5} fill={i === 0 ? "hsl(var(--primary))" : "white"} stroke="rgba(0,0,0,0.6)" />
            ))}
          </>
        )}
        {cursor && mode === "row" && <line x1={0} x2={w} y1={cursor[1] * h} y2={cursor[1] * h} {...ants} />}
        {cursor && mode === "col" && <line y1={0} y2={h} x1={cursor[0] * w} x2={cursor[0] * w} {...ants} />}
        {brushy && cursor && <circle cx={cursor[0] * w} cy={cursor[1] * h} r={r} fill="none" stroke="white" strokeWidth={1.5} style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.9))" }} />}
      </svg>
      {(busy || empty) && (
        <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground">
          {busy ? <><Loader2 className="h-3 w-3 animate-spin" /> seçim</> : "Seçim boş: bu fotoğrafta bir alan bulunamadı"}
        </div>
      )}
    </div>
  )
}

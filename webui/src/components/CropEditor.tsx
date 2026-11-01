import { useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { useFit } from "@/lib/hooks"
import { cn } from "@/lib/utils"

type Rect = [number, number, number, number] // x, y, w, h (0..1)
type Props = {
  image: string | null
  inner: [number, number]
  crop: Rect
  lock: number | null // 0..1 biriminde w/h; null = serbest
  onChange: (c: Rect) => void
  onReset: () => void
}

const MIN = 0.04
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const
const CURSOR: Record<string, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Tutamaçla boyutlandırma; kilitliyse oran korunur ve karşı köşe/kenar sabit kalır. */
function resize(start: Rect, h: string, dx: number, dy: number, lock: number | null): Rect {
  const [x, y, w, hh] = start
  let l = x, t = y, r = x + w, b = y + hh
  if (h.includes("w")) l = clamp(l + dx, 0, r - MIN)
  if (h.includes("e")) r = clamp(r + dx, l + MIN, 1)
  if (h.includes("n")) t = clamp(t + dy, 0, b - MIN)
  if (h.includes("s")) b = clamp(b + dy, t + MIN, 1)
  if (!lock) return [l, t, r - l, b - t]

  let nw = r - l, nh = b - t
  const horiz = /[ew]/.test(h), vert = /[ns]/.test(h)
  if (horiz && vert) {
    if (nw / lock >= nh) nh = nw / lock
    else nw = nh * lock
  } else if (horiz) nh = nw / lock
  else nw = nh * lock
  const ax = h.includes("w") ? x + w : h.includes("e") ? x : x + w / 2
  const ay = h.includes("n") ? y + hh : h.includes("s") ? y : y + hh / 2
  const maxW = h.includes("w") ? ax : h.includes("e") ? 1 - ax : 2 * Math.min(ax, 1 - ax)
  const maxH = h.includes("n") ? ay : h.includes("s") ? 1 - ay : 2 * Math.min(ay, 1 - ay)
  const s = Math.min(1, maxW / nw, maxH / nh)
  nw *= s
  nh *= s
  const nx = h.includes("w") ? ax - nw : h.includes("e") ? ax : ax - nw / 2
  const ny = h.includes("n") ? ay - nh : h.includes("s") ? ay : ay - nh / 2
  return [nx, ny, nw, nh]
}

export function CropEditor({ image, inner, crop, lock, onChange, onReset }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const size = useFit(wrapRef, inner[0] / inner[1], 28)
  const drag = useRef<{ mode: string; sx: number; sy: number; start: Rect } | null>(null)
  const [active, setActive] = useState(false)

  const down = (mode: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: crop }
    setActive(true)
    boxRef.current?.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.sx) / size.w
    const dy = (e.clientY - d.sy) / size.h
    const [x, y, w, h] = d.start
    onChange(d.mode === "move" ? [clamp(x + dx, 0, 1 - w), clamp(y + dy, 0, 1 - h), w, h] : resize(d.start, d.mode, dx, dy, lock))
  }
  const up = () => {
    drag.current = null
    setActive(false)
  }

  const [x, y, w, h] = crop
  const pct = (v: number) => `${v * 100}%`
  return (
    <div ref={wrapRef} className="absolute inset-0 flex items-center justify-center">
      <div
        ref={boxRef}
        className="relative select-none overflow-hidden rounded-md bg-card shadow-2xl ring-1 ring-border"
        style={{ width: size.w, height: size.h, touchAction: "none" }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {image ? (
          <img src={image} alt="" draggable={false} className="h-full w-full object-fill" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        <div
          className="absolute cursor-move outline outline-1 outline-white/90"
          style={{ left: pct(x), top: pct(y), width: pct(w), height: pct(h), boxShadow: "0 0 0 9999px rgba(0,0,0,0.58)" }}
          onPointerDown={down("move")}
          onDoubleClick={onReset}
          title="Sürükle: taşı · Çift tıkla: sıfırla"
        >
          {/* üçte bir kılavuzu */}
          <div className={cn("pointer-events-none absolute inset-0 transition-opacity", active ? "opacity-100" : "opacity-40")}>
            {[1, 2].map((i) => (
              <div key={"v" + i} className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${(i * 100) / 3}%` }} />
            ))}
            {[1, 2].map((i) => (
              <div key={"h" + i} className="absolute inset-x-0 h-px bg-white/70" style={{ top: `${(i * 100) / 3}%` }} />
            ))}
          </div>
          {HANDLES.map((hd) => {
            const left = hd.includes("w") ? "0%" : hd.includes("e") ? "100%" : "50%"
            const top = hd.includes("n") ? "0%" : hd.includes("s") ? "100%" : "50%"
            const corner = hd.length === 2
            return (
              <div
                key={hd}
                onPointerDown={down(hd)}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-sm border border-black/40 bg-white shadow",
                  corner ? "h-3.5 w-3.5" : /[ns]/.test(hd) ? "h-2 w-6" : "h-6 w-2"
                )}
                style={{ left, top, cursor: CURSOR[hd] }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { useFit } from "@/lib/hooks"

export type Quad = [number, number][] // sol üst, sağ üst, sağ alt, sol alt (0..1)
export const FULL_QUAD: Quad = [[0, 0], [1, 0], [1, 1], [0, 1]]

type Props = {
  image: string | null
  size: [number, number] // döndürülmüş, düzeltilmemiş görselin boyutu
  quad: Quad
  onChange: (q: Quad) => void
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** Perspektif kırpma: dört köşeyi eğik çekilmiş binanın, belgenin ya da tablonun köşelerine sürükle. */
export function PerspEditor({ image, size: src, quad, onChange }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const size = useFit(wrapRef, src[0] / src[1], 28)
  const drag = useRef<{ i: number; sx: number; sy: number; start: Quad } | null>(null)
  const [active, setActive] = useState(false)

  const down = (i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    drag.current = { i, sx: e.clientX, sy: e.clientY, start: quad }
    setActive(true)
    boxRef.current?.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.sx) / size.w
    const dy = (e.clientY - d.sy) / size.h
    onChange(d.start.map((p, j) => (j === d.i ? [clamp(p[0] + dx), clamp(p[1] + dy)] : p)) as Quad)
  }
  const up = () => {
    drag.current = null
    setActive(false)
  }

  const px = (p: [number, number]) => `${p[0] * size.w},${p[1] * size.h}`
  const [a, b, c, d] = quad
  // ızgara: düzeltilmiş görüntüde düz olacak çizgiler
  const lines = [1, 2, 3].flatMap((i) => [[lerp(a, b, i / 4), lerp(d, c, i / 4)], [lerp(a, d, i / 4), lerp(b, c, i / 4)]])
  return (
    <div ref={wrapRef} className="absolute inset-0 flex items-center justify-center">
      <div
        ref={boxRef}
        className="relative select-none rounded-md bg-card shadow-2xl ring-1 ring-border"
        style={{ width: size.w, height: size.h, touchAction: "none" }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {image ? (
          <img src={image} alt="" draggable={false} className="h-full w-full rounded-md object-fill" />
        ) : (
          <div className="grid h-full w-full place-items-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        <svg width={size.w} height={size.h} className="pointer-events-none absolute inset-0 overflow-visible">
          <defs>
            <mask id="persp-hole">
              <rect width={size.w} height={size.h} fill="white" />
              <polygon points={quad.map(px).join(" ")} fill="black" />
            </mask>
          </defs>
          <rect width={size.w} height={size.h} fill="rgba(0,0,0,0.55)" mask="url(#persp-hole)" />
          <polygon points={quad.map(px).join(" ")} fill="none" stroke="white" strokeWidth={1.5} />
          {lines.map(([p, q], i) => (
            <line key={i} x1={p[0] * size.w} y1={p[1] * size.h} x2={q[0] * size.w} y2={q[1] * size.h} stroke="white" strokeOpacity={active ? 0.7 : 0.35} />
          ))}
        </svg>
        {quad.map((p, i) => (
          <div
            key={i}
            onPointerDown={down(i)}
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-primary shadow"
            style={{ left: p[0] * size.w, top: p[1] * size.h }}
            title="Köşeyi sürükle"
          />
        ))}
      </div>
    </div>
  )
}

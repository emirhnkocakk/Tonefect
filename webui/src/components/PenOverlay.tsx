import { useEffect, useRef, useState } from "react"
import { TYPING } from "@/lib/shortcuts"
import { freeformNodes, nearest, newPathId, pathD, splitAt } from "@/lib/paths"
import type { PathNode, PenTool, VPath } from "@/types"

type Pt = [number, number]
type Props = { paths: VPath[]; sel: string | null; setSel: (id: string | null) => void; onChange: (p: VPath[]) => void; tool: PenTool; w: number; h: number }
type Drag =
  | { kind: "place"; id: string; i: number }
  | { kind: "node"; id: string; i: number; p0: Pt; start: PathNode }
  | { kind: "handle"; id: string; i: number; which: "in" | "out"; free: boolean }
  | { kind: "pull"; id: string; i: number }
  | { kind: "path"; id: string; p0: Pt; start: VPath }
  | { kind: "free"; pts: Pt[] }

/** Tuval üzerinde yol çizme ve düzenleme. Yollar çıktıda görünmez; seçime, maskeye ya da şekle çevrilir. */
export function PenOverlay({ paths, sel, setSel, onChange, tool, w, h }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [hover, setHover] = useState<Pt | null>(null)
  const [freeDraw, setFreeDraw] = useState<Pt[] | null>(null)
  const cur = paths.find((p) => p.id === sel) ?? null
  const latest = useRef({ paths, sel, cur, tool })
  latest.current = { paths, sel, cur, tool }

  const put = (id: string, fn: (p: VPath) => VPath) => onChange(latest.current.paths.map((p) => (p.id === id ? fn(p) : p)))
  const putNode = (id: string, i: number, fn: (n: PathNode) => PathNode) => put(id, (p) => ({ ...p, nodes: p.nodes.map((n, j) => (j === i ? fn(n) : n)) }))
  const screen = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const rel = (q: Pt): Pt => [q[0] / w, q[1] / h]
  const capture = (e: React.PointerEvent) => {
    e.stopPropagation()
    ref.current?.setPointerCapture(e.pointerId)
  }
  // Photoshop'taki gibi: Kalem'de Ctrl doğrudan seçim, Alt nokta dönüştürme
  const effective = (e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): PenTool => (tool !== "pen" ? tool : e.ctrlKey || e.metaKey ? "direct" : e.altKey ? "convert" : "pen")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (TYPING(e.target) || document.querySelector("[role=dialog]")) return
      const { cur: c, paths: all, tool: t } = latest.current
      if (e.key === "Escape" || (e.key === "Enter" && !e.ctrlKey && !e.metaKey)) {
        if (c && !c.closed) setSel(null)
        setHover(null)
      } else if (e.key === "Backspace" && t === "pen" && c && !c.closed) {
        e.preventDefault()
        if (c.nodes.length > 1) put(c.id, (p) => ({ ...p, nodes: p.nodes.slice(0, -1) }))
        else {
          onChange(all.filter((p) => p.id !== c.id))
          setSel(null)
        }
      } else if (e.key === "Delete" && (t === "path" || t === "direct") && c) {
        e.preventDefault()
        onChange(all.filter((p) => p.id !== c.id))
        setSel(null)
      } else return
      e.stopPropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const downBack = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const q = screen(e)
    const t = effective(e)
    if (t === "pen") {
      capture(e)
      const node: PathNode = { p: rel(q) }
      if (cur && !cur.closed) {
        put(cur.id, (p) => ({ ...p, nodes: [...p.nodes, node] }))
        drag.current = { kind: "place", id: cur.id, i: cur.nodes.length }
      } else {
        const n = paths.length + 1
        const p: VPath = { id: newPathId(), name: `Yol ${n}`, closed: false, nodes: [node] }
        onChange([...paths, p])
        setSel(p.id)
        drag.current = { kind: "place", id: p.id, i: 0 }
      }
    } else if (t === "free") {
      capture(e)
      drag.current = { kind: "free", pts: [q] }
      setFreeDraw([q])
    } else if (t === "add") {
      const hits = paths.map((p) => ({ p, r: nearest(p, q[0], q[1], w, h) })).filter((x) => x.r && x.r.dist < 12).sort((a, b) => a.r!.dist - b.r!.dist)
      if (hits[0]) {
        const { p, r } = hits[0]
        setSel(p.id)
        put(p.id, (x) => splitAt(x, r!.i, r!.t))
      }
    } else setSel(null)
  }
  const downLine = (p: VPath) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const t = effective(e)
    if (t === "add" || t === "pen" || t === "free") return // arka plan işlesin
    e.stopPropagation()
    setSel(p.id)
    if (t === "path") {
      capture(e)
      drag.current = { kind: "path", id: p.id, p0: screen(e), start: p }
    }
  }
  const downNode = (p: VPath, i: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const t = effective(e)
    setSel(p.id)
    if (t === "pen") {
      if (i === 0 && !p.closed && p.nodes.length > 1) {
        put(p.id, (x) => ({ ...x, closed: true }))
        setHover(null)
      }
    } else if (t === "del") {
      if (p.nodes.length <= 2) {
        onChange(paths.filter((x) => x.id !== p.id))
        setSel(null)
      } else put(p.id, (x) => ({ ...x, nodes: x.nodes.filter((_, j) => j !== i) }))
    } else if (t === "convert") {
      const n = p.nodes[i]
      if (n.in || n.out) putNode(p.id, i, (x) => ({ p: x.p }))
      else {
        capture(e)
        drag.current = { kind: "pull", id: p.id, i }
      }
    } else if (t === "direct") {
      capture(e)
      drag.current = { kind: "node", id: p.id, i, p0: screen(e), start: p.nodes[i] }
    } else if (t === "path") {
      capture(e)
      drag.current = { kind: "path", id: p.id, p0: screen(e), start: p }
    }
  }
  const downHandle = (p: VPath, i: number, which: "in" | "out") => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    drag.current = { kind: "handle", id: p.id, i, which, free: effective(e) === "convert" }
  }

  const pull = (id: string, i: number, q: Pt) =>
    putNode(id, i, (n) => {
      const o = rel(q)
      if (Math.hypot((o[0] - n.p[0]) * w, (o[1] - n.p[1]) * h) < 3) return { p: n.p }
      return { p: n.p, out: o, in: [2 * n.p[0] - o[0], 2 * n.p[1] - o[1]] }
    })

  const move = (e: React.PointerEvent) => {
    const q = screen(e)
    const d = drag.current
    if (!d) return setHover(q)
    if (d.kind === "place" || d.kind === "pull") return pull(d.id, d.i, q)
    if (d.kind === "free") {
      d.pts.push(q)
      return setFreeDraw([...d.pts])
    }
    if (d.kind === "node") {
      const dx = (q[0] - d.p0[0]) / w
      const dy = (q[1] - d.p0[1]) / h
      const shift = (v?: Pt | null): Pt | undefined => (v ? [v[0] + dx, v[1] + dy] : undefined)
      return putNode(d.id, d.i, () => ({ p: shift(d.start.p)!, in: shift(d.start.in), out: shift(d.start.out) }))
    }
    if (d.kind === "handle") {
      const v = rel(q)
      return putNode(d.id, d.i, (n) => {
        const other = d.which === "in" ? "out" : "in"
        return { ...n, [d.which]: v, ...(!d.free && n[other] ? { [other]: [2 * n.p[0] - v[0], 2 * n.p[1] - v[1]] as Pt } : {}) }
      })
    }
    const dx = (q[0] - d.p0[0]) / w
    const dy = (q[1] - d.p0[1]) / h
    const sh = (v?: Pt | null): Pt | undefined => (v ? [v[0] + dx, v[1] + dy] : undefined)
    put(d.id, () => ({ ...d.start, nodes: d.start.nodes.map((n) => ({ p: sh(n.p)!, in: sh(n.in), out: sh(n.out) })) }))
  }
  const up = () => {
    const d = drag.current
    drag.current = null
    if (d?.kind === "free") {
      setFreeDraw(null)
      if (d.pts.length > 2) {
        const r = freeformNodes(d.pts, w, h)
        if (r.nodes.length > 1) {
          const p: VPath = { id: newPathId(), name: `Yol ${paths.length + 1}`, ...r }
          onChange([...paths, p])
          setSel(p.id)
        }
      }
    }
  }

  const last = cur && !cur.closed && cur.nodes[cur.nodes.length - 1]
  const blue = "hsl(var(--primary))"
  const px = (v: Pt): Pt => [v[0] * w, v[1] * h]
  const cursor = tool === "pen" || tool === "free" ? "crosshair" : tool === "path" || tool === "direct" ? "default" : "copy"

  return (
    <div ref={ref} className="absolute inset-0 z-30" style={{ touchAction: "none", cursor }} onPointerDown={downBack} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => !drag.current && setHover(null)}>
      <svg width={w} height={h} className="absolute inset-0 overflow-visible">
        {paths.map((p) => {
          const d = pathD(p, w, h)
          const on = p.id === sel
          return (
            <g key={p.id}>
              <path d={d} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth={on ? 3 : 2.5} className="pointer-events-none" />
              <path d={d} fill="none" stroke={on ? blue : "rgba(255,255,255,.75)"} strokeWidth={on ? 1.5 : 1} className="pointer-events-none" />
              <path d={d} fill="none" stroke="transparent" strokeWidth={12} onPointerDown={downLine(p)} style={{ pointerEvents: "stroke" }} />
            </g>
          )
        })}
        {tool === "pen" && last && hover && !drag.current && (() => {
          const a = px(last.p)
          const c = px(last.out ?? last.p)
          return <path d={`M ${a[0]} ${a[1]} C ${c[0]} ${c[1]} ${hover[0]} ${hover[1]} ${hover[0]} ${hover[1]}`} fill="none" stroke={blue} strokeWidth={1} strokeDasharray="3 3" className="pointer-events-none" />
        })()}
        {freeDraw && <polyline points={freeDraw.map((q) => q.join(",")).join(" ")} fill="none" stroke={blue} strokeWidth={1.5} className="pointer-events-none" />}
        {cur?.nodes.map((n, i) => {
          const [x, y] = px(n.p)
          return (
            <g key={i}>
              {(["in", "out"] as const).map((k) => {
                const v = n[k]
                if (!v || tool === "path") return null
                const [hx, hy] = px(v)
                return (
                  <g key={k}>
                    <line x1={x} y1={y} x2={hx} y2={hy} stroke={blue} strokeWidth={1} className="pointer-events-none" />
                    <circle cx={hx} cy={hy} r={4} fill="white" stroke={blue} strokeWidth={1} onPointerDown={downHandle(cur, i, k)} style={{ cursor: "move" }} />
                  </g>
                )
              })}
              <rect x={x - 4} y={y - 4} width={8} height={8} fill={i === 0 && !cur.closed ? blue : "white"} stroke={blue} strokeWidth={1} onPointerDown={downNode(cur, i)} style={{ cursor: "pointer" }} />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

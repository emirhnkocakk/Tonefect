import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Columns2, Eye, ImagePlus, Loader2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"
import { StyleBar } from "@/components/StyleBar"
import { CropEditor } from "@/components/CropEditor"
import { LayerOverlay } from "@/components/LayerOverlay"
import { SliceOverlay } from "@/components/SliceOverlay"
import { BrushOverlay } from "@/components/BrushOverlay"
import { PatchOverlay } from "@/components/PatchOverlay"
import { FilterOverlay, filterHasOverlay } from "@/components/FilterOverlay"
import type { LiquifyTool } from "@/lib/filters"
import { LayerMaskOverlay } from "@/components/LayerMaskOverlay"
import { FULL_QUAD, PerspEditor, type Quad } from "@/components/PerspEditor"
import { MaskOverlay } from "@/components/MaskOverlay"
import { PenOverlay } from "@/components/PenOverlay"
import { SelectOverlay } from "@/components/SelectOverlay"
import { canvasScale, canvasSize, cropOf, innerSize, legacyGeo, lockRatio, photoRect } from "@/lib/geo"
import { useFit, useIntent, usePreview } from "@/lib/hooks"
import { commonStyle } from "@/lib/text"
import { cn } from "@/lib/utils"
import type { BrushSettings, BrushTool, CloneSource, FilterItem, MaskPaintTool, Stroke, Config, Geo, ImgLayer, Item, Mask, Mode, SelectTool, Slice, Style, Watermark, XformMode } from "@/types"

type Props = {
  item?: Item
  cfg: Config
  mode: Mode
  intent?: { cmd: string; n: number } | null // görünüm menüsü
  nav?: "hand" | "zoom" | ""
  pen?: { sel: string | null; setSel: (id: string | null) => void; onChange: (p: NonNullable<Item["paths"]>) => void; tool: import("@/types").PenTool } | null
  layerName?: string
  textTab?: boolean
  selected: number[]
  setSelected: (s: number[]) => void
  update: (fn: (it: Item) => Item) => void
  applyStyle: (patch: Partial<Style>) => void
  resetPosition: () => void
  pickFiles: () => void
  guides: boolean
  wm: Watermark | null
  cropping: boolean
  geoSrc: { image: string; inner: [number, number] } | null
  perspEdit?: boolean
  lineMode?: boolean
  endLine?: () => void
  eraseMode?: "" | "layermask" | "vector"
  maskTool?: MaskPaintTool
  putLayer?: (id: string, p: Partial<ImgLayer>) => void
  brushMode?: boolean
  brushTool?: BrushTool
  patchMode?: Record<string, string>
  filterEdit?: { filter: FilterItem; set: (p: Partial<FilterItem>) => void; liquify: LiquifyTool } | null
  pick?: ((rgb: [number, number, number]) => void) | null
  onPreview?: (img: string | null) => void
  source?: CloneSource | null
  setSource?: (s: CloneSource | null) => void
  armed?: boolean
  setArmed?: (v: boolean) => void
  onNeedSource?: () => void
  brush?: BrushSettings
  setBrush?: (p: Partial<BrushSettings>) => void
  smoothing?: number
  onStroke?: (s: Stroke) => void
  xform?: XformMode
  onXformDone?: (a: ImgLayer, b: ImgLayer) => void
  sliceMode?: boolean
  sliceTool?: "draw" | "select"
  sliceSel?: string | null
  setSliceSel?: (id: string | null) => void
  setSlices?: (s: Slice[]) => void
  designMode?: boolean
  layerSel?: string[]
  setLayerSel?: (ids: string[]) => void
  setLayers?: (l: ImgLayer[]) => void
  setGeo: (p: Partial<Geo>) => void
  localMode: boolean // Yerel sekmesi: yazı etkileşimi kapalı, maske tutamaçları açık
  mask?: Mask
  maskShow: boolean
  setMask: (p: Partial<Mask>) => void
  selTool: SelectTool
}

type Drag = {
  target: "block" | number[]
  clickWord: number | null
  sx: number
  sy: number
  startBlock: [number, number]
  startOffs: Record<number, [number, number]>
  ref: Rect
  others: Rect[]
  moved: boolean
  shift: boolean
  rect: DOMRect
}

type Rect = [number, number, number, number]
type Guide = { x1: number; y1: number; x2: number; y2: number }

const THRESH = 8
const MARGIN = 0.08

/** Damlalık: önizlemede tıklanan yerin 5x5 ortalama rengini verir. */
function PickOverlay({ image, onPick }: { image: string; onPick: (rgb: [number, number, number]) => void }) {
  const click = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    const img = new Image()
    img.onload = () => {
      const c = document.createElement("canvas")
      c.width = img.width
      c.height = img.height
      const g = c.getContext("2d")!
      g.drawImage(img, 0, 0)
      const x = Math.max(0, Math.min(img.width - 5, Math.round(fx * img.width) - 2))
      const y = Math.max(0, Math.min(img.height - 5, Math.round(fy * img.height) - 2))
      const d = g.getImageData(x, y, 5, 5).data
      const sum = [0, 0, 0]
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k]
      onPick([sum[0] / 25, sum[1] / 25, sum[2] / 25])
    }
    img.src = image
  }
  return <div className="absolute inset-0 z-40 cursor-crosshair rounded-xl" onPointerDown={click} />
}

export function Stage({ item, cfg, mode, intent, nav, pen, layerName, textTab, selected, setSelected, update, applyStyle, resetPosition, pickFiles, guides: guidesOn, wm, cropping, geoSrc, setGeo, perspEdit, lineMode, endLine, eraseMode, maskTool, putLayer, brushMode, brushTool, patchMode, filterEdit, pick, onPreview, source, setSource, armed, setArmed, onNeedSource, brush, setBrush, smoothing, onStroke, xform, onXformDone, sliceMode, sliceTool, sliceSel, setSliceSel, setSlices, designMode, layerSel, setLayerSel, setLayers, localMode, mask, maskShow, setMask, selTool }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const lastCanvas = useRef<[number, number]>([cfg.canvas.w, cfg.canvas.h])
  // tuval boyutu: fotoğrafın oranı/kırpması (önizleme gelmeden de bilinir)
  const known = item ? canvasSize(item.geo, item.src) : null
  if (known) lastCanvas.current = known
  const [W, H] = known ?? lastCanvas.current
  const k = canvasScale(W, H)
  const fit = useFit(wrapRef, W / H, 20)
  // yakınlaştırma: 1 = ekrana sığdır; büyüdükçe sunucudan daha keskin önizleme istenir
  const [zoom, setZoom] = useState(1)
  const zoom100 = W / fit.w
  const maxZoom = Math.max(8, zoom100 * 2)
  const size = { w: fit.w * zoom, h: fit.h * zoom }
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  const maxPw = zoom > 1 ? Math.min(W, 12000) : 1600
  const pw = Math.min(maxPw, Math.max(480, Math.ceil((size.w * dpr) / 80) * 80))
  const { preview, busy, error } = usePreview(cropping ? undefined : item, pw, wm)
  useEffect(() => onPreview?.(preview?.image ?? null), [preview?.image])

  // önce/sonra: basılı tutunca ya da bölünmüş görünümde düzenlenmemiş hali
  const [compare, setCompare] = useState(false)
  const [holdOrig, setHoldOrig] = useState(false)
  const [splitX, setSplitX] = useState(0.5)
  const showOrig = !cropping && (holdOrig || compare)
  const orig = usePreview(showOrig ? item : undefined, pw, null, true)
  const [spaceKey, setSpace] = useState(false)
  const space = spaceKey || nav === "hand"
  const [grid, setGrid] = useState(false)
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)
  const anchor = useRef<{ fx: number; fy: number; mx: number; my: number } | null>(null)

  const zoomTo = (z: number, at?: { x: number; y: number }) => {
    const nz = Math.min(maxZoom, Math.max(1, z))
    const el = wrapRef.current
    const st = stageRef.current
    if (el && st) {
      const r = st.getBoundingClientRect()
      const wr = el.getBoundingClientRect()
      const px = at ? at.x : wr.left + wr.width / 2
      const py = at ? at.y : wr.top + wr.height / 2
      anchor.current = { fx: (px - r.left) / r.width, fy: (py - r.top) / r.height, mx: px - wr.left, my: py - wr.top }
    }
    setZoom(nz)
  }
  // yakınlaştırırken imlecin altındaki nokta yerinde kalsın
  useLayoutEffect(() => {
    const a = anchor.current
    const el = wrapRef.current
    const st = stageRef.current
    anchor.current = null
    if (!a || !el || !st) return
    el.scrollLeft = st.offsetLeft + a.fx * size.w - a.mx
    el.scrollTop = st.offsetTop + a.fy * size.h - a.my
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])
  useEffect(() => setZoom(1), [item?.id, cropping])

  useIntent(intent, "view:", (cmd) => {
    if (cmd === "view:in") zoomTo(zoom * 1.5)
    else if (cmd === "view:out") zoomTo(zoom / 1.5)
    else if (cmd === "view:fit") zoomTo(1)
    else if (cmd === "view:100") zoomTo(zoom100)
    else if (cmd === "view:compare") setCompare((c) => !c)
    else if (cmd === "view:grid") setGrid((g) => !g)
  })
  const zoomRef = useRef(zoomTo)
  zoomRef.current = zoomTo
  const zoomNow = useRef(zoom)
  zoomNow.current = zoom
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return // normal tekerlek: kaydır
      e.preventDefault()
      zoomRef.current(zoomNow.current * (e.deltaY < 0 ? 1.25 : 0.8), { x: e.clientX, y: e.clientY })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  useEffect(() => {
    if (!item || cropping) return
    const field = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
    }
    const isBefore = (e: KeyboardEvent) => e.key === "\\" || e.key === "ö" || e.key === "Ö"
    const down = (e: KeyboardEvent) => {
      if (field(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (e.key === " " && zoomNow.current > 1) setSpace(true)
      else if (isBefore(e) && !mod) setHoldOrig(true)
      else if (mod && e.key === "0") zoomRef.current(1)
      else if (mod && e.key === "1") zoomRef.current(zoom100)
      else if (mod && (e.key === "=" || e.key === "+")) zoomRef.current(zoomNow.current * 1.5)
      else if (mod && e.key === "-") zoomRef.current(zoomNow.current / 1.5)
      else return
      e.preventDefault()
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") setSpace(false)
      if (isBefore(e)) setHoldOrig(false)
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [item, cropping, zoom100])

  const startSplit = (e: React.PointerEvent) => {
    e.stopPropagation()
    const rect = stageRef.current!.getBoundingClientRect()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setSplitX(Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)))
    const stop = () => {
      el.removeEventListener("pointermove", move)
      el.removeEventListener("pointerup", stop)
    }
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", stop)
  }
  if (!known && preview && item && preview.photo === item.id) lastCanvas.current = [preview.w, preview.h]

  const [hover, setHover] = useState<"block" | number | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [dragging, setDragging] = useState(false)

  const sx = size.w / W
  const sy = size.h / H

  // Önizleme geldikten sonra yapılan kaydırmalar kutulara anında yansısın
  const boxes = useMemo(() => {
    if (!item || !preview || preview.photo !== item.id || preview.used.text !== item.text) return []
    return preview.boxes.map((b) => {
      const o = item.offsets[b.idx] ?? [0, 0]
      const u = preview.used.offsets[b.idx] ?? [0, 0]
      const dx = (item.block[0] - preview.used.block[0] + o[0] - u[0]) * k
      const dy = (item.block[1] - preview.used.block[1] + o[1] - u[1]) * k
      return { idx: b.idx, box: [b.box[0] + dx, b.box[1] + dy, b.box[2] + dx, b.box[3] + dy] as Rect }
    })
  }, [item, preview, k])

  const union = (idxs?: number[]): Rect | null => {
    const list = idxs ? boxes.filter((b) => idxs.includes(b.idx)) : boxes
    if (!list.length) return null
    return [
      Math.min(...list.map((b) => b.box[0])), Math.min(...list.map((b) => b.box[1])),
      Math.max(...list.map((b) => b.box[2])), Math.max(...list.map((b) => b.box[3])),
    ]
  }

  const toImg = (clientX: number, clientY: number, rect: DOMRect) => [
    ((clientX - rect.left) / rect.width) * W,
    ((clientY - rect.top) / rect.height) * H,
  ]

  const hitWord = (gx: number, gy: number): number | null => {
    const pad = 10
    let r: number | null = null
    for (const b of boxes) {
      const [x0, y0, x1, y1] = b.box
      if (gx >= x0 - pad && gx <= x1 + pad && gy >= y0 - pad && gy <= y1 + pad) r = b.idx
    }
    return r
  }

  const inBlock = (gx: number, gy: number) => {
    const bb = union()
    return !!bb && gx >= bb[0] - 16 && gx <= bb[2] + 16 && gy >= bb[1] - 16 && gy <= bb[3] + 16
  }

  // Canva tarzı hizalama: hareket eden kutunun sol/orta/sağ ve üst/orta/alt çizgileri
  // başka kelimelerin ve tuvalin çizgilerine yaklaşınca yapışır, çizgi gösterilir.
  const snap = (ref: Rect, others: Rect[], dx: number, dy: number) => {
    const mv: Rect = [ref[0] + dx, ref[1] + dy, ref[2] + dx, ref[3] + dy]
    type Cand = { pos: number; a0: number; a1: number }
    const xs: Cand[] = [W * MARGIN, W / 2, W * (1 - MARGIN)].map((pos) => ({ pos, a0: 0, a1: H }))
    const ys: Cand[] = [{ pos: H / 2, a0: 0, a1: W }]
    for (const o of others) {
      for (const pos of [o[0], (o[0] + o[2]) / 2, o[2]]) xs.push({ pos, a0: o[1], a1: o[3] })
      for (const pos of [o[1], (o[1] + o[3]) / 2, o[3]]) ys.push({ pos, a0: o[0], a1: o[2] })
    }
    const best = (vals: number[], cands: Cand[]) => {
      let r: { delta: number; pos: number } | null = null
      for (const v of vals) for (const c of cands) {
        const dd = c.pos - v
        if (Math.abs(dd) <= THRESH * k && (!r || Math.abs(dd) < Math.abs(r.delta))) r = { delta: dd, pos: c.pos }
      }
      return r
    }
    const bx = best([mv[0], (mv[0] + mv[2]) / 2, mv[2]], xs)
    const by = best([mv[1], (mv[1] + mv[3]) / 2, mv[3]], ys)
    if (bx) dx += bx.delta
    if (by) dy += by.delta
    const fin: Rect = [ref[0] + dx, ref[1] + dy, ref[2] + dx, ref[3] + dy]
    const guides: Guide[] = []
    const near = (a: number, b: number) => Math.abs(a - b) < 0.75 * k
    if (bx) {
      let y0 = fin[1], y1 = fin[3]
      for (const c of xs) if (near(c.pos, bx.pos)) { y0 = Math.min(y0, c.a0); y1 = Math.max(y1, c.a1) }
      guides.push({ x1: bx.pos, y1: y0, x2: bx.pos, y2: y1 })
    }
    if (by) {
      let x0 = fin[0], x1 = fin[2]
      for (const c of ys) if (near(c.pos, by.pos)) { x0 = Math.min(x0, c.a0); x1 = Math.max(x1, c.a1) }
      guides.push({ x1: x0, y1: by.pos, x2: x1, y2: by.pos })
    }
    return { dx, dy, guides }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((space || e.button === 1) && wrapRef.current) {
      const el = wrapRef.current
      panRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      e.preventDefault()
      return
    }
    if (nav === "zoom" && e.button === 0) return zoomTo(zoom * (e.altKey ? 1 / 1.5 : 1.5), { x: e.clientX, y: e.clientY })
    if (e.button !== 0 || !item || localMode) return
    stageRef.current?.focus()
    const rect = stageRef.current!.getBoundingClientRect()
    const [gx, gy] = toImg(e.clientX, e.clientY, rect)
    const w = hitWord(gx, gy)
    let target: Drag["target"]
    if (mode === "word") {
      if (w == null) {
        setSelected([])
        return
      }
      target = selected.includes(w) && selected.length > 1 ? selected : [w]
    } else {
      if (!inBlock(gx, gy)) {
        setSelected([])
        return
      }
      target = "block"
    }
    const startOffs: Record<number, [number, number]> = {}
    if (target !== "block") for (const i of target) startOffs[i] = item.offsets[i] ?? [0, 0]
    const ref = target === "block" ? union() : union(target)
    if (!ref) return
    dragRef.current = {
      target, clickWord: w, sx: e.clientX, sy: e.clientY, startBlock: [...item.block] as [number, number],
      startOffs, ref, others: target === "block" ? [] : boxes.filter((b) => !target.includes(b.idx)).map((b) => b.box as Rect), moved: false, shift: e.shiftKey || e.ctrlKey || e.metaKey, rect,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = panRef.current
    if (p && wrapRef.current) {
      wrapRef.current.scrollLeft = p.sl - (e.clientX - p.x)
      wrapRef.current.scrollTop = p.st - (e.clientY - p.y)
      return
    }
    const d = dragRef.current
    if (!d) {
      if (!stageRef.current) return
      const [gx, gy] = toImg(e.clientX, e.clientY, stageRef.current.getBoundingClientRect())
      const h = mode === "word" ? hitWord(gx, gy) : inBlock(gx, gy) ? "block" : null
      if (h !== hover) setHover(h)
      return
    }
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return
    if (!d.moved) {
      d.moved = true
      setDragging(true)
    }
    let dx = ((e.clientX - d.sx) / d.rect.width) * W
    let dy = ((e.clientY - d.sy) / d.rect.height) * H
    if (guidesOn) {
      const snapped = snap(d.ref, d.others, dx, dy)
      dx = snapped.dx
      dy = snapped.dy
      setGuides(snapped.guides)
    }
    const t = d.target
    // ekran -> tuval pikseli -> kaydırma birimi (1080x1350 tuvalde 1:1)
    dx /= k
    dy /= k
    const r = (v: number) => Math.round(v * 10) / 10
    update((it) =>
      t === "block"
        ? { ...it, block: [r(d.startBlock[0] + dx), r(d.startBlock[1] + dy)] }
        : {
            ...it,
            offsets: {
              ...it.offsets,
              ...Object.fromEntries(
                t.map((i) => [i, [r(d.startOffs[i][0] + dx), r(d.startOffs[i][1] + dy)]])
              ),
            },
          }
    )
  }

  const onPointerUp = () => {
    if (panRef.current) {
      panRef.current = null
      return
    }
    const d = dragRef.current
    dragRef.current = null
    setGuides([])
    setDragging(false)
    if (d && !d.moved) {
      if (d.clickWord == null) setSelected([])
      else if (d.shift) setSelected(selected.includes(d.clickWord) ? selected.filter((i) => i !== d.clickWord) : [...selected, d.clickWord])
      else setSelected([d.clickWord])
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setSelected([])
    const step = e.shiftKey ? 10 : 2
    const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key]
    if (!delta || !item) return
    e.preventDefault()
    if (mode === "block") update((it) => ({ ...it, block: [it.block[0] + delta[0], it.block[1] + delta[1]] }))
    else if (selected.length)
      update((it) => ({
        ...it,
        offsets: {
          ...it.offsets,
          ...Object.fromEntries(
            selected.map((i) => {
              const o = it.offsets[i] ?? [0, 0]
              return [i, [o[0] + delta[0], o[1] + delta[1]]]
            })
          ),
        },
      }))
  }

  // Stil çubuğunun yeri: seçili kelimelerin üstü (yer yoksa altı)
  const selBox = selected.length && boxes.length ? union(selected) : null
  const barWidth = 352
  let barStyle: React.CSSProperties | undefined
  if (selBox) {
    const cx = ((selBox[0] + selBox[2]) / 2) * sx
    const left = Math.max(0, Math.min(size.w - barWidth, cx - barWidth / 2))
    const top = selBox[1] * sy
    barStyle =
      top < 150
        ? { left, top: selBox[3] * sy + 12 }
        : { left, top: top - 12, transform: "translateY(-100%)" }
  }

  const common = useMemo(
    () => (item && selected.length ? commonStyle(item.styles, selected) : null),
    [item, selected]
  )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div ref={wrapRef} className="relative flex min-h-0 flex-1 overflow-auto">
        {!item ? (
          <button
            onClick={pickFiles}
            className="m-auto flex h-64 w-80 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          >
            <ImagePlus className="h-8 w-8" />
            <span className="text-sm font-medium">Fotoğraflarını buraya sürükle</span>
            <span className="text-xs">ya da tıklayıp seç</span>
          </button>
        ) : cropping && perspEdit ? (
          (() => {
            const g = item.geo ?? legacyGeo()
            const src = item.src ?? [W, H]
            return (
              <PerspEditor
                image={geoSrc?.image ?? null}
                size={geoSrc?.inner ?? ((g.rotate % 180 ? [src[1], src[0]] : src) as [number, number])}
                quad={(g.persp as Quad | null | undefined) ?? FULL_QUAD}
                onChange={(q) => setGeo({ persp: q, keystone: null, crop: null })}
              />
            )
          })()
        ) : cropping ? (
          (() => {
            const g = item.geo ?? legacyGeo()
            const inner = geoSrc?.inner ?? (item.src ? innerSize(g, item.src) : [W, H])
            return (
              <CropEditor
                image={geoSrc?.image ?? null}
                inner={inner as [number, number]}
                crop={cropOf(g, inner[0], inner[1])}
                lock={lockRatio(g, inner[0], inner[1])}
                onChange={(c) => setGeo({ crop: c })}
                onReset={() => setGeo({ crop: null })}
                lineMode={lineMode}
                onLine={(a) => {
                  setGeo({ straighten: Math.max(-45, Math.min(45, Math.round(((g.straighten || 0) - a) * 100) / 100)), crop: null })
                  endLine?.()
                }}
              />
            )
          })()
        ) : (
          <div
            ref={stageRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="relative m-auto shrink-0 select-none outline-none"
            style={{ width: size.w, height: size.h }}
          >
            <div className="absolute inset-0 overflow-hidden rounded-xl bg-card shadow-2xl ring-1 ring-border">
              {preview && preview.photo === item.id && (
                <img src={preview.image} alt="" draggable={false} className="h-full w-full object-fill" />
              )}
              {showOrig && orig.preview && orig.preview.photo === item.id && (
                <img
                  src={orig.preview.image}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-fill"
                  style={compare && !holdOrig ? { clipPath: `inset(0 ${(1 - splitX) * 100}% 0 0)` } : undefined}
                />
              )}
              {error && (
                <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-destructive">{error}</div>
              )}
            </div>

            <div
              className="absolute inset-0 touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => !dragRef.current && setHover(null)}
              style={{ cursor: nav === "zoom" ? "zoom-in" : panRef.current ? "grabbing" : space ? "grab" : dragging ? "grabbing" : hover != null ? "grab" : "default" }}
            >
              {boxes.map((b) => {
                const sel = selected.includes(b.idx)
                const hov = mode === "word" && hover === b.idx
                if (!sel && !hov) return null
                return (
                  <div
                    key={b.idx}
                    className={cn(
                      "pointer-events-none absolute rounded-md border",
                      sel ? "border-primary bg-primary/15" : "border-dashed border-primary/70"
                    )}
                    style={{
                      left: b.box[0] * sx - 4, top: b.box[1] * sy - 3,
                      width: (b.box[2] - b.box[0]) * sx + 8, height: (b.box[3] - b.box[1]) * sy + 6,
                    }}
                  />
                )
              })}
              {mode === "block" && (hover === "block" || dragging) &&
                (() => {
                  const bb = union()
                  return bb ? (
                    <div
                      className="pointer-events-none absolute rounded-lg border border-dashed border-primary/60"
                      style={{ left: bb[0] * sx - 8, top: bb[1] * sy - 8, width: (bb[2] - bb[0]) * sx + 16, height: (bb[3] - bb[1]) * sy + 16 }}
                    />
                  ) : null
                })()}
              {guides.map((g, i) => (
                <div
                  key={i}
                  className="pointer-events-none absolute bg-[#ff3d9a] shadow-[0_0_0_0.5px_rgba(255,61,154,0.35)]"
                  style={
                    g.x1 === g.x2
                      ? { left: g.x1 * sx - 0.5, top: g.y1 * sy, width: 1, height: (g.y2 - g.y1) * sy }
                      : { left: g.x1 * sx, top: g.y1 * sy - 0.5, width: (g.x2 - g.x1) * sx, height: 1 }
                  }
                />
              ))}
            </div>

            {grid && <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(to right, rgba(255,255,255,.28) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.28) 1px, transparent 1px)", backgroundSize: `${size.w / 12}px ${size.w / 12}px` }} />}
            {eraseMode && !holdOrig && maskTool && putLayer && (() => {
              const ly = (item.layers ?? []).find((l) => l.id === layerSel?.[0])
              return ly ? <LayerMaskOverlay layer={ly} mode={eraseMode} tool={maskTool} onChange={(p) => putLayer(ly.id, p)} w={size.w} h={size.h} /> : null
            })()}
            {filterEdit && !holdOrig && filterHasOverlay(filterEdit.filter) && <FilterOverlay w={size.w} h={size.h} filter={filterEdit.filter} set={filterEdit.set} liquify={filterEdit.liquify} />}
            {pick && preview?.image && <PickOverlay image={preview.image} onPick={pick} />}
            {brushMode && !holdOrig && brush && setBrush && onStroke && (brushTool === "patch" || brushTool === "camove" ? (
              <PatchOverlay w={size.w} h={size.h} tool={brushTool} mode={patchMode?.[brushTool] ?? (brushTool === "patch" ? "source" : "move")} brush={brush} onStroke={onStroke} preview={preview?.image ?? null} />
            ) : (
              <BrushOverlay w={size.w} h={size.h} tool={brushTool ?? "brush"} brush={brush} smoothing={smoothing ?? 0} setBrush={setBrush} onStroke={onStroke} preview={preview?.image ?? null} source={source} setSource={setSource} armed={armed} setArmed={setArmed} onNeedSource={onNeedSource} />
            ))}
            {pen && !holdOrig && <PenOverlay paths={item.paths ?? []} {...pen} w={size.w} h={size.h} />}
            {sliceMode && !holdOrig && setSlices && setSliceSel && (
              <SliceOverlay slices={item.slices ?? []} tool={sliceTool ?? "draw"} sel={sliceSel ?? null} setSel={setSliceSel} onChange={setSlices} w={size.w} h={size.h} />
            )}
            {designMode && !holdOrig && setLayers && setLayerSel && (
              <LayerOverlay layers={(item.layers ?? []).filter((l) => l.kind !== "adjust" && !l.locked)} sel={layerSel ?? []} setSel={setLayerSel} onChange={(next) => setLayers((item.layers ?? []).map((l) => next.find((n) => n.id === l.id) ?? l))} w={size.w} h={size.h} mode={xform ?? "move"} onDone={onXformDone} />
            )}
            {designMode && !holdOrig && boxes.length > 0 && (() => {
              const bb = union()!
              return <div title="Yazıyı taşı" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} className="absolute z-40 cursor-move rounded-sm border border-dashed border-transparent hover:border-primary/70" style={{ left: bb[0] * sx - 6, top: bb[1] * sy - 6, width: (bb[2] - bb[0]) * sx + 12, height: (bb[3] - bb[1]) * sy + 12 }} />
            })()}
            {mask && !holdOrig && (() => {
              // maskeler fotoğrafa göre; tuval genişletildiyse fotoğrafın olduğu alana yerleşir
              const [rx, ry, rw, rh] = photoRect(item.geo, item.src)
              const w = size.w * rw
              const h = size.h * rh
              return (
                <div className="absolute" style={{ left: size.w * rx, top: size.h * ry, width: w, height: h }}>
                  {mask.type === "select"
                    ? <SelectOverlay mask={mask} w={w} h={h} photo={item.id} geo={item.geo ?? null} tool={selTool} onChange={setMask} />
                    : <MaskOverlay mask={mask} w={w} h={h} show={maskShow} onChange={setMask} />}
                </div>
              )
            })()}
            {compare && !holdOrig && (
              <div className="absolute inset-y-0 z-20" style={{ left: `${splitX * 100}%` }}>
                <div className="pointer-events-none absolute inset-y-0 -left-px w-0.5 bg-white/90 shadow-[0_0_6px_rgba(0,0,0,0.6)]" />
                <div
                  onPointerDown={startSplit}
                  className="absolute top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full bg-white text-xs font-bold text-black shadow-lg"
                  title="Sürükle"
                >
                  ‹ ›
                </div>
              </div>
            )}
            {(compare || holdOrig) && (
              <>
                <span className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white">ÖNCE</span>
                {!holdOrig && (
                  <span className="pointer-events-none absolute right-2 top-2 z-20 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white">SONRA</span>
                )}
              </>
            )}
            {common && barStyle && !dragging && (
              <StyleBar common={common} count={selected.length} apply={applyStyle} onClose={() => setSelected([])} style={barStyle} />
            )}

          </div>
        )}
      </div>

      <div className="flex h-6 shrink-0 items-center gap-3 border-t bg-card px-2 text-[11px] text-muted-foreground">
        <div className="flex items-center">
          <button aria-label="Uzaklaştır" title="Uzaklaştır (Ctrl −)" disabled={!item || zoom <= 1} onClick={() => zoomTo(zoom / 1.5)} className="p-0.5 hover:text-foreground disabled:opacity-40"><ZoomOut className="h-3 w-3" /></button>
          <button className="min-w-[46px] tabular-nums hover:text-foreground disabled:opacity-50" title="Sığdır / %100 (Ctrl+0 / Ctrl+1) · Ctrl+tekerlek: yakınlaştır · Boşluk+sürükle: gez" disabled={!item} onClick={() => zoomTo(zoom > 1 ? 1 : zoom100)}>{Math.round((zoom * fit.w * 100) / W)}%</button>
          <button aria-label="Yakınlaştır" title="Yakınlaştır (Ctrl +)" disabled={!item || zoom >= maxZoom} onClick={() => zoomTo(zoom * 1.5)} className="p-0.5 hover:text-foreground disabled:opacity-40"><ZoomIn className="h-3 w-3" /></button>
        </div>
        {item && <span className="tabular-nums">{W} × {H} px</span>}
        {layerName && <span className="truncate">Katman: {layerName}</span>}
        <span className="flex-1" />
        {(busy || (showOrig && orig.busy)) && <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> güncelleniyor</span>}
        {textTab && <button disabled={!item} onClick={resetPosition} title="Yazının konumunu sıfırla" className="flex items-center gap-1 hover:text-foreground"><RotateCcw className="h-3 w-3" /> Yazıyı Ortala</button>}
        <button disabled={!item} onClick={() => setCompare((c) => !c)} title="Önce/sonra: ortadaki çizgiyi sürükle" className={cn("flex items-center gap-1 hover:text-foreground disabled:opacity-50", compare && "text-primary")}><Columns2 className="h-3 w-3" /> Karşılaştır</button>
        <button disabled={!item} className="flex select-none items-center gap-1 hover:text-foreground disabled:opacity-50" title="Basılı tut: düzenlenmemiş hali (klavyede Ö)" onPointerDown={() => setHoldOrig(true)} onPointerUp={() => setHoldOrig(false)} onPointerLeave={() => setHoldOrig(false)}><Eye className="h-3 w-3" /> Önce</button>
      </div>
    </div>
  )
}

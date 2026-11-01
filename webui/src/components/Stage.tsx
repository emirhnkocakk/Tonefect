import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Columns2, Eye, ImagePlus, Loader2, Move, RotateCcw, Type, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { StyleBar } from "@/components/StyleBar"
import { CropEditor } from "@/components/CropEditor"
import { MaskOverlay } from "@/components/MaskOverlay"
import { canvasScale, canvasSize, cropOf, innerSize, legacyGeo, lockRatio } from "@/lib/geo"
import { useFit, usePreview } from "@/lib/hooks"
import { commonStyle, words } from "@/lib/text"
import { cn } from "@/lib/utils"
import type { Config, Geo, Item, Mask, Mode, Style, Watermark } from "@/types"

type Props = {
  item?: Item
  cfg: Config
  mode: Mode
  setMode: (m: Mode) => void
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
  setGeo: (p: Partial<Geo>) => void
  localMode: boolean // Yerel sekmesi: yazı etkileşimi kapalı, maske tutamaçları açık
  mask?: Mask
  maskShow: boolean
  setMask: (p: Partial<Mask>) => void
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

export function Stage({ item, cfg, mode, setMode, selected, setSelected, update, applyStyle, resetPosition, pickFiles, guides: guidesOn, wm, cropping, geoSrc, setGeo, localMode, mask, maskShow, setMask }: Props) {
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

  // önce/sonra: basılı tutunca ya da bölünmüş görünümde düzenlenmemiş hali
  const [compare, setCompare] = useState(false)
  const [holdOrig, setHoldOrig] = useState(false)
  const [splitX, setSplitX] = useState(0.5)
  const showOrig = !cropping && (holdOrig || compare)
  const orig = usePreview(showOrig ? item : undefined, pw, null, true)
  const [space, setSpace] = useState(false)
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

  const wordCount = item ? words(item.text).length : 0
  const common = useMemo(
    () => (item && selected.length ? commonStyle(item.styles, selected) : null),
    [item, selected]
  )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {cropping && item ? (
        <div className="flex h-[52px] items-center justify-between gap-3 px-5 pb-1 pt-4">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground">KIRP</span>
          <span className="truncate text-xs text-muted-foreground">
            Çerçeveyi sürükle · Köşelerden boyutlandır · Çift tık: sıfırla · Bitince başka bir sekmeye geç
          </span>
        </div>
      ) : (
      <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground">ÖNİZLEME</span>
          <ToggleGroup
            type="single"
            size="sm"
            value={mode}
            onValueChange={(v) => v && setMode(v as Mode)}
            className="rounded-lg bg-muted p-0.5"
          >
            <ToggleGroupItem value="block" className="h-7 gap-1.5 whitespace-nowrap text-xs">
              <Move className="h-3.5 w-3.5" /> Tüm metin
            </ToggleGroupItem>
            <ToggleGroupItem value="word" className="h-7 gap-1.5 whitespace-nowrap text-xs">
              <Type className="h-3.5 w-3.5" /> Tek kelime
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <Button variant="ghost" size="icon-sm" className="h-7 w-7" aria-label="Uzaklaştır" title="Uzaklaştır (Ctrl −)" disabled={!item || zoom <= 1} onClick={() => zoomTo(zoom / 1.5)}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <button
              className="min-w-[52px] px-1 text-xs tabular-nums text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Sığdır / %100 (Ctrl+0 / Ctrl+1) · Ctrl+tekerlek: yakınlaştır · Boşluk+sürükle: gez"
              disabled={!item}
              onClick={() => zoomTo(zoom > 1 ? 1 : zoom100)}
            >
              {zoom === 1 ? "Sığdır" : `${Math.round((zoom * fit.w * 100) / W)}%`}
            </button>
            <Button variant="ghost" size="icon-sm" className="h-7 w-7" aria-label="Yakınlaştır" title="Yakınlaştır (Ctrl +)" disabled={!item || zoom >= maxZoom} onClick={() => zoomTo(zoom * 1.5)}>
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button
            variant={compare ? "secondary" : "ghost"}
            size="sm"
            disabled={!item}
            onClick={() => setCompare((c) => !c)}
            className={cn("h-8 text-xs", compare && "text-primary")}
            title="Önce/sonra: ortadaki çizgiyi sürükle"
          >
            <Columns2 className="!size-3.5" /> Karşılaştır
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!item}
            className="h-8 select-none text-xs"
            title="Basılı tut: düzenlenmemiş hali (klavyede Ö ya da \)"
            onPointerDown={() => setHoldOrig(true)}
            onPointerUp={() => setHoldOrig(false)}
            onPointerLeave={() => setHoldOrig(false)}
          >
            <Eye className="!size-3.5" /> Önce
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={resetPosition} disabled={!item} aria-label="Konumu sıfırla" title="Yazının konumunu sıfırla">
            <RotateCcw className="!size-3.5" />
          </Button>
        </div>
      </div>
      )}

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
              style={{ cursor: panRef.current ? "grabbing" : space ? "grab" : dragging ? "grabbing" : hover != null ? "grab" : "default" }}
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

            {mask && !holdOrig && <MaskOverlay mask={mask} w={size.w} h={size.h} show={maskShow} onChange={setMask} />}
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
            {(busy || (showOrig && orig.busy)) && !compare && !holdOrig && (
              <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur">
                <Loader2 className="h-3 w-3 animate-spin" /> güncelleniyor
              </div>
            )}

            {common && barStyle && !dragging && (
              <StyleBar common={common} count={selected.length} apply={applyStyle} onClose={() => setSelected([])} style={barStyle} />
            )}

            {wordCount === 0 && !busy && (
              <div className="pointer-events-none absolute inset-x-0 bottom-[14%] text-center text-xs text-white/50">
                Sağdan bir cümle yaz
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

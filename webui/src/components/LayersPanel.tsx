import { useEffect, useRef, useState } from "react"
import { ArrowDownToLine, ArrowUpToLine, Bandage, ChevronDown, ChevronRight, ChevronUp, GripVertical, Contrast, ImagePlus, Link2, Lock, Paintbrush, Aperture, CircleDashed, Scissors, Copyright, Crop, Droplet, Eye, EyeOff, Film, Folder, FolderPlus, Frame, Image, Layers, PaintBucket, Palette, Plus, Search, Shapes, SlidersHorizontal, Sparkle, Sparkles, SquareDashed, Sun, Trash2, Type, Wind, X } from "lucide-react"
import { thumbUrl } from "@/lib/api"
import { BASE_ID, buildLayers, stackIds, TEXT_ID, type Layer, type LayerKind } from "@/lib/layers"
import { BLEND_GROUPS, labelColor } from "@/lib/layerops"
import { cn } from "@/lib/utils"
import type { ImgLayer, Item, PresetMeta, Watermark } from "@/types"

type Props = {
  item?: Item
  presets: PresetMeta[]
  wm: Watermark | null
  tool: string
  maskSel: string | null
  sel: string[]
  open: (layer: Layer, additive: boolean) => void
  toggle: (layer: Layer) => void
  remove: (layer: Layer) => void
  run: (cmd: string) => void
  put: (id: string, p: Partial<ImgLayer>) => void
  reorder: (moving: string[], above: string, group?: string | null) => void
  toggleGroup: (id: string) => void
  renameGroup: (id: string, name: string) => void
  renaming: string | null
  setRenaming: (id: string | null) => void
  filterOpen: boolean
  setFilterOpen: (v: boolean) => void
}

const ICON: Record<LayerKind, typeof Eye> = {
  watermark: Copyright, text: Type, image: ImagePlus, paint: Paintbrush, frame: Frame, background: Scissors, retouch: Bandage, colorfx: Palette, filters: Sparkle, leak: Sun, bloom: Sparkle, dust: Wind, vignette: Aperture,
  grain: Film, mask: CircleDashed, detail: Droplet, adjust: SlidersHorizontal, look: Palette, geo: Crop, photo: Image, group: Folder,
}
const TYPE_ICON: Record<string, typeof Eye> = { blank: Layers, text: Type, shape: Shapes, fill: PaintBucket, adjust: Contrast }
const FILTERS: [string, string][] = [["all", "Tümü"], ["pixel", "Görsel"], ["text", "Metin"], ["shape", "Şekil"], ["adjust", "Ayar"], ["fx", "Efekt"]]
const NEW: [string, string, typeof Eye][] = [["blank", "Boş Katman", Layers], ["image", "Görsel", ImagePlus], ["text", "Metin", Type], ["shape", "Şekil", Shapes], ["fill", "Dolgu", PaintBucket], ["adjust", "Ayar", Contrast]]

function passes(l: Layer, kind: string, q: string) {
  if (q && !l.label.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR"))) return false
  if (kind === "all") return true
  const t = l.layer?.kind
  if (kind === "pixel") return l.kind === "photo" || (l.kind === "image" && (!t || t === "blank" || t === "fill"))
  if (kind === "text") return l.kind === "text" || t === "text"
  if (kind === "shape") return t === "shape"
  if (kind === "adjust") return t === "adjust" || l.kind === "adjust" || l.kind === "colorfx"
  return l.kind !== "image" && l.kind !== "group" && l.kind !== "photo"
}

/** Sağdaki "Katmanlar": üstteki önde görünür; gruplar, kilit, bağ, süzgeç ve hızlı işlemler. */
export function LayersPanel({ item, presets, wm, tool, maskSel, sel, open, toggle, remove, run, put, reorder, toggleGroup, renameGroup, renaming, setRenaming, filterOpen, setFilterOpen }: Props) {
  const all = item ? buildLayers(item, presets, wm) : []
  const hidden = new Set(item?.hidden ?? [])
  const [kind, setKind] = useState("all")
  const [q, setQ] = useState("")
  const [menu, setMenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (filterOpen) inputRef.current?.focus()
  }, [filterOpen])
  const filtering = filterOpen && (kind !== "all" || !!q)
  const rows = filtering ? all.filter((l) => passes(l, kind, q)) : all
  const cur = sel.length === 1 ? item?.layers?.find((l) => l.id === sel[0]) ?? null : null
  const picked_ = (item?.layers ?? []).filter((l) => sel.includes(l.id))
  const allLocked = picked_.length > 0 && picked_.every((l) => l.locked)
  const anyLinked = picked_.some((l) => l.link)

  // Sürükleyerek sıralama: üstteki katman önde görünür
  const listRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ row: Layer; y0: number; active: boolean; id: number } | null>(null)
  const [drop, setDrop] = useState<{ gap: number; top: number; into?: string } | null>(null)
  const canDrag = (l: Layer) => !filtering && (l.kind === "text" || l.kind === "group" || (l.kind === "image" && !l.layer?.locked))
  const placeOf = (y: number): { gap: number; top: number; into?: string } | null => {
    const list = listRef.current
    if (!list) return null
    const els = [...list.querySelectorAll<HTMLElement>("[data-row]")]
    const first = rows.findIndex((r) => r.kind !== "watermark")
    const photo = rows.findIndex((r) => r.kind === "photo")
    if (first < 0 || photo < 0) return null
    const base = list.getBoundingClientRect().top - list.scrollTop
    let gap = photo
    let into: string | undefined
    for (let i = first; i <= photo; i++) {
      const r = els[i].getBoundingClientRect()
      if (rows[i].kind === "group" && dragRef.current?.row.kind !== "group" && dragRef.current?.row.kind !== "text" && y > r.top + r.height * 0.25 && y < r.bottom - r.height * 0.25) {
        gap = i
        into = rows[i].groupId
        break
      }
      if (y < r.top + r.height / 2) {
        gap = i
        break
      }
    }
    return { gap, top: els[gap].getBoundingClientRect().top - base - 1, into }
  }
  const finishDrag = (place: { gap: number; into?: string }, row: Layer) => {
    const members = (g?: string) => (item?.layers ?? []).filter((l) => l.group === g)
    const topOf = (g?: string) => members(g).slice(-1)[0]?.id ?? BASE_ID
    const moving = row.kind === "group" ? members(row.groupId).map((l) => l.id) : row.kind === "text" ? [TEXT_ID] : sel.includes(row.layerId!) ? sel.filter((x) => x !== BASE_ID) : [row.layerId!]
    const below = rows[place.gap]
    const above = rows[place.gap - 1]
    const groupAbove = above?.kind === "group" ? above.groupId : above?.layer?.group
    const inside = !!groupAbove && groupAbove === below.layer?.group
    const target = place.into || (below.kind === "group" ? topOf(below.groupId) : inside && row.kind === "group" ? topOf(groupAbove) : below.kind === "photo" ? BASE_ID : below.kind === "text" ? TEXT_ID : below.layerId!)
    reorder(moving, target, row.kind === "image" ? (place.into ?? (inside ? groupAbove! : null)) : undefined)
  }
  // Canva'daki Öne Getir / Arkaya Gönder: satırdaki oklar ve sağ tık menüsü
  const [ctx, setCtx] = useState<{ x: number; y: number; row: Layer } | null>(null)
  const stack = item ? stackIds(item) : []
  const groupOf = (id: string) => item?.layers?.find((l) => l.id === id)?.group
  const groupTop = (g: string) => (item?.layers ?? []).filter((l) => l.group === g).slice(-1)[0]?.id ?? BASE_ID
  const movingOf = (l: Layer) => l.kind === "group" ? (item?.layers ?? []).filter((x) => x.group === l.groupId).map((x) => x.id) : l.kind === "text" ? [TEXT_ID] : sel.length > 1 && sel.includes(l.layerId!) ? sel.filter((x) => x !== BASE_ID) : [l.layerId!]
  const span = (m: string[]) => [Math.min(...m.map((i) => stack.indexOf(i))), Math.max(...m.map((i) => stack.indexOf(i)))]
  const canStep = (l: Layer, up: boolean) => {
    const [lo, hi] = span(movingOf(l))
    return up ? hi < stack.length - 1 || (l.kind === "image" && !!l.layer?.group) : lo > 1 || (l.kind === "image" && !!l.layer?.group)
  }
  const step = (l: Layer, up: boolean) => {
    const m = movingOf(l)
    const [lo, hi] = span(m)
    const own = l.kind === "image" ? l.layer?.group : undefined
    const self = l.kind === "group" ? l.groupId : own
    const next = up ? stack[hi + 1] : stack[lo - 1]
    const nextGroup = next && next !== TEXT_ID ? groupOf(next) : undefined
    if (own && nextGroup !== own) return reorder(m, stack[lo - 1], null) // grubun kenarında: önce gruptan çıkar
    if (up) {
      if (!next) return
      return reorder(m, nextGroup && nextGroup !== self ? groupTop(nextGroup) : next)
    }
    if (!next || next === BASE_ID) return
    if (nextGroup && nextGroup !== self) return reorder(m, stack[stack.findIndex((id) => id !== TEXT_ID && groupOf(id) === nextGroup) - 1])
    reorder(m, stack[lo - 2])
  }
  const toEnd = (l: Layer, top: boolean) => {
    const m = movingOf(l)
    const target = top ? stack[stack.length - 1] : BASE_ID
    reorder(m, target, l.kind === "image" ? null : undefined)
  }
  const rowDown = (l: Layer) => (e: React.PointerEvent) => {
    if (e.button === 0 && canDrag(l)) dragRef.current = { row: l, y0: e.clientY, active: false, id: e.pointerId }
  }
  const listMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    if (!d.active) {
      if (Math.abs(e.clientY - d.y0) < 5) return
      d.active = true
      listRef.current?.setPointerCapture(d.id)
    }
    setDrop(placeOf(e.clientY))
  }
  const listUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.active && drop) finishDrag(drop, d.row)
    setDrop(null)
  }

  const tb = (label: string, cmd: string, I: typeof Eye, disabled = false, on = false) => (
    <button key={cmd} aria-label={label} title={label} disabled={disabled} onClick={() => run(cmd)} className={cn("grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-35", on ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
      <I className="h-3.5 w-3.5" strokeWidth={1.8} />
    </button>
  )

  return (
    <aside className="flex h-full min-h-0 w-full flex-col">
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-xs font-semibold tracking-wider text-muted-foreground">KATMANLAR</span>
        <button aria-label="Katmanları süz" title="Katman Filtreleme (Layer Filtering)" onClick={() => setFilterOpen(!filterOpen)} className={cn("rounded p-0.5 hover:text-foreground", filterOpen ? "text-primary" : "text-muted-foreground")}><Search className="h-3.5 w-3.5" /></button>
      </div>
      {!item ? (
        <p className="px-4 pt-4 text-sm text-muted-foreground">Bir fotoğraf açınca katmanlar burada görünür. Üstteki katman önde durur, sürükleyerek sırasını değiştirebilirsin.</p>
      ) : (
        <>
          {filterOpen && (
            <div className="space-y-1.5 px-3 pb-2">
              <div className="relative">
                <input ref={inputRef} aria-label="Katman ara" value={q} placeholder="Katman ara" onChange={(e) => setQ(e.target.value)} className="h-7 w-full rounded-md border bg-background px-2 pr-6 text-xs" />
                {q && <button aria-label="Aramayı temizle" className="absolute right-1.5 top-1.5 text-muted-foreground" onClick={() => setQ("")}><X className="h-3.5 w-3.5" /></button>}
              </div>
              <div className="flex flex-wrap gap-1">
                {FILTERS.map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={cn("rounded-full border px-1.5 py-px text-[10px] transition-colors", kind === k ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>{l}</button>)}
              </div>
            </div>
          )}
          {cur && (
            <div className="space-y-1.5 border-y px-3 py-2">
              <div className="flex items-center gap-1.5">
                <select aria-label="Karışım kipi" className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1 text-[11px]" value={cur.mode ?? "normal"} onChange={(e) => put(cur.id, { mode: e.target.value })}>
                  {BLEND_GROUPS.map(([g, m]) => <optgroup key={g} label={g || "Temel"}>{m.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}
                </select>
                <label className="flex items-center gap-0.5 text-[10px] text-muted-foreground" title="Opaklık">
                  Op
                  <input aria-label="Opaklık" type="number" min={0} max={100} className="h-7 w-11 rounded-md border bg-background px-1 text-center text-[11px] text-foreground" value={Math.round(cur.opacity * 100)} onChange={(e) => put(cur.id, { opacity: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })} />
                </label>
                {cur.kind !== "adjust" && (
                  <label className="flex items-center gap-0.5 text-[10px] text-muted-foreground" title="Dolgu Opaklığı">
                    Dl
                    <input aria-label="Dolgu opaklığı" type="number" min={0} max={100} className="h-7 w-11 rounded-md border bg-background px-1 text-center text-[11px] text-foreground" value={Math.round((cur.fill ?? 1) * 100)} onChange={(e) => put(cur.id, { fill: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 })} />
                  </label>
                )}
              </div>
            </div>
          )}
          <div ref={listRef} onPointerMove={listMove} onPointerUp={listUp} onPointerCancel={listUp} className="relative min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
            {drop && !drop.into && <div className="pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded bg-primary" style={{ top: drop.top }} />}
            {rows.map((l, rowIndex) => {
              const ly = l.layer
              const Icon = (ly?.kind && TYPE_ICON[ly.kind]) || ICON[l.kind]
              const off = hidden.has(l.key)
              const picked = !!l.layerId && sel.includes(l.layerId)
              const active = picked || (l.kind === "mask" ? tool === l.tool && maskSel === l.maskId : !l.layerId && l.tool === tool && l.kind !== "photo" && l.kind !== "group")
              const color = labelColor(ly?.label)
              const editing = renaming && (renaming === l.layerId || renaming === l.groupId)
              return (
                <div
                  key={l.key}
                  data-row={rowIndex}
                  onPointerDown={rowDown(l)}
                  onContextMenu={(e) => {
                    if (!canDrag(l)) return
                    e.preventDefault()
                    setCtx({ x: e.clientX, y: e.clientY, row: l })
                  }}
                  onClick={(e) => (l.kind === "group" ? toggleGroup(l.groupId!) : open(l, e.ctrlKey || e.metaKey || e.shiftKey))}
                  onDoubleClick={() => (l.layerId || l.groupId) && setRenaming(l.layerId ?? l.groupId!)}
                  style={l.depth ? { marginLeft: 14 } : undefined}
                  className={cn(
                    "group relative flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
                    active ? "border-primary/60 bg-primary/10" : "border-transparent hover:bg-accent/70",
                    canDrag(l) && "active:cursor-grabbing",
                    drop?.into && drop.into === l.groupId && "border-primary",
                    l.kind === "photo" && "mt-2 border-dashed border-border"
                  )}
                >
                  {color && <span className="absolute inset-y-1 left-0.5 w-0.5 rounded" style={{ background: color }} />}
                  {canDrag(l) && <GripVertical className="-mx-1 h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden />}
                  {l.kind === "group" && (l.open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />)}
                  <div className={cn("grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-muted", off && "opacity-40")}>
                    {ly?.photo ? <img src={thumbUrl(ly.photo)} alt="" className="h-full w-full object-cover" draggable={false} /> : <Icon className="h-4 w-4" />}
                  </div>
                  <div className={cn("min-w-0 flex-1", off && "opacity-50")}>
                    {editing ? (
                      <input
                        autoFocus
                        aria-label="Katman adı"
                        defaultValue={l.label}
                        className="h-5 w-full rounded border bg-background px-1 text-xs"
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          if (l.layerId) put(l.layerId, { name: e.target.value })
                          else renameGroup(l.groupId!, e.target.value)
                          setRenaming(null)
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                    ) : (
                      <p className="truncate text-xs font-medium">{l.label}</p>
                    )}
                    {l.sub && <p className="truncate text-[10px] text-muted-foreground">{l.sub}</p>}
                  </div>
                  {ly?.link && <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Bağlı" />}
                  {ly?.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Kilitli" />}
                  {canDrag(l) && (
                    <span className="hidden shrink-0 flex-col group-hover:flex">
                      <button aria-label={`${l.label} bir üste`} title="Bir Üste" disabled={!canStep(l, true)} onClick={(e) => { e.stopPropagation(); step(l, true) }} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronUp className="h-3 w-3" /></button>
                      <button aria-label={`${l.label} bir alta`} title="Bir Alta" disabled={!canStep(l, false)} onClick={(e) => { e.stopPropagation(); step(l, false) }} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ChevronDown className="h-3 w-3" /></button>
                    </span>
                  )}
                  {l.removable && !ly?.locked && (
                    <button
                      aria-label={`${l.label} katmanını kaldır`}
                      title={l.global ? "Filigranı kapat (tüm fotoğraflar)" : "Kaldır"}
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(l)
                      }}
                      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {l.hideable && (
                    <button
                      aria-label={off ? "Göster" : "Gizle"}
                      title={off ? "Göster" : "Gizle (dışa aktarmaya da dahil olmaz)"}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggle(l)
                      }}
                      className={cn("rounded p-1 transition-colors", off ? "text-muted-foreground" : "text-foreground/80 hover:text-primary")}
                    >
                      {off ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              )
            })}
            {filtering && !rows.length && <p className="px-2 pt-3 text-[11px] text-muted-foreground">Bu süzgece uyan katman yok.</p>}
          </div>
          <div className="relative flex items-center justify-between border-t px-2 py-1">
            {tb(anyLinked ? "Bağı Kaldır" : "Katmanları Bağla", "layer:link", Link2, sel.length < 2 && !anyLinked, anyLinked)}
            {tb("Katman Stilleri", "layer:styles", Sparkles)}
            {tb("Katman Maskesi", "erase:layermask", SquareDashed)}
            {tb("Ayar Katmanı", "layer:new:adjust", Contrast)}
            {tb("Grupla", "layer:group", FolderPlus)}
            {tb(allLocked ? "Kilidi Aç" : "Kilitle", allLocked ? "layer:unlock" : "layer:lock", Lock, false, allLocked)}
            <button aria-label="Yeni Katman" title="Yeni Katman" onClick={() => setMenu(!menu)} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Plus className="h-3.5 w-3.5" /></button>
            {tb("Katmanı Sil", "layer:del", Trash2)}
            {menu && (
              <div className="absolute bottom-full right-2 z-40 mb-1 w-36 rounded-lg border bg-popover p-1 text-xs shadow-xl" role="menu">
                {NEW.map(([k, l, I]) => (
                  <button key={k} role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent" onClick={() => { setMenu(false); run(k === "image" ? "addImage" : `layer:new:${k}`) }}>
                    <I className="h-3.5 w-3.5 text-muted-foreground" /> {l}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {ctx && (
        <div className="fixed inset-0 z-50" onPointerDown={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null) }}>
          <div role="menu" className="fixed w-44 rounded-md border bg-popover p-1 text-xs shadow-xl" style={{ left: Math.min(ctx.x, window.innerWidth - 184), top: Math.min(ctx.y, window.innerHeight - 124) }} onPointerDown={(e) => e.stopPropagation()}>
            {([["En Üste Getir", ArrowUpToLine, () => toEnd(ctx.row, true)], ["Bir Üste", ChevronUp, () => step(ctx.row, true)], ["Bir Alta", ChevronDown, () => step(ctx.row, false)], ["En Alta Gönder", ArrowDownToLine, () => toEnd(ctx.row, false)]] as const).map(([label, I, run_]) => (
              <button key={label} role="menuitem" className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-accent" onClick={() => { run_(); setCtx(null) }}><I className="h-3.5 w-3.5 text-muted-foreground" /> {label}</button>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

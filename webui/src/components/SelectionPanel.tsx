import { useState } from "react"
import { Copy, FolderOpen, Loader2, Move, Plus, RotateCcw, Save, Sparkles, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { AiSetup, useAi } from "@/components/AiSetup"
import { MAX_MASKS, MaskAdjustSliders } from "@/components/MaskPanel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { photoSize } from "@/lib/geo"
import { useIntent } from "@/lib/hooks"
import { SELECT_TOOLS, selectEntry } from "@/lib/selection"
import { cn } from "@/lib/utils"
import type { Item, Mask, SavedSelection, SelectCombo, SelectOp, SelectTool } from "@/types"

type Props = {
  item: Item
  selected: string | null
  select: (id: string | null) => void
  setMasks: (m: Mask[]) => void
  tool: SelectTool
  setTool: (t: SelectTool) => void
  toLayer: (cut: boolean) => Promise<void>
  patchItem: (p: Partial<Item>) => void
  intent?: { cmd: string; n: number } | null
}

const COMBOS: [SelectCombo, string][] = [
  ["add", "Ekle"],
  ["sub", "Çıkar"],
  ["intersect", "Kesiştir"],
]
const DRAW_TOOLS = SELECT_TOOLS.filter((t) => t.draw)
const AUTO_IDS = ["subject", "background", "sky", "focus"]
const MODIFY_IDS = ["expand", "contract", "feather", "smooth", "border", "invert", "grow", "similar"]
const newId = () => Math.random().toString(36).slice(2, 9)
const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60)

function Value({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>
      {children}
    </div>
  )
}

/** Selection Tool: seçim araçları, otomatik seçimler, seçimi düzenleme, kaydetme ve seçilen bölgenin ayarları. */
export function SelectionPanel({ item, selected, select, setMasks, tool, setTool, toLayer, patchItem, intent }: Props) {
  const masks = item.fx.masks ?? []
  const selMasks = masks.filter((m) => m.type === "select")
  const cur = selMasks.find((m) => m.id === selected) ?? null
  const target = cur ?? selMasks[selMasks.length - 1] ?? null
  const ai = useAi()
  const [needAi, setNeedAi] = useState(false)
  const [moving, setMoving] = useState(false)
  const [saveName, setSaveName] = useState("")
  const saved = item.selections ?? []
  const short = Math.min(...(photoSize(item.geo, item.src) ?? [1080, 1350]))

  const patch = (m: Mask, p: Partial<Mask>) => setMasks(masks.map((x) => (x.id === m.id ? { ...x, ...p } : x)))
  const create = (ops: SelectOp[] = []): Mask | null => {
    if (masks.length >= MAX_MASKS) {
      toast.error(`En fazla ${MAX_MASKS} seçim ve yerel düzenleme olabilir`)
      return null
    }
    const m: Mask = { id: newId(), type: "select", ops, feather: 0, invert: false, adjust: {} }
    setMasks([...masks, m])
    select(m.id)
    return m
  }
  const ensure = () => {
    if (target) select(target.id)
    else create()
  }
  const pushOp = (op: SelectOp) => {
    if (!target) return void create([op])
    select(target.id)
    patch(target, { ops: [...(target.ops ?? []), op] })
  }
  const needSelection = () => {
    if (target?.ops?.length) return false
    toast("Önce bir alan seç")
    return true
  }
  const amt = tool.amt / short

  const run = (id: string) => {
    const e = selectEntry(id)
    if (!e) return
    if (e.draw) {
      setTool({ ...tool, mode: e.draw })
      return ensure()
    }
    switch (id) {
      case "subject":
      case "background":
        if (!ai.ready) return setNeedAi(true)
        return pushOp({ kind: "subject", add: true, inverse: id === "background" })
      case "sky":
        return pushOp({ kind: "sky", add: true })
      case "focus":
        return pushOp({ kind: "focus", amt: tool.focus, add: true })
      case "invert":
        if (target?.invert) return patch(target, { invert: false }) // eski sürümlerde açılan ters çevirme anahtarı
        return pushOp({ kind: "invert" })
      case "expand":
      case "contract":
      case "feather":
      case "smooth":
      case "border":
        if (!needSelection()) pushOp({ kind: id, amt })
        return
      case "grow":
      case "similar":
        if (!needSelection()) pushOp({ kind: id, tol: tool.tol })
        return
      case "refine":
        ensure()
        return void scrollTo("sec-refine")
      case "save":
        return saveSelection()
      case "load":
        ensure()
        return void scrollTo("sec-saved")
    }
  }
  useIntent(intent, "sel:", (cmd) => run(cmd.slice(4)))

  const saveSelection = () => {
    if (needSelection() || !target) return
    if (saved.length >= 20) return void toast.error("En fazla 20 seçim kaydedilebilir")
    const n = saveName.trim().slice(0, 40) || `Kayıtlı Seçim ${saved.length + 1}`
    patchItem({ selections: [...saved, { id: newId(), name: n, ops: target.ops ?? [], feather: target.feather ?? 0, refine: target.refine }] })
    setSaveName("")
    toast.success("Seçim kaydedildi")
    scrollTo("sec-saved")
  }
  const load = (s: SavedSelection, append: boolean) => {
    if (!target) return void create(s.ops)
    select(target.id)
    patch(target, append ? { ops: [...(target.ops ?? []), ...s.ops] } : { ops: s.ops, feather: s.feather, refine: s.refine })
  }

  const last = target?.ops?.[target.ops.length - 1]
  const entry = DRAW_TOOLS.find((t) => t.draw === tool.mode)
  const setFocus = (v: number) => {
    setTool({ ...tool, focus: v })
    if (target && last?.kind === "focus") patch(target, { ops: [...target.ops!.slice(0, -1), { ...last, amt: v }] })
  }
  const refine = target?.refine ?? {}
  const setRefine = (p: Partial<NonNullable<Mask["refine"]>>) => target && patch(target, { refine: { ...refine, ...p } })
  const runLayer = (cut: boolean) => {
    setMoving(true)
    toLayer(cut).finally(() => setMoving(false))
  }

  const small = "rounded-md border px-1 py-1.5 text-[11px] leading-tight transition-colors hover:border-primary/60 text-muted-foreground disabled:pointer-events-none disabled:opacity-40"
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        {selMasks.map((m, i) => (
          <div
            key={m.id}
            onClick={() => select(m.id)}
            className={cn(
              "group flex cursor-pointer items-center justify-between rounded-lg border px-3 py-1.5 text-xs transition-colors hover:border-primary/60",
              m.id === target?.id ? "border-primary/70 bg-primary/15" : "text-muted-foreground"
            )}
          >
            <span>Seçim {i + 1}{m.ops?.length ? ` · ${m.ops.length} adım` : " · boş"}</span>
            <button
              aria-label="Sil"
              onClick={(e) => {
                e.stopPropagation()
                setMasks(masks.filter((x) => x.id !== m.id))
                if (m.id === selected) select(null)
              }}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <Button variant="secondary" size="sm" className="w-full text-xs" onClick={() => create()}>
          <Plus className="!size-3.5" /> Yeni Seçim
        </Button>
      </div>

      <section id="sec-tools" className="space-y-2">
        <Label>Araçlar</Label>
        <div className="grid grid-cols-6 gap-1">
          {DRAW_TOOLS.map((t) => {
            const I = t.icon
            return (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <button
                    aria-label={t.label}
                    onClick={() => run(t.id)}
                    className={cn(
                      "grid h-9 place-items-center rounded-md border transition-colors hover:border-primary/60",
                      tool.mode === t.draw ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <I className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t.label} ({t.en}){t.key ? ` · ${t.key}` : ""}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        {entry && (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{entry.label}</span> · {entry.hint}
          </p>
        )}
        <div className="grid grid-cols-3 gap-1">
          {COMBOS.map(([c, l]) => (
            <button key={c} onClick={() => setTool({ ...tool, combine: c })} className={cn(small, tool.combine === c && "border-primary/70 bg-primary/15 text-foreground")}>
              {l}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">Kısayol: Shift ekler · Alt çıkarır · Shift+Alt kesiştirir</p>
        <Value label="Tolerans" value={String(Math.round(tool.tol * 100))}>
          <Slider min={1} max={100} step={1} value={[Math.round(tool.tol * 100)]} onValueChange={([v]) => setTool({ ...tool, tol: v / 100 })} />
        </Value>
        {tool.mode === "wand" && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Yalnızca Bitişik Alan</span>
            <Switch checked={tool.contiguous} onCheckedChange={(v) => setTool({ ...tool, contiguous: v })} />
          </div>
        )}
        {["brush", "erase", "quick"].includes(tool.mode) && (
          <Value label="Fırça Boyutu" value={String(Math.round(tool.size * 100))}>
            <Slider min={1} max={30} step={1} value={[Math.round(tool.size * 100)]} onValueChange={([v]) => setTool({ ...tool, size: v / 100 })} />
          </Value>
        )}
        {["brush", "erase"].includes(tool.mode) && (
          <Value label="Sertlik" value={`${Math.round(tool.hard * 100)}%`}>
            <Slider min={0} max={100} step={1} value={[Math.round(tool.hard * 100)]} onValueChange={([v]) => setTool({ ...tool, hard: v / 100 })} />
          </Value>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" size="sm" className="text-xs" disabled={!target?.ops?.length} onClick={() => target && patch(target, { ops: target.ops!.slice(0, -1) })}>
            <Undo2 className="!size-3.5" /> Son Adım
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" disabled={!target?.ops?.length} onClick={() => target && patch(target, { ops: [], invert: false })}>
            <RotateCcw className="!size-3.5" /> Temizle
          </Button>
        </div>
      </section>

      <section id="sec-auto" className="space-y-2">
        <Label>Otomatik Seçim</Label>
        {needAi && !ai.ready && <AiSetup what="Konuyu ya da arka planı tek tıkla seçmek" />}
        <div className="grid grid-cols-2 gap-1">
          {AUTO_IDS.map((id) => {
            const t = selectEntry(id)!
            const I = t.icon
            return (
              <Button key={id} variant="secondary" size="sm" className="justify-start text-xs" title={t.en} onClick={() => run(id)}>
                <I className="!size-3.5" /> {t.label}
              </Button>
            )
          })}
        </div>
        {last?.kind === "focus" && (
          <Value label="Odak Aralığı" value={`${Math.round(tool.focus * 100)}%`}>
            <Slider min={0} max={100} step={1} value={[Math.round(tool.focus * 100)]} onValueChange={([v]) => setFocus(v / 100)} />
          </Value>
        )}
      </section>

      <section id="sec-modify" className="space-y-2">
        <Label>Seçimi Düzenle</Label>
        <Value label="Miktar" value={`${tool.amt} px`}>
          <Slider min={1} max={150} step={1} value={[tool.amt]} onValueChange={([v]) => setTool({ ...tool, amt: v })} />
        </Value>
        <div className="grid grid-cols-2 gap-1">
          {MODIFY_IDS.map((id) => {
            const t = selectEntry(id)!
            const I = t.icon
            return (
              <Button key={id} variant="secondary" size="sm" className="justify-start text-xs" title={t.en} onClick={() => run(id)}>
                <I className="!size-3.5" /> {t.label}
              </Button>
            )
          })}
        </div>
      </section>

      <section id="sec-refine" className="space-y-3 rounded-lg border p-3">
        <Label>Seç ve Maskele</Label>
        <Value label="Kenar İyileştir" value={`${Math.round((refine.edge ?? 0) * 100)}%`}>
          <Slider disabled={!target} min={0} max={100} step={1} value={[Math.round((refine.edge ?? 0) * 100)]} onValueChange={([v]) => setRefine({ edge: v / 100 })} />
        </Value>
        <Value label="Pürüzsüz" value={`${Math.round((refine.smooth ?? 0) * 100)}%`}>
          <Slider disabled={!target} min={0} max={100} step={1} value={[Math.round((refine.smooth ?? 0) * 100)]} onValueChange={([v]) => setRefine({ smooth: v / 100 })} />
        </Value>
        <Value label="Kenar Yumuşatma" value={`${Math.round((target?.feather ?? 0) * 100)}%`}>
          <Slider disabled={!target} min={0} max={100} step={1} value={[Math.round((target?.feather ?? 0) * 100)]} onValueChange={([v]) => target && patch(target, { feather: v / 100 })} />
        </Value>
        <Value label="Kontrast" value={`${Math.round((refine.contrast ?? 0) * 100)}%`}>
          <Slider disabled={!target} min={0} max={100} step={1} value={[Math.round((refine.contrast ?? 0) * 100)]} onValueChange={([v]) => setRefine({ contrast: v / 100 })} />
        </Value>
        <Value label="Kenarı Kaydır" value={`${Math.round((refine.shift ?? 0) * 100)}%`}>
          <Slider disabled={!target} min={-100} max={100} step={1} value={[Math.round((refine.shift ?? 0) * 100)]} onValueChange={([v]) => setRefine({ shift: v / 100 })} />
        </Value>
      </section>

      <section id="sec-saved" className="space-y-2">
        <Label>Kayıtlı Seçimler</Label>
        <div className="flex gap-1.5">
          <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Seçim adı" className="h-8 text-xs" onKeyDown={(e) => e.key === "Enter" && saveSelection()} />
          <Button variant="secondary" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={saveSelection}>
            <Save className="!size-3.5" /> Kaydet
          </Button>
        </div>
        {saved.length === 0 && <p className="text-[11px] text-muted-foreground">Kayıtlı seçim yok. Seçimi kaydedip sonra yeniden yükleyebilirsin.</p>}
        {saved.map((s) => (
          <div key={s.id} className="group flex items-center justify-between gap-1 rounded-lg border px-2.5 py-1 text-xs">
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <button className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-primary" title="Mevcut seçimin yerine yükle" onClick={() => load(s, false)}>
              <FolderOpen className="h-3 w-3" /> Yükle
            </button>
            <button className="rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:text-primary" title="Mevcut seçime ekle" onClick={() => load(s, true)}>
              Ekle
            </button>
            <button aria-label="Sil" className="rounded p-0.5 text-muted-foreground hover:text-destructive" onClick={() => patchItem({ selections: saved.filter((x) => x.id !== s.id) })}>
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </section>

      {!!target?.ops?.length && (
        <>
          <section className="space-y-1.5">
            <Label>Seçimle</Label>
            <Button variant="secondary" size="sm" className="w-full text-xs" disabled={!!target.fill} onClick={() => patch(target, { fill: true })} title="Content-Aware Fill: seçili alanı çevresindeki dokuyla kapat">
              <Sparkles className="!size-3.5" /> İçeriğe Duyarlı Dolgu
            </Button>
            <div className="grid grid-cols-2 gap-1.5">
              <Button variant="secondary" size="sm" className="text-xs" disabled={moving} onClick={() => runLayer(false)} title="Seçili alanı yeni bir katmana kopyala">
                {moving ? <Loader2 className="!size-3.5 animate-spin" /> : <Copy className="!size-3.5" />} Kopyala
              </Button>
              <Button variant="secondary" size="sm" className="text-xs" disabled={moving} onClick={() => runLayer(true)} title="Seçili alanı taşı: yeni katman olur, eski yeri çevresinden doldurulur">
                {moving ? <Loader2 className="!size-3.5 animate-spin" /> : <Move className="!size-3.5" />} Taşı
              </Button>
            </div>
            {target.fill && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Alanı Doldur</span>
                <Switch checked onCheckedChange={(v) => patch(target, { fill: v })} />
              </div>
            )}
          </section>
          <section id="sec-adjust-sel" className="space-y-3">
            <MaskAdjustSliders mask={target} set={(p) => patch(target, p)} />
          </section>
        </>
      )}
    </div>
  )
}

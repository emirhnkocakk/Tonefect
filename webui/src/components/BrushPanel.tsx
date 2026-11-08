import { useEffect, useRef, useState } from "react"
import { ArrowLeftRight, ImagePlus, Loader2, RotateCcw, Save, Trash2, Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, thumbUrl } from "@/lib/api"
import { BRUSH_MODES, BRUSH_PRESETS, PRESET_GROUPS, applyPreset, type BrushPreset } from "@/lib/brushes"
import { canvasSize } from "@/lib/geo"
import { useIntent } from "@/lib/hooks"
import { cn } from "@/lib/utils"
import type { BrushSettings, BrushTool, Item, Settings } from "@/types"

type Props = {
  item: Item
  tool: BrushTool
  setTool: (t: BrushTool) => void
  brush: BrushSettings
  setBrush: (p: Partial<BrushSettings>) => void
  smoothing: number
  setSmoothing: (v: number) => void
  patchItem: (p: Partial<Item>) => void
  settings: Settings
  setSettings: (s: Settings) => void
  intent?: { cmd: string; n: number } | null
  target?: string // boya bu katmana gider
}

const thumbCache = new Map<string, string>()

function BrushThumb({ b, tool, className }: { b: BrushSettings; tool?: BrushTool; className?: string }) {
  const key = JSON.stringify([b, tool])
  const [src, setSrc] = useState(thumbCache.get(key) ?? "")
  useEffect(() => {
    const hit = thumbCache.get(key)
    if (hit) return setSrc(hit)
    let alive = true
    const t = setTimeout(() => {
      api.brushThumb({ b, tool }).then((r) => {
        thumbCache.set(key, r.image)
        if (alive) setSrc(r.image)
      }).catch(() => {})
    }, 80)
    return () => {
      alive = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return src ? <img src={src} alt="" draggable={false} className={className} /> : <div className={cn("animate-pulse bg-muted", className)} />
}

function Row({ id, label, value, min, max, step = 1, set }: { id?: string; label: string; value: number; min: number; max: number; step?: number; set: (v: number) => void }) {
  return (
    <div id={id} className="space-y-1.5">
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => set(v)} />
    </div>
  )
}
const Pct = ({ id, label, v, set, max = 100 }: { id?: string; label: string; v: number; set: (x: number) => void; max?: number }) => <Row id={id} label={label} value={Math.round(v * 100)} min={0} max={max} set={(x) => set(x / 100)} />

/** Fırça ve Çizim: araçlar, renk, hazır ayarlar, tüm fırça ayarları. */
export function BrushPanel({ item, tool, setTool, brush: b, setBrush: set, smoothing, setSmoothing, patchItem, settings, setSettings, intent, target }: Props) {
  const [group, setGroup] = useState("all")
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)
  const short = Math.min(...(canvasSize(item.geo, item.src) ?? [1080, 1350]))
  const strokes = item.paint?.strokes ?? []
  const saved = settings.brushes?.presets ?? []
  const tips = settings.brushes?.tips ?? []
  const setBrushes = (p: Partial<NonNullable<Settings["brushes"]>>) => setSettings({ ...settings, brushes: { presets: saved, tips, ...settings.brushes, ...p } })
  const entry = BRUSH_MODES.find((t) => t.tool === tool)
  const scrollTo = (id: string) => setTimeout(() => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    el.classList.add("menu-flash")
    setTimeout(() => el.classList.remove("menu-flash"), 1200)
  }, 60)

  useIntent(intent, "brush:", (cmd) => {
    if (cmd.startsWith("brush:group:")) {
      setGroup(cmd.slice(12))
      scrollTo("sec-presets")
    } else if (cmd.startsWith("brush:sec:")) scrollTo("sec-" + cmd.slice(10))
  })

  const pickPreset = (p: BrushPreset) => {
    set(applyPreset(b, p.b))
    if (p.tool) setTool(p.tool)
    else if (tool !== "brush") setTool("brush")
  }
  const savePreset = () => {
    const n = name.trim().slice(0, 30) || `Fırçam ${saved.length + 1}`
    setBrushes({ presets: [...saved, { id: Math.random().toString(36).slice(2, 9), name: n, group: "mine", tool: tool === "pencil" ? "pencil" : undefined, b }] })
    setName("")
    toast.success("Fırça kaydedildi")
  }
  const addTip = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      const added = []
      for (const f of Array.from(files)) {
        const r = await api.upload(f)
        added.push({ id: Math.random().toString(36).slice(2, 9), photo: r.id, name: r.name })
      }
      setBrushes({ tips: [...tips, ...added] })
      set({ tip: `img:${added[0].photo}` })
    } catch (e: any) {
      toast.error(e.message)
    }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ""
  }

  const list = [...BRUSH_PRESETS, ...saved].filter((p) => group === "all" || p.group === group)
  const isErase = tool === "erase" || tool === "bgerase" || tool === "magic"
  const usesColor = tool === "brush" || tool === "pencil" || tool === "replace" || tool === "mixer"
  const usesTol = tool === "replace" || tool === "bgerase" || tool === "magic"

  return (
    <div className="space-y-5">
      {target && <p className="rounded-md bg-primary/10 px-2 py-1 text-[11px]">Boya hedefi: <span className="font-medium">{target}</span></p>}
      <section className="space-y-2">
        <Label>Araçlar</Label>
        <div className="grid grid-cols-5 gap-1">
          {BRUSH_MODES.map((t) => {
            const I = t.icon
            return (
              <Tooltip key={t.cmd}>
                <TooltipTrigger asChild>
                  <button aria-label={t.label} onClick={() => setTool(t.tool!)} className={cn("grid h-9 place-items-center rounded-md border transition-colors hover:border-primary/60", tool === t.tool ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>
                    <I className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t.label} ({t.en}){t.key ? ` · ${t.key}` : ""}</TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        {entry && <p className="text-[11px] text-muted-foreground"><span className="font-medium text-foreground">{entry.label}</span> · {entry.hint}</p>}
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="ghost" size="sm" className="text-xs" disabled={!strokes.length} onClick={() => patchItem({ paint: { strokes: strokes.slice(0, -1) } })}>
            <Undo2 className="!size-3.5" /> Son Darbe
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" disabled={!strokes.length} onClick={() => patchItem({ paint: undefined })}>
            <RotateCcw className="!size-3.5" /> Boyayı Temizle
          </Button>
        </div>
      </section>

      {usesColor && (
        <section className="flex items-center gap-3">
          <label className="relative h-9 w-9 cursor-pointer overflow-hidden rounded-md border" title="Ön plan rengi" style={{ background: b.color }}>
            <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={b.color} onChange={(e) => set({ color: e.target.value.toUpperCase() })} />
          </label>
          <button aria-label="Renkleri değiştir" title="Renkleri değiştir (X)" className="text-muted-foreground hover:text-primary" onClick={() => set({ color: b.color2, color2: b.color })}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </button>
          <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-md border" title="Arka plan rengi" style={{ background: b.color2 }}>
            <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={b.color2} onChange={(e) => set({ color2: e.target.value.toUpperCase() })} />
          </label>
          <span className="text-[11px] text-muted-foreground">Alt+tıkla: fotoğraftan renk al</span>
        </section>
      )}

      {usesTol && <Pct label="Tolerans" v={b.tol} set={(tol) => set({ tol })} />}
      {tool === "magic" && (
        <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Yalnızca Bitişik Alan</span><Switch checked={b.contiguous} onCheckedChange={(contiguous) => set({ contiguous })} /></div>
      )}
      {tool === "erase" && (
        <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Yalnızca Boyayı Sil</span><Switch checked={b.paintOnly} onCheckedChange={(paintOnly) => set({ paintOnly })} /></div>
      )}
      {tool === "mixer" && (
        <>
          <Pct label="Boya Alma" v={b.pickup} set={(pickup) => set({ pickup })} />
          <Pct label="Fırçadaki Renk" v={b.load} set={(load) => set({ load })} />
        </>
      )}
      {isErase && <p className="text-[11px] text-muted-foreground">Silinen yerler şeffaf olur; dışa aktarırken PNG, WebP ya da TIFF seç.</p>}

      <section id="sec-presets" className="space-y-2">
        <Label>Fırça Hazır Ayarları</Label>
        <div className="flex flex-wrap gap-1">
          {[...PRESET_GROUPS, ...(saved.length ? [["mine", "Benim"] as [string, string]] : [])].map(([g, l]) => (
            <button key={g} onClick={() => setGroup(g)} className={cn("rounded-full border px-2 py-0.5 text-[11px] transition-colors hover:border-primary/60", group === g ? "border-primary/70 bg-primary/15 text-foreground" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {list.map((p) => (
            <div key={p.id} className="group relative">
              <button onClick={() => pickPreset(p)} className="block w-full text-left" title={p.name}>
                <BrushThumb b={applyPreset(b, p.b)} tool={p.tool} className="h-10 w-full rounded-md object-cover ring-1 ring-border transition hover:ring-primary/60" />
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{p.name}</span>
              </button>
              {p.group === "mine" && (
                <button aria-label="Sil" className="absolute right-0.5 top-0.5 hidden rounded bg-background/80 p-0.5 text-muted-foreground hover:text-destructive group-hover:block" onClick={() => setBrushes({ presets: saved.filter((x) => x.id !== p.id) })}>
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fırça adı" className="h-8 text-xs" onKeyDown={(e) => e.key === "Enter" && savePreset()} />
          <Button variant="secondary" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" onClick={savePreset}><Save className="!size-3.5" /> Kaydet</Button>
        </div>
      </section>

      <section id="sec-tips" className="space-y-2">
        <Label>Özel Fırçalar</Label>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => addTip(e.target.files)} />
        <div className="grid grid-cols-5 gap-1">
          <button title="Yuvarlak uç" onClick={() => set({ tip: "round" })} className={cn("grid aspect-square place-items-center rounded-md border hover:border-primary/60", b.tip === "round" ? "border-primary/70 bg-primary/15" : "")}>
            <span className="h-4 w-4 rounded-full bg-foreground" />
          </button>
          {tips.map((t) => (
            <div key={t.id} className="group relative">
              <button title={t.name} onClick={() => set({ tip: `img:${t.photo}` })} className={cn("block aspect-square w-full overflow-hidden rounded-md border hover:border-primary/60", b.tip === `img:${t.photo}` ? "border-primary/70 ring-1 ring-primary" : "")}>
                <img src={thumbUrl(t.photo)} alt="" className="h-full w-full bg-white object-contain" draggable={false} />
              </button>
              <button aria-label="Sil" className="absolute right-0 top-0 hidden rounded bg-background/80 p-0.5 text-muted-foreground hover:text-destructive group-hover:block" onClick={() => { setBrushes({ tips: tips.filter((x) => x.id !== t.id) }); if (b.tip === `img:${t.photo}`) set({ tip: "round" }) }}>
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}
          <button title="Görselden fırça yap" disabled={busy} onClick={() => fileRef.current?.click()} className="grid aspect-square place-items-center rounded-md border border-dashed text-muted-foreground hover:border-primary/60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">Bir görsel seç: şeffaf PNG'de şekli, değilse koyu yerleri fırça ucu olur.</p>
      </section>

      <section id="sec-settings" className="space-y-3">
        <Label>Fırça Ayarları</Label>
        <BrushThumb b={b} tool={tool === "pencil" ? "pencil" : undefined} className="h-12 w-full rounded-md object-cover ring-1 ring-border" />
        <Row id="sec-size" label="Boyut (px)" value={Math.max(1, Math.round(b.size * short))} min={1} max={Math.round(short * 0.5)} set={(v) => set({ size: v / short })} />
        <Pct id="sec-hard" label="Sertlik" v={b.hard} set={(hard) => set({ hard })} />
        <Pct id="sec-opacity" label="Opaklık" v={b.opacity} set={(opacity) => set({ opacity })} />
        <Pct id="sec-flow" label="Akış" v={b.flow} set={(flow) => set({ flow })} />
        <Pct id="sec-smooth" label="Yumuşatma" v={smoothing} set={setSmoothing} />
        <Row id="sec-spacing" label="Aralık (%)" value={Math.round(b.spacing * 100)} min={2} max={300} set={(v) => set({ spacing: v / 100 })} />
        <Row id="sec-angle" label="Açı (°)" value={Math.round(b.angle)} min={-180} max={180} set={(angle) => set({ angle })} />
        <Pct id="sec-round" label="Yuvarlaklık" v={b.round} set={(round) => set({ round: Math.max(0.05, round) })} />
        <div id="sec-press" className="space-y-1.5 rounded-lg border p-2.5">
          <p className="text-xs font-medium">Basınç Hassasiyeti</p>
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Basınç Boyutu Değiştirsin</span><Switch checked={b.pressSize} onCheckedChange={(pressSize) => set({ pressSize })} /></div>
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Basınç Opaklığı Değiştirsin</span><Switch checked={b.pressOpacity} onCheckedChange={(pressOpacity) => set({ pressOpacity })} /></div>
          <p className="text-[10px] text-muted-foreground">Yalnızca kalem tabletlerde çalışır; fareyle tam basınç sayılır.</p>
        </div>
      </section>

      <section id="sec-kinds" className="space-y-3">
        <Label>Doku ve Boya</Label>
        <div className="flex flex-wrap items-center gap-1">
          <span className="w-12 text-xs text-muted-foreground">Doku</span>
          {([["", "Yok"], ["paper", "Kâğıt"], ["canvas", "Kanvas"], ["grain", "Grenli"], ["noise", "Benek"]] as const).map(([v, l]) => (
            <button key={l} onClick={() => set({ tex: v })} className={cn("rounded-md border px-1.5 py-0.5 text-[11px] hover:border-primary/60", b.tex === v ? "border-primary/70 bg-primary/15" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
        {b.tex && <Pct label="Doku Derinliği" v={b.texDepth} set={(texDepth) => set({ texDepth })} />}
        <div className="flex flex-wrap items-center gap-1">
          <span className="w-12 text-xs text-muted-foreground">Desen</span>
          {([["", "Yok"], ["dots", "Nokta"], ["stripes", "Çizgi"], ["checker", "Dama"], ["hatch", "Tarama"]] as const).map(([v, l]) => (
            <button key={l} onClick={() => set({ pattern: v })} className={cn("rounded-md border px-1.5 py-0.5 text-[11px] hover:border-primary/60", b.pattern === v ? "border-primary/70 bg-primary/15" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
        <Pct label="Saçılma" v={b.scatter / 5} set={(v) => set({ scatter: v * 5 })} />
        <Row label="Damga Sayısı" value={b.count} min={1} max={8} set={(count) => set({ count })} />
        <Pct label="Islaklık" v={b.wet} set={(wet) => set({ wet })} />
        <Pct label="Kuruluk" v={b.dry} set={(dry) => set({ dry })} />
      </section>

      <section id="sec-dual" className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between"><Label>Çift Fırça</Label><Switch checked={b.dual} onCheckedChange={(dual) => set({ dual })} /></div>
        {b.dual && (
          <>
            <Pct label="İkinci Uç Boyutu" v={b.dualSize} max={300} set={(dualSize) => set({ dualSize: Math.max(0.1, dualSize) })} />
            <Pct label="İkinci Uç Saçılması" v={b.dualScatter} max={500} set={(dualScatter) => set({ dualScatter })} />
            <Pct label="İkinci Uç Sertliği" v={b.dualHard} set={(dualHard) => set({ dualHard })} />
          </>
        )}
      </section>

      <section id="sec-shape" className="space-y-3 rounded-lg border p-3">
        <Label>Şekil Dinamiği</Label>
        <Pct label="Boyut Değişimi" v={b.sizeJ} set={(sizeJ) => set({ sizeJ })} />
        <Pct label="En Küçük Çap" v={b.minD} set={(minD) => set({ minD })} />
        <Pct label="Açı Değişimi" v={b.angleJ} set={(angleJ) => set({ angleJ })} />
        <Pct label="Yuvarlaklık Değişimi" v={b.roundJ} set={(roundJ) => set({ roundJ })} />
      </section>

      <section id="sec-color" className="space-y-3 rounded-lg border p-3">
        <Label>Renk Dinamiği</Label>
        <Pct label="Ön/Arka Plan Değişimi" v={b.fgbgJ} set={(fgbgJ) => set({ fgbgJ })} />
        <Pct label="Ton Değişimi" v={b.hueJ} set={(hueJ) => set({ hueJ })} />
        <Pct label="Doygunluk Değişimi" v={b.satJ} set={(satJ) => set({ satJ })} />
        <Pct label="Parlaklık Değişimi" v={b.briJ} set={(briJ) => set({ briJ })} />
      </section>
    </div>
  )
}
